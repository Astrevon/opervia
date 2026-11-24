# Opervia billing: subscriptions, manual bank transfers, verification and suspension

This is the subscription system for the Opervia Approval Portal. All payments are **manual bank transfers**. There is no payment gateway and no automatic debit. A payment counts as received only when an Opervia billing admin has checked the bank account and confirmed it. An uploaded screenshot is never enough.

## Who is who

| Person | Where | Can do |
| --- | --- | --- |
| **Client**: an agency workspace's *Agency Admin* | `/billing` in the workspace | See the subscription, invoices, bank details and history. Upload a transfer receipt for an invoice. Cannot change any status. |
| Content Team / Client Approver | — | No billing access. When the workspace is suspended they see a notice and the workflow is blocked. |
| **Opervia billing admin** (`public.platform_admins`, matched on a *verified* email) | `/admin` console | Verify or reject payments. Suspend, reactivate or cancel subscriptions. Change plan, price or grace period. Cancel invoices. Edit the bank details and billing rules. Read all history and the audit trail. |

Fictional demo workspaces (`organizations.is_demo`) are never billed or suspended.

### Making someone a billing admin

1. They sign up at `/signup` and confirm their email.
2. Add their email in the Supabase SQL editor:
   ```sql
   insert into public.platform_admins (email, note) values ('you@opervia.com', 'Founder');
   ```
3. They sign in and land on `/admin`. If they also belong to a workspace, an **Opervia billing admin** link appears in that workspace's sidebar.

To remove access: `update public.platform_admins set is_active = false where email = '…';`

## Billing rules

- **One subscription per workspace**, monthly, each with its own cycle (anchored on its start date, so a 31st anchor doesn't drift).
- **New workspace**: the subscription is created automatically together with the **first invoice** for `[today, today + 1 month − 1 day]`. That invoice is due in `first_invoice_due_days` (default **7**). The workspace can be used straight away.
- **Renewals**: the daily check issues the next invoice `invoice_lead_days` (default **7**) before the period starts. It is due **on the first day** of that period.
- **Reminders**: in-app notifications `reminder_days_before` (default **3**) days before the due date and on the due date itself, once each.
- **Overdue**: the day after the due date, the invoice and the subscription become *overdue*. Access continues during the **grace period** (default **3 days**, configurable per subscription).
- **Automatic suspension**: if the payment is still not *verified* when the grace period ends (due date + grace days has passed), the subscription is suspended with reason `payment_overdue`. A proof that is still waiting for verification does not stop this, so verify promptly.
- **Confirming a payment** marks the invoice paid and records the admin and the time. It also moves the subscription into the paid period.
  - If the workspace was suspended **for non-payment** and nothing else is past its grace period, it is **reactivated automatically**. Because service was off, the paid month **restarts on the reactivation day** (the billing anchor moves).
  - If it was suspended for **any other reason**, it stays suspended until an admin clicks **Reactivate**.
- **Rejecting a payment** requires a reason. The client sees the reason. The proof file is kept, and the client can upload a new one.
- **Plan and price changes** apply to invoices issued afterwards. Existing invoices never change. Issued invoices are frozen: number, amount, period and due date cannot be edited, only cancelled.
- Partial payments aren't supported. The amount received must be at least the invoice amount.

Statuses: subscription `active · pending_payment · overdue · suspended · cancelled`. Invoice `unpaid · pending_verification · paid · rejected · overdue · cancelled`.

All billing dates use the **Asia/Jakarta** calendar day.

## What suspension does (server-side)

Suspension and cancellation are enforced **in the database**, not just hidden in the UI:

- `private.require_member()` runs at the start of every workflow function (create, edit, submit, approve, request revision, reject, schedule, attachments, invites, team and client management). It refuses with error `PT402` when the workspace's subscription is suspended or cancelled.
- The RLS policies on `content_items`, `content_versions`, `attachments`, `approval_events` and the `attachments` storage bucket return nothing for a suspended workspace. Upload policies refuse new files.
- Nothing is deleted: content, settings, members, invoices and history are all kept. Other workspaces are unaffected.
- The workspace admin can still open **Billing**, see why access was suspended, which invoice is unpaid and how much is outstanding, and upload a payment proof.

## History & audit trail

- `billing_events` holds the **payment and subscription history**, visible to the workspace's own admins and to billing admins. Every invoice, reminder, upload, submission, confirmation, rejection, overdue marking, period change, plan or price change, suspension, reactivation and cancellation is recorded. Each record has the actor, amount, previous and new value, and reason.
- `billing_audit_log` is the **administrative audit trail**, visible to billing admins only. It records the event id, client, administrator, action, previous value, new value, reason, **internal notes** and timestamp.
- Both are **append-only**: database triggers reject `UPDATE`, `DELETE` and `TRUNCATE` for everyone, including the database owner. Invoices, payment proofs and subscriptions cannot be deleted.
- Admin console: **History** has tabs for all events, payment history, subscription history and audit trail. You can search by client or invoice number and filter by event type, payment status and date range. Each client also has its own page at `/admin/clients/[id]`.

## Payment proofs

- Private Storage bucket `payment-proofs` (not public). JPG, PNG or PDF only, **10 MB** maximum, enforced by the bucket and again by `submit_payment_proof`.
- Path: `{workspace_id}/{invoice_id}/{random}-{file}`. Storage policies let a workspace admin upload only into their own workspace's open invoices. Only that workspace's admins and billing admins can read the files. There are no update or delete policies.
- Files are opened through `/api/billing/proofs/[id]`, which checks access and redirects to a **2-minute signed URL**.

## Daily cron

**Primary: `pg_cron` in Supabase** (already active). Job `opervia-billing-daily` runs `private.billing_run()` every day at **17:05 UTC = 00:05 WIB**. No secret or key is involved. Check it in the SQL editor:

```sql
select * from cron.job where jobname = 'opervia-billing-daily';
select * from cron.job_run_details order by start_time desc limit 10;   -- run log
```

`private.billing_run()` takes an advisory lock, so overlapping runs skip. Every step is state-based and the history events carry idempotency keys, so **running it twice never creates duplicate invoices, events or notifications**. A unique constraint on `(subscription_id, period_start)` blocks duplicate invoices at the database level too. Admins can also click **Run daily check now** on the Overview page.

**Optional backup: Vercel Cron.** `vercel.json` also calls `GET /api/cron/billing` daily at the same time. Until `CRON_SECRET` is set, the route simply answers "skipped". To enable it:

1. the route checks `Authorization: Bearer $CRON_SECRET` (Vercel adds this header automatically when `CRON_SECRET` is set);
2. it calls `public.run_billing_jobs(token)` with the publishable key. The database verifies the token against the **SHA-256 hash** in `private.billing_secrets`, so **no service-role key is needed or stored in Vercel**.

Generate a random secret (for example `openssl rand -hex 32`) and use the same value in both places:

```sql
-- Supabase SQL editor
insert into private.billing_secrets (name, token_hash)
values ('cron', encode(sha256(convert_to('PASTE-THE-SECRET', 'UTF8')), 'hex'))
on conflict (name) do update set token_hash = excluded.token_hash, updated_at = now();
```

Then set `CRON_SECRET` to the same value in Vercel (Production, type *Sensitive*) and redeploy.

## API surface

Server actions in `src/app/actions/billing.ts` call these database functions (all `SECURITY DEFINER`, each checking the caller):

| Function | Who |
| --- | --- |
| `get_workspace_access()` | any member: their workspace's subscription status |
| `get_payment_details()` | workspace admins, billing admins |
| `submit_payment_proof(...)` | workspace admins (own open invoices only) |
| `am_i_billing_admin()` | anyone signed in |
| `admin_confirm_payment`, `admin_reject_payment` | billing admins |
| `admin_suspend_subscription`, `admin_reactivate_subscription`, `admin_cancel_subscription`, `admin_update_subscription`, `admin_create_subscription` | billing admins |
| `admin_cancel_invoice`, `admin_save_billing_settings`, `admin_save_plan`, `admin_run_billing_jobs`, `admin_billing_overview` | billing admins |
| `run_billing_jobs(token)` | the cron (anon + secret) |

HTTP routes: `GET /api/billing/proofs/[id]` (signed proof URL) and `GET /api/cron/billing` (daily job).

## Testing

`supabase/tests/billing_e2e.sql` runs the whole lifecycle as real roles (`authenticated` + JWT claims, so RLS applies). It simulates calendar days by overriding `private.jakarta_today()` inside the transaction. It always ends by raising an exception, so **everything is rolled back** and it is safe on a live project. Paste it into the SQL editor and read the error message, which is the report. It covers 27 checks:

new client gets an invoice · upload proof (and cross-workspace upload blocked) · upload never marks paid · admin views the proof · confirm (underpayment refused, admin and time and audit recorded) · subscription active · renewal issued 7 days ahead · due date → overdue · still active inside the grace period · automatic suspension after it · suspended workspace blocked (PT402) and content hidden, with data preserved · suspended admin can still pay · late payment reactivates and re-anchors the period · next renewal follows the new period · every event in the history · other clients, team and approvers see no billing data · clients cannot change status, fake history, self-approve, reactivate, edit bank details or delete · even the DB owner cannot edit history or paid invoices · rejection flow · a manual suspension survives a payment · demo workspaces exempt · admin metrics.

## Known limitations

- Notifications are **in-app only** (the bell). No email or WhatsApp is sent for invoices, reminders or suspensions yet. Adding custom SMTP or an email provider would be the next step.
- No PDF invoice download yet. The invoice page itself can be printed.
- One plan per subscription, monthly cycle only, no proration, no partial payments, no taxes or VAT lines.
- Anyone with direct database owner access (the Supabase dashboard) can still change data outside the app. The append-only triggers make history edits fail, but an owner could drop the triggers, so restrict dashboard access.
- Vercel Hobby crons run once per day within the scheduled hour. The run is idempotent, so a late or extra run is harmless.
