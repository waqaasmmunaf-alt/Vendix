-- ============================================================
-- VENDIX — full reset
-- Run this FIRST if you're getting "relation already exists" errors,
-- or any time you want to wipe this Supabase project's schema and
-- start the 4-file setup over from a clean slate.
--
-- This drops every table, function, and trigger the setup files
-- create. It does NOT touch auth.users (your logins) — only the
-- app's own tables/functions, so you won't need to re-invite anyone,
-- just re-run the 4 setup files afterward.
-- ============================================================

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists shipment_plan_weeks cascade;
drop table if exists shipment_plan_items cascade;
drop table if exists psi_location_groups cascade;
drop table if exists inventory_snapshots cascade;
drop table if exists purchase_transactions cascade;
drop table if exists sales_transactions cascade;
drop table if exists user_rtm_access cascade;
drop table if exists activity_log cascade;
drop table if exists imei_records cascade;
drop table if exists apple_calendar cascade;
drop table if exists upload_batches cascade;
drop table if exists customers cascade;
drop table if exists rtm_categories cascade;
drop table if exists profiles cascade;

drop function if exists get_psi_report(bigint[], bigint[], text[]) cascade;
drop function if exists get_psi_report_v2(text[], text[], text) cascade;
drop function if exists get_sales_trend(text, int, text[]) cascade;
drop function if exists get_psi_filter_options() cascade;
drop function if exists finalize_shipment_plan_batch(bigint, int) cascade;
drop function if exists process_shipment_plan_chunk(bigint, jsonb) cascade;
drop function if exists finalize_sales_ledger_batch(bigint, int) cascade;
drop function if exists process_sales_ledger_chunk(bigint, jsonb) cascade;
drop function if exists finalize_purchase_ledger_batch(bigint, int) cascade;
drop function if exists process_purchase_ledger_chunk(bigint, jsonb) cascade;
drop function if exists finalize_inventory_snapshot_batch(bigint, int) cascade;
drop function if exists process_inventory_snapshot_chunk(bigint, jsonb) cascade;
drop function if exists get_dashboard_v3(text, bigint[], bigint[], text[], text[], text[]) cascade;
drop function if exists get_dashboard_filter_options() cascade;
drop function if exists hard_delete_all_uploads() cascade;
drop function if exists hard_delete_batch(bigint) cascade;
drop function if exists finalize_activation_batch(bigint, int, int) cascade;
drop function if exists process_activation_check_chunk(bigint, jsonb) cascade;
drop function if exists finalize_ops_or_combined_batch(bigint, int) cascade;
drop function if exists process_combined_report_chunk(bigint, jsonb) cascade;
drop function if exists process_ops_export_chunk(bigint, jsonb) cascade;
drop function if exists create_upload_batch(text, text) cascade;
drop function if exists set_user_rtm_access(uuid, bigint[]) cascade;
drop function if exists get_dashboard_summary() cascade;
drop function if exists is_admin_or_sales() cascade;
drop function if exists is_admin() cascade;
drop function if exists handle_new_user() cascade;

-- Sanity check — should return 0 rows once the drops above succeeded.
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles','rtm_categories','customers','upload_batches','apple_calendar','imei_records',
    'activity_log','user_rtm_access','shipment_plan_items','shipment_plan_weeks','sales_transactions',
    'purchase_transactions','inventory_snapshots','psi_location_groups');
