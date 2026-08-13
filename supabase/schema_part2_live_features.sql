-- ============================================================
-- VENDIX — Part 2: features that existed only in the ORIGINAL
-- Channel Pulse Supabase project (built directly via SQL Editor
-- over time, never committed back into schema.sql there).
--
-- Run this AFTER schema.sql, BEFORE migration_psi.sql.
--
-- IMPORTANT CAVEAT: this file was reconstructed by reading the
-- frontend JavaScript (which RPCs it calls, with what parameters,
-- and what fields it reads back from each response) — NOT by
-- reading the original project's actual database, which I never
-- had credentials for. The table/column/RLS pieces are inferred
-- from how the UI behaves (e.g. the Users page's "All (unrestricted)"
-- label when no RTM access rows exist). Everything below was tested
-- against a local Postgres instance seeded with sample data and
-- exercised through every RPC before this was handed to you — so
-- the SQL itself is syntactically and logically sound — but I can't
-- guarantee every business rule matches your original project's
-- exact behavior 1:1. Spot-check Dashboard, uploads, and the Users
-- RTM-access restriction once you have real data in, and tell me if
-- anything looks off so I can adjust it.
-- ============================================================

-- ---------------------------------------------------------
-- Columns imei_records grew beyond schema.sql over time
-- ---------------------------------------------------------
alter table imei_records add column if not exists model text;
alter table imei_records add column if not exists activation_remark text;

alter table imei_records drop constraint if exists imei_records_status_check;
alter table imei_records add constraint imei_records_status_check
  check (status in ('unactivated', 'activated', 'not_included'));

create index if not exists idx_imei_records_model on imei_records(model);

-- ---------------------------------------------------------
-- USER RTM ACCESS — restricts a non-admin user to specific RTM
-- categories. No rows for a user = unrestricted (sees everything),
-- matching the Users page's "All (unrestricted)" label.
-- ---------------------------------------------------------
create table if not exists user_rtm_access (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references profiles(id) on delete cascade,
  rtm_category_id bigint not null references rtm_categories(id) on delete cascade,
  unique (user_id, rtm_category_id)
);

alter table user_rtm_access enable row level security;
drop policy if exists "user_rtm_access_select_all" on user_rtm_access;
create policy "user_rtm_access_select_all" on user_rtm_access for select using (auth.role() = 'authenticated');

-- Replace the plain "see everything non-deleted" imei_records policy with
-- one that also honors per-user RTM restriction (admins always see all).
drop policy if exists "imei_select_active_or_admin" on imei_records;
create policy "imei_select_active_or_admin" on imei_records for select using (
  deleted_at is null
  and (
    is_admin()
    or not exists (select 1 from user_rtm_access where user_id = auth.uid())
    or customer_id in (
      select c.id from customers c
      join user_rtm_access ura on ura.rtm_category_id = c.rtm_category_id
      where ura.user_id = auth.uid()
    )
  )
  or is_admin() -- admins can also see soft-deleted (Trash)
);

create or replace function set_user_rtm_access(p_user_id uuid, p_rtm_ids bigint[])
returns void
language plpgsql
security definer
as $$
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;

  delete from user_rtm_access where user_id = p_user_id;

  insert into user_rtm_access (user_id, rtm_category_id)
  select p_user_id, unnest(p_rtm_ids)
  where p_rtm_ids is not null and array_length(p_rtm_ids, 1) > 0;
end;
$$;

-- ---------------------------------------------------------
-- upload_batches.upload_type — add 'combined_report' (migration_psi.sql
-- adds 'shipment_plan' on top of this later; both use the same
-- dynamic-drop trick so order between them doesn't matter)
-- ---------------------------------------------------------
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'upload_batches'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%upload_type%';

  if v_conname is not null then
    execute format('alter table upload_batches drop constraint %I', v_conname);
  end if;

  alter table upload_batches
    add constraint upload_batches_upload_type_check
    check (upload_type in ('ops_export', 'activation_check', 'combined_report'));
end $$;

-- ============================================================
-- CHUNKED UPLOAD RPCs — the frontend uploads big files in 3000-row
-- chunks: create_upload_batch() once, then process_*_chunk() per
-- chunk, then finalize_*() once at the end.
-- ============================================================

create or replace function create_upload_batch(p_file_name text, p_upload_type text)
returns bigint
language plpgsql
security definer
as $$
declare
  v_batch_id bigint;
begin
  if not is_admin_or_sales() then
    raise exception 'Not authorized to upload';
  end if;

  insert into upload_batches (file_name, upload_type, uploaded_by)
  values (p_file_name, p_upload_type, auth.uid())
  returning id into v_batch_id;

  return v_batch_id;
end;
$$;

-- rows: jsonb array shaped like OPS_HEADER_MAP output (see excelParser.js
-- parseOpsExportFile) — imei1, imei2, serial_no, location, date_of_shipment,
-- month, order_reference_no, proforma_invoice_no, customer_name,
-- ship_to_name, actual_customer_forwarder, part_no, description, color,
-- gb, lob, sub_lob, qty, carton_no, apple_week, apple_qtr, apple_year
create or replace function process_ops_export_chunk(p_batch_id bigint, p_rows jsonb)
returns int
language plpgsql
security definer
as $$
declare
  v_inserted int;
begin
  if not is_admin_or_sales() then
    raise exception 'Not authorized to upload';
  end if;

  insert into customers (name)
  select distinct trim(r->>'customer_name')
  from jsonb_array_elements(p_rows) r
  where trim(coalesce(r->>'customer_name','')) <> ''
  on conflict (name) do nothing;

  with inserted as (
    insert into imei_records (
      imei1, imei2, serial_no, location, date_of_shipment, month,
      order_reference_no, proforma_invoice_no, customer_id, ship_to_name,
      actual_customer_forwarder, part_no, description, color, gb, lob, sub_lob,
      qty, carton_no, apple_week, apple_qtr, apple_year, upload_batch_id
    )
    select
      r->>'imei1', r->>'imei2', r->>'serial_no', r->>'location',
      nullif(r->>'date_of_shipment','')::date, r->>'month',
      r->>'order_reference_no', r->>'proforma_invoice_no', c.id, r->>'ship_to_name',
      r->>'actual_customer_forwarder', r->>'part_no', r->>'description', r->>'color', r->>'gb', r->>'lob', r->>'sub_lob',
      coalesce((r->>'qty')::int, 1), r->>'carton_no',
      coalesce(r->>'apple_week', ac.apple_week),
      coalesce(r->>'apple_qtr', ac.apple_qtr),
      coalesce(r->>'apple_year', ac.apple_year),
      p_batch_id
    from jsonb_array_elements(p_rows) r
    left join customers c on c.name = trim(r->>'customer_name')
    left join apple_calendar ac on ac.calendar_date = nullif(r->>'date_of_shipment','')::date
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

-- rows: jsonb array shaped like COMBINED_HEADER_MAP output — imei1, imei2,
-- serial_no, model, description, part_no, qty, proforma_invoice_no,
-- customer_name, date_of_shipment, status, activated_date, activation_remark
create or replace function process_combined_report_chunk(p_batch_id bigint, p_rows jsonb)
returns int
language plpgsql
security definer
as $$
declare
  v_inserted int;
begin
  if not is_admin_or_sales() then
    raise exception 'Not authorized to upload';
  end if;

  insert into customers (name)
  select distinct trim(r->>'customer_name')
  from jsonb_array_elements(p_rows) r
  where trim(coalesce(r->>'customer_name','')) <> ''
  on conflict (name) do nothing;

  with inserted as (
    insert into imei_records (
      imei1, imei2, serial_no, model, description, part_no, qty,
      proforma_invoice_no, customer_id, date_of_shipment, apple_week, apple_qtr, apple_year,
      status, activated_date, activated_apple_week, activated_apple_qtr, activated_apple_year,
      activation_remark, upload_batch_id
    )
    select
      r->>'imei1', r->>'imei2', r->>'serial_no', r->>'model', r->>'description', r->>'part_no',
      coalesce((r->>'qty')::int, 1),
      r->>'proforma_invoice_no', c.id,
      nullif(r->>'date_of_shipment','')::date,
      ac_ship.apple_week, ac_ship.apple_qtr, ac_ship.apple_year,
      coalesce(r->>'status', 'unactivated'),
      nullif(r->>'activated_date','')::date,
      ac_act.apple_week, ac_act.apple_qtr, ac_act.apple_year,
      r->>'activation_remark',
      p_batch_id
    from jsonb_array_elements(p_rows) r
    left join customers c on c.name = trim(r->>'customer_name')
    left join apple_calendar ac_ship on ac_ship.calendar_date = nullif(r->>'date_of_shipment','')::date
    left join apple_calendar ac_act on ac_act.calendar_date = nullif(r->>'activated_date','')::date
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

-- shared finalize step for ops_export AND combined_report batches —
-- flags duplicate IMEIs and returns the summary both upload pages read.
create or replace function finalize_ops_or_combined_batch(p_batch_id bigint, p_total_rows int)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_new_count int;
  v_dup_count int;
  v_activated_count int;
begin
  update imei_records
  set is_duplicate = true
  where deleted_at is null
    and imei1 in (
      select imei1 from imei_records where deleted_at is null group by imei1 having count(*) > 1
    );

  select count(*) filter (where is_duplicate), count(*) filter (where not is_duplicate), count(*) filter (where status = 'activated')
    into v_dup_count, v_new_count, v_activated_count
  from imei_records where upload_batch_id = p_batch_id;

  update upload_batches set row_count = p_total_rows, new_count = v_new_count, duplicate_count = v_dup_count
  where id = p_batch_id;

  insert into activity_log (user_id, action, target_table, target_id, details)
  values (auth.uid(), 'upload', 'upload_batches', p_batch_id::text,
    jsonb_build_object('rowCount', p_total_rows, 'newCount', v_new_count, 'duplicateCount', v_dup_count));

  return jsonb_build_object(
    'batchId', p_batch_id,
    'totalRows', p_total_rows,
    'newRecords', v_new_count,
    'flaggedDuplicates', v_dup_count,
    'activatedCount', v_activated_count
  );
end;
$$;

-- rows: jsonb array of {imei1, activated_date, device_model}
create or replace function process_activation_check_chunk(p_batch_id bigint, p_rows jsonb)
returns int
language plpgsql
security definer
as $$
declare
  v_updated int;
begin
  if not is_admin_or_sales() then
    raise exception 'Not authorized to upload';
  end if;

  with updates as (
    update imei_records r
    set status = 'activated',
        activated_date = nullif(x->>'activated_date','')::date,
        device_model = coalesce(x->>'device_model', r.device_model),
        activated_apple_week = ac.apple_week,
        activated_apple_qtr = ac.apple_qtr,
        activated_apple_year = ac.apple_year,
        activation_batch_id = p_batch_id,
        updated_at = now()
    from jsonb_array_elements(p_rows) x
    left join apple_calendar ac on ac.calendar_date = nullif(x->>'activated_date','')::date
    where r.imei1 = x->>'imei1' and r.deleted_at is null
    returning r.id
  )
  select count(*) into v_updated from updates;

  return v_updated;
end;
$$;

create or replace function finalize_activation_batch(p_batch_id bigint, p_total_rows int, p_updated_count int)
returns jsonb
language plpgsql
security definer
as $$
begin
  update upload_batches
  set row_count = p_total_rows, updated_count = p_updated_count, error_count = p_total_rows - p_updated_count
  where id = p_batch_id;

  insert into activity_log (user_id, action, target_table, target_id, details)
  values (auth.uid(), 'upload', 'upload_batches', p_batch_id::text,
    jsonb_build_object('type', 'activation_check', 'rowCount', p_total_rows, 'updatedCount', p_updated_count));

  return jsonb_build_object(
    'batchId', p_batch_id,
    'activatedRowsInFile', p_total_rows,
    'recordsUpdated', p_updated_count,
    'imeiNotFoundInSystem', p_total_rows - p_updated_count
  );
end;
$$;

-- ------------------------------------------------------------------
-- hard_delete_batch(batch_id) — admin only.
-- activation_check batches: revert affected records to 'unactivated'
--   (the underlying sale record is kept — matches the confirm dialog
--   text in manage-uploads.html).
-- every other batch type: permanently delete every record it created.
-- ------------------------------------------------------------------
create or replace function hard_delete_batch(p_batch_id bigint)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_type text;
  v_affected int;
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;

  select upload_type into v_type from upload_batches where id = p_batch_id;
  if v_type is null then
    raise exception 'Upload batch not found';
  end if;

  if v_type = 'activation_check' then
    with reverted as (
      update imei_records
      set status = 'unactivated', activated_date = null,
          activated_apple_week = null, activated_apple_qtr = null, activated_apple_year = null,
          activation_batch_id = null, updated_at = now()
      where activation_batch_id = p_batch_id
      returning 1
    )
    select count(*) into v_affected from reverted;
  elsif v_type = 'shipment_plan' then
    with deleted as (
      delete from shipment_plan_items where upload_batch_id = p_batch_id returning 1
    )
    select count(*) into v_affected from deleted;
  else
    with deleted as (
      delete from imei_records where upload_batch_id = p_batch_id returning 1
    )
    select count(*) into v_affected from deleted;
  end if;

  delete from upload_batches where id = p_batch_id;

  return jsonb_build_object('recordsAffected', v_affected);
end;
$$;

create or replace function hard_delete_all_uploads()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_deleted int;
  v_batches int;
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;

  select count(*) into v_deleted from imei_records;
  select count(*) into v_batches from upload_batches;

  delete from imei_records;
  delete from shipment_plan_items;
  delete from upload_batches;

  return jsonb_build_object('recordsDeleted', v_deleted, 'batchesDeleted', v_batches);
end;
$$;

-- ------------------------------------------------------------------
-- get_dashboard_filter_options() — populates the RTM/Customer/Model/
-- Qtr/Week multi-select filters on Dashboard and Inventory.
-- ------------------------------------------------------------------
create or replace function get_dashboard_filter_options()
returns jsonb
language sql
stable
security definer
as $$
  select jsonb_build_object(
    'rtmCategories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb) from rtm_categories),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb) from customers),
    'models', (select coalesce(jsonb_agg(distinct model order by model), '[]'::jsonb) from imei_records where deleted_at is null and model is not null and model <> ''),
    'qtrs', (select coalesce(jsonb_agg(distinct apple_qtr order by apple_qtr), '[]'::jsonb) from imei_records where deleted_at is null and apple_qtr is not null and apple_qtr <> ''),
    'weeks', (select coalesce(jsonb_agg(distinct apple_week order by apple_week), '[]'::jsonb) from imei_records where deleted_at is null and apple_week is not null and apple_week <> '')
  );
$$;

-- ------------------------------------------------------------------
-- get_dashboard_v3(date_mode, rtm_ids, customer_ids, models, qtrs, weeks)
-- date_mode: 'sales' groups by apple_qtr/apple_week (shipment date);
--   'activation' groups by activated_apple_qtr/activated_apple_week.
-- Returns everything public/js/dashboard.js destructures:
--   totals, salesTrend, activationTrend, byRtmCategory, modelMix,
--   topCustomersPending, heatmap, duplicateTrend
-- ------------------------------------------------------------------
create or replace function get_dashboard_v3(
  p_date_mode text default 'sales',
  p_rtm_category_ids bigint[] default '{}',
  p_customer_ids bigint[] default '{}',
  p_models text[] default '{}',
  p_qtrs text[] default '{}',
  p_weeks text[] default '{}'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Not authorized';
  end if;

  create temp table _dash_units on commit drop as
  select r.*, c.rtm_category_id, rc.name as rtm_category_name
  from imei_records r
  left join customers c on r.customer_id = c.id
  left join rtm_categories rc on c.rtm_category_id = rc.id
  where r.deleted_at is null
    and (array_length(p_rtm_category_ids, 1) is null or c.rtm_category_id = any(p_rtm_category_ids))
    and (array_length(p_customer_ids, 1) is null or r.customer_id = any(p_customer_ids))
    and (array_length(p_models, 1) is null or r.model = any(p_models))
    and (array_length(p_qtrs, 1) is null or r.apple_qtr = any(p_qtrs))
    and (array_length(p_weeks, 1) is null or r.apple_week = any(p_weeks));

  with totals as (
    select
      count(*) as units_sold,
      count(*) filter (where status = 'activated') as activated,
      count(*) filter (where status = 'unactivated') as not_activated,
      count(*) filter (where status = 'not_included') as not_included
    from _dash_units
  ),
  sales_trend as (
    select apple_qtr as f_qtr, apple_week as f_week, count(*) as sold
    from _dash_units
    where apple_qtr is not null and apple_week is not null
    group by apple_qtr, apple_week
  ),
  activation_trend as (
    select activated_apple_qtr as f_qtr, activated_apple_week as f_week, count(*) as activated
    from _dash_units
    where status = 'activated' and activated_apple_qtr is not null and activated_apple_week is not null
    group by activated_apple_qtr, activated_apple_week
  ),
  by_rtm as (
    select coalesce(rtm_category_name, 'Uncategorized') as rtm_category,
           count(*) filter (where status = 'unactivated') as in_channel,
           count(*) filter (where status = 'activated') as activated
    from _dash_units
    group by coalesce(rtm_category_name, 'Uncategorized')
    order by in_channel desc
  ),
  model_mix as (
    select coalesce(nullif(model, ''), 'Unspecified') as model,
           count(*) filter (where status = 'unactivated') as in_channel,
           count(*) filter (where status = 'activated') as activated
    from _dash_units
    group by coalesce(nullif(model, ''), 'Unspecified')
    order by in_channel desc
    limit 15
  ),
  top_customers as (
    select coalesce(c.name, 'Unknown Customer') as customer_name, count(*) as pending
    from _dash_units u
    left join customers c on u.customer_id = c.id
    where u.status = 'unactivated'
    group by coalesce(c.name, 'Unknown Customer')
    order by pending desc
    limit 10
  ),
  heat as (
    select
      (case when p_date_mode = 'activation' then activated_apple_qtr else apple_qtr end) as qtr,
      (case when p_date_mode = 'activation' then activated_apple_week else apple_week end) as week,
      count(*) filter (where status = 'activated') as activated,
      count(*) as total
    from _dash_units
    where (case when p_date_mode = 'activation' then activated_apple_qtr else apple_qtr end) is not null
      and (case when p_date_mode = 'activation' then activated_apple_week else apple_week end) is not null
    group by 1, 2
  ),
  dup_trend as (
    select b.file_name, b.uploaded_at, b.duplicate_count
    from upload_batches b
    where b.duplicate_count > 0
    order by b.uploaded_at desc
    limit 10
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object('units_sold', units_sold, 'activated', activated, 'not_activated', not_activated, 'not_included', not_included) from totals),
    'salesTrend', (select coalesce(jsonb_agg(jsonb_build_object('f_qtr', f_qtr, 'f_week', f_week, 'sold', sold)), '[]'::jsonb) from sales_trend),
    'activationTrend', (select coalesce(jsonb_agg(jsonb_build_object('f_qtr', f_qtr, 'f_week', f_week, 'activated', activated)), '[]'::jsonb) from activation_trend),
    'byRtmCategory', (select coalesce(jsonb_agg(jsonb_build_object('rtm_category', rtm_category, 'in_channel', in_channel, 'activated', activated)), '[]'::jsonb) from by_rtm),
    'modelMix', (select coalesce(jsonb_agg(jsonb_build_object('model', model, 'in_channel', in_channel, 'activated', activated)), '[]'::jsonb) from model_mix),
    'topCustomersPending', (select coalesce(jsonb_agg(jsonb_build_object('customer_name', customer_name, 'pending', pending)), '[]'::jsonb) from top_customers),
    'heatmap', (select coalesce(jsonb_agg(jsonb_build_object('qtr', qtr, 'week', week, 'activated', activated, 'total', total, 'activation_rate', case when total > 0 then round(activated * 100.0 / total) else 0 end)), '[]'::jsonb) from heat),
    'duplicateTrend', (select coalesce(jsonb_agg(jsonb_build_object('file_name', file_name, 'uploaded_at', uploaded_at, 'duplicate_count', duplicate_count)), '[]'::jsonb) from dup_trend)
  ) into v_result;

  return v_result;
end;
$$;
