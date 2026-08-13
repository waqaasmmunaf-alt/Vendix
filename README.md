# Vendix (Supabase + Vercel edition)

Same feature set as Channel Pulse — IMEI-level channel/activation tracking,
Dashboard, uploads, PSI Report — rebranded as **Vendix**, running on its own
independent Supabase project (own data, own users, nothing shared with the
original app). No server to manage, no Docker, no VPS: Supabase hosts the
database + login, Vercel hosts the website.

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

## What's inside

```
vendix/
├── supabase/
│   ├── schema.sql                      # run 1st — base tables, security rules
│   ├── schema_part2_live_features.sql  # run 2nd — chunked uploads, Dashboard,
│   │                                   #   RTM access restriction, delete tools
│   ├── migration_psi.sql               # run 3rd — PSI Files feature
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
   toggle between "By sales date" / "By activation date".
6. **IMEI Search** to trace any single unit's full history.
7. **Master Settings** — tag customers to an RTM category (admin only).
8. **PSI Files → Upload Shipment Plan / PSI Report** — see below.

## PSI Files feature (Purchase / Sales / Inventory report)

A **PSI Files** section in the sidebar adds two pages:

1. **Upload Shipment Plan** — a *planning-level* file (one row per Model /
   Storage / Color / Location / Week, not per-IMEI). Expected columns
   (header names are matched loosely, any order): `LOB, Sub LOB, Model,
   Storage, Color, Customer, Location, Week, Planned Qty, FGOS, Backlog`.
2. **PSI Report** — rolls up your Sales File + Activation Check data
   together with the Shipment Plan into one table: LOB / Sub LOB / Storage
   / Color / Sell-in / Sell through / Activated / In channel / 6-Month
   Sell Trend / Inventory-in-hand (SG, DXB, LE PK) / Shipment Plan
   (WK-1, WK-2, WK-3) / Backlog / Total Upcoming / FGOS / DOS / WOS.
   Filterable by RTM / Customer / Model, downloadable as an Excel file
   (same grouped-header layout) via **Download PSI File (.xlsx)**.

Full detail on how each PSI column is computed — and which parts are
best-effort assumptions worth sanity-checking against real data — is in
the comment block at the top of `supabase/migration_psi.sql`.

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
