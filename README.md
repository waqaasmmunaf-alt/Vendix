# Vendix (Supabase + Vercel edition)

Same IMEI-level channel/activation tracking as Channel Pulse — Dashboard,
uploads, Inventory, IMEI Search — rebranded as **Vendix**, running on its own
independent Supabase project (own data, own users, nothing shared with the
original app). No server to manage, no Docker, no VPS: Supabase hosts the
database + login, Vercel hosts the website.

The **PSI Files** section is built specifically around your real Purchase /
Sales / Inventory / Shipment-Plan workbooks (SKU-level, not per-IMEI) — see
its own section below. It's a separate data pipeline from the IMEI tracking
above and doesn't touch or depend on it.

The UI has also been redesigned — a light, blue "premium" console theme
(icon sidebar, card-based dashboard) instead of the earlier navy/gold look.

## Recent changes in this build

- **Nav is now 4 collapsible categories** — Upload, Search, PSI Files, and
  (admin-only) Settings — collapsed by default for a clean sidebar, and
  auto-expanding whichever one contains the page you're on. Sub-item labels
  are short (e.g. "Sales File" under Upload, not "Upload Sales File").
- **Sales Trend moved to the top of the Dashboard**, above the IMEI charts.
- **Combined Report / PK Import column matching fixed** — Activation Status,
  Customer Name, Part No, and Serial No are now recognized under more header
  spellings, so real exports (e.g. "Activation Status" with a space, "Customer
  Name" instead of just "Customer") no longer silently default to unactivated /
  "Unknown Customer."
- **New "Upload PK Import" page** (same file format as Combined Report) —
  every customer created from a file uploaded there is tagged RTM Category
  "PK Import" automatically. On the regular upload pages, a row whose own RTM
  Category column says "PK Import" is instead recorded as "LE PK." This only
  applies the first time a customer is created — an existing customer's RTM
  Category is never changed by a later upload.
- **New "Invoice Search" page** (Search → Invoice) — looks up every unit under
  one PFI / Invoice number, same detail view as IMEI Search.
- **PSI Report now matches by Part No** instead of by comparing LOB/Sub-LOB
  text between your Sales/Purchase/Inventory files and your Shipment Plan file
  — fixes cases where a spelling difference used to leave Shipment Plan qty
  out of the report (surfaced before as "unmatchedShipmentQty").

Deploying this build over an existing project: re-run `schema_part2_live_features.sql`
and `migration_psi.sql` (in that order) in the Supabase SQL Editor — both are
safe to re-run on top of your existing data (functions use `create or replace`,
new tables/policies check for existing objects first, nothing is dropped).

## ⚠️ Please read before you deploy

This copy's backend was rebuilt from scratch by reading the app's own
JavaScript (which database functions it calls, with what parameters, and
what it expects back) rather than from the original project's live
database — I never had credentials for that. Some pieces of the original
(especially exact Dashboard numbers and the "restrict a sales user to
certain RTM categories" behavior on the Users page) were inferred, not
copied byte-for-byte.

Before shipping this, I ran the complete SQL setup below against a fresh
local Postgres instance, seeded it with realistic sample data, and
exercised every single function the frontend calls — every upload type,
duplicate flagging, the activation-check revert-on-delete behavior, the
admin-only permission checks, and the RTM-based row visibility restriction
— all behaved correctly. So the SQL itself is sound and tested. What I
can't guarantee is that every business rule matches your original
project's exact behavior in every edge case, since I was reconstructing
it rather than reading it. Once you have real data in, compare a few
Dashboard numbers against Channel Pulse and tell me if anything's off.

The PSI Files parsers were additionally run directly against the 3 real
workbooks you shared (Purchase & Sell, Apple Distribution Inventory Value,
Shipment Plan Cash Flow) — sheet auto-detection, column mapping, date
parsing, and the location/week breakdown were all verified against your
actual data before this was packaged, not just against made-up samples.

## What's inside

```
vendix/
├── supabase/
│   ├── reset_all.sql                   # only if you need to start over — see below
│   ├── schema.sql                      # run 1st — base tables, security rules
│   ├── schema_part2_live_features.sql  # run 2nd — chunked uploads, Dashboard,
│   │                                   #   RTM access restriction, delete tools
│   ├── migration_psi.sql               # run 3rd — PSI Files feature (Sales/Purchase/
│   │                                   #   Inventory/Shipment-Plan ledgers + PSI Report)
│   └── seed_apple_calendar.sql         # run 4th — Apple fiscal calendar data
├── public/                             # the actual website (deploy this folder to Vercel)
│   ├── login.html, dashboard.html, upload-ops.html, ... (one file per page)
│   ├── css/styles.css
│   └── js/                             # one file per page, plus shared helpers
└── vercel.json
```

## Part 1 — Set up Supabase (the database)

1. Go to [supabase.com](https://supabase.com), sign up, click **New Project**.
2. Pick a name (e.g. `vendix`), set a strong database password (save it
   somewhere), and choose a region close to you.
3. Wait ~2 minutes for the project to finish provisioning.
4. Open **SQL Editor** (left sidebar) → **New Query**.
5. Run these four files **in order**, each as its own New Query → paste →
   Run, waiting for each to finish before starting the next:
   1. `supabase/schema.sql`
   2. `supabase/schema_part2_live_features.sql`
   3. `supabase/migration_psi.sql`
   4. `supabase/seed_apple_calendar.sql` (loads ~2,700 Apple fiscal
      calendar dates — takes a few seconds)

   **Getting `relation "profiles" already exists` (or similar) on step 1?**
   That means `schema.sql` already ran on this project before — pasting it
   again tries to recreate tables that are already there. Run
   `supabase/reset_all.sql` first (New Query → paste → Run — it wipes just
   this app's tables/functions, not your logins), then start again from
   step 1. Tested end-to-end: reset → all four files in order works cleanly.
6. Go to **Settings → API**. You'll need two values for Part 2:
   - **Project URL**
   - **anon public** key (NOT the `service_role` key — never put that one
     in frontend code)

## Part 2 — Connect the frontend to your Supabase project

1. Open `public/js/supabaseClient.js`.
2. Replace the two placeholder values with what you copied from Supabase:
   ```js
   const SUPABASE_URL = 'https://your-project-ref.supabase.co';
   const SUPABASE_ANON_KEY = 'your-anon-key-here';
   ```
3. Save the file.

## Part 3 — Create your first admin login

1. In Supabase: **Authentication → Users → Add user**.
2. Enter your email and a password, click **Create user**.
3. A profile is created for you automatically (via a database trigger), but
   starts as role `viewer`. To make yourself admin, go to **Table Editor →
   profiles**, find your row, and change `role` to `admin`.

Repeat "Add user" for each team member later — set their role in the
`profiles` table the same way, or once you have an admin account, do it
from the app's **Users** page. From the **Users** page you can also
restrict a `sales` user to only see certain RTM categories — leaving a
user with no RTM categories assigned means they see everything
(unrestricted), same as before.

## Part 4 — Deploy the frontend to Vercel

You've already created the `vendix` GitHub repo — drag the contents of
this zip's `public/` folder, `supabase/` folder, and `vercel.json` into it
via GitHub's "uploading an existing file" page, then commit.

1. Go to [vercel.com](https://vercel.com), sign up (GitHub login is
   easiest), click **Add New → Project**, import the `vendix` repo.
2. Under **Root Directory**, set it to `public`.
3. Framework Preset: **Other** (static site, no build step).
4. Click **Deploy**. You'll get a live URL like `https://vendix.vercel.app`.

## Day-to-day usage

1. **Upload Sales File** — the unactivated IMEI export from ops software;
   new units are added as "Unactivated" (in the channel).
2. **Inventory** → filter Status = Unactivated → **Export to Excel** →
   send for carrier activation check.
3. **Upload Activation Check** — the file that comes back from the carrier;
   matching IMEIs get auto-updated with status + activation date.
4. **Upload Combined Report** — for files that already have both sales and
   activation data in one row per unit (e.g. regional customer reports).
5. **Dashboard** for a running view by RTM category, model, and location,
   toggle between "By sales date" / "By activation date" — plus a **Sales
   Trend** panel further down driven by your PSI Sales Data uploads.
6. **IMEI Search** to trace any single unit's full history.
7. **Master Settings** — tag customers to an RTM category (admin only).
8. **PSI Files** (its own tinted section in the sidebar) — see below.

## PSI Files feature (Purchase / Sales / Inventory report)

This section reads your **actual** business workbooks directly — not a
custom template you have to reformat. Each upload page scans every sheet in
the file you give it and finds the right one on its own, so it keeps working
even though these workbooks routinely have 20–60+ unrelated tabs and the
sheet names shift every time (e.g. "Sales till 8th Aug 2026" becomes
"Sales till 7th Sep 2026" next month).

Four upload pages, each with its own colored tag:

1. **Upload Sales Data** — your Purchase & Sell workbook; finds the
   "Sales till …" sheet. Full running history back to 2019 — re-uploading a
   newer export is safe, lines already in the database (matched by
   Document Number + Part No) are skipped automatically.
2. **Upload Purchase Data** — same workbook, finds the "Purchases till …"
   sheet. Same safe-re-upload behavior.
3. **Upload Inventory** — your Apple Distribution Inventory Value workbook;
   finds the consolidated warehouse-value sheet. Each upload is a full
   point-in-time snapshot — the report always uses your **most recent**
   upload, not a sum of every one you've ever done.
4. **Upload Shipment Plan** — your Shipment Plan (Cash Flow) workbook;
   finds the "Shipment plan" sheet and reads its weekly columns straight
   from the file's own header rows (works even as the week labels shift
   forward). Each upload replaces the previous one as the active plan.

**PSI Report** rolls all four together into one table, grouped by LOB / Sub
LOB: Sell-in Qty/Value / Sell-through Qty/Value / Inventory-in-hand (SG, DXB,
LE PK) / Inventory Total / Shipment Plan (Wk-1/2/3) / Backlog / Total
Upcoming / DOS / WOS. Filterable by LOB / Sub LOB and by period (This Week /
Month / Quarter / All Time), downloadable as an Excel file with the same
grouped-header layout via **Download PSI File (.xlsx)**.

This is deliberately **separate from the IMEI-based tracking** above (its
own tables, own upload types) per your instruction not to mix the two — so
the "Activated" / "In channel" columns from your original format image
aren't in this version, since none of these 3 files carry per-IMEI
activation data. If you later have a per-IMEI activation file for these same
products, tell me and I'll wire it in as an additional column without
touching anything else here.

Full detail on how each PSI column is computed — location-bucket mapping,
period definitions, DOS/WOS formula — and which parts are best-effort
assumptions worth sanity-checking against your real numbers, is in the
comment block at the top of `supabase/migration_psi.sql`. In particular,
check the `psi_location_groups` table if the SG/DXB/LE PK inventory split
looks off — it's a plain lookup table you can edit directly in Supabase's
Table Editor, no code change needed.

## Roles

Three roles, same as before: `admin` (full access, including deleting
uploads and managing users/RTM access), `sales` (can upload files), and
`viewer` (read-only). Assign/change roles from the **Users** page or
directly in Supabase's **Table Editor → profiles**.

## Known gaps / next steps

- **New team members**: added via the Supabase Dashboard (Part 3 above) or
  the in-app Users page — there's no public signup flow.
- **Apple fiscal calendar**: loaded through 2026-12-31. Past that date,
  you'll need an updated calendar file from Apple, converted the same way
  and inserted into the `apple_calendar` table.
- All deletes are soft deletes — restorable from **Trash** (admin only) at
  any time. Deleting an upload batch from **Manage Uploads** either
  reverts activation records (for Activation Check batches) or hard-deletes
  everything that batch created (for every other batch type).
