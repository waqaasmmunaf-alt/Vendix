-- ============================================================
-- PSI FILES FEATURE — v2, built from your REAL Purchase/Sales/Inventory/
-- Shipment-Plan workbooks (not from guessed IMEI-level data).
-- Run this in Supabase Dashboard → SQL Editor → New Query → Run,
-- AFTER schema.sql and schema_part2_live_features.sql (and before or
-- after seed_apple_calendar.sql — order doesn't matter for this file).
-- Safe to run more than once (drops + recreates its own objects only).
--
-- Why "v2": your 3 real files are SKU/Part-No level ledgers and
-- warehouse snapshots — not per-IMEI records — so this deliberately
-- does NOT touch or depend on imei_records / activation data at all
-- (per your instruction: don't mix the two; IMEI-based Activated/
-- In-Channel numbers can be layered back in later if you ever upload
-- a matching per-IMEI activation file — nothing here blocks that).
--
-- What this adds:
--   1. sales_transactions      — one row per line in your Sales ledger
--      ("Sales till <date>" sheet). Cumulative history, deduped by
--      (document_number, part_no) so re-uploading the same file (it's a
--      running export back to 2019) doesn't double your numbers.
--   2. purchase_transactions   — same idea, for the Purchase ledger
--      ("Purchases till <date>" sheet).
--   3. inventory_snapshots     — one row per (Part No, warehouse
--      location) from the "CONSOLIDATED with Value" sheet. Each upload
--      is a full point-in-time snapshot; the PSI report always uses the
--      MOST RECENT snapshot batch only (not summed across uploads).
--   4. psi_location_groups     — maps your real warehouse columns (SG,
--      Dafza, DCC, Dubai, Dubai Leading, HK, PK IT, PK) into the 3
--      buckets from your PSI format image (SG / DXB / LE PK). This is
--      a best-effort default mapping — see ASSUMPTIONS below — edit
--      this table any time to fix it, no code change needed:
--        update psi_location_groups set group_label = 'DXB' where location = 'HK';
--   5. shipment_plan_items / shipment_plan_weeks — one row per Part No
--      (+ its dynamic weekly columns) from the "Shipment plan" sheet.
--      Reads the week labels/dates straight out of the file, so it
--      keeps working next month even though the sheet's own column
--      labels shift forward every week.
--   6. get_psi_report_v2() — the report behind the PSI Report page.
--   7. get_sales_trend()   — weekly sales trend behind the Dashboard's
--      new Sales Trend panel.
--   8. get_psi_filter_options() — LOB / Sub LOB dropdown values.
--
-- ------------------------------------------------------------------
-- ASSUMPTIONS — please sanity-check these against real numbers:
--
--   • Sell-in    = sum of Qty from the Purchase ledger within the
--                  selected period (This Week / This Month / This
--                  Quarter / All Time — a dropdown on the report).
--   • Sell-thru  = sum of Qty from the Sales ledger, same period.
--   • Inventory-in-hand (SG / DXB / LE PK) = latest Inventory snapshot
--     only, grouped via psi_location_groups. Default mapping:
--       SG      → SG
--       DXB     → Dafza, DCC, Dubai, Dubai Leading, HK
--       LE PK   → PK IT, PK
--     ("LE PK" reuses the label from your format image; I mapped
--     Pakistan's two columns to it since nothing in the file is
--     literally labelled "LE". Tell me the right split and I'll fix
--     the table above.)
--   • Shipment Plan Wk-1/2/3 = the first 3 weekly columns from the
--     MOST RECENT Shipment Plan upload, in the order the file lists
--     them (this week + next 2), matched to a LOB/Sub LOB by
--     Product Category ↔ LOB and Model ↔ Sub LOB (case/space-
--     insensitive text match — check the "unmatchedShipmentQty" field
--     the report returns; a high number means naming doesn't line up
--     between your Shipment Plan file and your Sales/Purchase files).
--   • Backlog = sum of "Total Backlog" from that same latest upload.
--   • Total Upcoming = Wk-1 + Wk-2 + Wk-3 + Backlog.
--   • DOS (Days of Supply) = current inventory qty ÷ (sell-through qty
--     in the selected period ÷ days in that period).
--   • WOS (Weeks of Supply) = DOS ÷ 7.
--   • Duplicate protection: re-uploading a Sales/Purchase file skips
--     any (Document Number, Part No) pair already in the database —
--     safe for the "full history every time" export style these files
--     use. If two genuinely different lines ever share both fields,
--     the second is silently skipped — tell me if that happens.
-- ------------------------------------------------------------------

drop function if exists get_psi_report(bigint[], bigint[], text[]) cascade;
drop function if exists get_psi_report_v2(text[], text[], text) cascade;
drop function if exists get_sales_trend(text, int, text[]) cascade;
drop function if exists get_psi_filter_options() cascade;
drop function if exists process_shipment_plan_chunk(bigint, jsonb) cascade;
drop function if exists finalize_shipment_plan_batch(bigint, int) cascade;
drop function if exists process_sales_ledger_chunk(bigint, jsonb) cascade;
drop function if exists finalize_sales_ledger_batch(bigint, int) cascade;
drop function if exists process_purchase_ledger_chunk(bigint, jsonb) cascade;
drop function if exists finalize_purchase_ledger_batch(bigint, int) cascade;
drop function if exists process_inventory_snapshot_chunk(bigint, jsonb) cascade;
drop function if exists finalize_inventory_snapshot_batch(bigint, int) cascade;

drop table if exists shipment_plan_weeks cascade;
drop table if exists shipment_plan_items cascade;

-- ---------------------------------------------------------
-- Allow the new upload types
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
    check (upload_type in (
      'ops_export', 'activation_check', 'combined_report', 'shipment_plan',
      'sales_ledger', 'purchase_ledger', 'inventory_snapshot'
    ));
end $$;

-- ---------------------------------------------------------
-- SALES TRANSACTIONS  (from "Sales till ..." sheet)
-- ---------------------------------------------------------
create table sales_transactions (
    id              bigint generated always as identity primary key,
    upload_batch_id bigint references upload_batches(id),
    part_no         text,
    lob             text,
    sub_lob         text,
    description     text,
    sale_date       date,
    apple_year      text,
    apple_qtr       text,
    apple_week      text,
    document_number text,
    qty             numeric,
    cost            numeric,
    sale_price      numeric,
    revenue         numeric,
    customer_name   text,
    sales_person    text,
    created_at      timestamptz not null default now(),
    unique (document_number, part_no)
);
create index idx_sales_txn_date on sales_transactions(sale_date);
create index idx_sales_txn_lob on sales_transactions(lob, sub_lob);
create index idx_sales_txn_batch on sales_transactions(upload_batch_id);

alter table sales_transactions enable row level security;
create policy "sales_txn_select_all" on sales_transactions for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------
-- PURCHASE TRANSACTIONS  (from "Purchases till ..." sheet)
-- ---------------------------------------------------------
create table purchase_transactions (
    id              bigint generated always as identity primary key,
    upload_batch_id bigint references upload_batches(id),
    part_no         text,
    lob             text,
    sub_lob         text,
    description     text,
    purchase_date   date,
    apple_year      text,
    apple_qtr       text,
    apple_week      text,
    document_number text,
    qty             numeric,
    price           numeric,
    amount          numeric,
    vendor          text,
    created_at      timestamptz not null default now(),
    unique (document_number, part_no)
);
create index idx_purchase_txn_date on purchase_transactions(purchase_date);
create index idx_purchase_txn_lob on purchase_transactions(lob, sub_lob);
create index idx_purchase_txn_batch on purchase_transactions(upload_batch_id);

alter table purchase_transactions enable row level security;
create policy "purchase_txn_select_all" on purchase_transactions for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------
-- INVENTORY SNAPSHOTS  (from "CONSOLIDATED with Value" sheet)
-- One row per Part No x Location. Report always uses latest batch only.
-- ---------------------------------------------------------
create table inventory_snapshots (
    id              bigint generated always as identity primary key,
    upload_batch_id bigint references upload_batches(id),
    snapshot_date   date,
    part_no         text,
    lob             text,
    sub_lob         text,
    description     text,
    location        text,   -- raw warehouse column name, e.g. 'SG', 'Dafza', 'PK'
    qty             numeric,
    value           numeric,
    created_at      timestamptz not null default now()
);
create index idx_inv_snap_batch on inventory_snapshots(upload_batch_id);
create index idx_inv_snap_lob on inventory_snapshots(lob, sub_lob);
create index idx_inv_snap_location on inventory_snapshots(location);

alter table inventory_snapshots enable row level security;
create policy "inv_snap_select_all" on inventory_snapshots for select using (auth.role() = 'authenticated');

-- Maps raw warehouse location names -> the 3 PSI report buckets.
-- Edit freely: update psi_location_groups set group_label = '...' where location = '...';
create table if not exists psi_location_groups (
    location    text primary key,
    group_label text not null,
    sort_order  int not null default 0
);
insert into psi_location_groups (location, group_label, sort_order) values
  ('SG', 'SG', 1),
  ('Dafza', 'DXB', 2),
  ('DCC', 'DXB', 2),
  ('Dubai', 'DXB', 2),
  ('Dubai Leading', 'DXB', 2),
  ('HK', 'DXB', 2),
  ('PK IT', 'LE PK', 3),
  ('PK', 'LE PK', 3)
on conflict (location) do nothing;

-- ---------------------------------------------------------
-- SHIPMENT PLAN  (from "Shipment plan" sheet — dynamic weekly columns)
-- ---------------------------------------------------------
create table shipment_plan_items (
    id                bigint generated always as identity primary key,
    upload_batch_id   bigint references upload_batches(id),
    product_category  text,   -- LOB
    model             text,   -- Sub LOB / model name
    part_no           text,   -- Apple Part#
    description       text,
    total_backlog     numeric default 0,
    rollover_qty      numeric default 0,
    created_at        timestamptz not null default now()
);
create index idx_shipplan_item_batch on shipment_plan_items(upload_batch_id);
create index idx_shipplan_item_cat on shipment_plan_items(product_category, model);

create table shipment_plan_weeks (
    id                     bigint generated always as identity primary key,
    shipment_plan_item_id  bigint references shipment_plan_items(id) on delete cascade,
    week_index             int not null,   -- 1 = nearest week, 2 = next, ...
    week_label             text,           -- e.g. 'FY26 Q4 WK7'
    week_ending            date,
    planned_qty            numeric default 0
);
create index idx_shipplan_week_item on shipment_plan_weeks(shipment_plan_item_id);
create index idx_shipplan_week_idx on shipment_plan_weeks(week_index);

alter table shipment_plan_items enable row level security;
alter table shipment_plan_weeks enable row level security;
create policy "shipplan_item_select_all" on shipment_plan_items for select using (auth.role() = 'authenticated');
create policy "shipplan_week_select_all" on shipment_plan_weeks for select using (auth.role() = 'authenticated');

-- ============================================================
-- UPLOAD RPCs — same chunked create/process/finalize pattern as the
-- existing ops_export / activation_check uploads.
-- ============================================================

-- ---- Sales ledger ----
create or replace function process_sales_ledger_chunk(p_batch_id bigint, p_rows jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_inserted int;
  v_skipped int;
  v_row_count int;
begin
  if not is_admin_or_sales() then
    raise exception 'Not authorized to upload';
  end if;

  select count(*) into v_row_count from jsonb_array_elements(p_rows);

  with inserted as (
    insert into sales_transactions (
      upload_batch_id, part_no, lob, sub_lob, description, sale_date,
      apple_year, apple_qtr, apple_week, document_number, qty, cost,
      sale_price, revenue, customer_name, sales_person
    )
    select
      p_batch_id,
      r->>'partNo', r->>'lob', r->>'subLob', r->>'description',
      nullif(r->>'saleDate','')::date,
      r->>'appleYear', r->>'appleQtr', r->>'appleWeek', r->>'documentNumber',
      nullif(r->>'qty','')::numeric, nullif(r->>'cost','')::numeric,
      nullif(r->>'salePrice','')::numeric, nullif(r->>'revenue','')::numeric,
      r->>'customerName', r->>'salesPerson'
    from jsonb_array_elements(p_rows) r
    on conflict (document_number, part_no) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  v_skipped := v_row_count - v_inserted;
  return jsonb_build_object('inserted', v_inserted, 'skippedDuplicates', v_skipped);
end;
$$;

create or replace function finalize_sales_ledger_batch(p_batch_id bigint, p_total_rows int)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row_count int;
begin
  select count(*) into v_row_count from sales_transactions where upload_batch_id = p_batch_id;
  update upload_batches set row_count = p_total_rows, new_count = v_row_count where id = p_batch_id;
  insert into activity_log (user_id, action, target_table, target_id, details)
  values (auth.uid(), 'upload', 'upload_batches', p_batch_id::text,
    jsonb_build_object('type', 'sales_ledger', 'rowCount', p_total_rows, 'newCount', v_row_count));
  return jsonb_build_object('batchId', p_batch_id, 'totalRows', p_total_rows, 'rowsAdded', v_row_count);
end;
$$;

-- ---- Purchase ledger ----
create or replace function process_purchase_ledger_chunk(p_batch_id bigint, p_rows jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_inserted int;
  v_skipped int;
  v_row_count int;
begin
  if not is_admin_or_sales() then
    raise exception 'Not authorized to upload';
  end if;

  select count(*) into v_row_count from jsonb_array_elements(p_rows);

  with inserted as (
    insert into purchase_transactions (
      upload_batch_id, part_no, lob, sub_lob, description, purchase_date,
      apple_year, apple_qtr, apple_week, document_number, qty, price, amount, vendor
    )
    select
      p_batch_id,
      r->>'partNo', r->>'lob', r->>'subLob', r->>'description',
      nullif(r->>'purchaseDate','')::date,
      r->>'appleYear', r->>'appleQtr', r->>'appleWeek', r->>'documentNumber',
      nullif(r->>'qty','')::numeric, nullif(r->>'price','')::numeric,
      nullif(r->>'amount','')::numeric, r->>'vendor'
    from jsonb_array_elements(p_rows) r
    on conflict (document_number, part_no) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  v_skipped := v_row_count - v_inserted;
  return jsonb_build_object('inserted', v_inserted, 'skippedDuplicates', v_skipped);
end;
$$;

create or replace function finalize_purchase_ledger_batch(p_batch_id bigint, p_total_rows int)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row_count int;
begin
  select count(*) into v_row_count from purchase_transactions where upload_batch_id = p_batch_id;
  update upload_batches set row_count = p_total_rows, new_count = v_row_count where id = p_batch_id;
  insert into activity_log (user_id, action, target_table, target_id, details)
  values (auth.uid(), 'upload', 'upload_batches', p_batch_id::text,
    jsonb_build_object('type', 'purchase_ledger', 'rowCount', p_total_rows, 'newCount', v_row_count));
  return jsonb_build_object('batchId', p_batch_id, 'totalRows', p_total_rows, 'rowsAdded', v_row_count);
end;
$$;

-- ---- Inventory snapshot ----
create or replace function process_inventory_snapshot_chunk(p_batch_id bigint, p_rows jsonb)
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

  with inserted as (
    insert into inventory_snapshots (
      upload_batch_id, snapshot_date, part_no, lob, sub_lob, description, location, qty, value
    )
    select
      p_batch_id,
      nullif(r->>'snapshotDate','')::date,
      r->>'partNo', r->>'lob', r->>'subLob', r->>'description', r->>'location',
      nullif(r->>'qty','')::numeric, nullif(r->>'value','')::numeric
    from jsonb_array_elements(p_rows) r
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

create or replace function finalize_inventory_snapshot_batch(p_batch_id bigint, p_total_rows int)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row_count int;
begin
  select count(*) into v_row_count from inventory_snapshots where upload_batch_id = p_batch_id;
  update upload_batches set row_count = p_total_rows, new_count = v_row_count where id = p_batch_id;
  insert into activity_log (user_id, action, target_table, target_id, details)
  values (auth.uid(), 'upload', 'upload_batches', p_batch_id::text,
    jsonb_build_object('type', 'inventory_snapshot', 'rowCount', p_total_rows, 'newCount', v_row_count));
  return jsonb_build_object('batchId', p_batch_id, 'totalRows', p_total_rows, 'rowsAdded', v_row_count);
end;
$$;

-- ---- Shipment plan (rows carry a nested "weeks" array) ----
create or replace function process_shipment_plan_chunk(p_batch_id bigint, p_rows jsonb)
returns int
language plpgsql
security definer
as $$
declare
  v_inserted int := 0;
  r jsonb;
  v_item_id bigint;
  w jsonb;
begin
  if not is_admin_or_sales() then
    raise exception 'Not authorized to upload';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into shipment_plan_items (
      upload_batch_id, product_category, model, part_no, description, total_backlog, rollover_qty
    )
    values (
      p_batch_id, r->>'productCategory', r->>'model', r->>'partNo', r->>'description',
      coalesce((r->>'totalBacklog')::numeric, 0), coalesce((r->>'rolloverQty')::numeric, 0)
    )
    returning id into v_item_id;

    for w in select * from jsonb_array_elements(coalesce(r->'weeks', '[]'::jsonb)) loop
      insert into shipment_plan_weeks (shipment_plan_item_id, week_index, week_label, week_ending, planned_qty)
      values (
        v_item_id,
        coalesce((w->>'weekIndex')::int, 1),
        w->>'weekLabel',
        nullif(w->>'weekEnding','')::date,
        coalesce((w->>'plannedQty')::numeric, 0)
      );
    end loop;

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

create or replace function finalize_shipment_plan_batch(p_batch_id bigint, p_total_rows int)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row_count int;
begin
  select count(*) into v_row_count from shipment_plan_items where upload_batch_id = p_batch_id;
  update upload_batches set row_count = p_total_rows, new_count = v_row_count where id = p_batch_id;
  insert into activity_log (user_id, action, target_table, target_id, details)
  values (auth.uid(), 'upload', 'upload_batches', p_batch_id::text,
    jsonb_build_object('type', 'shipment_plan', 'rowCount', p_total_rows, 'newCount', v_row_count));
  return jsonb_build_object('batchId', p_batch_id, 'totalRows', p_total_rows, 'rowsAdded', v_row_count);
end;
$$;

-- ============================================================
-- get_psi_filter_options() — LOB / Sub LOB values across all 3 sources
-- ============================================================
create or replace function get_psi_filter_options()
returns jsonb
language sql
stable
security definer
as $$
  select jsonb_build_object(
    'lobs', (
      select coalesce(jsonb_agg(distinct lob order by lob), '[]'::jsonb) from (
        select nullif(trim(lob), '') as lob from sales_transactions
        union select nullif(trim(lob), '') from purchase_transactions
        union select nullif(trim(lob), '') from inventory_snapshots
      ) x where lob is not null
    ),
    'subLobs', (
      select coalesce(jsonb_agg(distinct sub_lob order by sub_lob), '[]'::jsonb) from (
        select nullif(trim(sub_lob), '') as sub_lob from sales_transactions
        union select nullif(trim(sub_lob), '') from purchase_transactions
        union select nullif(trim(sub_lob), '') from inventory_snapshots
      ) x where sub_lob is not null
    )
  );
$$;

-- ============================================================
-- get_sales_trend(p_group_by, p_periods, p_lobs)
-- Weekly (or monthly) Qty + Revenue trend for the Dashboard, plus a
-- by-LOB breakdown for the same window.
-- ============================================================
create or replace function get_sales_trend(
  p_group_by text default 'week',   -- 'week' | 'month'
  p_periods int default 16,
  p_lobs text[] default '{}'
)
returns jsonb
language plpgsql
stable
security definer
as $$
declare
  v_result jsonb;
  v_unit text;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Not authorized';
  end if;

  v_unit := case when p_group_by = 'month' then 'month' else 'week' end;

  with filtered as (
    select sale_date, qty, revenue, lob
    from sales_transactions
    where sale_date is not null
      and (array_length(p_lobs, 1) is null or lob = any(p_lobs))
  ),
  periods as (
    select date_trunc(v_unit, gs)::date as period_start
    from generate_series(
      date_trunc(v_unit, current_date) - ((p_periods - 1) || ' ' || v_unit)::interval,
      date_trunc(v_unit, current_date),
      ('1 ' || v_unit)::interval
    ) gs
  ),
  agg as (
    select p.period_start,
      coalesce(sum(f.qty), 0) as qty,
      coalesce(sum(f.revenue), 0) as revenue
    from periods p
    left join filtered f on date_trunc(v_unit, f.sale_date) = p.period_start
    group by p.period_start
  ),
  by_lob as (
    select coalesce(nullif(trim(lob), ''), 'Other') as lob, sum(qty) as qty, sum(revenue) as revenue
    from filtered
    where sale_date >= (select min(period_start) from periods)
    group by 1
    order by sum(revenue) desc
    limit 8
  )
  select jsonb_build_object(
    'groupBy', v_unit,
    'points', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'periodStart', period_start,
        'label', to_char(period_start, case when v_unit = 'month' then 'Mon YYYY' else 'DD Mon' end),
        'qty', qty,
        'revenue', round(revenue::numeric, 2)
      ) order by period_start), '[]'::jsonb)
      from agg
    ),
    'byLob', (
      select coalesce(jsonb_agg(jsonb_build_object('lob', lob, 'qty', qty, 'revenue', round(revenue::numeric, 2))), '[]'::jsonb)
      from by_lob
    )
  ) into v_result;

  return v_result;
end;
$$;

-- ============================================================
-- get_psi_report_v2(p_lobs, p_sub_lobs, p_period)
-- p_period: 'week' | 'month' | 'quarter' | 'all'
-- ============================================================
create or replace function get_psi_report_v2(
  p_lobs text[] default '{}',
  p_sub_lobs text[] default '{}',
  p_period text default 'quarter'
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
  v_period_start date;
  v_period_days numeric;
  v_latest_inv_batch bigint;
  v_latest_ship_batch bigint;
  v_unmatched_shipment_qty numeric := 0;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Not authorized';
  end if;

  v_period_start := case p_period
    when 'week' then current_date - interval '7 days'
    when 'month' then current_date - interval '30 days'
    when 'all' then date '2000-01-01'
    else current_date - interval '91 days'  -- quarter (default)
  end;
  v_period_days := greatest(current_date - v_period_start, 1);

  select id into v_latest_inv_batch from upload_batches
  where upload_type = 'inventory_snapshot' order by uploaded_at desc limit 1;

  select id into v_latest_ship_batch from upload_batches
  where upload_type = 'shipment_plan' order by uploaded_at desc limit 1;

  create temp table _psi_sales on commit drop as
  select coalesce(nullif(trim(lob),''),'Unknown') as lob, coalesce(nullif(trim(sub_lob),''),'Unknown') as sub_lob,
         qty, revenue
  from sales_transactions
  where sale_date >= v_period_start
    and (array_length(p_lobs,1) is null or lob = any(p_lobs))
    and (array_length(p_sub_lobs,1) is null or sub_lob = any(p_sub_lobs));

  create temp table _psi_purchases on commit drop as
  select coalesce(nullif(trim(lob),''),'Unknown') as lob, coalesce(nullif(trim(sub_lob),''),'Unknown') as sub_lob,
         qty, amount
  from purchase_transactions
  where purchase_date >= v_period_start
    and (array_length(p_lobs,1) is null or lob = any(p_lobs))
    and (array_length(p_sub_lobs,1) is null or sub_lob = any(p_sub_lobs));

  create temp table _psi_inventory on commit drop as
  select coalesce(nullif(trim(s.lob),''),'Unknown') as lob, coalesce(nullif(trim(s.sub_lob),''),'Unknown') as sub_lob,
         coalesce(g.group_label, 'Other') as bucket, s.qty, s.value
  from inventory_snapshots s
  left join psi_location_groups g on g.location = s.location
  where s.upload_batch_id = v_latest_inv_batch
    and (array_length(p_lobs,1) is null or s.lob = any(p_lobs))
    and (array_length(p_sub_lobs,1) is null or s.sub_lob = any(p_sub_lobs));

  -- one row per SKU (Part No) in the latest shipment-plan upload
  create temp table _psi_shipment_items on commit drop as
  select coalesce(nullif(trim(i.product_category),''),'Unknown') as lob,
         coalesce(nullif(trim(i.model),''),'Unknown') as sub_lob,
         i.id, i.part_no, i.total_backlog
  from shipment_plan_items i
  where i.upload_batch_id = v_latest_ship_batch;

  -- one row per SKU x week
  create temp table _psi_shipment_weeks on commit drop as
  select si.lob, si.sub_lob, w.week_index, w.planned_qty
  from _psi_shipment_items si
  join shipment_plan_weeks w on w.shipment_plan_item_id = si.id;

  -- shipment-plan rows whose LOB/Model text doesn't match any group present
  -- in sales/purchase/inventory — surfaced so naming mismatches are visible
  select coalesce(sum(planned_qty), 0) into v_unmatched_shipment_qty
  from _psi_shipment_weeks sp
  where not exists (
    select 1 from (
      select lob, sub_lob from _psi_sales
      union select lob, sub_lob from _psi_purchases
      union select lob, sub_lob from _psi_inventory
    ) known
    where upper(known.lob) = upper(sp.lob) and upper(known.sub_lob) = upper(sp.sub_lob)
  );

  with groups as (
    select lob, sub_lob from _psi_sales
    union select lob, sub_lob from _psi_purchases
    union select lob, sub_lob from _psi_inventory
  ),
  sell_in as (
    select lob, sub_lob, sum(qty) as qty, sum(amount) as value from _psi_purchases group by 1,2
  ),
  sell_thru as (
    select lob, sub_lob, sum(qty) as qty, sum(revenue) as value from _psi_sales group by 1,2
  ),
  inv as (
    select lob, sub_lob,
      sum(qty) filter (where bucket = 'SG') as sg_qty,
      sum(qty) filter (where bucket = 'DXB') as dxb_qty,
      sum(qty) filter (where bucket = 'LE PK') as lepk_qty,
      sum(qty) as total_qty,
      sum(value) as total_value
    from _psi_inventory group by 1,2
  ),
  ship_wk as (
    select lob, sub_lob, week_index, sum(planned_qty) as qty
    from _psi_shipment_weeks where week_index <= 3
    group by 1,2,3
  ),
  ship_backlog as (
    select lob, sub_lob, sum(total_backlog) as backlog
    from _psi_shipment_items
    group by 1,2
  ),
  ship_totals as (
    select g.lob, g.sub_lob,
      coalesce((select qty from ship_wk w where upper(w.lob)=upper(g.lob) and upper(w.sub_lob)=upper(g.sub_lob) and w.week_index=1),0) as wk1,
      coalesce((select qty from ship_wk w where upper(w.lob)=upper(g.lob) and upper(w.sub_lob)=upper(g.sub_lob) and w.week_index=2),0) as wk2,
      coalesce((select qty from ship_wk w where upper(w.lob)=upper(g.lob) and upper(w.sub_lob)=upper(g.sub_lob) and w.week_index=3),0) as wk3,
      coalesce((select backlog from ship_backlog b where upper(b.lob)=upper(g.lob) and upper(b.sub_lob)=upper(g.sub_lob)), 0) as backlog
    from groups g
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'period', p_period,
    'periodStart', v_period_start,
    'unmatchedShipmentQty', v_unmatched_shipment_qty,
    'rows', coalesce(jsonb_agg(
      jsonb_build_object(
        'lob', g.lob,
        'subLob', g.sub_lob,
        'sellInQty', coalesce(si.qty, 0),
        'sellInValue', round(coalesce(si.value, 0)::numeric, 2),
        'sellThroughQty', coalesce(st.qty, 0),
        'sellThroughValue', round(coalesce(st.value, 0)::numeric, 2),
        'invSg', coalesce(inv.sg_qty, 0),
        'invDxb', coalesce(inv.dxb_qty, 0),
        'invLePk', coalesce(inv.lepk_qty, 0),
        'invTotalQty', coalesce(inv.total_qty, 0),
        'invTotalValue', round(coalesce(inv.total_value, 0)::numeric, 2),
        'shipWk1', sh.wk1, 'shipWk2', sh.wk2, 'shipWk3', sh.wk3,
        'backlog', sh.backlog,
        'totalUpcoming', sh.wk1 + sh.wk2 + sh.wk3 + sh.backlog,
        'dos', case when coalesce(st.qty,0) > 0 then round((coalesce(inv.total_qty,0) / (st.qty::numeric / v_period_days))::numeric, 1) else null end,
        'wos', case when coalesce(st.qty,0) > 0 then round(((coalesce(inv.total_qty,0) / (st.qty::numeric / v_period_days)) / 7)::numeric, 1) else null end
      )
      order by g.lob, g.sub_lob
    ), '[]'::jsonb)
  ) into v_result
  from groups g
  left join sell_in si on si.lob = g.lob and si.sub_lob = g.sub_lob
  left join sell_thru st on st.lob = g.lob and st.sub_lob = g.sub_lob
  left join inv on inv.lob = g.lob and inv.sub_lob = g.sub_lob
  left join ship_totals sh on sh.lob = g.lob and sh.sub_lob = g.sub_lob;

  return v_result;
end;
$$;
