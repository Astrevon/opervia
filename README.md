# Opervia Approval Portal

A multi-client SaaS MVP where agencies and their clients review content, request revisions, approve deliverables and track publishing readiness in one place.

It turns the documented process **NSD-MOPS-SOP-002 Client Content Approval & Publishing (v0.3)** into a working application. **Made by Opervia.**

> **Northstar Digital is a fictional demonstration company** created by Opervia for a portfolio SOP sample. It is not, and has never been, an Opervia client. The demo workspace is flagged in the database (`is_demo`) and every screen of it shows a demo banner.

- **Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS 4, Supabase (Postgres, Auth, Storage), Row Level Security, zod
- **Roles:** Agency Admin · Content Team · Client Approver
- **Statuses:** Draft → Pending Approval → Revision Required ↺ → Approved → Scheduled for Publishing (plus Rejected, from the SOP's client decision table)

See **[docs/SOP-WORKFLOW.md](docs/SOP-WORKFLOW.md)** for how the SOP maps to the product, the business-rule decisions taken, and the open questions.

**Subscriptions & billing:** every agency workspace has a monthly subscription paid by manual bank transfer. Clients upload transfer receipts on **Billing**, and Opervia billing admins verify them in the **/admin** console. Unpaid workspaces are suspended automatically after the grace period, enforced in the database. See **[docs/BILLING.md](docs/BILLING.md)**.

> **Note:** the `demo`, `seed:demo`, `lint` and `test:integration` scripts described below are not included in this copy of the repository (there is no `scripts/` folder). Available scripts: `dev`, `dev:lan`, `build`, `start`, `start:lan`, `typecheck`. The billing system has its own database test: `supabase/tests/billing_e2e.sql`.

---

## Quick preview: demo mode (no Supabase needed)

Want to click through the UI and the approval workflow first? Demo mode runs entirely on your computer, with fictional data held in memory. No Supabase, accounts, email or internet services are needed.

```
npm install
npm run demo
```

Open **http://localhost:3000** and pick a demo person (admin, team member or client approver). To act as the agency and the client at the same time, use two browsers or a private window. Stopping the server resets the data.

Demo mode only works with `npm run demo`, the development server. A production build (`npm run build` / `npm start`) always uses real Supabase authentication, even if the demo variables are set. Sign-up, password reset and accepting invitations need real accounts, so they are disabled in demo mode.

---

## 1. What you need

- **Node.js 20.9 or newer** (22 LTS recommended) — https://nodejs.org
- A free **Supabase** project — https://supabase.com
- Windows, macOS or Linux. All npm scripts are cross-platform.

## 2. Set up Supabase (about 10 minutes)

1. **Create a project** in the Supabase dashboard. Choose a strong database password and a region near your users.
2. **Run the database migration.** Open **SQL Editor → New query**, paste the whole contents of
   `supabase/migrations/20261119000001_approval_portal.sql`, and click **Run**. It should finish with "Success. No rows returned".
   *(Alternative, with the Supabase CLI: `npx supabase link --project-ref YOUR-REF` then `npx supabase db push`.)*
   This creates the tables, Row Level Security policies, workflow functions, the append-only approval history, notifications, and the private `attachments` storage bucket with its policies.
3. **Copy your API keys.** In **Project Settings → API Keys** copy:
   - the **Project URL**,
   - the **publishable** key (`sb_publishable_…`) — or the legacy **anon** key,
   - the **secret** key (`sb_secret_…`) — or the legacy **service_role** key. This one is only used by the seed and test scripts on your computer.
4. **Allow the app's addresses for email links.** In **Authentication → URL Configuration**:
   - **Site URL:** `http://localhost:3000` (change to your production URL when you deploy)
   - **Redirect URLs:** add `http://localhost:3000/**` and, for testing on your phone, `http://YOUR-LAN-IP:3000/**` (see §5). Add your production URL later, e.g. `https://your-app.vercel.app/**`.
5. **Email confirmation** is on by default in Supabase. That's supported: new users get a confirmation email and continue from the link.
   Supabase's built-in email service only sends a few emails per hour and is meant for testing. For real users, set up custom SMTP under **Authentication → Emails → SMTP settings**.

## 3. Run it locally (Windows: use PowerShell or the VS Code terminal)

```powershell
cd opervia-approval-portal
npm install
copy .env.example .env.local      # macOS/Linux: cp .env.example .env.local
```

Open `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`. Leave `NEXT_PUBLIC_SITE_URL` empty for local use.

```powershell
npm run seed:demo     # creates the fictional Northstar Digital demo workspace
npm run dev           # http://localhost:3000
```

`seed:demo` prints the demo accounts and **unique random passwords** once, and saves them to `demo-credentials.local.md`, which git ignores. There are no shared or public demo passwords. Run `npm run seed:demo -- --reset` to delete the demo workspace and recreate it, which also rotates all the passwords.

| Demo person | Role |
| --- | --- |
| Maya Okafor | Agency Admin |
| Leo Brandt | Content Team |
| Priya Nair | Content Team |
| Jonas Weller | Client Approver — Halden Coffee Roasters (fictional) |
| Ana Ferreira | Client Approver — Verde Living Studio (fictional) |

The seed creates 9 items covering every status: pending approval, revision required, resubmitted, approved, scheduled, rejected and drafts. Each one was created through the same database functions the app uses, so its approval history is real audit data.

**Your own agency:** go to `/signup`, create a workspace (you become its admin), add a client on **Clients**, then invite people from **Team**.

## 4. Environment variables

| Variable | Where | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | app + scripts | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | app + scripts | yes | Public client key. Safe in the browser; RLS protects the data |
| `NEXT_PUBLIC_SITE_URL` | app | production | Base URL for email and invitation links. Leave empty locally |
| `NEXT_PUBLIC_OPERVIA_URL` | app | no | Makes the "Made by Opervia" badge a link |
| `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | **scripts only** | for seed/tests | Admin key for `seed:demo` and `test:integration`. **The running app never uses it. Never put it in Vercel or in client code.** |
| `DEMO_PASSWORD` | scripts | no | Use one fixed demo password instead of random ones |

## 5. Open it from your phone or tablet (same Wi-Fi)

```powershell
npm run dev:lan
ipconfig            # find "IPv4 Address", e.g. 192.168.1.23
```

Then open `http://192.168.1.23:3000` on the other device. If Windows Firewall asks, allow Node.js on **private networks**. For email links to work on that address, add `http://192.168.1.23:3000/**` to the Supabase **Redirect URLs**. A production build works the same way: `npm run build`, then `npm run start:lan`.

## 6. Tests

```powershell
npm run typecheck
npm run lint
npm run test:integration   # use a DEVELOPMENT project — it creates throw-away users and workspaces
```

`test:integration` runs 27 end-to-end API tests with supabase-js across every role. It covers the full approval cycle, comment rules, the four-eyes check, version immutability, append-only history, storage rules, anonymous and wrong-role access, cross-client and cross-organization isolation, invitations and deactivated members. Test users are deleted afterwards. Their empty test workspaces remain, named "Agency A/B …".

## 7. Deploy (Vercel)

1. Push the project to a GitHub repository. `.env.local` and `demo-credentials.local.md` are git-ignored.
2. In Vercel: **Add New → Project →** import the repo. The framework is detected as Next.js.
3. Add the environment variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `NEXT_PUBLIC_SITE_URL=https://your-app.vercel.app`. **Do not add the secret key.**
4. Deploy. Then, in Supabase **Authentication → URL Configuration**, set the Site URL to the production URL and add `https://your-app.vercel.app/**` to the Redirect URLs.
5. Keep demo data in a separate Supabase project if you show the demo publicly, so demo and real customer data never share a database.
6. **Billing schedule:** the daily billing check runs inside Supabase (`pg_cron`, 00:05 Asia/Jakarta), so nothing is needed in Vercel. `vercel.json` also defines an optional Vercel Cron backup that stays idle until you set `CRON_SECRET`. See [docs/BILLING.md](docs/BILLING.md#daily-cron).

Other Node hosts work too: `npm run build && npm start`.

## 8. Architecture

```
src/
  proxy.ts                     Session refresh + redirect for signed-out users (Next 16 "proxy", formerly middleware)
  app/
    (auth)/                    login, signup (incl. invite links), forgot/reset password
    auth/callback/route.ts     Email link landing (PKCE code or token_hash)
    onboarding/                Create workspace / accept invitation
    (agency)/                  Admin + Content Team: dashboard, content, clients, team, settings
    portal/                    Client Approver portal: to-review list, review & decide, account
    api/attachments/[id]       Opens files via 2-minute signed URLs after RLS checks
    actions/                   Server actions (zod validation → database functions)
  components/                  Design system (ui.tsx), dialogs, timeline, uploader, shells
  lib/                         Supabase clients, session/role guards, data access, validation
supabase/migrations/           Schema, RLS, workflow functions, storage bucket + policies
scripts/seed-demo.ts           Fictional Northstar Digital demo workspace
tests/integration/             API-level tests against Supabase
```

**Security model.** Every table has RLS. The `authenticated` role can only **read**, and only rows from its own organization. Client approvers can only read their own client's items, and never drafts or unsent versions. Every write goes through a `SECURITY DEFINER` database function that re-checks organization, role and workflow state, so the rules hold even if someone calls the API directly and bypasses the UI. Server actions validate input with zod first. Submitted versions, their attachments and the approval history are protected by triggers, so even the service role cannot rewrite them. Files live in a private bucket with a 25 MB limit and an allow-list of image, video, PDF and Office types. Uploads use one-time signed tokens, and downloads use 2-minute signed URLs.

**Notifications** are in-app only (bell icon, polled every 30 seconds). No email or push notifications are sent for workflow events. The only emails are Supabase Auth's own confirmation and password-reset emails.

## 9. What is functional, and what isn't (v1)

**Working and tested end to end:** sign-up with workspace creation, email confirmation, sign-in, password reset; invitation links by role (single-use, 14-day expiry, email-matched); role-based navigation and server-side guards; dashboard counts, attention list, scheduled list and recent activity; content create/edit, attachments (upload, preview, download, remove on unsent versions), send for approval; client portal review with approve (confirmed, exact version), request changes (comment required) and decline (reason required); revision rounds that create new versions while keeping old ones intact; resubmission with a change summary; scheduling with the four-eyes rule and a binding approved publish time; unschedule and reopen; append-only approval history; in-app notifications; client and team management (roles, activation); workspace settings; demo seed; responsive layouts for desktop, tablet and phone.

**Not included in v1 (by design or still open):** actual publishing to social platforms (the workflow ends at *Scheduled for Publishing*); a separate internal-QC status; automatic *On Hold – No Response* at the publishing cutoff; business-day deadline calculation; email notifications for workflow events; one person belonging to several workspaces; post-publication verification (*Published / Verified / Closed*); analytics; billing. See `docs/SOP-WORKFLOW.md` for the reasoning behind each.

**How it was verified:** against a local Supabase-equivalent stack — the real Supabase Auth server (GoTrue v2.180), PostgREST v13 and PostgreSQL 16, with Supabase's roles and default privileges. Checks: 27 API integration tests; two browser end-to-end runs (the full SOP cycle across 4 accounts, plus email confirmation, password reset and invite-with-confirmation through a local mail catcher); a database-outage error-state test; type checking, linting and a production build. **The Supabase Storage server could not be run locally**, so storage was exercised through a stand-in that enforces the same `storage.objects` RLS policies and bucket limits. After you connect your own Supabase project, upload a file once to confirm. Deployment to Vercel and delivery through a real email provider have not been tested from here.
