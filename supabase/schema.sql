-- ============================================================
-- IMEI Activation Tracker — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================

-- ---------------------------------------------------------
-- PROFILES  (extends Supabase auth.users with name + role)
-- Auto-created for every new auth user via trigger below.
-- ---------------------------------------------------------
create table profiles (
    id          uuid primary key references auth.users(id) on delete cascade,
    name        text not null default 'New User',
    email       text,
    role        text not null default 'viewer' check (role in ('admin', 'sales', 'viewer')),
    created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a new user is added (via Supabase Dashboard "Add user")
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), new.email, 'viewer');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Helper functions used throughout RLS policies below
create or replace function is_admin()
returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$ language sql stable security definer;

create or replace function is_admin_or_sales()
returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('admin', 'sales'));
$$ language sql stable security definer;

-- ---------------------------------------------------------
-- RTM CATEGORIES
-- ---------------------------------------------------------
create table rtm_categories (
    id         bigint generated always as identity primary key,
    name       text unique not null,
    created_at timestamptz not null default now()
);

insert into rtm_categories (name) values
    ('PK Import'), ('AF'), ('Trading'), ('LA'), ('LE PK');

-- ---------------------------------------------------------
-- CUSTOMERS
-- ---------------------------------------------------------
create table customers (
    id               bigint generated always as identity primary key,
    name             text unique not null,
    rtm_category_id  bigint references rtm_categories(id) on delete set null,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------
-- UPLOAD BATCHES
-- ---------------------------------------------------------
create table upload_batches (
    id              bigint generated always as identity primary key,
    file_name       text not null,
    upload_type     text not null check (upload_type in ('ops_export', 'activation_check')),
    uploaded_by     uuid references profiles(id),
    row_count       int default 0,
    new_count       int default 0,
    updated_count   int default 0,
    duplicate_count int default 0,
    error_count     int default 0,
    uploaded_at     timestamptz not null default now()
);

-- ---------------------------------------------------------
-- APPLE FISCAL CALENDAR (Week / Qtr / Year lookup by date)
-- ---------------------------------------------------------
create table apple_calendar (
    calendar_date date primary key,
    apple_week    text,
    apple_qtr     text,
    apple_year    text
);

-- ---------------------------------------------------------
-- IMEI RECORDS  (core table)
-- ---------------------------------------------------------
create table imei_records (
    id                        bigint generated always as identity primary key,
    imei1                     text not null,
    imei2                     text,
    serial_no                 text,
    location                  text,
    date_of_shipment          date,
    month                     text,
    order_reference_no        text,
    proforma_invoice_no       text,
    customer_id               bigint references customers(id),
    ship_to_name              text,
    actual_customer_forwarder text,
    part_no                   text,
    description               text,
    color                     text,
    gb                        text,
    lob                       text,
    sub_lob                   text,
    qty                       int default 1,
    carton_no                 text,
    apple_week                text,
    apple_qtr                 text,
    apple_year                text,

    status                    text not null default 'unactivated' check (status in ('unactivated', 'activated')),
    device_model              text,
    activated_date            date,
    activated_apple_week      text,
    activated_apple_qtr       text,
    activated_apple_year      text,

    is_duplicate              boolean not null default false,

    upload_batch_id           bigint references upload_batches(id),
    activation_batch_id       bigint references upload_batches(id),

    deleted_at                timestamptz,
    deleted_by                uuid references profiles(id),

    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now()
);

create index idx_imei_records_imei1 on imei_records(imei1);
create index idx_imei_records_status on imei_records(status);
create index idx_imei_records_customer on imei_records(customer_id);
create index idx_imei_records_location on imei_records(location);
create index idx_imei_records_deleted_at on imei_records(deleted_at);
create index idx_imei_records_batch on imei_records(upload_batch_id);
create index idx_imei_records_shipment_date on imei_records(date_of_shipment);

-- ---------------------------------------------------------
-- ACTIVITY LOG
-- ---------------------------------------------------------
create table activity_log (
    id           bigint generated always as identity primary key,
    user_id      uuid references profiles(id),
    action       text not null check (action in ('upload', 'delete', 'restore', 'manual_edit', 'tag_customer', 'create_customer', 'create_rtm_category', 'export')),
    target_table text not null,
    target_id    text,
    details      jsonb,
    created_at   timestamptz not null default now()
);
create index idx_activity_log_created_at on activity_log(created_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table profiles enable row level security;
alter table rtm_categories enable row level security;
alter table customers enable row level security;
alter table upload_batches enable row level security;
alter table apple_calendar enable row level security;
alter table imei_records enable row level security;
alter table activity_log enable row level security;

-- profiles: everyone logged in can view all profiles (needed for "uploaded by" names); only admin edits roles
create policy "profiles_select_all" on profiles for select using (auth.role() = 'authenticated');
create policy "profiles_update_admin" on profiles for update using (is_admin());

-- rtm_categories: everyone reads; admin writes
create policy "rtm_select_all" on rtm_categories for select using (auth.role() = 'authenticated');
create policy "rtm_insert_admin" on rtm_categories for insert with check (is_admin());
create policy "rtm_update_admin" on rtm_categories for update using (is_admin());
create policy "rtm_delete_admin" on rtm_categories for delete using (is_admin());

-- customers: everyone reads; admin tags/edits; insert allowed for admin/sales (also created via RPC as definer)
create policy "customers_select_all" on customers for select using (auth.role() = 'authenticated');
create policy "customers_insert_staff" on customers for insert with check (is_admin_or_sales());
create policy "customers_update_admin" on customers for update using (is_admin());

-- upload_batches: everyone reads; inserts happen via RPC (security definer) only
create policy "batches_select_all" on upload_batches for select using (auth.role() = 'authenticated');

-- apple_calendar: everyone reads (used by client for display only; matching happens server-side in RPCs)
create policy "calendar_select_all" on apple_calendar for select using (auth.role() = 'authenticated');

-- imei_records: visible if not deleted, OR you're an admin (so admin can see trash too)
create policy "imei_select_active_or_admin" on imei_records for select using (deleted_at is null or is_admin());
-- manual edits / soft delete / restore — admin only
create policy "imei_update_admin" on imei_records for update using (is_admin());

-- activity_log: anyone logged in can write a log entry; only admin can read the log
create policy "activity_insert_authenticated" on activity_log for insert with check (auth.role() = 'authenticated');
create policy "activity_select_admin" on activity_log for select using (is_admin());

-- ============================================================
-- RPC FUNCTIONS — bulk upload logic (runs server-side in Postgres,
-- avoids doing thousands of round-trips from the browser)
-- ============================================================

-- ------------------------------------------------------------------
-- upload_ops_export(rows, file_name)
-- rows: jsonb array of {imei1, imei2, serial_no, location, date_of_shipment,
--   month, order_reference_no, proforma_invoice_no, customer_name, ship_to_name,
--   actual_customer_forwarder, part_no, description, color, gb, lob, sub_lob,
--   qty, carton_no, apple_week, apple_qtr, apple_year}
-- ------------------------------------------------------------------
create or replace function upload_ops_export(p_rows jsonb, p_file_name text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_batch_id bigint;
  v_new_count int;
  v_dup_count int;
begin
  if not is_admin_or_sales() then
    raise exception 'Not authorized to upload';
  end if;

  insert into upload_batches (file_name, upload_type, uploaded_by, row_count)
  values (p_file_name, 'ops_export', auth.uid(), jsonb_array_length(p_rows))
  returning id into v_batch_id;

  -- create any customers that don't exist yet
  insert into customers (name)
  select distinct trim(r->>'customer_name')
  from jsonb_array_elements(p_rows) r
  where trim(coalesce(r->>'customer_name','')) <> ''
  on conflict (name) do nothing;

  -- insert all rows
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
    v_batch_id
  from jsonb_array_elements(p_rows) r
  left join customers c on c.name = trim(r->>'customer_name')
  left join apple_calendar ac on ac.calendar_date = nullif(r->>'date_of_shipment','')::date;

  -- flag duplicates: any IMEI (among non-deleted records) that now appears more than once
  update imei_records
  set is_duplicate = true
  where deleted_at is null
    and imei1 in (
      select imei1 from imei_records where deleted_at is null group by imei1 having count(*) > 1
    );

  select count(*) filter (where is_duplicate) , count(*) filter (where not is_duplicate)
    into v_dup_count, v_new_count
  from imei_records where upload_batch_id = v_batch_id;

  update upload_batches set new_count = v_new_count, duplicate_count = v_dup_count where id = v_batch_id;

  insert into activity_log (user_id, action, target_table, target_id, details)
  values (auth.uid(), 'upload', 'upload_batches', v_batch_id::text,
    jsonb_build_object('type', 'ops_export', 'fileName', p_file_name, 'rowCount', jsonb_array_length(p_rows), 'newCount', v_new_count, 'duplicateCount', v_dup_count));

  return jsonb_build_object(
    'batchId', v_batch_id,
    'totalRows', jsonb_array_length(p_rows),
    'newRecords', v_new_count,
    'flaggedDuplicates', v_dup_count
  );
end;
$$;

-- ------------------------------------------------------------------
-- upload_activation_check(rows, file_name)
-- rows: jsonb array of {imei1, activated_date, device_model} — already
-- filtered client-side to status = 'activated' only.
-- ------------------------------------------------------------------
create or replace function upload_activation_check(p_rows jsonb, p_file_name text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_batch_id bigint;
  v_updated int;
begin
  if not is_admin_or_sales() then
    raise exception 'Not authorized to upload';
  end if;

  insert into upload_batches (file_name, upload_type, uploaded_by, row_count)
  values (p_file_name, 'activation_check', auth.uid(), jsonb_array_length(p_rows))
  returning id into v_batch_id;

  with updates as (
    update imei_records r
    set status = 'activated',
        activated_date = nullif(x->>'activated_date','')::date,
        device_model = coalesce(x->>'device_model', r.device_model),
        activated_apple_week = ac.apple_week,
        activated_apple_qtr = ac.apple_qtr,
        activated_apple_year = ac.apple_year,
        activation_batch_id = v_batch_id,
        updated_at = now()
    from jsonb_array_elements(p_rows) x
    left join apple_calendar ac on ac.calendar_date = nullif(x->>'activated_date','')::date
    where r.imei1 = x->>'imei1' and r.deleted_at is null
    returning r.id
  )
  select count(*) into v_updated from updates;

  update upload_batches
  set updated_count = v_updated, error_count = jsonb_array_length(p_rows) - v_updated
  where id = v_batch_id;

  insert into activity_log (user_id, action, target_table, target_id, details)
  values (auth.uid(), 'upload', 'upload_batches', v_batch_id::text,
    jsonb_build_object('type', 'activation_check', 'fileName', p_file_name, 'rowCount', jsonb_array_length(p_rows), 'updatedCount', v_updated));

  return jsonb_build_object(
    'batchId', v_batch_id,
    'activatedRowsInFile', jsonb_array_length(p_rows),
    'recordsUpdated', v_updated,
    'imeiNotFoundInSystem', jsonb_array_length(p_rows) - v_updated
  );
end;
$$;

-- ------------------------------------------------------------------
-- get_dashboard_summary() — one call returns everything the dashboard needs
-- ------------------------------------------------------------------
create or replace function get_dashboard_summary()
returns jsonb
language sql
stable
security definer
as $$
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'in_channel', count(*) filter (where status = 'unactivated'),
        'activated', count(*) filter (where status = 'activated'),
        'total', count(*),
        'duplicates', count(*) filter (where is_duplicate)
      ) from imei_records where deleted_at is null
    ),
    'byRtmCategory', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select coalesce(rc.name, 'Uncategorized') as rtm_category,
               count(*) filter (where r.status = 'unactivated') as in_channel,
               count(*) filter (where r.status = 'activated') as activated
        from imei_records r
        left join customers c on r.customer_id = c.id
        left join rtm_categories rc on c.rtm_category_id = rc.id
        where r.deleted_at is null
        group by rc.name order by in_channel desc
      ) t
    ),
    'byLocation', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select location,
               count(*) filter (where status = 'unactivated') as in_channel,
               count(*) filter (where status = 'activated') as activated
        from imei_records where deleted_at is null
        group by location order by in_channel desc
      ) t
    ),
    'topCustomersPending', (
      select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select c.name as customer_name, count(*) as pending
        from imei_records r join customers c on r.customer_id = c.id
        where r.deleted_at is null and r.status = 'unactivated'
        group by c.name order by pending desc limit 10
      ) t
    )
  );
$$;
