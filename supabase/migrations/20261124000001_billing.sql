-- =============================================================================
-- Opervia — subscription billing, manual bank transfers, verification,
-- suspension and history.
--
-- Who is who
--   * The paying customer is an agency WORKSPACE (public.organizations).
--     Its active "admin" members are its billing contacts: they see invoices,
--     upload payment proofs and see the billing history of their workspace.
--   * Opervia staff are BILLING ADMINS (public.platform_admins, by verified
--     email). Only they can confirm or reject payments, suspend, reactivate,
--     change plans and prices, and edit the bank account details.
--
-- Security model (same as the rest of the app)
--   * RLS on every table; the API roles may only SELECT through policies.
--   * Every write goes through a SECURITY DEFINER function that checks the
--     caller and the billing rules. Clients can never change invoice status.
--   * billing_events and billing_audit_log are append-only (no UPDATE/DELETE,
--     no TRUNCATE). Invoices, payment proofs and subscriptions cannot be deleted
--     (except by the service-role-only demo purge).
--   * Suspension is enforced in the database: private.require_member (used by
--     every workflow function) and the content RLS policies check that the
--     workspace's subscription is not suspended or cancelled.
--   * Dates for billing use the Asia/Jakarta calendar day.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.platform_admins (
  email text primary key check (email = lower(email) and char_length(email) between 3 and 254),
  is_active boolean not null default true,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
comment on table public.platform_admins is 'Opervia billing administrators, matched on the signed-in user''s verified email.';

create table public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  description text check (description is null or char_length(description) <= 1000),
  monthly_price numeric(14, 2) not null check (monthly_price > 0 and monthly_price < 1000000000000),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index billing_plans_one_default on public.billing_plans ((true)) where is_default;
create unique index billing_plans_name_key on public.billing_plans (lower(name));

create table public.billing_settings (
  id smallint primary key default 1 check (id = 1),
  bank_name text not null default '' check (char_length(bank_name) <= 120),
  account_holder text not null default '' check (char_length(account_holder) <= 160),
  account_number text not null default '' check (char_length(account_number) <= 60),
  payment_instructions text not null default '' check (char_length(payment_instructions) <= 2000),
  default_grace_days integer not null default 3 check (default_grace_days between 0 and 60),
  invoice_lead_days integer not null default 7 check (invoice_lead_days between 0 and 28),
  first_invoice_due_days integer not null default 7 check (first_invoice_due_days between 0 and 60),
  reminder_days_before integer not null default 3 check (reminder_days_before between 0 and 28),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organizations (id) on delete cascade,
  plan_id uuid references public.billing_plans (id) on delete set null,
  plan_name text not null,
  monthly_price numeric(14, 2) not null check (monthly_price > 0),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending_payment'
    check (status in ('active', 'pending_payment', 'overdue', 'suspended', 'cancelled')),
  billing_cycle text not null default 'monthly' check (billing_cycle = 'monthly'),
  start_date date not null,
  billing_anchor_date date not null,
  current_period_start date not null,
  current_period_end date not null,
  next_payment_due_date date,
  grace_period_days integer not null default 3 check (grace_period_days between 0 and 60),
  suspended_at timestamptz,
  suspension_reason text check (suspension_reason is null or suspension_reason in
    ('payment_overdue', 'client_requested', 'administrative_review', 'contract_issue', 'other')),
  suspension_message text check (suspension_message is null or char_length(suspension_message) <= 1000),
  last_reactivated_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_period check (current_period_end >= current_period_start),
  constraint subscriptions_suspension check (status <> 'suspended' or (suspended_at is not null and suspension_reason is not null)),
  unique (id, org_id)
);
comment on column public.subscriptions.suspension_message is 'Optional explanation shown to the client. Internal notes live only in billing_audit_log.';
comment on column public.subscriptions.billing_anchor_date is 'Billing periods run monthly from this date (re-anchored when a payment-overdue suspension is lifted).';

create sequence public.invoice_number_seq;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  org_id uuid not null,
  subscription_id uuid not null,
  client_name text not null,
  client_email text,
  plan_name text not null,
  period_start date not null,
  period_end date not null,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'unpaid'
    check (status in ('unpaid', 'pending_verification', 'paid', 'rejected', 'overdue', 'cancelled')),
  issue_date date not null,
  due_date date not null,
  payment_instructions jsonb not null default '{}'::jsonb,
  latest_proof_id uuid,
  amount_paid numeric(14, 2),
  paid_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  rejection_reason text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_subscription_fk foreign key (subscription_id, org_id) references public.subscriptions (id, org_id) on delete cascade,
  constraint invoices_period check (period_end >= period_start),
  -- one invoice per subscription and billing period (prevents duplicates)
  unique (subscription_id, period_start),
  unique (id, org_id)
);
create index invoices_org_idx on public.invoices (org_id, issue_date desc);
create index invoices_status_idx on public.invoices (status, due_date);

create table public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  invoice_id uuid not null,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  amount_claimed numeric(14, 2) not null check (amount_claimed > 0),
  transfer_date date not null,
  sender_name text not null check (char_length(sender_name) between 2 and 120),
  sender_bank text check (sender_bank is null or char_length(sender_bank) <= 120),
  note text check (note is null or char_length(note) <= 1000),
  submitted_by uuid references auth.users (id) on delete set null,
  submitted_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  constraint payment_proofs_invoice_fk foreign key (invoice_id, org_id) references public.invoices (id, org_id) on delete cascade
);
create index payment_proofs_invoice_idx on public.payment_proofs (invoice_id, submitted_at desc);
create index payment_proofs_pending_idx on public.payment_proofs (submitted_at) where status = 'pending';

alter table public.invoices
  add constraint invoices_latest_proof_fk foreign key (latest_proof_id) references public.payment_proofs (id) on delete set null;

-- Payment + subscription history (client-visible for their own workspace).
-- No foreign keys on purpose: history must outlive anything it refers to.
create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  subscription_id uuid,
  invoice_id uuid,
  invoice_number text,
  client_name text not null default '',
  category text not null check (category in ('payment', 'subscription')),
  event_type text not null check (event_type in (
    'invoice_generated', 'payment_reminder', 'proof_uploaded', 'payment_submitted', 'payment_confirmed',
    'payment_rejected', 'invoice_overdue', 'invoice_cancelled',
    'subscription_created', 'plan_changed', 'price_changed', 'grace_period_changed', 'period_extended',
    'subscription_activated', 'subscription_pending_payment', 'subscription_overdue',
    'subscription_suspended', 'subscription_reactivated', 'subscription_cancelled'
  )),
  actor_id uuid,
  actor_name text not null default '',
  actor_kind text not null check (actor_kind in ('client', 'admin', 'system')),
  amount numeric(14, 2),
  currency text,
  from_value text,
  to_value text,
  reason text,
  details jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
create index billing_events_org_idx on public.billing_events (org_id, created_at desc);
create index billing_events_feed_idx on public.billing_events (category, created_at desc);
create index billing_events_invoice_idx on public.billing_events (invoice_id);

-- Administrative audit trail (Opervia billing admins only).
create table public.billing_audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  client_name text not null default '',
  admin_id uuid,
  admin_email text not null default '',
  action_type text not null,
  entity_type text not null,
  entity_id uuid,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  internal_notes text,
  created_at timestamptz not null default now()
);
create index billing_audit_org_idx on public.billing_audit_log (org_id, created_at desc);
create index billing_audit_time_idx on public.billing_audit_log (created_at desc);

-- Not exposed through the API (private schema).
create table private.billing_runs (
  id bigint generated always as identity primary key,
  run_date date not null,
  source text not null,
  started_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb
);

create table private.billing_secrets (
  name text primary key,
  token_hash text not null,
  updated_at timestamptz not null default now()
);

-- Billing notification types.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'submitted', 'resubmitted', 'approved', 'revision_requested', 'rejected', 'scheduled', 'reopened',
  'invoice_issued', 'payment_due_soon', 'payment_overdue', 'payment_submitted', 'payment_confirmed',
  'payment_rejected', 'subscription_suspended', 'subscription_reactivated', 'subscription_cancelled'
));

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------

create trigger billing_plans_touch before update on public.billing_plans for each row execute function private.touch_updated_at();
create trigger billing_settings_touch before update on public.billing_settings for each row execute function private.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions for each row execute function private.touch_updated_at();
create trigger invoices_touch before update on public.invoices for each row execute function private.touch_updated_at();

create or replace function private.billing_history_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Billing history is permanent and cannot be changed or deleted.' using errcode = '42501';
end $$;

create trigger billing_events_append_only before update or delete on public.billing_events
  for each row execute function private.billing_history_append_only();
create trigger billing_events_no_truncate before truncate on public.billing_events
  for each statement execute function private.billing_history_append_only();
create trigger billing_audit_append_only before update or delete on public.billing_audit_log
  for each row execute function private.billing_history_append_only();
create trigger billing_audit_no_truncate before truncate on public.billing_audit_log
  for each statement execute function private.billing_history_append_only();

-- Billing records are never deleted (only the service-role demo purge may).
create or replace function private.billing_no_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_setting('app.allow_purge', true) = 'on' then return old; end if;
  raise exception 'Billing records cannot be deleted.' using errcode = '42501';
end $$;

create trigger subscriptions_no_delete before delete on public.subscriptions for each row execute function private.billing_no_delete();
create trigger invoices_no_delete before delete on public.invoices for each row execute function private.billing_no_delete();
create trigger payment_proofs_no_delete before delete on public.payment_proofs for each row execute function private.billing_no_delete();

-- An issued invoice's identity and amount are frozen.
create or replace function private.protect_invoice() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.invoice_number is distinct from old.invoice_number or new.org_id is distinct from old.org_id
     or new.subscription_id is distinct from old.subscription_id or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end or new.issue_date is distinct from old.issue_date
     or new.due_date is distinct from old.due_date then
    raise exception 'Issued invoices cannot be altered. Cancel the invoice instead.' using errcode = '42501';
  end if;
  if old.status in ('paid', 'cancelled') and new.status is distinct from old.status then
    raise exception 'Invoice % is % and can no longer change status.', old.invoice_number, old.status using errcode = '42501';
  end if;
  return new;
end $$;
create trigger invoices_protect before update on public.invoices for each row execute function private.protect_invoice();

-- A submitted payment proof is frozen; only its single review can be recorded.
create or replace function private.protect_payment_proof() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'pending' then
    raise exception 'This payment proof has already been reviewed.' using errcode = '42501';
  end if;
  if new.storage_path is distinct from old.storage_path or new.file_name is distinct from old.file_name
     or new.mime_type is distinct from old.mime_type or new.size_bytes is distinct from old.size_bytes
     or new.amount_claimed is distinct from old.amount_claimed or new.transfer_date is distinct from old.transfer_date
     or new.sender_name is distinct from old.sender_name or new.sender_bank is distinct from old.sender_bank
     or new.note is distinct from old.note or new.invoice_id is distinct from old.invoice_id
     or new.org_id is distinct from old.org_id or new.submitted_by is distinct from old.submitted_by
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'Submitted payment proofs cannot be altered.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger payment_proofs_protect before update on public.payment_proofs for each row execute function private.protect_payment_proof();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function private.jakarta_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Jakarta')::date
$$;

-- Number of whole calendar months from the anchor's month to d's month.
create or replace function private.period_index(p_anchor date, p_day date) returns integer
language sql immutable set search_path = '' as $$
  select ((extract(year from p_day) - extract(year from p_anchor)) * 12
          + (extract(month from p_day) - extract(month from p_anchor)))::integer
$$;

-- Last day of the monthly period that starts on p_start (anchored, so 31st-of-month
-- anchors don't drift).
create or replace function private.period_end_for(p_anchor date, p_start date) returns date
language sql immutable set search_path = '' as $$
  select ((p_anchor + make_interval(months => private.period_index(p_anchor, p_start) + 1))::date - 1)
$$;

create or replace function private.fmt_money(p_amount numeric, p_currency text) returns text
language sql immutable set search_path = '' as $$
  select case when p_currency = 'IDR'
              then 'Rp ' || replace(to_char(round(p_amount), 'FM999,999,999,999,990'), ',', '.')
              else p_currency || ' ' || to_char(p_amount, 'FM999,999,999,990.00') end
$$;

create or replace function private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.platform_admins pa
    join auth.users u on lower(u.email) = pa.email
    where u.id = (select auth.uid()) and pa.is_active and u.email_confirmed_at is not null
  )
$$;

-- The workspace whose billing the caller manages (active agency admins only).
create or replace function private.billing_org() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m
  where m.user_id = (select auth.uid()) and m.is_active and m.role = 'admin' limit 1
$$;

-- Paid services are available unless the subscription is suspended or cancelled.
-- Fictional demo workspaces are never billed.
create or replace function private.org_service_active(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_org is null
      or coalesce((select o.is_demo from public.organizations o where o.id = p_org), false)
      or not exists (select 1 from public.subscriptions s where s.org_id = p_org and s.status in ('suspended', 'cancelled'))
$$;

create or replace function private.require_platform_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'You must be signed in.' using errcode = '28000'; end if;
  if not private.is_platform_admin() then
    raise exception 'Only Opervia billing administrators can do this.' using errcode = '42501';
  end if;
  return (select auth.uid());
end $$;

create or replace function private.billing_actor_kind() returns text
language sql stable security definer set search_path = '' as $$
  select case when (select auth.uid()) is null then 'system'
              when private.is_platform_admin() then 'admin'
              else 'client' end
$$;

create or replace function private.org_admin_ids(p_org uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.user_id), '{}') from public.memberships m
  where m.org_id = p_org and m.role = 'admin' and m.is_active
$$;

create or replace function private.platform_admin_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(u.id), '{}') from auth.users u
  join public.platform_admins pa on pa.email = lower(u.email)
  where pa.is_active and u.email_confirmed_at is not null
$$;

-- By default the person who caused the event is not notified about it.
create or replace function private.notify_users(p_org uuid, p_users uuid[], p_type text, p_title text, p_body text,
  p_include_actor boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (org_id, user_id, item_id, type, title, body)
  select distinct p_org, u, null::uuid, p_type, left(p_title, 200), left(coalesce(p_body, ''), 500)
  from unnest(p_users) as u
  where u is not null
    and (p_include_actor or u <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid));
end $$;

-- Writes one history event. Returns false if an event with the same
-- idempotency key already exists (so repeated runs don't duplicate history).
create or replace function private.log_billing_event(
  p_org uuid, p_sub uuid, p_invoice uuid, p_category text, p_type text,
  p_amount numeric default null, p_currency text default null,
  p_from text default null, p_to text default null, p_reason text default null,
  p_details jsonb default '{}'::jsonb, p_key text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_inv_no text;
  v_name text;
  v_id uuid;
begin
  select invoice_number into v_inv_no from public.invoices where id = p_invoice;
  select name into v_name from public.organizations where id = p_org;
  insert into public.billing_events (org_id, subscription_id, invoice_id, invoice_number, client_name, category, event_type,
    actor_id, actor_name, actor_kind, amount, currency, from_value, to_value, reason, details, idempotency_key)
  values (p_org, p_sub, p_invoice, v_inv_no, coalesce(v_name, ''), p_category, p_type,
    (select auth.uid()), coalesce(private.actor_name((select auth.uid())), case when (select auth.uid()) is null then 'Opervia billing system' else '' end),
    private.billing_actor_kind(), p_amount, p_currency, p_from, p_to, nullif(trim(coalesce(p_reason, '')), ''),
    coalesce(p_details, '{}'::jsonb), p_key)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id is not null;
end $$;

create or replace function private.audit(
  p_org uuid, p_action text, p_entity_type text, p_entity_id uuid,
  p_prev jsonb, p_new jsonb, p_reason text, p_notes text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.billing_audit_log (org_id, client_name, admin_id, admin_email, action_type, entity_type, entity_id,
    previous_value, new_value, reason, internal_notes)
  values (p_org, coalesce((select name from public.organizations where id = p_org), ''), (select auth.uid()),
    coalesce((select email from auth.users where id = (select auth.uid())), ''), p_action, p_entity_type, p_entity_id,
    p_prev, p_new, nullif(trim(coalesce(p_reason, '')), ''), nullif(trim(coalesce(p_notes, '')), ''));
end $$;

create or replace function private.bank_details() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('bank_name', s.bank_name, 'account_holder', s.account_holder,
                            'account_number', s.account_number, 'payment_instructions', s.payment_instructions)
  from public.billing_settings s where s.id = 1
$$;

-- -----------------------------------------------------------------------------
-- Core billing operations (internal)
-- -----------------------------------------------------------------------------

-- Issues the invoice for the period starting p_period_start. Returns the new
-- invoice id, or null when that period was already invoiced.
create or replace function private.issue_invoice(p_sub public.subscriptions, p_period_start date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_set public.billing_settings;
  v_today date := private.jakarta_today();
  v_first boolean;
  v_due date;
  v_end date := private.period_end_for(p_sub.billing_anchor_date, p_period_start);
  v_org_name text;
  v_email text;
  v_id uuid;
  v_number text;
begin
  select * into v_set from public.billing_settings where id = 1;
  v_first := not exists (select 1 from public.invoices where subscription_id = p_sub.id);
  v_due := case when v_first then greatest(p_period_start, v_today) + v_set.first_invoice_due_days else p_period_start end;
  select o.name into v_org_name from public.organizations o where o.id = p_sub.org_id;
  select p.email into v_email from public.memberships m join public.profiles p on p.id = m.user_id
    where m.org_id = p_sub.org_id and m.role = 'admin' and m.is_active order by m.created_at limit 1;
  v_number := 'OPV-' || to_char(v_today, 'YYYYMM') || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0');

  insert into public.invoices (invoice_number, org_id, subscription_id, client_name, client_email, plan_name, period_start, period_end,
    amount, currency, status, issue_date, due_date, payment_instructions)
  values (v_number, p_sub.org_id, p_sub.id, coalesce(v_org_name, ''), v_email, p_sub.plan_name, p_period_start, v_end,
    p_sub.monthly_price, p_sub.currency, 'unpaid', v_today, v_due, coalesce(private.bank_details(), '{}'::jsonb))
  on conflict (subscription_id, period_start) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  perform private.log_billing_event(p_sub.org_id, p_sub.id, v_id, 'payment', 'invoice_generated', p_sub.monthly_price, p_sub.currency,
    null, 'unpaid', null,
    jsonb_build_object('period_start', p_period_start, 'period_end', v_end, 'due_date', v_due), 'invoice_generated:' || v_id);
  perform private.notify_users(p_sub.org_id, private.org_admin_ids(p_sub.org_id), 'invoice_issued', 'New invoice ' || v_number,
    private.fmt_money(p_sub.monthly_price, p_sub.currency) || ' · due ' || to_char(v_due, 'DD Mon YYYY'), true);
  return v_id;
end $$;

-- Recomputes status (active / pending_payment / overdue) and the next payment
-- due date from the outstanding invoices. Suspended and cancelled are sticky.
create or replace function private.recompute_subscription(p_sub_id uuid, p_today date) returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.subscriptions;
  v_outstanding boolean;
  v_overdue boolean;
  v_next date;
  v_new text;
begin
  select * into s from public.subscriptions where id = p_sub_id for update;
  if not found then return null; end if;
  select count(*) > 0, coalesce(bool_or(i.due_date < p_today), false), min(i.due_date)
    into v_outstanding, v_overdue, v_next
  from public.invoices i
  where i.subscription_id = s.id and i.status in ('unpaid', 'pending_verification', 'rejected', 'overdue');
  v_next := coalesce(v_next, s.current_period_end + 1);
  if s.status in ('suspended', 'cancelled') then
    update public.subscriptions set next_payment_due_date = v_next where id = s.id and next_payment_due_date is distinct from v_next;
    return s.status;
  end if;
  v_new := case when v_overdue then 'overdue' when v_outstanding then 'pending_payment' else 'active' end;
  update public.subscriptions set status = v_new, next_payment_due_date = v_next
  where id = s.id and (status is distinct from v_new or next_payment_due_date is distinct from v_next);
  if v_new <> s.status then
    perform private.log_billing_event(s.org_id, s.id, null, 'subscription',
      case v_new when 'active' then 'subscription_activated' when 'overdue' then 'subscription_overdue' else 'subscription_pending_payment' end,
      null, null, s.status, v_new, null, jsonb_build_object('next_payment_due_date', v_next));
  end if;
  return v_new;
end $$;

create or replace function private.suspend_subscription(p_sub_id uuid, p_reason text, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.subscriptions;
begin
  select * into s from public.subscriptions where id = p_sub_id for update;
  if s.status in ('suspended', 'cancelled') then return; end if;
  update public.subscriptions
  set status = 'suspended', suspended_at = now(), suspension_reason = p_reason,
      suspension_message = nullif(trim(coalesce(p_message, '')), '')
  where id = s.id;
  perform private.log_billing_event(s.org_id, s.id, null, 'subscription', 'subscription_suspended', null, null,
    s.status, 'suspended', coalesce(nullif(trim(coalesce(p_message, '')), ''), replace(p_reason, '_', ' ')),
    jsonb_build_object('suspension_reason', p_reason));
  perform private.notify_users(s.org_id, private.org_admin_ids(s.org_id), 'subscription_suspended', 'Workspace access suspended',
    case when p_reason = 'payment_overdue'
         then 'Payment was not verified within the grace period. Open Billing to submit your payment proof.'
         else 'Your subscription was suspended by Opervia. Open Billing for details.' end);
end $$;

create or replace function private.create_subscription(p_org uuid, p_plan_id uuid, p_start date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.billing_plans;
  v_set public.billing_settings;
  s public.subscriptions;
begin
  if p_plan_id is null then
    select * into v_plan from public.billing_plans where is_default and is_active limit 1;
  else
    select * into v_plan from public.billing_plans where id = p_plan_id and is_active;
  end if;
  if v_plan.id is null then raise exception 'Choose an active billing plan.' using errcode = '22023'; end if;
  select * into v_set from public.billing_settings where id = 1;
  insert into public.subscriptions (org_id, plan_id, plan_name, monthly_price, currency, status, start_date, billing_anchor_date,
    current_period_start, current_period_end, grace_period_days)
  values (p_org, v_plan.id, v_plan.name, v_plan.monthly_price, v_plan.currency, 'pending_payment', p_start, p_start,
    p_start, private.period_end_for(p_start, p_start), v_set.default_grace_days)
  returning * into s;
  perform private.log_billing_event(p_org, s.id, null, 'subscription', 'subscription_created', s.monthly_price, s.currency,
    null, 'pending_payment', null, jsonb_build_object('plan', s.plan_name, 'start_date', p_start));
  perform private.issue_invoice(s, p_start);
  perform private.recompute_subscription(s.id, private.jakarta_today());
  return s.id;
end $$;

-- New (non-demo) workspaces get a subscription and their first invoice.
-- Deferred, so it runs after create_organization has added the admin member.
-- It never blocks sign-up: a failure is reported as a warning only.
create or replace function private.on_organization_created() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_demo boolean;
begin
  -- Re-read the row: it may have been flagged as demo (or removed) later in the same transaction.
  select is_demo into v_demo from public.organizations where id = new.id;
  if not found or v_demo then return null; end if;
  if exists (select 1 from public.subscriptions where org_id = new.id) then return null; end if;
  begin
    perform private.create_subscription(new.id, null, private.jakarta_today());
  exception when others then
    raise warning 'Opervia billing: could not create a subscription for organization %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
create constraint trigger organizations_create_subscription after insert on public.organizations
  deferrable initially deferred for each row execute function private.on_organization_created();

-- -----------------------------------------------------------------------------
-- Daily billing run (idempotent; safe to run any number of times per day)
-- -----------------------------------------------------------------------------

create or replace function private.billing_run(p_today date, p_source text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_set public.billing_settings;
  s public.subscriptions;
  i public.invoices;
  v_new_invoices integer := 0;
  v_overdue_invoices integer := 0;
  v_suspended integer := 0;
  v_reminders integer := 0;
  v_days integer;
  v_summary jsonb;
begin
  -- Only one run at a time; a concurrent duplicate simply skips.
  if not pg_try_advisory_xact_lock(hashtext('opervia.billing_run')) then
    return jsonb_build_object('skipped', true, 'reason', 'another billing run is in progress');
  end if;
  select * into v_set from public.billing_settings where id = 1;

  -- 1. Monthly renewal invoices, issued invoice_lead_days before the next period.
  for s in
    select sb.* from public.subscriptions sb join public.organizations o on o.id = sb.org_id
    where not o.is_demo and sb.status in ('active', 'pending_payment', 'overdue')
      and sb.current_period_end + 1 - v_set.invoice_lead_days <= p_today
    for update of sb
  loop
    if private.issue_invoice(s, s.current_period_end + 1) is not null then
      v_new_invoices := v_new_invoices + 1;
    end if;
  end loop;

  -- 2. Unpaid invoices past their due date become overdue.
  for i in
    select iv.* from public.invoices iv join public.organizations o on o.id = iv.org_id
    where not o.is_demo and iv.status in ('unpaid', 'rejected') and iv.due_date < p_today
    for update of iv
  loop
    update public.invoices set status = 'overdue' where id = i.id;
    if private.log_billing_event(i.org_id, i.subscription_id, i.id, 'payment', 'invoice_overdue', i.amount, i.currency,
         i.status, 'overdue', null, jsonb_build_object('due_date', i.due_date), 'invoice_overdue:' || i.id) then
      perform private.notify_users(i.org_id, private.org_admin_ids(i.org_id), 'payment_overdue', 'Invoice ' || i.invoice_number || ' is overdue',
        private.fmt_money(i.amount, i.currency) || ' was due ' || to_char(i.due_date, 'DD Mon YYYY') || '. Submit your payment proof to avoid suspension.');
    end if;
    v_overdue_invoices := v_overdue_invoices + 1;
  end loop;

  -- 3. Refresh every live subscription's status and next due date.
  for s in
    select sb.* from public.subscriptions sb join public.organizations o on o.id = sb.org_id
    where not o.is_demo and sb.status in ('active', 'pending_payment', 'overdue')
  loop
    perform private.recompute_subscription(s.id, p_today);
  end loop;

  -- 4. Grace period expired without a verified payment -> automatic suspension.
  for s in
    select sb.* from public.subscriptions sb join public.organizations o on o.id = sb.org_id
    where not o.is_demo and sb.status = 'overdue'
      and exists (select 1 from public.invoices iv where iv.subscription_id = sb.id
                  and iv.status in ('unpaid', 'pending_verification', 'rejected', 'overdue')
                  and iv.due_date + sb.grace_period_days < p_today)
  loop
    perform private.suspend_subscription(s.id, 'payment_overdue', null);
    v_suspended := v_suspended + 1;
  end loop;

  -- 5. Reminders: N days before the due date and on the due date (once each).
  for i in
    select iv.* from public.invoices iv join public.organizations o on o.id = iv.org_id
    where not o.is_demo and iv.status = 'unpaid' and (iv.due_date - p_today) in (v_set.reminder_days_before, 0)
  loop
    v_days := i.due_date - p_today;
    if private.log_billing_event(i.org_id, i.subscription_id, i.id, 'payment', 'payment_reminder', i.amount, i.currency,
         null, null, null, jsonb_build_object('days_before_due', v_days), 'reminder:' || i.id || ':' || v_days) then
      perform private.notify_users(i.org_id, private.org_admin_ids(i.org_id), 'payment_due_soon',
        case when v_days = 0 then 'Invoice ' || i.invoice_number || ' is due today' else 'Invoice ' || i.invoice_number || ' is due in ' || v_days || ' days' end,
        private.fmt_money(i.amount, i.currency) || ' · due ' || to_char(i.due_date, 'DD Mon YYYY'));
      v_reminders := v_reminders + 1;
    end if;
  end loop;

  v_summary := jsonb_build_object('run_date', p_today, 'invoices_generated', v_new_invoices, 'invoices_marked_overdue', v_overdue_invoices,
    'subscriptions_suspended', v_suspended, 'reminders_sent', v_reminders);
  insert into private.billing_runs (run_date, source, summary) values (p_today, p_source, v_summary);
  return v_summary;
end $$;

-- -----------------------------------------------------------------------------
-- Suspension enforcement for the existing workflow
-- -----------------------------------------------------------------------------

-- Same as before, plus: suspended/cancelled workspaces can't use any workflow.
create or replace function private.require_member(p_roles text[]) returns public.memberships
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be signed in.' using errcode = '28000';
  end if;
  select * into m from public.memberships where user_id = (select auth.uid()) and is_active;
  if not found then
    raise exception 'Your account is not an active member of a workspace.' using errcode = '42501';
  end if;
  if not (m.role = any (p_roles)) then
    raise exception 'Your role (%) is not allowed to do this.', m.role using errcode = '42501';
  end if;
  if not private.org_service_active(m.org_id) then
    raise exception 'This workspace''s subscription is suspended, so this action is unavailable. A workspace admin can restore access from the Billing page.'
      using errcode = 'PT402';
  end if;
  return m;
end $$;

drop policy "read visible content items" on public.content_items;
create policy "read visible content items" on public.content_items for select to authenticated
  using (
    org_id = (select private.org_id())
    and (select private.org_service_active(private.org_id()))
    and ((select private.is_agency()) or (client_id = (select private.client_id()) and status <> 'draft'))
  );

drop policy "read visible versions" on public.content_versions;
create policy "read visible versions" on public.content_versions for select to authenticated
  using (
    org_id = (select private.org_id())
    and (select private.org_service_active(private.org_id()))
    and ((select private.is_agency()) or (submitted_at is not null and private.can_view_item(item_id)))
  );

drop policy "read visible attachments" on public.attachments;
create policy "read visible attachments" on public.attachments for select to authenticated
  using (
    org_id = (select private.org_id())
    and (select private.org_service_active(private.org_id()))
    and (
      (select private.is_agency())
      or exists (
        select 1 from public.content_versions v
        where v.id = attachments.version_id and v.submitted_at is not null and private.can_view_item(v.item_id)
      )
    )
  );

drop policy "read visible approval events" on public.approval_events;
create policy "read visible approval events" on public.approval_events for select to authenticated
  using (
    org_id = (select private.org_id())
    and (select private.org_service_active(private.org_id()))
    and ((select private.is_agency()) or (visibility = 'client' and private.can_view_item(item_id)))
  );

drop policy "agency uploads attachments to editable items" on storage.objects;
create policy "agency uploads attachments to editable items" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (select private.is_agency())
    and (select private.org_service_active(private.org_id()))
    and (storage.foldername(name))[1] = (select private.org_id())::text
    and exists (
      select 1 from public.content_items i
      where i.id::text = (storage.foldername(name))[2]
        and i.org_id = (select private.org_id())
        and i.status in ('draft', 'revision_required')
    )
  );

drop policy "members read attachments they can see" on storage.objects;
create policy "members read attachments they can see" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select private.org_id())::text
    and (select private.org_service_active(private.org_id()))
    and (
      (select private.is_agency())
      or exists (
        select 1 from public.attachments a
        join public.content_versions v on v.id = a.version_id
        where a.storage_path = objects.name and v.submitted_at is not null and private.can_view_item(a.item_id)
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Row Level Security for billing (read access; writes go through functions)
-- -----------------------------------------------------------------------------

alter table public.platform_admins enable row level security;
alter table public.billing_plans enable row level security;
alter table public.billing_settings enable row level security;
alter table public.subscriptions enable row level security;
alter table public.invoices enable row level security;
alter table public.payment_proofs enable row level security;
alter table public.billing_events enable row level security;
alter table public.billing_audit_log enable row level security;

create policy "billing admins read billing admins" on public.platform_admins for select to authenticated
  using ((select private.is_platform_admin()));
create policy "billing admins read plans" on public.billing_plans for select to authenticated
  using ((select private.is_platform_admin()));
create policy "billing admins read settings" on public.billing_settings for select to authenticated
  using ((select private.is_platform_admin()));
create policy "workspace admins and billing admins read subscriptions" on public.subscriptions for select to authenticated
  using ((select private.is_platform_admin()) or org_id = (select private.billing_org()));
create policy "workspace admins and billing admins read invoices" on public.invoices for select to authenticated
  using ((select private.is_platform_admin()) or org_id = (select private.billing_org()));
create policy "workspace admins and billing admins read payment proofs" on public.payment_proofs for select to authenticated
  using ((select private.is_platform_admin()) or org_id = (select private.billing_org()));
create policy "workspace admins and billing admins read billing history" on public.billing_events for select to authenticated
  using ((select private.is_platform_admin()) or org_id = (select private.billing_org()));
create policy "billing admins read the audit trail" on public.billing_audit_log for select to authenticated
  using ((select private.is_platform_admin()));

-- Billing admins need to see which workspace (and contact) an invoice belongs to.
create policy "billing admins read organizations" on public.organizations for select to authenticated
  using ((select private.is_platform_admin()));
create policy "billing admins read memberships" on public.memberships for select to authenticated
  using ((select private.is_platform_admin()));
create policy "billing admins read profiles" on public.profiles for select to authenticated
  using ((select private.is_platform_admin()));

-- -----------------------------------------------------------------------------
-- API: everyone signed in
-- -----------------------------------------------------------------------------

create or replace function public.am_i_billing_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_platform_admin()
$$;

-- Access state of the caller's workspace (any active member).
create or replace function public.get_workspace_access()
returns table (has_subscription boolean, subscription_status text, service_active boolean, suspension_reason text,
               suspended_at timestamptz, next_payment_due_date date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.org_id();
begin
  if v_org is null then return; end if;
  return query
    select s.id is not null, s.status, private.org_service_active(v_org), s.suspension_reason, s.suspended_at, s.next_payment_due_date
    from (select 1) one left join public.subscriptions s on s.org_id = v_org;
end $$;

-- -----------------------------------------------------------------------------
-- API: workspace admins (the paying client)
-- -----------------------------------------------------------------------------

create or replace function public.get_payment_details() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.billing_org() is null and not private.is_platform_admin() then
    raise exception 'Only workspace admins can view payment details.' using errcode = '42501';
  end if;
  return private.bank_details();
end $$;

create or replace function public.submit_payment_proof(
  p_invoice_id uuid, p_storage_path text, p_file_name text, p_amount numeric, p_transfer_date date,
  p_sender_name text, p_sender_bank text default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.billing_org();
  v_inv public.invoices;
  v_sub public.subscriptions;
  v_obj record;
  v_mime text;
  v_size bigint;
  v_today date := private.jakarta_today();
  v_name text := private.clean_text(p_file_name, 200);
  v_sender text := private.clean_text(p_sender_name, 120);
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'You must be signed in.' using errcode = '28000'; end if;
  if v_org is null then raise exception 'Only workspace admins can submit payments.' using errcode = '42501'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id and org_id = v_org for update;
  if not found then raise exception 'Invoice not found.' using errcode = 'PT404'; end if;
  if v_inv.status = 'pending_verification' then
    raise exception 'A payment proof for this invoice is already waiting for verification.' using errcode = '42501';
  elsif v_inv.status = 'paid' then
    raise exception 'This invoice has already been paid.' using errcode = '42501';
  elsif v_inv.status = 'cancelled' then
    raise exception 'This invoice was cancelled and no longer needs payment.' using errcode = '42501';
  end if;
  select * into v_sub from public.subscriptions where id = v_inv.subscription_id;
  if v_sub.status = 'cancelled' then raise exception 'This subscription is cancelled.' using errcode = '42501'; end if;

  if p_storage_path is null or split_part(p_storage_path, '/', 1) <> v_org::text or split_part(p_storage_path, '/', 2) <> v_inv.id::text then
    raise exception 'Invalid file location.' using errcode = '42501';
  end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'payment-proofs' and o.name = p_storage_path;
  if not found then raise exception 'Uploaded file not found. Please upload it again.' using errcode = 'PT404'; end if;
  v_mime := v_obj.metadata ->> 'mimetype';
  v_size := coalesce((v_obj.metadata ->> 'size')::bigint, 0);
  if v_mime not in ('image/jpeg', 'image/png', 'application/pdf') then
    raise exception 'Payment proof must be a JPG, PNG or PDF file.' using errcode = '22023';
  end if;
  if v_size <= 0 or v_size > 10485760 then raise exception 'Payment proof must be 10 MB or smaller.' using errcode = '22023'; end if;
  if char_length(v_name) = 0 then raise exception 'File name is required.' using errcode = '22023'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1000000000000 then raise exception 'Enter the amount you transferred.' using errcode = '22023'; end if;
  if p_transfer_date is null or p_transfer_date > v_today + 1 or p_transfer_date < v_inv.issue_date - 60 then
    raise exception 'Enter the date of the transfer (not in the future).' using errcode = '22023';
  end if;
  if char_length(v_sender) < 2 then raise exception 'Enter the name on the sending bank account.' using errcode = '22023'; end if;

  insert into public.payment_proofs (org_id, invoice_id, storage_path, file_name, mime_type, size_bytes, amount_claimed, transfer_date,
    sender_name, sender_bank, note, submitted_by)
  values (v_org, v_inv.id, p_storage_path, v_name, v_mime, v_size, p_amount, p_transfer_date,
    v_sender, nullif(private.clean_text(p_sender_bank, 120), ''), nullif(private.clean_text(p_note, 1000), ''), (select auth.uid()))
  returning id into v_id;
  update public.invoices set status = 'pending_verification', latest_proof_id = v_id where id = v_inv.id;

  perform private.log_billing_event(v_org, v_inv.subscription_id, v_inv.id, 'payment', 'proof_uploaded', null, null, null, null, null,
    jsonb_build_object('proof_id', v_id, 'file_name', v_name, 'mime_type', v_mime, 'size_bytes', v_size));
  perform private.log_billing_event(v_org, v_inv.subscription_id, v_inv.id, 'payment', 'payment_submitted', p_amount, v_inv.currency,
    v_inv.status, 'pending_verification', null,
    jsonb_build_object('proof_id', v_id, 'transfer_date', p_transfer_date, 'sender_name', v_sender));
  perform private.recompute_subscription(v_inv.subscription_id, v_today);
  perform private.notify_users(v_org, private.platform_admin_ids(), 'payment_submitted', 'Payment proof to verify: ' || v_inv.invoice_number,
    v_inv.client_name || ' · ' || private.fmt_money(p_amount, v_inv.currency) || ' (invoice ' || private.fmt_money(v_inv.amount, v_inv.currency) || ')');
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- API: Opervia billing admins
-- -----------------------------------------------------------------------------

create or replace function public.admin_confirm_payment(p_invoice_id uuid, p_amount_received numeric, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  v_inv public.invoices;
  s public.subscriptions;
  v_proof public.payment_proofs;
  v_today date := private.jakarta_today();
  v_note text := private.clean_text(p_note, 1000);
  v_start date;
  v_end date;
  v_anchor date;
  v_reactivate boolean := false;
  v_prev jsonb;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found.' using errcode = 'PT404'; end if;
  if v_inv.status in ('paid', 'cancelled') then
    raise exception 'Invoice % is already %.', v_inv.invoice_number, v_inv.status using errcode = '42501';
  end if;
  select * into s from public.subscriptions where id = v_inv.subscription_id for update;
  select * into v_proof from public.payment_proofs where invoice_id = v_inv.id and status = 'pending' order by submitted_at desc limit 1;
  if v_proof.id is null and char_length(v_note) < 5 then
    raise exception 'No payment proof is waiting for this invoice. Add a note (at least 5 characters) saying how you confirmed the funds arrived.'
      using errcode = '22023';
  end if;
  if p_amount_received is null or p_amount_received < v_inv.amount then
    raise exception 'The amount received must be at least the invoice amount (%). Partial payments are not supported: reject the proof and ask the client to transfer the full amount.',
      private.fmt_money(v_inv.amount, v_inv.currency) using errcode = '22023';
  end if;
  v_prev := jsonb_build_object('invoice_status', v_inv.status, 'subscription_status', s.status,
    'period_start', s.current_period_start, 'period_end', s.current_period_end);

  if v_proof.id is not null then
    update public.payment_proofs set status = 'accepted', reviewed_by = v_admin, reviewed_at = now(), review_reason = nullif(v_note, '')
    where id = v_proof.id;
  end if;
  update public.invoices
  set status = 'paid', amount_paid = p_amount_received, paid_at = now(), verified_by = v_admin, verified_at = now(), rejection_reason = null
  where id = v_inv.id;
  perform private.log_billing_event(s.org_id, s.id, v_inv.id, 'payment', 'payment_confirmed', p_amount_received, v_inv.currency,
    v_inv.status, 'paid', nullif(v_note, ''), jsonb_build_object('proof_id', v_proof.id, 'verified_at', now()));

  -- Billing period: a renewal invoice moves the subscription into its period.
  v_start := s.current_period_start; v_end := s.current_period_end; v_anchor := s.billing_anchor_date;
  if v_inv.period_start > s.current_period_end then
    v_start := v_inv.period_start; v_end := v_inv.period_end;
  end if;
  -- Lift a payment-overdue suspension when nothing else is past its grace period.
  -- Manual suspensions (other reasons) stay in place for admin review.
  if s.status = 'suspended' and s.suspension_reason = 'payment_overdue' and not exists (
       select 1 from public.invoices o where o.subscription_id = s.id and o.id <> v_inv.id
       and o.status in ('unpaid', 'pending_verification', 'rejected', 'overdue') and o.due_date + s.grace_period_days < v_today) then
    v_reactivate := true;
    -- Service was off: the paid month starts on the day access is restored.
    if v_start < v_today then
      v_anchor := v_today; v_start := v_today; v_end := private.period_end_for(v_today, v_today);
    end if;
  end if;
  if v_start is distinct from s.current_period_start or v_end is distinct from s.current_period_end then
    update public.subscriptions set billing_anchor_date = v_anchor, current_period_start = v_start, current_period_end = v_end where id = s.id;
    perform private.log_billing_event(s.org_id, s.id, v_inv.id, 'subscription', 'period_extended', null, null,
      s.current_period_start || ' – ' || s.current_period_end, v_start || ' – ' || v_end, null,
      jsonb_build_object('reanchored', v_anchor <> s.billing_anchor_date));
  end if;
  if v_reactivate then
    update public.subscriptions
    set status = 'pending_payment', suspended_at = null, suspension_reason = null, suspension_message = null, last_reactivated_at = now()
    where id = s.id;
    perform private.log_billing_event(s.org_id, s.id, v_inv.id, 'subscription', 'subscription_reactivated', null, null,
      'suspended', 'access restored', 'Payment verified', jsonb_build_object('previous_reason', s.suspension_reason));
    perform private.notify_users(s.org_id, private.org_admin_ids(s.org_id), 'subscription_reactivated', 'Workspace access restored',
      'Payment for ' || v_inv.invoice_number || ' was verified. Thank you!');
  end if;
  perform private.recompute_subscription(s.id, v_today);

  perform private.audit(s.org_id, 'payment_confirmed', 'invoice', v_inv.id, v_prev,
    jsonb_build_object('invoice_status', 'paid', 'amount_received', p_amount_received, 'proof_id', v_proof.id,
      'subscription_status', (select status from public.subscriptions where id = s.id), 'period_start', v_start, 'period_end', v_end),
    nullif(v_note, ''));
  perform private.notify_users(s.org_id, private.org_admin_ids(s.org_id), 'payment_confirmed', 'Payment confirmed: ' || v_inv.invoice_number,
    private.fmt_money(p_amount_received, v_inv.currency) || ' received. ' ||
    case when s.status = 'suspended' and not v_reactivate then 'Your workspace remains suspended pending review by Opervia.' else 'Thank you!' end);
end $$;

create or replace function public.admin_reject_payment(p_invoice_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  v_inv public.invoices;
  v_proof public.payment_proofs;
  v_reason text := private.clean_text(p_reason, 1000);
begin
  if char_length(v_reason) < 5 then raise exception 'Give the client a reason for the rejection (at least 5 characters).' using errcode = '22023'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found.' using errcode = 'PT404'; end if;
  if v_inv.status <> 'pending_verification' then
    raise exception 'Only payments waiting for verification can be rejected.' using errcode = '42501';
  end if;
  select * into v_proof from public.payment_proofs where invoice_id = v_inv.id and status = 'pending' order by submitted_at desc limit 1;
  if v_proof.id is not null then
    update public.payment_proofs set status = 'rejected', reviewed_by = v_admin, reviewed_at = now(), review_reason = v_reason where id = v_proof.id;
  end if;
  update public.invoices set status = 'rejected', rejection_reason = v_reason where id = v_inv.id;
  perform private.log_billing_event(v_inv.org_id, v_inv.subscription_id, v_inv.id, 'payment', 'payment_rejected', v_proof.amount_claimed,
    v_inv.currency, 'pending_verification', 'rejected', v_reason, jsonb_build_object('proof_id', v_proof.id));
  perform private.recompute_subscription(v_inv.subscription_id, private.jakarta_today());
  perform private.audit(v_inv.org_id, 'payment_rejected', 'invoice', v_inv.id,
    jsonb_build_object('invoice_status', 'pending_verification', 'proof_id', v_proof.id),
    jsonb_build_object('invoice_status', 'rejected'), v_reason);
  perform private.notify_users(v_inv.org_id, private.org_admin_ids(v_inv.org_id), 'payment_rejected', 'Payment not confirmed: ' || v_inv.invoice_number,
    left(v_reason, 300));
end $$;

create or replace function public.admin_suspend_subscription(p_subscription_id uuid, p_reason text, p_client_message text default null, p_internal_notes text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  s public.subscriptions;
begin
  if p_reason is null or p_reason not in ('payment_overdue', 'client_requested', 'administrative_review', 'contract_issue', 'other') then
    raise exception 'Choose a suspension reason.' using errcode = '22023';
  end if;
  if p_reason = 'other' and char_length(private.clean_text(p_client_message, 1000)) < 5 and char_length(private.clean_text(p_internal_notes, 2000)) < 5 then
    raise exception 'Describe the reason (at least 5 characters) when choosing "Other".' using errcode = '22023';
  end if;
  select * into s from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Subscription not found.' using errcode = 'PT404'; end if;
  if s.status in ('suspended', 'cancelled') then raise exception 'This subscription is already %.', s.status using errcode = '42501'; end if;
  perform private.suspend_subscription(s.id, p_reason, private.clean_text(p_client_message, 1000));
  perform private.audit(s.org_id, 'subscription_suspended', 'subscription', s.id, jsonb_build_object('status', s.status),
    jsonb_build_object('status', 'suspended', 'suspension_reason', p_reason), p_reason, private.clean_text(p_internal_notes, 2000));
end $$;

create or replace function public.admin_reactivate_subscription(p_subscription_id uuid, p_reason text, p_internal_notes text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  s public.subscriptions;
  v_today date := private.jakarta_today();
  v_reason text := private.clean_text(p_reason, 1000);
  v_new_end date;
  v_prev jsonb;
begin
  if char_length(v_reason) < 5 then raise exception 'Give a reason for reactivating (at least 5 characters).' using errcode = '22023'; end if;
  select * into s from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Subscription not found.' using errcode = 'PT404'; end if;
  if s.status not in ('suspended', 'cancelled') then raise exception 'Only suspended or cancelled subscriptions can be reactivated.' using errcode = '42501'; end if;
  v_prev := jsonb_build_object('status', s.status, 'suspension_reason', s.suspension_reason);
  if exists (select 1 from public.invoices i where i.subscription_id = s.id and i.status in ('unpaid', 'pending_verification', 'rejected', 'overdue')
             and i.due_date + s.grace_period_days < v_today) then
    raise exception 'An invoice is past its grace period. Confirm its payment (or cancel the invoice) first, otherwise the daily check would suspend the workspace again.'
      using errcode = '42501';
  end if;

  if s.status = 'cancelled' then
    -- Restart billing from today with a new first invoice.
    v_new_end := private.period_end_for(v_today, v_today);
    update public.subscriptions
    set status = 'pending_payment', cancelled_at = null, billing_anchor_date = v_today, current_period_start = v_today, current_period_end = v_new_end,
        last_reactivated_at = now()
    where id = s.id returning * into s;
    perform private.log_billing_event(s.org_id, s.id, null, 'subscription', 'subscription_reactivated', null, null, 'cancelled', 'pending_payment', v_reason,
      jsonb_build_object('new_period_start', v_today, 'new_period_end', v_new_end));
    perform private.issue_invoice(s, v_today);
  else
    update public.subscriptions
    set status = 'pending_payment', suspended_at = null, suspension_reason = null, suspension_message = null, last_reactivated_at = now()
    where id = s.id;
    perform private.log_billing_event(s.org_id, s.id, null, 'subscription', 'subscription_reactivated', null, null, 'suspended', 'access restored', v_reason,
      jsonb_build_object('previous_reason', s.suspension_reason));
  end if;
  perform private.recompute_subscription(s.id, v_today);
  perform private.audit(s.org_id, 'subscription_reactivated', 'subscription', s.id, v_prev,
    jsonb_build_object('status', (select status from public.subscriptions where id = s.id)), v_reason, private.clean_text(p_internal_notes, 2000));
  perform private.notify_users(s.org_id, private.org_admin_ids(s.org_id), 'subscription_reactivated', 'Workspace access restored', v_reason);
end $$;

create or replace function public.admin_cancel_subscription(p_subscription_id uuid, p_reason text, p_internal_notes text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  s public.subscriptions;
  v_reason text := private.clean_text(p_reason, 1000);
  i public.invoices;
begin
  if char_length(v_reason) < 5 then raise exception 'Give a reason for cancelling (at least 5 characters).' using errcode = '22023'; end if;
  select * into s from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Subscription not found.' using errcode = 'PT404'; end if;
  if s.status = 'cancelled' then raise exception 'This subscription is already cancelled.' using errcode = '42501'; end if;
  if exists (select 1 from public.invoices where subscription_id = s.id and status = 'pending_verification') then
    raise exception 'A payment proof is waiting for verification. Confirm or reject it before cancelling.' using errcode = '42501';
  end if;
  for i in select * from public.invoices where subscription_id = s.id and status in ('unpaid', 'rejected', 'overdue') for update loop
    update public.invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Subscription cancelled: ' || v_reason where id = i.id;
    perform private.log_billing_event(s.org_id, s.id, i.id, 'payment', 'invoice_cancelled', i.amount, i.currency, i.status, 'cancelled', 'Subscription cancelled');
  end loop;
  update public.subscriptions set status = 'cancelled', cancelled_at = now() where id = s.id;
  perform private.log_billing_event(s.org_id, s.id, null, 'subscription', 'subscription_cancelled', null, null, s.status, 'cancelled', v_reason);
  perform private.audit(s.org_id, 'subscription_cancelled', 'subscription', s.id, jsonb_build_object('status', s.status),
    jsonb_build_object('status', 'cancelled'), v_reason, private.clean_text(p_internal_notes, 2000));
  perform private.notify_users(s.org_id, private.org_admin_ids(s.org_id), 'subscription_cancelled', 'Subscription cancelled', v_reason);
end $$;

-- Plan / price / grace-period changes apply to invoices issued from now on.
create or replace function public.admin_update_subscription(
  p_subscription_id uuid, p_plan_id uuid, p_monthly_price numeric, p_grace_days integer, p_reason text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  s public.subscriptions;
  v_plan public.billing_plans;
  v_reason text := private.clean_text(p_reason, 1000);
  v_price numeric;
begin
  if char_length(v_reason) < 5 then raise exception 'Give a reason for the change (at least 5 characters).' using errcode = '22023'; end if;
  select * into s from public.subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'Subscription not found.' using errcode = 'PT404'; end if;
  if s.status = 'cancelled' then raise exception 'Reactivate the subscription before changing it.' using errcode = '42501'; end if;
  select * into v_plan from public.billing_plans where id = coalesce(p_plan_id, s.plan_id);
  if p_plan_id is not null and (v_plan.id is null or not v_plan.is_active) then raise exception 'Choose an active plan.' using errcode = '22023'; end if;
  v_price := coalesce(p_monthly_price, case when p_plan_id is distinct from s.plan_id then v_plan.monthly_price end, s.monthly_price);
  if v_price is null or v_price <= 0 or v_price >= 1000000000000 then raise exception 'Enter a valid monthly price.' using errcode = '22023'; end if;
  if p_grace_days is not null and (p_grace_days < 0 or p_grace_days > 60) then raise exception 'Grace period must be 0–60 days.' using errcode = '22023'; end if;

  if p_plan_id is not null and p_plan_id is distinct from s.plan_id then
    update public.subscriptions set plan_id = v_plan.id, plan_name = v_plan.name, currency = v_plan.currency where id = s.id;
    perform private.log_billing_event(s.org_id, s.id, null, 'subscription', 'plan_changed', null, null, s.plan_name, v_plan.name, v_reason);
  end if;
  if v_price <> s.monthly_price then
    update public.subscriptions set monthly_price = v_price where id = s.id;
    perform private.log_billing_event(s.org_id, s.id, null, 'subscription', 'price_changed', v_price, coalesce(v_plan.currency, s.currency),
      private.fmt_money(s.monthly_price, s.currency), private.fmt_money(v_price, coalesce(v_plan.currency, s.currency)), v_reason);
  end if;
  if p_grace_days is not null and p_grace_days <> s.grace_period_days then
    update public.subscriptions set grace_period_days = p_grace_days where id = s.id;
    perform private.log_billing_event(s.org_id, s.id, null, 'subscription', 'grace_period_changed', null, null,
      s.grace_period_days || ' days', p_grace_days || ' days', v_reason);
  end if;
  perform private.audit(s.org_id, 'subscription_updated', 'subscription', s.id,
    jsonb_build_object('plan', s.plan_name, 'monthly_price', s.monthly_price, 'grace_period_days', s.grace_period_days),
    (select jsonb_build_object('plan', x.plan_name, 'monthly_price', x.monthly_price, 'grace_period_days', x.grace_period_days)
       from public.subscriptions x where x.id = s.id), v_reason);
end $$;

create or replace function public.admin_cancel_invoice(p_invoice_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  v_inv public.invoices;
  v_reason text := private.clean_text(p_reason, 1000);
begin
  if char_length(v_reason) < 5 then raise exception 'Give a reason for cancelling the invoice (at least 5 characters).' using errcode = '22023'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found.' using errcode = 'PT404'; end if;
  if v_inv.status not in ('unpaid', 'rejected', 'overdue') then
    raise exception 'Only unpaid, rejected or overdue invoices can be cancelled.' using errcode = '42501';
  end if;
  update public.invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason where id = v_inv.id;
  perform private.log_billing_event(v_inv.org_id, v_inv.subscription_id, v_inv.id, 'payment', 'invoice_cancelled', v_inv.amount, v_inv.currency,
    v_inv.status, 'cancelled', v_reason);
  perform private.recompute_subscription(v_inv.subscription_id, private.jakarta_today());
  perform private.audit(v_inv.org_id, 'invoice_cancelled', 'invoice', v_inv.id, jsonb_build_object('status', v_inv.status),
    jsonb_build_object('status', 'cancelled'), v_reason);
end $$;

create or replace function public.admin_create_subscription(p_org_id uuid, p_plan_id uuid, p_start_date date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  v_id uuid;
  v_start date := coalesce(p_start_date, private.jakarta_today());
begin
  if not exists (select 1 from public.organizations where id = p_org_id) then raise exception 'Workspace not found.' using errcode = 'PT404'; end if;
  if exists (select 1 from public.subscriptions where org_id = p_org_id) then
    raise exception 'This workspace already has a subscription.' using errcode = '23505';
  end if;
  if v_start < private.jakarta_today() - 31 or v_start > private.jakarta_today() + 90 then
    raise exception 'Start date must be within the last month or the next 90 days.' using errcode = '22023';
  end if;
  v_id := private.create_subscription(p_org_id, p_plan_id, v_start);
  perform private.audit(p_org_id, 'subscription_created', 'subscription', v_id, null,
    (select jsonb_build_object('plan', plan_name, 'monthly_price', monthly_price, 'start_date', start_date) from public.subscriptions where id = v_id), null);
  return v_id;
end $$;

create or replace function public.admin_save_billing_settings(
  p_bank_name text, p_account_holder text, p_account_number text, p_payment_instructions text,
  p_default_grace_days integer, p_invoice_lead_days integer, p_first_invoice_due_days integer, p_reminder_days_before integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  v_old public.billing_settings;
  v_new public.billing_settings;
begin
  select * into v_old from public.billing_settings where id = 1 for update;
  update public.billing_settings
  set bank_name = private.clean_text(p_bank_name, 120), account_holder = private.clean_text(p_account_holder, 160),
      account_number = private.clean_text(p_account_number, 60), payment_instructions = private.clean_text(p_payment_instructions, 2000),
      default_grace_days = coalesce(p_default_grace_days, v_old.default_grace_days),
      invoice_lead_days = coalesce(p_invoice_lead_days, v_old.invoice_lead_days),
      first_invoice_due_days = coalesce(p_first_invoice_due_days, v_old.first_invoice_due_days),
      reminder_days_before = coalesce(p_reminder_days_before, v_old.reminder_days_before), updated_by = v_admin
  where id = 1 returning * into v_new;
  perform private.audit(null, 'billing_settings_updated', 'billing_settings', null,
    to_jsonb(v_old) - 'updated_at' - 'updated_by', to_jsonb(v_new) - 'updated_at' - 'updated_by', null);
end $$;

create or replace function public.admin_save_plan(
  p_id uuid, p_name text, p_description text, p_monthly_price numeric, p_currency text, p_is_active boolean, p_is_default boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  v_old public.billing_plans;
  v_new public.billing_plans;
  v_name text := private.clean_text(p_name, 120);
begin
  if char_length(v_name) < 2 then raise exception 'Plan name must be at least 2 characters.' using errcode = '22023'; end if;
  if p_monthly_price is null or p_monthly_price <= 0 or p_monthly_price >= 1000000000000 then raise exception 'Enter a valid monthly price.' using errcode = '22023'; end if;
  if coalesce(p_currency, '') !~ '^[A-Z]{3}$' then raise exception 'Currency must be a 3-letter code such as IDR.' using errcode = '22023'; end if;
  if coalesce(p_is_default, false) and not coalesce(p_is_active, true) then raise exception 'The default plan must be active.' using errcode = '22023'; end if;
  if exists (select 1 from public.billing_plans where lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'A plan with this name already exists.' using errcode = '23505';
  end if;
  if coalesce(p_is_default, false) then update public.billing_plans set is_default = false where is_default and id is distinct from p_id; end if;
  if p_id is null then
    insert into public.billing_plans (name, description, monthly_price, currency, is_active, is_default)
    values (v_name, nullif(private.clean_text(p_description, 1000), ''), p_monthly_price, p_currency, coalesce(p_is_active, true), coalesce(p_is_default, false))
    returning * into v_new;
  else
    select * into v_old from public.billing_plans where id = p_id for update;
    if not found then raise exception 'Plan not found.' using errcode = 'PT404'; end if;
    update public.billing_plans
    set name = v_name, description = nullif(private.clean_text(p_description, 1000), ''), monthly_price = p_monthly_price, currency = p_currency,
        is_active = coalesce(p_is_active, true), is_default = coalesce(p_is_default, false)
    where id = p_id returning * into v_new;
  end if;
  if not exists (select 1 from public.billing_plans where is_default) then
    raise exception 'Keep one active plan as the default for new workspaces.' using errcode = '22023';
  end if;
  perform private.audit(null, 'plan_saved', 'billing_plan', v_new.id,
    case when v_old.id is null then null else to_jsonb(v_old) - 'created_at' - 'updated_at' end, to_jsonb(v_new) - 'created_at' - 'updated_at', null);
  return v_new.id;
end $$;

create or replace function public.admin_run_billing_jobs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  v_res jsonb;
begin
  v_res := private.billing_run(private.jakarta_today(), 'admin');
  perform private.audit(null, 'billing_run', 'billing_run', null, null, v_res, 'Manual run from the admin console');
  return v_res;
end $$;

create or replace function public.admin_billing_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_platform_admin();
  v_today date := private.jakarta_today();
  v_month_start date := date_trunc('month', v_today)::date;
begin
  return jsonb_build_object(
    'total_clients', (select count(*) from public.organizations where not is_demo),
    'active_subscriptions', (select count(*) from public.subscriptions where status = 'active'),
    'pending_payment_subscriptions', (select count(*) from public.subscriptions where status = 'pending_payment'),
    'pending_verification', (select count(*) from public.invoices where status = 'pending_verification'),
    'unpaid_invoices', (select count(*) from public.invoices where status in ('unpaid', 'rejected', 'overdue')),
    'overdue_subscriptions', (select count(*) from public.subscriptions where status = 'overdue'),
    'suspended_subscriptions', (select count(*) from public.subscriptions where status = 'suspended'),
    'verified_revenue_this_month', (select coalesce(sum(amount_paid), 0) from public.invoices
       where status = 'paid' and (verified_at at time zone 'Asia/Jakarta')::date >= v_month_start),
    'revenue_currency', 'IDR',
    'month_start', v_month_start,
    'today', v_today,
    'last_run', (select jsonb_build_object('at', started_at, 'source', source, 'summary', summary) from private.billing_runs order by id desc limit 1)
  );
end $$;

-- Daily scheduler entry point (Vercel Cron). Authorised by a secret token whose
-- SHA-256 hash is stored in private.billing_secrets — no service-role key needed.
create or replace function public.run_billing_jobs(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 256
     or not exists (select 1 from private.billing_secrets where name = 'cron'
                    and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  return private.billing_run(private.jakarta_today(), 'cron');
end $$;

-- -----------------------------------------------------------------------------
-- Storage: private bucket for payment proofs
-- Path convention: {org_id}/{invoice_id}/{random}-{file name}
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "workspace admins upload payment proofs" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select private.billing_org())::text
    and exists (
      select 1 from public.invoices i
      where i.id::text = (storage.foldername(name))[2]
        and i.org_id = (select private.billing_org())
        and i.status in ('unpaid', 'rejected', 'overdue')
    )
  );

create policy "workspace admins and billing admins read payment proofs" on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and ((select private.is_platform_admin()) or (storage.foldername(name))[1] = (select private.billing_org())::text)
  );
-- No UPDATE or DELETE policies: uploaded proofs are kept permanently.

-- -----------------------------------------------------------------------------
-- Seed data
-- -----------------------------------------------------------------------------

insert into public.billing_settings (id) values (1) on conflict (id) do nothing;
insert into public.billing_plans (name, description, monthly_price, currency, is_active, is_default)
values ('Standard', 'Opervia Approval Portal — monthly subscription. Placeholder price: set your real price in Billing settings.', 500000, 'IDR', true, true)
on conflict do nothing;

-- Existing real (non-demo) workspaces start billing today.
do $$
declare o record;
begin
  for o in select id from public.organizations where not is_demo and id not in (select org_id from public.subscriptions) loop
    perform private.create_subscription(o.id, null, private.jakarta_today());
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Privileges. Supabase's default privileges grant everything on new objects
-- to anon/authenticated, so every new object is locked down explicitly.
-- -----------------------------------------------------------------------------

revoke all on table public.platform_admins, public.billing_plans, public.billing_settings, public.subscriptions, public.invoices,
  public.payment_proofs, public.billing_events, public.billing_audit_log from anon, authenticated;
grant select on table public.platform_admins, public.billing_plans, public.billing_settings, public.subscriptions, public.invoices,
  public.payment_proofs, public.billing_events, public.billing_audit_log to authenticated;
grant all on table public.platform_admins, public.billing_plans, public.billing_settings, public.subscriptions, public.invoices,
  public.payment_proofs, public.billing_events, public.billing_audit_log to service_role;
revoke all on sequence public.invoice_number_seq from anon, authenticated;
revoke all on table private.billing_runs, private.billing_secrets from public, anon, authenticated;

-- Private helpers: only the ones used inside RLS policies are callable by signed-in users.
revoke execute on all functions in schema private from public, anon;
grant execute on function private.is_platform_admin(), private.billing_org(), private.org_service_active(uuid) to authenticated;
revoke execute on function
  private.issue_invoice(public.subscriptions, date), private.recompute_subscription(uuid, date),
  private.suspend_subscription(uuid, text, text), private.create_subscription(uuid, uuid, date),
  private.billing_run(date, text), private.notify_users(uuid, uuid[], text, text, text, boolean),
  private.log_billing_event(uuid, uuid, uuid, text, text, numeric, text, text, text, text, jsonb, text),
  private.audit(uuid, text, text, uuid, jsonb, jsonb, text, text), private.on_organization_created()
  from authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.am_i_billing_admin(), public.get_workspace_access(), public.get_payment_details(),
  public.submit_payment_proof(uuid, text, text, numeric, date, text, text, text),
  public.admin_confirm_payment(uuid, numeric, text), public.admin_reject_payment(uuid, text),
  public.admin_suspend_subscription(uuid, text, text, text), public.admin_reactivate_subscription(uuid, text, text),
  public.admin_cancel_subscription(uuid, text, text), public.admin_update_subscription(uuid, uuid, numeric, integer, text),
  public.admin_cancel_invoice(uuid, text), public.admin_create_subscription(uuid, uuid, date),
  public.admin_save_billing_settings(text, text, text, text, integer, integer, integer, integer),
  public.admin_save_plan(uuid, text, text, numeric, text, boolean, boolean),
  public.admin_run_billing_jobs(), public.admin_billing_overview()
  to authenticated;
-- The scheduler calls this without a user session; it checks its own secret.
grant execute on function public.run_billing_jobs(text) to anon, authenticated;
-- Unchanged from the first migration.
grant execute on function public.get_invitation_preview(text) to anon;
