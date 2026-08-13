-- ============================================================
-- PSI FILES FEATURE — additive migration
-- Run this in Supabase Dashboard → SQL Editor → New Query → Run,
-- AFTER schema.sql (and after seed_apple_calendar.sql).
-- Safe to run more than once — everything below is idempotent
-- (IF NOT EXISTS / CREATE OR REPLACE / dynamic constraint drop).
--
-- What this adds:
--   1. shipment_plan_items  — one row per Model/Storage/Color/Location/Week
--      planned-shipment line, loaded from the new "Upload Shipment Plan" page.
--   2. upload_batches.upload_type gets a new allowed value: 'shipment_plan'.
--   3. process_shipment_plan_chunk() / finalize_shipment_plan_batch() —
--      mirror the existing ops-export upload RPC pattern.
--   4. get_psi_report() — the PSI rollup that powers the new PSI Report page
--      (Sell-in / Sell-through / Activated / In Channel / 6-month trend /
--      Inventory-in-hand by location / Shipment Plan WK-1..3 / Backlog /
--      Total Upcoming / FGOS / DOS / WOS), grouped by LOB / Sub LOB /
--      Storage / Color, filterable by RTM category / Customer / Model
--      (same filter shape as get_dashboard_v3 / get_dashboard_filter_options).
--
-- ------------------------------------------------------------------
-- ASSUMPTIONS — this file went in blind (no direct access to your live
-- Supabase project, only the code in the repo), so please sanity-check
-- these once you see real numbers, and tell me what to change:
--
--   • Sell-in       = every unit ever loaded for that Model/Storage/Color
--                      via any upload (i.e. everything that ever entered
--                      the channel), not scoped to a period.
--   • Sell through  = Activated = count of status = 'activated' units
--                      (all-time, cumulative). The app doesn't currently
--                      capture a separate POS/retail sell-through number,
--                      so these two columns will always be equal. If you
--                      DO have a separate retail sell-through source,
--                      tell me and I'll add a real distinct field for it.
--   • In channel    = count of status = 'unactivated' units (= current
--                      stock — same number already shown elsewhere in
--                      the app as "In Channel").
--   • 6-month trend = units ACTIVATED in each of the trailing 6 calendar
--                      months (by activated_date), oldest → newest.
--   • Inventory-in-hand SG / DXB / LE PK = current unactivated stock
--                      bucketed by imei_records.location text ('SG',
--                      'DXB') OR by the unit's customer's RTM category
--                      name ('LE PK'). Anything that matches none of the
--                      three is left out of those 3 columns — check the
--                      "otherLocationCount" field returned alongside the
--                      report if that number looks high, it means your
--                      real location/RTM text values don't match what I
--                      guessed and the bucket rule needs adjusting.
--   • Shipment Plan WK-1/2/3 = sum of planned_qty from shipment_plan_items
--                      for the 3 nearest upcoming calendar weeks (by
--                      plan_week_date), for that Model/Storage/Color.
--   • Backlog / FGOS = pulled straight from the columns of that name in
--                      the shipment plan file you upload — not calculated.
--   • Total Upcoming = WK-1 + WK-2 + WK-3 + Backlog + FGOS.
--   • DOS (Days of Supply) = In channel ÷ (units activated in trailing
--                      90 days ÷ 90).
--   • WOS (Weeks of Supply) = DOS ÷ 7.
-- ------------------------------------------------------------------

-- ---------------------------------------------------------
-- SHIPMENT PLAN ITEMS
-- ---------------------------------------------------------
create table if not exists shipment_plan_items (
    id              bigint generated always as identity primary key,
    upload_batch_id bigint references upload_batches(id),
    lob             text,
    sub_lob         text,
    model           text,
    storage         text,   -- e.g. GB
    color           text,
    customer_id     bigint references customers(id),
    location        text,   -- raw text bucket, e.g. 'SG' / 'DXB' / 'LE PK'
    plan_week_date  date,   -- the Monday (or any date) of the planned week
    planned_qty     int not null default 0,
    fgos_qty        int not null default 0,
    backlog_qty     int not null default 0,
    created_at      timestamptz not null default now()
);

create index if not exists idx_shipment_plan_model on shipment_plan_items(model, storage, color);
create index if not exists idx_shipment_plan_week on shipment_plan_items(plan_week_date);
create index if not exists idx_shipment_plan_batch on shipment_plan_items(upload_batch_id);
create index if not exists idx_shipment_plan_customer on shipment_plan_items(customer_id);

alter table shipment_plan_items enable row level security;

drop policy if exists "shipment_plan_select_all" on shipment_plan_items;
create policy "shipment_plan_select_all" on shipment_plan_items for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------
-- Allow 'shipment_plan' as an upload_batches.upload_type
-- (dynamic drop — works no matter what the existing constraint is
-- named, since 'combined_report' was clearly added the same way
-- at some point after schema.sql was first written)
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
    check (upload_type in ('ops_export', 'activation_check', 'combined_report', 'shipment_plan'));
end $$;

-- ------------------------------------------------------------------
-- process_shipment_plan_chunk(batch_id, rows)
-- rows: jsonb array of {lob, sub_lob, model, storage, color,
--   customer_name, location, plan_week_date, planned_qty, fgos_qty, backlog_qty}
-- ------------------------------------------------------------------
create or replace function process_shipment_plan_chunk(p_batch_id bigint, p_rows jsonb)
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
    insert into shipment_plan_items (
      upload_batch_id, lob, sub_lob, model, storage, color, customer_id, location,
      plan_week_date, planned_qty, fgos_qty, backlog_qty
    )
    select
      p_batch_id, r->>'lob', r->>'sub_lob', r->>'model', r->>'storage', r->>'color', c.id,
      r->>'location',
      nullif(r->>'plan_week_date','')::date,
      coalesce((r->>'planned_qty')::int, 0),
      coalesce((r->>'fgos_qty')::int, 0),
      coalesce((r->>'backlog_qty')::int, 0)
    from jsonb_array_elements(p_rows) r
    left join customers c on c.name = trim(r->>'customer_name')
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

-- ------------------------------------------------------------------
-- finalize_shipment_plan_batch(batch_id, total_rows)
-- ------------------------------------------------------------------
create or replace function finalize_shipment_plan_batch(p_batch_id bigint, p_total_rows int)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row_count int;
begin
  select count(*) into v_row_count from shipment_plan_items where upload_batch_id = p_batch_id;

  update upload_batches
  set row_count = p_total_rows, new_count = v_row_count
  where id = p_batch_id;

  insert into activity_log (user_id, action, target_table, target_id, details)
  values (auth.uid(), 'upload', 'upload_batches', p_batch_id::text,
    jsonb_build_object('type', 'shipment_plan', 'rowCount', p_total_rows, 'newCount', v_row_count));

  return jsonb_build_object('batchId', p_batch_id, 'totalRows', p_total_rows, 'rowsAdded', v_row_count);
end;
$$;

-- ------------------------------------------------------------------
-- get_psi_report(rtm_category_ids, customer_ids, models)
-- Returns { rows: [...], generatedAt, otherLocationCount }
-- One row per Model/Storage/Color group. See assumptions block above
-- for exactly how each column is computed.
-- ------------------------------------------------------------------
create or replace function get_psi_report(
  p_rtm_category_ids bigint[] default '{}',
  p_customer_ids bigint[] default '{}',
  p_models text[] default '{}'
)
returns jsonb
language plpgsql
-- NOT marked stable/immutable: this function creates temp tables internally
-- (a write operation) to stage the two source sets before aggregating.
security definer
as $$
declare
  v_result jsonb;
  v_other_location_count int;
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Not authorized';
  end if;

  create temp table _psi_units on commit drop as
  select
    coalesce(nullif(r.lob, ''), 'iPhone') as lob,
    nullif(r.sub_lob, '') as sub_lob,
    coalesce(nullif(r.model, ''), nullif(r.device_model, ''), nullif(r.description, ''), 'Unknown Model') as model,
    nullif(r.gb, '') as storage,
    nullif(r.color, '') as color,
    r.status,
    r.activated_date,
    case
      when upper(trim(coalesce(r.location, ''))) = 'SG' then 'SG'
      when upper(trim(coalesce(r.location, ''))) = 'DXB' then 'DXB'
      when upper(trim(coalesce(r.location, ''))) = 'LE PK' then 'LE PK'
      when rc.name = 'LE PK' then 'LE PK'
      else 'OTHER'
    end as location_bucket
  from imei_records r
  left join customers c on r.customer_id = c.id
  left join rtm_categories rc on c.rtm_category_id = rc.id
  where r.deleted_at is null
    and (array_length(p_rtm_category_ids, 1) is null or c.rtm_category_id = any(p_rtm_category_ids))
    and (array_length(p_customer_ids, 1) is null or r.customer_id = any(p_customer_ids))
    and (array_length(p_models, 1) is null or coalesce(nullif(r.model, ''), nullif(r.device_model, ''), nullif(r.description, ''), 'Unknown Model') = any(p_models));

  select count(*) into v_other_location_count from _psi_units where status = 'unactivated' and location_bucket = 'OTHER';

  create temp table _psi_plan on commit drop as
  select
    coalesce(nullif(sp.model, ''), 'Unknown Model') as model,
    nullif(sp.storage, '') as storage,
    nullif(sp.color, '') as color,
    sp.plan_week_date,
    sp.planned_qty,
    sp.fgos_qty,
    sp.backlog_qty
  from shipment_plan_items sp
  left join customers c on sp.customer_id = c.id
  where (array_length(p_rtm_category_ids, 1) is null or c.rtm_category_id = any(p_rtm_category_ids))
    and (array_length(p_customer_ids, 1) is null or sp.customer_id = any(p_customer_ids))
    and (array_length(p_models, 1) is null or coalesce(nullif(sp.model, ''), 'Unknown Model') = any(p_models));

  with groups as (
    select distinct lob, sub_lob, model, storage, color from _psi_units
  ),
  base as (
    select
      g.lob, g.sub_lob, g.model, g.storage, g.color,
      count(*) filter (where u.model is not null) as sell_in,
      count(*) filter (where u.status = 'activated') as sell_through,
      count(*) filter (where u.status = 'unactivated') as in_channel,
      count(*) filter (where u.status = 'unactivated' and u.location_bucket = 'SG') as inv_sg,
      count(*) filter (where u.status = 'unactivated' and u.location_bucket = 'DXB') as inv_dxb,
      count(*) filter (where u.status = 'unactivated' and u.location_bucket = 'LE PK') as inv_lepk,
      count(*) filter (where u.status = 'activated' and u.activated_date >= current_date - interval '90 days') as activated_last_90d
    from groups g
    left join _psi_units u
      on u.lob is not distinct from g.lob and u.sub_lob is not distinct from g.sub_lob
     and u.model is not distinct from g.model and u.storage is not distinct from g.storage and u.color is not distinct from g.color
    group by g.lob, g.sub_lob, g.model, g.storage, g.color
  ),
  trend as (
    select
      g.model, g.storage, g.color,
      to_char(m.month_start, 'Mon YYYY') as month_label,
      m.month_start,
      count(u.*) filter (
        where date_trunc('month', u.activated_date) = m.month_start
      ) as activated_count
    from groups g
    cross join (
      select date_trunc('month', current_date) - (n || ' months')::interval as month_start
      from generate_series(5, 0, -1) n
    ) m
    left join _psi_units u
      on u.model is not distinct from g.model and u.storage is not distinct from g.storage and u.color is not distinct from g.color
     and u.status = 'activated'
    group by g.model, g.storage, g.color, m.month_start
  ),
  trend_agg as (
    select model, storage, color, jsonb_agg(jsonb_build_object('month', month_label, 'units', activated_count) order by month_start) as trend
    from trend
    group by model, storage, color
  ),
  plan_weeks as (
    select distinct date_trunc('week', plan_week_date)::date as week_start
    from _psi_plan
    where plan_week_date is not null and plan_week_date >= date_trunc('week', current_date)::date
    order by week_start
    limit 3
  ),
  plan_ranked as (
    select week_start, row_number() over (order by week_start) as wk_rank from plan_weeks
  ),
  plan_by_week as (
    select
      p.model, p.storage, p.color,
      pr.wk_rank,
      sum(p.planned_qty) as qty
    from _psi_plan p
    join plan_ranked pr on date_trunc('week', p.plan_week_date)::date = pr.week_start
    group by p.model, p.storage, p.color, pr.wk_rank
  ),
  plan_totals as (
    select model, storage, color,
      sum(planned_qty) filter (where true) as all_planned, -- not used directly, kept for QA
      sum(fgos_qty) as fgos_total,
      sum(backlog_qty) as backlog_total
    from _psi_plan
    group by model, storage, color
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'otherLocationCount', v_other_location_count,
    'rows', coalesce(jsonb_agg(
      jsonb_build_object(
        'lob', b.lob,
        'subLob', b.sub_lob,
        'model', b.model,
        'storage', b.storage,
        'color', b.color,
        'sellIn', b.sell_in,
        'sellThrough', b.sell_through,
        'activated', b.sell_through,
        'inChannel', b.in_channel,
        'sixMonthTrend', coalesce(t.trend, '[]'::jsonb),
        'invSg', b.inv_sg,
        'invDxb', b.inv_dxb,
        'invLePk', b.inv_lepk,
        'planWk1', coalesce((select qty from plan_by_week pw where pw.model is not distinct from b.model and pw.storage is not distinct from b.storage and pw.color is not distinct from b.color and pw.wk_rank = 1), 0),
        'planWk2', coalesce((select qty from plan_by_week pw where pw.model is not distinct from b.model and pw.storage is not distinct from b.storage and pw.color is not distinct from b.color and pw.wk_rank = 2), 0),
        'planWk3', coalesce((select qty from plan_by_week pw where pw.model is not distinct from b.model and pw.storage is not distinct from b.storage and pw.color is not distinct from b.color and pw.wk_rank = 3), 0),
        'backlog', coalesce(pt.backlog_total, 0),
        'fgos', coalesce(pt.fgos_total, 0),
        'totalUpcoming',
          coalesce((select qty from plan_by_week pw where pw.model is not distinct from b.model and pw.storage is not distinct from b.storage and pw.color is not distinct from b.color and pw.wk_rank = 1), 0) +
          coalesce((select qty from plan_by_week pw where pw.model is not distinct from b.model and pw.storage is not distinct from b.storage and pw.color is not distinct from b.color and pw.wk_rank = 2), 0) +
          coalesce((select qty from plan_by_week pw where pw.model is not distinct from b.model and pw.storage is not distinct from b.storage and pw.color is not distinct from b.color and pw.wk_rank = 3), 0) +
          coalesce(pt.backlog_total, 0) + coalesce(pt.fgos_total, 0),
        'dos', case when b.activated_last_90d > 0 then round(b.in_channel / (b.activated_last_90d::numeric / 90), 1) else null end,
        'wos', case when b.activated_last_90d > 0 then round((b.in_channel / (b.activated_last_90d::numeric / 90)) / 7, 1) else null end
      )
      order by b.lob, b.sub_lob, b.model, b.storage, b.color
    ), '[]'::jsonb)
  ) into v_result
  from base b
  left join trend_agg t on t.model is not distinct from b.model and t.storage is not distinct from b.storage and t.color is not distinct from b.color
  left join plan_totals pt on pt.model is not distinct from b.model and pt.storage is not distinct from b.storage and pt.color is not distinct from b.color;

  return v_result;
end;
$$;
