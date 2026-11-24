-- =============================================================================
-- Billing end-to-end test (database level).
--
-- Runs every scenario from the billing spec as real users (role
-- `authenticated` + JWT claims, so RLS and every function check apply) and
-- simulates calendar days by overriding private.jakarta_today() for this
-- transaction only. The block ALWAYS ends with an exception, so everything —
-- test users, workspaces, invoices, events and the function override — is
-- rolled back. It is safe to run against a live project.
--
-- Run: paste into the Supabase SQL editor (or psql) and read the error
-- message: it is the test report ("RESULT: n passed, m failed").
-- =============================================================================
do $test$
declare
  r text := '';
  pass int := 0;
  fail int := 0;
  v_admin uuid := gen_random_uuid();
  u1 uuid := gen_random_uuid();   -- workspace A admin (paying client)
  t1 uuid := gen_random_uuid();   -- workspace A content team
  c1 uuid := gen_random_uuid();   -- workspace A client approver
  u2 uuid := gen_random_uuid();   -- workspace B admin (another client)
  org1 uuid; org2 uuid; cl1 uuid; item1 uuid;
  sub1 public.subscriptions; sub2 public.subscriptions;
  inv1 public.invoices; inv2 public.invoices; inv_b public.invoices;
  n int; n2 int; v_text text; v_bool boolean; v_json jsonb; v_proof uuid;
  path1 text; path2 text;
  ev_before int; inv_before int; notif_before int;
  ok boolean;
begin
  -- Time travel for this transaction only.
  execute $f$create or replace function private.jakarta_today() returns date language sql stable set search_path = '' as
    $b$ select coalesce(nullif(current_setting('test.today', true), '')::date, (now() at time zone 'Asia/Jakarta')::date) $b$$f$;
  perform set_config('test.today', '2026-12-01', true);

  -- ---- Fixtures (as the database owner) ------------------------------------
  insert into auth.users (id, email, email_confirmed_at) values
    (v_admin, 'zz-billing-admin@billing-test.example', now()),
    (u1, 'zz-admin-a@billing-test.example', now()), (t1, 'zz-team-a@billing-test.example', now()),
    (c1, 'zz-client-a@billing-test.example', now()), (u2, 'zz-admin-b@billing-test.example', now());
  insert into public.profiles (id, email, full_name) values
    (v_admin, 'zz-billing-admin@billing-test.example', 'Test Billing Admin'), (u1, 'zz-admin-a@billing-test.example', 'Admin A'),
    (t1, 'zz-team-a@billing-test.example', 'Team A'), (c1, 'zz-client-a@billing-test.example', 'Client A'),
    (u2, 'zz-admin-b@billing-test.example', 'Admin B')
  on conflict (id) do nothing;
  insert into public.platform_admins (email) values ('zz-billing-admin@billing-test.example');
  update public.billing_settings set bank_name = 'Test Bank', account_holder = 'PT Test', account_number = '000-TEST', default_grace_days = 3,
    invoice_lead_days = 7, first_invoice_due_days = 7, reminder_days_before = 3 where id = 1;

  -- Workspace A created by its admin through the normal sign-up function.
  perform set_config('request.jwt.claim.sub', u1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated', 'email', 'zz-admin-a@billing-test.example')::text, true);
  set local role authenticated;
  org1 := public.create_organization('ZZ Billing Test Agency A');
  set constraints all immediate;   -- fire the deferred "create subscription" trigger now
  set constraints all deferred;
  reset role;

  perform set_config('request.jwt.claim.sub', u2::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated', 'email', 'zz-admin-b@billing-test.example')::text, true);
  set local role authenticated;
  org2 := public.create_organization('ZZ Billing Test Agency B');
  set constraints all immediate;
  set constraints all deferred;
  reset role;

  -- Workspace B only serves the isolation / rejection / manual-suspension checks:
  -- a long grace period keeps the simulated months from auto-suspending it.
  update public.subscriptions set grace_period_days = 60 where org_id = org2;
  insert into public.clients (org_id, name) values (org1, 'ZZ Client Co') returning id into cl1;
  insert into public.memberships (org_id, user_id, role) values (org1, t1, 'team');
  insert into public.memberships (org_id, user_id, role, client_id) values (org1, c1, 'client', cl1);

  -- ===== 1. New client receives an invoice =====================================
  select * into sub1 from public.subscriptions where org_id = org1;
  select * into inv1 from public.invoices where org_id = org1;
  select count(*) into n from public.invoices where org_id = org1;
  ok := sub1.id is not null and sub1.status = 'pending_payment' and n = 1 and inv1.status = 'unpaid'
        and inv1.amount = sub1.monthly_price and inv1.due_date = date '2026-12-08' and inv1.period_start = date '2026-12-01'
        and inv1.period_end = date '2026-12-31' and inv1.payment_instructions ->> 'bank_name' = 'Test Bank';
  r := r || case when ok then 'PASS' else 'FAIL' end || '  1 new client gets subscription + first invoice (' || coalesce(inv1.invoice_number, '-') || ', due ' || coalesce(inv1.due_date::text, '-') || ')' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;
  select count(*) into n from public.notifications where user_id = u1 and type = 'invoice_issued';
  ok := n = 1; r := r || case when ok then 'PASS' else 'FAIL' end || '  1b client admin notified of invoice' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== 2. Client uploads payment proof ======================================
  path1 := org1 || '/' || inv1.id || '/proof-1.png';
  perform set_config('request.jwt.claim.sub', u1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated', 'email', 'zz-admin-a@billing-test.example')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner, metadata) values ('payment-proofs', path1, u1, '{"mimetype":"image/png","size":20480}');
  -- uploading into another workspace's folder is refused by storage RLS
  begin
    insert into storage.objects (bucket_id, name, owner, metadata) values ('payment-proofs', org2 || '/' || gen_random_uuid() || '/x.png', u1, '{"mimetype":"image/png","size":1}');
    v_bool := false;
  exception when others then v_bool := true; end;
  v_proof := public.submit_payment_proof(inv1.id, path1, 'transfer.png', inv1.amount, date '2026-12-01', 'PT Agency A', 'BCA', 'Paid via m-banking');
  -- second submission while one is pending is refused
  begin
    perform public.submit_payment_proof(inv1.id, path1, 'again.png', inv1.amount, date '2026-12-01', 'PT Agency A');
    ok := false;
  exception when others then ok := true; end;
  reset role;
  select * into inv1 from public.invoices where id = inv1.id;
  select count(*) into n from public.billing_events where invoice_id = inv1.id and event_type in ('proof_uploaded', 'payment_submitted');
  ok := ok and v_bool and inv1.status = 'pending_verification' and inv1.latest_proof_id = v_proof and n = 2;
  r := r || case when ok then 'PASS' else 'FAIL' end || '  2 client uploads proof -> pending_verification (cross-workspace upload blocked, double submit blocked)' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;
  select count(*) into n from public.notifications where user_id = v_admin and type = 'payment_submitted';
  ok := n = 1; r := r || case when ok then 'PASS' else 'FAIL' end || '  2b billing admin notified of proof' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;
  -- Uploading a screenshot does NOT mark the invoice paid
  ok := inv1.status <> 'paid' and inv1.paid_at is null;
  r := r || case when ok then 'PASS' else 'FAIL' end || '  2c upload alone never marks invoice paid' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== 3. Admin views uploaded proof ========================================
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'zz-billing-admin@billing-test.example')::text, true);
  set local role authenticated;
  select count(*) into n from public.payment_proofs where id = v_proof;
  select count(*) into n2 from storage.objects where bucket_id = 'payment-proofs' and name = path1;
  reset role;
  ok := n = 1 and n2 = 1;
  r := r || case when ok then 'PASS' else 'FAIL' end || '  3 billing admin can read the proof row and the stored file' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== 4./5. Admin confirms payment -> subscription active ==================
  set local role authenticated;
  begin  -- underpayment is refused
    perform public.admin_confirm_payment(inv1.id, inv1.amount - 1, null);
    v_bool := false;
  exception when others then v_bool := true; end;
  perform public.admin_confirm_payment(inv1.id, inv1.amount, 'Funds seen in bank statement');
  reset role;
  select * into inv1 from public.invoices where id = inv1.id;
  select * into sub1 from public.subscriptions where id = sub1.id;
  select count(*) into n from public.billing_audit_log where entity_id = inv1.id and action_type = 'payment_confirmed' and admin_id = v_admin;
  ok := v_bool and inv1.status = 'paid' and inv1.verified_by = v_admin and inv1.verified_at is not null and inv1.amount_paid = inv1.amount and n = 1
        and (select status from public.payment_proofs where id = v_proof) = 'accepted';
  r := r || case when ok then 'PASS' else 'FAIL' end || '  4 admin confirms: invoice paid, admin id + timestamp + audit recorded (underpayment refused)' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;
  ok := sub1.status = 'active' and sub1.next_payment_due_date = date '2027-01-01' and sub1.current_period_end = date '2026-12-31';
  r := r || case when ok then 'PASS' else 'FAIL' end || '  5 subscription becomes active (next due ' || coalesce(sub1.next_payment_due_date::text, '-') || ')' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- Content created while active is visible.
  perform set_config('request.jwt.claim.sub', t1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  item1 := public.create_content_item(cl1, 'Billing test post', 'post', 'instagram', null, null, null, '', 'Caption');
  reset role;

  -- ===== 6. Renewal invoice + due date ========================================
  v_json := private.billing_run(date '2026-12-24', 'test');
  select count(*) into n from public.invoices where subscription_id = sub1.id;
  v_json := private.billing_run(date '2026-12-25', 'test');
  select count(*) into n2 from public.invoices where subscription_id = sub1.id;
  select * into inv2 from public.invoices where subscription_id = sub1.id and period_start = date '2027-01-01';
  ok := n = 1 and n2 = 2 and inv2.due_date = date '2027-01-01' and inv2.period_end = date '2027-01-31';
  r := r || case when ok then 'PASS' else 'FAIL' end || '  6 renewal invoice issued 7 days before the period (not earlier), due on period start' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== 15. Duplicate cron runs are idempotent ================================
  select count(*) into ev_before from public.billing_events where org_id = org1;
  select count(*) into inv_before from public.invoices where org_id = org1;
  select count(*) into notif_before from public.notifications where org_id = org1;
  perform private.billing_run(date '2026-12-25', 'test');
  perform private.billing_run(date '2026-12-25', 'test');
  perform private.billing_run(date '2026-12-29', 'test');   -- reminder day
  perform private.billing_run(date '2026-12-29', 'test');
  select count(*) into n from public.billing_events where org_id = org1 and event_type = 'payment_reminder';
  ok := (select count(*) from public.invoices where org_id = org1) = inv_before and n = 1
        and (select count(*) from public.billing_events where org_id = org1) = ev_before + 1;
  r := r || case when ok then 'PASS' else 'FAIL' end || '  15 repeated runs: no duplicate invoices/events (1 reminder only)' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;
  insert into private.billing_secrets (name, token_hash) values ('cron', encode(sha256(convert_to('test-token-0123456789-abcdefghijklmnop', 'UTF8')), 'hex'))
    on conflict (name) do update set token_hash = excluded.token_hash;
  set local role anon;
  begin perform public.run_billing_jobs('wrong-token-0123456789-abcdefghijklmnop'); v_bool := false; exception when others then v_bool := true; end;
  v_json := public.run_billing_jobs('test-token-0123456789-abcdefghijklmnop');
  reset role;
  ok := v_bool and v_json ? 'run_date';
  r := r || case when ok then 'PASS' else 'FAIL' end || '  15b cron entry point: wrong secret refused, right secret runs' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== 7./8. Grace period -> automatic suspension ===========================
  perform private.billing_run(date '2027-01-02', 'test');
  select * into sub1 from public.subscriptions where id = sub1.id;
  select * into inv2 from public.invoices where id = inv2.id;
  ok := sub1.status = 'overdue' and inv2.status = 'overdue';
  r := r || case when ok then 'PASS' else 'FAIL' end || '  7 day after due date: invoice + subscription overdue' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;
  perform private.billing_run(date '2027-01-04', 'test');
  select status into v_text from public.subscriptions where id = sub1.id;
  perform private.billing_run(date '2027-01-05', 'test');
  perform private.billing_run(date '2027-01-05', 'test');
  select * into sub1 from public.subscriptions where id = sub1.id;
  select count(*) into n from public.billing_events where subscription_id = sub1.id and event_type = 'subscription_suspended';
  ok := v_text = 'overdue' and sub1.status = 'suspended' and sub1.suspension_reason = 'payment_overdue' and sub1.suspended_at is not null and n = 1
        and exists (select 1 from public.notifications where user_id = u1 and type = 'subscription_suspended');
  r := r || case when ok then 'PASS' else 'FAIL' end || '  8 still active within grace (day 3), auto-suspended after it (once), client notified' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== 9. Suspended workspace cannot use paid services ======================
  perform set_config('request.jwt.claim.sub', t1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.create_content_item(cl1, 'Blocked post', 'post', 'instagram', null, null, null, '', 'x'); v_text := 'not blocked';
  exception when others then v_text := sqlstate; end;
  select count(*) into n from public.content_items where org_id = org1;
  reset role;
  perform set_config('request.jwt.claim.sub', c1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.approve_content_item(item1, 1, null); v_bool := false; exception when others then v_bool := sqlstate = 'PT402'; end;
  reset role;
  ok := v_text = 'PT402' and n = 0 and v_bool;
  r := r || case when ok then 'PASS' else 'FAIL' end || '  9 suspended: workflow functions refuse (PT402) and content is unreadable via RLS' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;
  ok := (select count(*) from public.content_items where id = item1) = 1;
  r := r || case when ok then 'PASS' else 'FAIL' end || '  9b suspended: client data preserved' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== 10./11. Late payment confirmed -> reactivated ========================
  perform set_config('test.today', '2027-01-10', true);
  path2 := org1 || '/' || inv2.id || '/proof-2.pdf';
  perform set_config('request.jwt.claim.sub', u1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated', 'email', 'zz-admin-a@billing-test.example')::text, true);
  set local role authenticated;
  select count(*) into n from public.invoices where org_id = org1;   -- billing still visible while suspended
  insert into storage.objects (bucket_id, name, owner, metadata) values ('payment-proofs', path2, u1, '{"mimetype":"application/pdf","size":50000}');
  perform public.submit_payment_proof(inv2.id, path2, 'late.pdf', inv2.amount, date '2027-01-10', 'PT Agency A');
  reset role;
  -- the daily run while waiting for verification does not change anything else
  perform private.billing_run(date '2027-01-10', 'test');
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'zz-billing-admin@billing-test.example')::text, true);
  set local role authenticated;
  perform public.admin_confirm_payment(inv2.id, inv2.amount, null);
  reset role;
  select * into sub1 from public.subscriptions where id = sub1.id;
  ok := n = 2 and (select status from public.invoices where id = inv2.id) = 'paid';
  r := r || case when ok then 'PASS' else 'FAIL' end || '  10 suspended admin can still pay; admin confirms the late payment' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;
  ok := sub1.status = 'active' and sub1.suspension_reason is null and sub1.current_period_start = date '2027-01-10'
        and sub1.current_period_end = date '2027-02-09' and sub1.next_payment_due_date = date '2027-02-10';
  r := r || case when ok then 'PASS' else 'FAIL' end || '  11 reactivated; paid month restarts on restore day (' || sub1.current_period_start || ' – ' || sub1.current_period_end || ')' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;
  perform set_config('request.jwt.claim.sub', t1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.content_items where org_id = org1;
  perform public.create_content_item(cl1, 'Back in business', 'post', 'instagram', null, null, null, '', 'x');
  reset role;
  ok := n = 1;
  r := r || case when ok then 'PASS' else 'FAIL' end || '  11b service access restored (content readable, new work allowed)' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;
  -- next renewal is generated from the new anchor
  perform private.billing_run(date '2027-02-03', 'test');
  ok := exists (select 1 from public.invoices where subscription_id = sub1.id and period_start = date '2027-02-10' and due_date = date '2027-02-10');
  r := r || case when ok then 'PASS' else 'FAIL' end || '  11c next renewal follows the new billing period' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== 12. Every step is in the history timeline ============================
  select string_agg(distinct event_type, ',' order by event_type) into v_text from public.billing_events where org_id = org1;
  ok := v_text like '%invoice_generated%' and v_text like '%proof_uploaded%' and v_text like '%payment_submitted%'
        and v_text like '%payment_confirmed%' and v_text like '%subscription_created%' and v_text like '%subscription_activated%'
        and v_text like '%subscription_overdue%' and v_text like '%subscription_suspended%' and v_text like '%subscription_reactivated%'
        and v_text like '%period_extended%' and v_text like '%invoice_overdue%' and v_text like '%payment_reminder%';
  r := r || case when ok then 'PASS' else 'FAIL' end || '  12 history has every event: ' || v_text || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== 13. Clients can't see other clients' billing ========================
  select * into inv_b from public.invoices where org_id = org2 order by period_start limit 1;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated', 'email', 'zz-admin-b@billing-test.example')::text, true);
  set local role authenticated;
  select count(*) into n from public.invoices where org_id = org1;
  select count(*) into n2 from public.billing_events where org_id = org1;
  n := n + n2 + (select count(*) from public.payment_proofs where org_id = org1) + (select count(*) from storage.objects where name = path1)
         + (select count(*) from public.subscriptions where org_id = org1);
  begin perform public.submit_payment_proof(inv2.id, path2, 'x.pdf', 1, date '2027-01-10', 'Intruder'); v_bool := false;
  exception when others then v_bool := true; end;
  reset role;
  perform set_config('request.jwt.claim.sub', t1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', t1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := n + (select count(*) from public.invoices) + (select count(*) from public.billing_audit_log);
  reset role;
  perform set_config('request.jwt.claim.sub', c1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', c1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := n + (select count(*) from public.invoices) + (select count(*) from public.billing_settings);
  reset role;
  ok := n = 0 and v_bool;
  r := r || case when ok then 'PASS' else 'FAIL' end || '  13 other client / team member / approver see none of workspace A''s billing' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== 14. Clients can't manipulate payment status or history =============
  perform set_config('request.jwt.claim.sub', u1::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated', 'email', 'zz-admin-a@billing-test.example')::text, true);
  set local role authenticated;
  n := 0;
  begin update public.invoices set status = 'paid' where org_id = org1; exception when others then n := n + 1; end;
  begin insert into public.billing_events (org_id, category, event_type, actor_kind) values (org1, 'payment', 'payment_confirmed', 'client'); exception when others then n := n + 1; end;
  begin update public.subscriptions set status = 'active' where org_id = org1; exception when others then n := n + 1; end;
  begin perform public.admin_confirm_payment(inv2.id, 1, 'self-approve'); exception when others then n := n + 1; end;
  begin perform public.admin_reactivate_subscription(sub1.id, 'let me in please'); exception when others then n := n + 1; end;
  begin perform public.admin_save_billing_settings('Evil Bank', 'Evil', '666', '', 3, 7, 7, 3); exception when others then n := n + 1; end;
  begin delete from public.invoices where org_id = org1; exception when others then n := n + 1; end;
  reset role;
  ok := n = 7;
  r := r || case when ok then 'PASS' else 'FAIL' end || '  14 client blocked from: status edits, fake history, self-approval, reactivation, bank settings, deletes (' || n || '/7)' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;
  n := 0;
  begin update public.billing_events set reason = 'edited' where org_id = org1; exception when others then n := n + 1; end;
  begin delete from public.billing_events where org_id = org1; exception when others then n := n + 1; end;
  begin delete from public.billing_audit_log; exception when others then n := n + 1; end;
  begin update public.invoices set amount = 1 where id = inv1.id; exception when others then n := n + 1; end;
  begin update public.invoices set status = 'unpaid' where id = inv1.id; exception when others then n := n + 1; end;
  begin update public.payment_proofs set amount_claimed = 1 where id = v_proof; exception when others then n := n + 1; end;
  ok := n = 6;
  r := r || case when ok then 'PASS' else 'FAIL' end || '  14b even the DB owner cannot edit/delete history, paid invoices or reviewed proofs (' || n || '/6)' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== Extra: rejection flow ===============================================
  select * into sub2 from public.subscriptions where org_id = org2;
  perform set_config('test.today', '2027-02-05', true);
  perform set_config('request.jwt.claim.sub', u2::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated', 'email', 'zz-admin-b@billing-test.example')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner, metadata) values ('payment-proofs', org2 || '/' || inv_b.id || '/b.jpg', u2, '{"mimetype":"image/jpeg","size":999}');
  perform public.submit_payment_proof(inv_b.id, org2 || '/' || inv_b.id || '/b.jpg', 'b.jpg', 100000, date '2027-02-05', 'PT B');
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'zz-billing-admin@billing-test.example')::text, true);
  set local role authenticated;
  begin perform public.admin_reject_payment(inv_b.id, ''); v_bool := false; exception when others then v_bool := true; end;
  perform public.admin_reject_payment(inv_b.id, 'Amount does not match the invoice');
  reset role;
  select * into inv_b from public.invoices where id = inv_b.id;
  ok := v_bool and inv_b.status = 'rejected' and inv_b.rejection_reason = 'Amount does not match the invoice'
        and (select count(*) from public.payment_proofs where invoice_id = inv_b.id and status = 'rejected') = 1
        and (select count(*) from storage.objects where name = org2 || '/' || inv_b.id || '/b.jpg') = 1
        and exists (select 1 from public.notifications where user_id = u2 and type = 'payment_rejected');
  r := r || case when ok then 'PASS' else 'FAIL' end || '  X1 reject needs a reason; invoice rejected, proof + file preserved, client notified' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== Extra: manual suspension is NOT lifted by a payment ==================
  set local role authenticated;   -- still the billing admin
  perform public.admin_suspend_subscription(sub2.id, 'contract_issue', 'Please contact Opervia about your contract.', 'internal: waiting for signed addendum');
  reset role;
  perform set_config('request.jwt.claim.sub', u2::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated', 'email', 'zz-admin-b@billing-test.example')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner, metadata) values ('payment-proofs', org2 || '/' || inv_b.id || '/b2.jpg', u2, '{"mimetype":"image/jpeg","size":999}');
  perform public.submit_payment_proof(inv_b.id, org2 || '/' || inv_b.id || '/b2.jpg', 'b2.jpg', inv_b.amount, date '2027-02-05', 'PT B');
  select count(*) into n from public.billing_audit_log;   -- clients can't read the audit trail (internal notes)
  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'zz-billing-admin@billing-test.example')::text, true);
  set local role authenticated;
  perform public.admin_confirm_payment(inv_b.id, inv_b.amount, null);
  select status into v_text from public.subscriptions where id = sub2.id;
  perform public.admin_reactivate_subscription(sub2.id, 'Addendum signed', null);
  reset role;
  select * into sub2 from public.subscriptions where id = sub2.id;
  ok := v_text = 'suspended' and sub2.status <> 'suspended' and sub2.suspension_reason is null and n = 0
        and exists (select 1 from public.billing_audit_log where org_id = org2 and action_type = 'subscription_suspended' and internal_notes like 'internal:%');
  r := r || case when ok then 'PASS' else 'FAIL' end || '  X2 manual suspension survives payment; admin reactivation required; internal notes hidden from client' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== Extra: demo workspaces are never billed =============================
  ok := not exists (select 1 from public.invoices i join public.organizations o on o.id = i.org_id where o.is_demo)
        and private.org_service_active((select id from public.organizations where is_demo limit 1));
  r := r || case when ok then 'PASS' else 'FAIL' end || '  X3 demo workspaces are exempt' || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  -- ===== Extra: overview metrics ==============================================
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'email', 'zz-billing-admin@billing-test.example')::text, true);
  set local role authenticated;
  v_json := public.admin_billing_overview();
  reset role;
  ok := (v_json ->> 'total_clients')::int >= 2
        and (v_json ->> 'active_subscriptions')::int + (v_json ->> 'pending_payment_subscriptions')::int
          + (v_json ->> 'overdue_subscriptions')::int + (v_json ->> 'suspended_subscriptions')::int >= 2;
  r := r || case when ok then 'PASS' else 'FAIL' end || '  X4 admin overview metrics: ' || (v_json - 'last_run')::text || E'\n';
  if ok then pass := pass + 1; else fail := fail + 1; end if;

  raise exception E'\nRESULT: % passed, % failed (all changes rolled back)\n%', pass, fail, r;
end
$test$;
