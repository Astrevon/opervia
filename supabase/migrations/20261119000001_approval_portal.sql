-- =============================================================================
-- Opervia Approval Portal — initial schema
-- Source process: NSD-MOPS-SOP-002 Client Content Approval & Publishing (v0.3)
--
-- Security model
--   * Every table has Row Level Security enabled.
--   * The `authenticated` role may only SELECT, through RLS policies.
--   * Every write goes through a SECURITY DEFINER function in `public` that
--     checks the caller's organisation, role and the workflow state.
--   * The approval history (approval_events) is append-only, and submitted
--     versions and their attachments are immutable.
-- =============================================================================

create schema if not exists private;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  is_demo boolean not null default false,
  require_four_eyes boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.organizations.is_demo is 'True only for the fictional Northstar Digital demonstration workspace.';
comment on column public.organizations.require_four_eyes is 'SOP-002 §5.2/§8.6: the person who schedules must not be the author of the approved version.';

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  timezone text not null default 'UTC',
  notes text check (notes is null or char_length(notes) <= 2000),
  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id)
);
create unique index clients_org_name_key on public.clients (org_id, lower(name));

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  role text not null check (role in ('admin', 'team', 'client')),
  client_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- client users must be linked to exactly one client of the same organisation
  constraint memberships_client_role check ((role = 'client') = (client_id is not null)),
  constraint memberships_client_fk foreign key (client_id, org_id) references public.clients (id, org_id)
);
create index memberships_org_idx on public.memberships (org_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (char_length(email) <= 254),
  full_name text check (full_name is null or char_length(full_name) <= 120),
  role text not null check (role in ('admin', 'team', 'client')),
  client_id uuid,
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  constraint invitations_client_role check ((role = 'client') = (client_id is not null)),
  constraint invitations_client_fk foreign key (client_id, org_id) references public.clients (id, org_id)
);
create unique index invitations_pending_email_key on public.invitations (org_id, lower(email))
  where accepted_at is null and revoked_at is null;

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  title text not null check (char_length(trim(title)) between 3 and 160),
  content_type text not null check (content_type in ('post', 'carousel', 'short_video', 'story', 'other')),
  platform text not null check (platform in ('instagram', 'facebook', 'linkedin', 'tiktok', 'other')),
  assignee_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'revision_required', 'approved', 'scheduled', 'rejected')),
  current_version integer not null default 1,
  approved_version integer,
  revision_round integer not null default 0,
  due_date date,
  planned_publish_at timestamptz,
  first_submitted_at timestamptz,
  last_submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  scheduled_for timestamptz,
  scheduled_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_items_client_fk foreign key (client_id, org_id) references public.clients (id, org_id),
  unique (id, org_id)
);
create index content_items_org_status_idx on public.content_items (org_id, status);
create index content_items_client_idx on public.content_items (client_id, status);

create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  item_id uuid not null,
  version_number integer not null check (version_number >= 1),
  description text not null default '' check (char_length(description) <= 5000),
  body text not null default '' check (char_length(body) <= 10000),
  change_summary text check (change_summary is null or char_length(change_summary) <= 2000),
  snapshot jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  submitted_by uuid,
  constraint content_versions_item_fk foreign key (item_id, org_id) references public.content_items (id, org_id) on delete cascade,
  unique (item_id, version_number),
  unique (id, org_id)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  item_id uuid not null,
  version_id uuid not null,
  storage_path text not null,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  constraint attachments_version_fk foreign key (version_id, org_id) references public.content_versions (id, org_id) on delete cascade,
  unique (version_id, storage_path)
);
create index attachments_path_idx on public.attachments (storage_path);
create index attachments_item_idx on public.attachments (item_id);

create table public.approval_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  item_id uuid not null,
  version_number integer,
  actor_id uuid,
  actor_name text not null default '',
  actor_role text not null,
  action text not null check (action in (
    'created', 'submitted', 'resubmitted', 'approved', 'revision_requested', 'rejected',
    'scheduled', 'unscheduled', 'reopened'
  )),
  from_status text,
  to_status text,
  comment text,
  visibility text not null default 'client' check (visibility in ('client', 'internal')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint approval_events_item_fk foreign key (item_id, org_id) references public.content_items (id, org_id) on delete cascade
);
create index approval_events_item_idx on public.approval_events (item_id, created_at);
create index approval_events_org_idx on public.approval_events (org_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid references public.content_items (id) on delete cascade,
  type text not null check (type in ('submitted', 'resubmitted', 'approved', 'revision_requested', 'rejected', 'scheduled', 'reopened')),
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------

create or replace function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger organizations_touch before update on public.organizations for each row execute function private.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger clients_touch before update on public.clients for each row execute function private.touch_updated_at();
create trigger memberships_touch before update on public.memberships for each row execute function private.touch_updated_at();
create trigger content_items_touch before update on public.content_items for each row execute function private.touch_updated_at();
create trigger content_versions_touch before update on public.content_versions for each row execute function private.touch_updated_at();

-- Approval history is append-only. The only exceptions are deleting a draft that
-- was never sent to a client (delete_draft) and purging the fictional demo
-- workspace (purge_demo_workspace, service role only). Both set a
-- transaction-local flag inside a SECURITY DEFINER function.
create or replace function private.protect_approval_events() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'Approval history is append-only and cannot be changed.' using errcode = '42501';
end $$;
create trigger approval_events_append_only before update or delete on public.approval_events
  for each row execute function private.protect_approval_events();

-- Submitted versions are frozen: "Approved means this exact version" (SOP §6).
create or replace function private.protect_submitted_versions() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_purge', true) = 'on' then return old; end if;
  if old.submitted_at is not null then
    raise exception 'Version % has been submitted and can no longer be changed.', old.version_number using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger content_versions_frozen before update or delete on public.content_versions
  for each row execute function private.protect_submitted_versions();

create or replace function private.protect_submitted_attachments() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.allow_purge', true) = 'on' then return old; end if;
  if exists (select 1 from public.content_versions v where v.id = old.version_id and v.submitted_at is not null) then
    raise exception 'Attachments of a submitted version cannot be changed.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger attachments_frozen before update or delete on public.attachments
  for each row execute function private.protect_submitted_attachments();

-- Profile row for every auth user.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)), 120)
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- Session helpers (used by RLS policies). SECURITY DEFINER avoids RLS recursion.
-- -----------------------------------------------------------------------------

create or replace function private.org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.org_id from public.memberships m where m.user_id = (select auth.uid()) and m.is_active limit 1
$$;

create or replace function private.user_role() returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.memberships m where m.user_id = (select auth.uid()) and m.is_active limit 1
$$;

create or replace function private.client_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.client_id from public.memberships m where m.user_id = (select auth.uid()) and m.is_active limit 1
$$;

create or replace function private.is_agency() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select m.role in ('admin', 'team') from public.memberships m
                   where m.user_id = (select auth.uid()) and m.is_active limit 1), false)
$$;

-- Can the current user see this content item? Single source of truth for
-- items, versions, attachments, events and storage objects.
create or replace function private.can_view_item(p_item_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.content_items i
    join public.memberships m on m.user_id = (select auth.uid()) and m.is_active and m.org_id = i.org_id
    where i.id = p_item_id
      and (m.role in ('admin', 'team') or (m.role = 'client' and i.client_id = m.client_id and i.status <> 'draft'))
  )
$$;

-- Raises unless the caller is an active member with one of the given roles.
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
  return m;
end $$;

create or replace function private.actor_name(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(p.full_name, ''), p.email, 'Unknown user') from public.profiles p where p.id = p_user
$$;

create or replace function private.log_event(
  p_item public.content_items, p_version integer, p_action text, p_from text, p_to text,
  p_comment text, p_visibility text, p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.approval_events
    (org_id, item_id, version_number, actor_id, actor_name, actor_role, action, from_status, to_status, comment, visibility, metadata)
  values
    (p_item.org_id, p_item.id, p_version, (select auth.uid()), coalesce(private.actor_name((select auth.uid())), ''),
     coalesce(private.user_role(), 'system'), p_action, p_from, p_to, nullif(trim(coalesce(p_comment, '')), ''), p_visibility,
     coalesce(p_metadata, '{}'::jsonb));
end $$;

-- In-app notifications. Never notifies the actor; only active members of the org.
create or replace function private.notify(
  p_item public.content_items, p_recipients uuid[], p_type text, p_title text, p_body text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (org_id, user_id, item_id, type, title, body)
  select distinct p_item.org_id, r, p_item.id, p_type, p_title, coalesce(p_body, '')
  from unnest(p_recipients) as r
  where r is not null
    and r <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
    and exists (select 1 from public.memberships m where m.user_id = r and m.org_id = p_item.org_id and m.is_active);
end $$;

create or replace function private.client_approvers(p_client uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(m.user_id), '{}') from public.memberships m
  where m.client_id = p_client and m.role = 'client' and m.is_active
$$;

create or replace function private.agency_watchers(p_item public.content_items) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct u), '{}') from (
    select p_item.created_by as u
    union all select p_item.assignee_id
    union all select m.user_id from public.memberships m where m.org_id = p_item.org_id and m.role = 'admin' and m.is_active
  ) s where u is not null
$$;

create or replace function private.clean_text(p text, p_max integer) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := trim(coalesce(p, ''));
begin
  if char_length(v) > p_max then
    raise exception 'Text is too long (maximum % characters).', p_max using errcode = '22001';
  end if;
  return v;
end $$;

create or replace function private.valid_email(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p ~* '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' and char_length(p) <= 254
$$;

-- Copies version n into a new working version n+1 (used for revision rounds).
create or replace function private.start_new_version(p_item public.content_items) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.content_versions;
  v_new_id uuid;
  v_next integer := p_item.current_version + 1;
begin
  select * into v_old from public.content_versions where item_id = p_item.id and version_number = p_item.current_version;
  insert into public.content_versions (org_id, item_id, version_number, description, body, created_by)
  values (p_item.org_id, p_item.id, v_next, v_old.description, v_old.body, (select auth.uid()))
  returning id into v_new_id;
  insert into public.attachments (org_id, item_id, version_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select a.org_id, a.item_id, v_new_id, a.storage_path, a.file_name, a.mime_type, a.size_bytes, a.uploaded_by
  from public.attachments a where a.version_id = v_old.id;
  return v_next;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security (read access). Writes happen only through functions below.
-- -----------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.content_items enable row level security;
alter table public.content_versions enable row level security;
alter table public.attachments enable row level security;
alter table public.approval_events enable row level security;
alter table public.notifications enable row level security;

create policy "members read own organization" on public.organizations for select to authenticated
  using (id = (select private.org_id()));

create policy "read profiles of visible members" on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships m
      where m.user_id = profiles.id and m.org_id = (select private.org_id())
        and ((select private.is_agency()) or m.role in ('admin', 'team') or m.client_id = (select private.client_id()))
    )
  );

create policy "agency reads all clients, client users read their own" on public.clients for select to authenticated
  using (org_id = (select private.org_id()) and ((select private.is_agency()) or id = (select private.client_id())));

create policy "agency reads memberships, users read their own" on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or (org_id = (select private.org_id()) and (select private.is_agency())));

create policy "admins read invitations" on public.invitations for select to authenticated
  using (org_id = (select private.org_id()) and (select private.user_role()) = 'admin');

create policy "read visible content items" on public.content_items for select to authenticated
  using (
    org_id = (select private.org_id())
    and ((select private.is_agency()) or (client_id = (select private.client_id()) and status <> 'draft'))
  );

create policy "read visible versions" on public.content_versions for select to authenticated
  using (
    org_id = (select private.org_id())
    and ((select private.is_agency()) or (submitted_at is not null and private.can_view_item(item_id)))
  );

create policy "read visible attachments" on public.attachments for select to authenticated
  using (
    org_id = (select private.org_id())
    and (
      (select private.is_agency())
      or exists (
        select 1 from public.content_versions v
        where v.id = attachments.version_id and v.submitted_at is not null and private.can_view_item(v.item_id)
      )
    )
  );

create policy "read visible approval events" on public.approval_events for select to authenticated
  using (
    org_id = (select private.org_id())
    and ((select private.is_agency()) or (visibility = 'client' and private.can_view_item(item_id)))
  );

create policy "users read their own notifications" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- Table privileges: no direct writes for API roles; anonymous users get nothing.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
-- Explicit, in case the project's default privileges were changed.
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;

-- -----------------------------------------------------------------------------
-- Workspace onboarding
-- -----------------------------------------------------------------------------

create or replace function public.create_organization(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_name text := private.clean_text(p_name, 120);
begin
  if v_uid is null then raise exception 'You must be signed in.' using errcode = '28000'; end if;
  if exists (select 1 from public.memberships where user_id = v_uid) then
    raise exception 'Your account already belongs to a workspace.' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 then raise exception 'Workspace name must be at least 2 characters.' using errcode = '22023'; end if;
  insert into public.organizations (name, created_by) values (v_name, v_uid) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, v_uid, 'admin');
  return v_org;
end $$;

create or replace function public.accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(coalesce((select auth.jwt()) ->> 'email', ''));
  v_inv public.invitations;
begin
  if v_uid is null then raise exception 'You must be signed in.' using errcode = '28000'; end if;
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    raise exception 'This invitation link is not valid.' using errcode = '22023';
  end if;
  select * into v_inv from public.invitations
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found or v_inv.revoked_at is not null then
    raise exception 'This invitation link is not valid.' using errcode = '22023';
  end if;
  if v_inv.accepted_at is not null then raise exception 'This invitation has already been used.' using errcode = '22023'; end if;
  if v_inv.expires_at < now() then raise exception 'This invitation has expired. Ask your admin for a new link.' using errcode = '22023'; end if;
  if lower(v_inv.email) <> v_email then
    raise exception 'This invitation was sent to a different email address. Sign in with %.', v_inv.email using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships where user_id = v_uid) then
    raise exception 'Your account already belongs to a workspace.' using errcode = '42501';
  end if;
  insert into public.memberships (org_id, user_id, role, client_id) values (v_inv.org_id, v_uid, v_inv.role, v_inv.client_id);
  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  if v_inv.full_name is not null then
    update public.profiles set full_name = v_inv.full_name where id = v_uid and (full_name = '' or full_name = split_part(email, '@', 1));
  end if;
  return v_inv.org_id;
end $$;

-- Public, read-only preview of an invitation (for the sign-up screen).
create or replace function public.get_invitation_preview(p_token text)
returns table (organization_name text, email text, role text, client_name text, is_valid boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then return; end if;
  return query
    select o.name, i.email, i.role, c.name,
           (i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
    from public.invitations i
    join public.organizations o on o.id = i.org_id
    left join public.clients c on c.id = i.client_id
    where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
end $$;

-- -----------------------------------------------------------------------------
-- Team & client management (admin)
-- -----------------------------------------------------------------------------

create or replace function public.create_invitation(p_email text, p_role text, p_client_id uuid default null, p_full_name text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin']);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not private.valid_email(v_email) then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if p_role not in ('admin', 'team', 'client') then raise exception 'Choose a valid role.' using errcode = '22023'; end if;
  if p_role = 'client' then
    if p_client_id is null or not exists (select 1 from public.clients where id = p_client_id and org_id = m.org_id and is_active) then
      raise exception 'Choose an active client account for this client approver.' using errcode = '22023';
    end if;
  elsif p_client_id is not null then
    raise exception 'Only client approvers are linked to a client account.' using errcode = '22023';
  end if;
  if exists (select 1 from public.memberships mm join public.profiles p on p.id = mm.user_id where lower(p.email) = v_email) then
    raise exception 'An account with this email already belongs to a workspace.' using errcode = '23505';
  end if;
  update public.invitations set revoked_at = now()
  where org_id = m.org_id and lower(email) = v_email and accepted_at is null and revoked_at is null;
  insert into public.invitations (org_id, email, full_name, role, client_id, token_hash, invited_by)
  values (m.org_id, v_email, nullif(private.clean_text(p_full_name, 120), ''), p_role, p_client_id,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), m.user_id);
  return v_token;
end $$;

create or replace function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.memberships := private.require_member(array['admin']);
begin
  update public.invitations set revoked_at = now()
  where id = p_invitation_id and org_id = m.org_id and accepted_at is null and revoked_at is null;
  if not found then raise exception 'Invitation not found or no longer pending.' using errcode = 'PT404'; end if;
end $$;

create or replace function public.update_member(p_user_id uuid, p_role text, p_client_id uuid, p_is_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin']);
  t public.memberships;
begin
  select * into t from public.memberships where user_id = p_user_id and org_id = m.org_id for update;
  if not found then raise exception 'Member not found.' using errcode = 'PT404'; end if;
  if p_role not in ('admin', 'team', 'client') then raise exception 'Choose a valid role.' using errcode = '22023'; end if;
  if p_role = 'client' and (p_client_id is null or not exists (select 1 from public.clients where id = p_client_id and org_id = m.org_id)) then
    raise exception 'Choose a client account for this client approver.' using errcode = '22023';
  end if;
  if t.role = 'admin' and (p_role <> 'admin' or not p_is_active)
     and (select count(*) from public.memberships where org_id = m.org_id and role = 'admin' and is_active) <= 1 then
    raise exception 'A workspace needs at least one active admin.' using errcode = '42501';
  end if;
  update public.memberships
  set role = p_role, client_id = case when p_role = 'client' then p_client_id else null end, is_active = coalesce(p_is_active, true)
  where id = t.id;
end $$;

create or replace function public.upsert_client(
  p_id uuid, p_name text, p_contact_name text, p_contact_email text, p_timezone text, p_notes text, p_is_active boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin']);
  v_id uuid;
  v_name text := private.clean_text(p_name, 120);
  v_email text := nullif(lower(trim(coalesce(p_contact_email, ''))), '');
  v_tz text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
begin
  if char_length(v_name) < 2 then raise exception 'Client name must be at least 2 characters.' using errcode = '22023'; end if;
  if v_email is not null and not private.valid_email(v_email) then raise exception 'Enter a valid contact email.' using errcode = '22023'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    raise exception 'Unknown time zone: %', v_tz using errcode = '22023';
  end if;
  if exists (select 1 from public.clients where org_id = m.org_id and lower(name) = lower(v_name) and id is distinct from p_id) then
    raise exception 'A client with this name already exists.' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.clients (org_id, name, contact_name, contact_email, timezone, notes, is_active, created_by)
    values (m.org_id, v_name, nullif(private.clean_text(p_contact_name, 120), ''), v_email, v_tz,
            nullif(private.clean_text(p_notes, 2000), ''), coalesce(p_is_active, true), m.user_id)
    returning id into v_id;
  else
    update public.clients
    set name = v_name, contact_name = nullif(private.clean_text(p_contact_name, 120), ''), contact_email = v_email,
        timezone = v_tz, notes = nullif(private.clean_text(p_notes, 2000), ''), is_active = coalesce(p_is_active, true)
    where id = p_id and org_id = m.org_id
    returning id into v_id;
    if v_id is null then raise exception 'Client not found.' using errcode = 'PT404'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.update_organization(p_name text, p_require_four_eyes boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin']);
  v_name text := private.clean_text(p_name, 120);
begin
  if char_length(v_name) < 2 then raise exception 'Workspace name must be at least 2 characters.' using errcode = '22023'; end if;
  update public.organizations set name = v_name, require_four_eyes = coalesce(p_require_four_eyes, true) where id = m.org_id;
end $$;

create or replace function public.update_my_profile(p_full_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text := private.clean_text(p_full_name, 120);
begin
  if (select auth.uid()) is null then raise exception 'You must be signed in.' using errcode = '28000'; end if;
  if char_length(v_name) < 2 then raise exception 'Name must be at least 2 characters.' using errcode = '22023'; end if;
  update public.profiles set full_name = v_name where id = (select auth.uid());
end $$;

-- -----------------------------------------------------------------------------
-- Content workflow
-- -----------------------------------------------------------------------------

create or replace function private.validate_item_fields(
  p_org uuid, p_client_id uuid, p_title text, p_content_type text, p_platform text, p_assignee_id uuid
) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if char_length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Title must be at least 3 characters.' using errcode = '22023'; end if;
  if char_length(trim(p_title)) > 160 then raise exception 'Title must be 160 characters or fewer.' using errcode = '22023'; end if;
  if p_content_type not in ('post', 'carousel', 'short_video', 'story', 'other') then raise exception 'Choose a valid content type.' using errcode = '22023'; end if;
  if p_platform not in ('instagram', 'facebook', 'linkedin', 'tiktok', 'other') then raise exception 'Choose a valid platform.' using errcode = '22023'; end if;
  if not exists (select 1 from public.clients where id = p_client_id and org_id = p_org and is_active) then
    raise exception 'Choose an active client from your workspace.' using errcode = '22023';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.memberships where user_id = p_assignee_id and org_id = p_org and role in ('admin', 'team') and is_active
  ) then
    raise exception 'The assigned team member must be an active member of your agency.' using errcode = '22023';
  end if;
end $$;

create or replace function public.create_content_item(
  p_client_id uuid, p_title text, p_content_type text, p_platform text, p_assignee_id uuid,
  p_due_date date, p_planned_publish_at timestamptz, p_description text, p_body text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin', 'team']);
  v_item public.content_items;
begin
  perform private.validate_item_fields(m.org_id, p_client_id, p_title, p_content_type, p_platform, p_assignee_id);
  insert into public.content_items (org_id, client_id, title, content_type, platform, assignee_id, created_by, due_date, planned_publish_at)
  values (m.org_id, p_client_id, trim(p_title), p_content_type, p_platform, coalesce(p_assignee_id, m.user_id), m.user_id, p_due_date, p_planned_publish_at)
  returning * into v_item;
  insert into public.content_versions (org_id, item_id, version_number, description, body, created_by)
  values (m.org_id, v_item.id, 1, private.clean_text(p_description, 5000), private.clean_text(p_body, 10000), m.user_id);
  perform private.log_event(v_item, 1, 'created', null, 'draft', null, 'internal');
  return v_item.id;
end $$;

create or replace function public.update_content_item(
  p_item_id uuid, p_client_id uuid, p_title text, p_content_type text, p_platform text, p_assignee_id uuid,
  p_due_date date, p_planned_publish_at timestamptz, p_description text, p_body text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin', 'team']);
  v_item public.content_items;
begin
  select * into v_item from public.content_items where id = p_item_id and org_id = m.org_id for update;
  if not found then raise exception 'Content item not found.' using errcode = 'PT404'; end if;
  if v_item.status not in ('draft', 'revision_required') then
    raise exception 'Only drafts and items returned for revision can be edited.' using errcode = '42501';
  end if;
  if v_item.status = 'revision_required' and p_client_id <> v_item.client_id then
    raise exception 'The client cannot be changed after the item was sent for approval.' using errcode = '42501';
  end if;
  perform private.validate_item_fields(m.org_id, p_client_id, p_title, p_content_type, p_platform, p_assignee_id);
  update public.content_items
  set client_id = p_client_id, title = trim(p_title), content_type = p_content_type, platform = p_platform,
      assignee_id = p_assignee_id, due_date = p_due_date, planned_publish_at = p_planned_publish_at
  where id = v_item.id;
  update public.content_versions
  set description = private.clean_text(p_description, 5000), body = private.clean_text(p_body, 10000)
  where item_id = v_item.id and version_number = v_item.current_version and submitted_at is null;
  if not found then raise exception 'The working version is locked.' using errcode = '42501'; end if;
end $$;

create or replace function public.submit_content_item(p_item_id uuid, p_change_summary text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin', 'team']);
  v_item public.content_items;
  v_ver public.content_versions;
  v_summary text := private.clean_text(p_change_summary, 2000);
  v_is_resubmit boolean;
  v_client_name text;
begin
  select * into v_item from public.content_items where id = p_item_id and org_id = m.org_id for update;
  if not found then raise exception 'Content item not found.' using errcode = 'PT404'; end if;
  if v_item.status not in ('draft', 'revision_required') then
    raise exception 'This item has already been sent for approval.' using errcode = '42501';
  end if;
  v_is_resubmit := v_item.status = 'revision_required';
  select * into v_ver from public.content_versions where item_id = v_item.id and version_number = v_item.current_version;
  if v_ver.submitted_at is not null then raise exception 'This version was already submitted.' using errcode = '42501'; end if;

  -- SOP §8.1: the approval package must be complete before it is sent.
  if char_length(trim(v_ver.body)) = 0 and not exists (select 1 from public.attachments where version_id = v_ver.id) then
    raise exception 'Add the caption/copy or at least one attachment before sending.' using errcode = '22023';
  end if;
  if v_item.due_date is null then raise exception 'Set a client response due date before sending.' using errcode = '22023'; end if;
  if v_item.due_date < current_date then raise exception 'The client response due date is in the past.' using errcode = '22023'; end if;
  if v_item.planned_publish_at is not null and v_item.planned_publish_at::date < v_item.due_date then
    raise exception 'The planned publish date must be on or after the client response due date.' using errcode = '22023';
  end if;
  if v_is_resubmit and char_length(v_summary) < 5 then
    raise exception 'Summarise what changed in this version (at least 5 characters).' using errcode = '22023';
  end if;
  -- SOP §7 escalation: never send content when the client has no named approver.
  if cardinality(private.client_approvers(v_item.client_id)) = 0 then
    raise exception 'This client has no active Client Approver yet. Invite one before sending content for approval.' using errcode = '22023';
  end if;

  update public.content_versions
  set submitted_at = now(), submitted_by = m.user_id, change_summary = nullif(v_summary, ''),
      snapshot = jsonb_build_object('title', v_item.title, 'content_type', v_item.content_type, 'platform', v_item.platform,
                                    'due_date', v_item.due_date, 'planned_publish_at', v_item.planned_publish_at)
  where id = v_ver.id;
  update public.content_items
  set status = 'pending_approval', last_submitted_at = now(), first_submitted_at = coalesce(first_submitted_at, now())
  where id = v_item.id;

  perform private.log_event(v_item, v_item.current_version, case when v_is_resubmit then 'resubmitted' else 'submitted' end,
                            v_item.status, 'pending_approval', v_summary, 'client');
  select name into v_client_name from public.clients where id = v_item.client_id;
  perform private.notify(v_item, private.client_approvers(v_item.client_id),
    case when v_is_resubmit then 'resubmitted' else 'submitted' end,
    case when v_is_resubmit then 'Updated version ready for review' else 'New content awaiting your approval' end,
    v_item.title || ' · v' || v_item.current_version || ' · due ' || to_char(v_item.due_date, 'DD Mon YYYY'));
end $$;

-- Client decisions (SOP §8.3 decision table). p_version guards against acting on
-- a stale screen: the decision always names the exact version reviewed.
create or replace function private.load_for_client_decision(p_item_id uuid, p_version integer)
returns public.content_items
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['client']);
  v_item public.content_items;
begin
  select * into v_item from public.content_items where id = p_item_id and org_id = m.org_id and client_id = m.client_id for update;
  if not found then raise exception 'Content item not found.' using errcode = 'PT404'; end if;
  if v_item.status <> 'pending_approval' then
    raise exception 'This item is not waiting for your decision.' using errcode = '42501';
  end if;
  if p_version is distinct from v_item.current_version then
    raise exception 'A newer version is available. Refresh the page and review version %.', v_item.current_version using errcode = 'PT409';
  end if;
  return v_item;
end $$;

create or replace function public.approve_content_item(p_item_id uuid, p_version integer, p_comment text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.content_items := private.load_for_client_decision(p_item_id, p_version);
  v_comment text := private.clean_text(p_comment, 5000);
begin
  update public.content_items
  set status = 'approved', approved_version = v_item.current_version, approved_at = now(), approved_by = (select auth.uid())
  where id = v_item.id;
  perform private.log_event(v_item, v_item.current_version, 'approved', 'pending_approval', 'approved', v_comment, 'client');
  perform private.notify(v_item, private.agency_watchers(v_item), 'approved', 'Client approved content',
    v_item.title || ' · v' || v_item.current_version || ' approved by ' || coalesce(private.actor_name((select auth.uid())), 'client'));
end $$;

create or replace function public.request_revision(p_item_id uuid, p_version integer, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.content_items := private.load_for_client_decision(p_item_id, p_version);
  v_comment text := private.clean_text(p_comment, 5000);
  v_next integer;
begin
  if char_length(v_comment) < 5 then
    raise exception 'Describe the changes you need (at least 5 characters).' using errcode = '22023';
  end if;
  v_next := private.start_new_version(v_item);
  update public.content_items
  set status = 'revision_required', current_version = v_next, revision_round = revision_round + 1
  where id = v_item.id;
  perform private.log_event(v_item, v_item.current_version, 'revision_requested', 'pending_approval', 'revision_required', v_comment, 'client',
                            jsonb_build_object('revision_round', v_item.revision_round + 1, 'next_version', v_next));
  perform private.notify(v_item, private.agency_watchers(v_item), 'revision_requested', 'Client requested revisions',
    v_item.title || ' · v' || v_item.current_version || ': ' || left(v_comment, 140));
end $$;

create or replace function public.reject_content_item(p_item_id uuid, p_version integer, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.content_items := private.load_for_client_decision(p_item_id, p_version);
  v_comment text := private.clean_text(p_comment, 5000);
begin
  if char_length(v_comment) < 5 then
    raise exception 'Tell the team why this item should not be used (at least 5 characters).' using errcode = '22023';
  end if;
  update public.content_items set status = 'rejected' where id = v_item.id;
  perform private.log_event(v_item, v_item.current_version, 'rejected', 'pending_approval', 'rejected', v_comment, 'client');
  perform private.notify(v_item, private.agency_watchers(v_item), 'rejected', 'Client rejected content',
    v_item.title || ' · v' || v_item.current_version || ': ' || left(v_comment, 140));
end $$;

-- Approved -> Scheduled for Publishing (SOP §8.5–8.6).
create or replace function public.schedule_content_item(p_item_id uuid, p_scheduled_for timestamptz, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin', 'team']);
  v_item public.content_items;
  v_ver public.content_versions;
  v_four_eyes boolean;
  v_approved_time timestamptz;
  v_note text := private.clean_text(p_note, 2000);
begin
  select * into v_item from public.content_items where id = p_item_id and org_id = m.org_id for update;
  if not found then raise exception 'Content item not found.' using errcode = 'PT404'; end if;
  if v_item.status <> 'approved' then raise exception 'Only client-approved items can be scheduled.' using errcode = '42501'; end if;
  if v_item.approved_version is distinct from v_item.current_version then
    raise exception 'The version to schedule does not match the approved version.' using errcode = '42501';
  end if;
  select * into v_ver from public.content_versions where item_id = v_item.id and version_number = v_item.approved_version;
  if p_scheduled_for is null or p_scheduled_for <= now() then
    raise exception 'Choose a publishing date and time in the future.' using errcode = '22023';
  end if;
  v_approved_time := nullif(v_ver.snapshot ->> 'planned_publish_at', '')::timestamptz;
  if v_approved_time is not null and v_approved_time <> p_scheduled_for then
    raise exception 'The client approved publishing at a specific time. To change it, reopen the item and get the new date approved.' using errcode = '42501';
  end if;
  select require_four_eyes into v_four_eyes from public.organizations where id = m.org_id;
  if v_four_eyes and (v_ver.created_by = m.user_id or v_ver.submitted_by = m.user_id) then
    raise exception 'Four-eyes check: you prepared this version, so another team member must schedule it.' using errcode = '42501';
  end if;
  update public.content_items set status = 'scheduled', scheduled_for = p_scheduled_for, scheduled_by = m.user_id where id = v_item.id;
  perform private.log_event(v_item, v_item.current_version, 'scheduled', 'approved', 'scheduled', v_note, 'client',
                            jsonb_build_object('scheduled_for', p_scheduled_for, 'four_eyes_checked_by', private.actor_name(m.user_id)));
  perform private.notify(v_item, private.agency_watchers(v_item), 'scheduled', 'Scheduled for publishing',
    v_item.title || ' · ' || to_char(p_scheduled_for at time zone 'UTC', 'DD Mon YYYY HH24:MI') || ' UTC');
end $$;

create or replace function public.unschedule_content_item(p_item_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin', 'team']);
  v_item public.content_items;
  v_reason text := private.clean_text(p_reason, 2000);
begin
  select * into v_item from public.content_items where id = p_item_id and org_id = m.org_id for update;
  if not found then raise exception 'Content item not found.' using errcode = 'PT404'; end if;
  if v_item.status <> 'scheduled' then raise exception 'Only scheduled items can be unscheduled.' using errcode = '42501'; end if;
  if char_length(v_reason) < 5 then raise exception 'Give a reason for unscheduling (at least 5 characters).' using errcode = '22023'; end if;
  update public.content_items set status = 'approved', scheduled_for = null, scheduled_by = null where id = v_item.id;
  perform private.log_event(v_item, v_item.current_version, 'unscheduled', 'scheduled', 'approved', v_reason, 'client');
end $$;

-- SOP §11: "Client asks for a change after approval" -> new revision round.
create or replace function public.reopen_content_item(p_item_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin', 'team']);
  v_item public.content_items;
  v_reason text := private.clean_text(p_reason, 2000);
  v_next integer;
begin
  select * into v_item from public.content_items where id = p_item_id and org_id = m.org_id for update;
  if not found then raise exception 'Content item not found.' using errcode = 'PT404'; end if;
  if v_item.status not in ('approved', 'scheduled') then
    raise exception 'Only approved or scheduled items can be reopened.' using errcode = '42501';
  end if;
  if char_length(v_reason) < 5 then raise exception 'Give a reason for reopening (at least 5 characters).' using errcode = '22023'; end if;
  v_next := private.start_new_version(v_item);
  update public.content_items
  set status = 'revision_required', current_version = v_next, revision_round = revision_round + 1,
      approved_version = null, approved_at = null, approved_by = null, scheduled_for = null, scheduled_by = null
  where id = v_item.id;
  perform private.log_event(v_item, v_item.current_version, 'reopened', v_item.status, 'revision_required', v_reason, 'client',
                            jsonb_build_object('next_version', v_next));
end $$;

create or replace function public.delete_draft(p_item_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin', 'team']);
  v_item public.content_items;
begin
  select * into v_item from public.content_items where id = p_item_id and org_id = m.org_id for update;
  if not found then raise exception 'Content item not found.' using errcode = 'PT404'; end if;
  if v_item.status <> 'draft' or v_item.first_submitted_at is not null then
    raise exception 'Only drafts that were never sent to a client can be deleted.' using errcode = '42501';
  end if;
  if m.role <> 'admin' and v_item.created_by is distinct from m.user_id then
    raise exception 'Only the author or an admin can delete this draft.' using errcode = '42501';
  end if;
  perform set_config('app.allow_purge', 'on', true);
  delete from public.content_items where id = v_item.id;
  perform set_config('app.allow_purge', 'off', true);
end $$;

-- Removes the fictional demo workspace so the seed script can rebuild it.
-- Only callable with the service-role key, and only for organisations flagged is_demo.
create or replace function public.purge_demo_workspace() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the service role can purge demo data.' using errcode = '42501';
  end if;
  perform set_config('app.allow_purge', 'on', true);
  delete from public.notifications where org_id in (select id from public.organizations where is_demo);
  delete from public.organizations where is_demo;
  get diagnostics v_count = row_count;
  perform set_config('app.allow_purge', 'off', true);
  return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Attachments (files live in the private `attachments` storage bucket)
-- Path convention: {org_id}/{item_id}/{random}-{file name}
-- -----------------------------------------------------------------------------

create or replace function public.add_attachment(p_item_id uuid, p_storage_path text, p_file_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin', 'team']);
  v_item public.content_items;
  v_ver public.content_versions;
  v_obj record;
  v_id uuid;
  v_name text := private.clean_text(p_file_name, 200);
begin
  select * into v_item from public.content_items where id = p_item_id and org_id = m.org_id for update;
  if not found then raise exception 'Content item not found.' using errcode = 'PT404'; end if;
  if v_item.status not in ('draft', 'revision_required') then
    raise exception 'Files can only be added to drafts and items returned for revision.' using errcode = '42501';
  end if;
  select * into v_ver from public.content_versions where item_id = v_item.id and version_number = v_item.current_version and submitted_at is null;
  if not found then raise exception 'The working version is locked.' using errcode = '42501'; end if;
  if p_storage_path is null or split_part(p_storage_path, '/', 1) <> m.org_id::text or split_part(p_storage_path, '/', 2) <> v_item.id::text then
    raise exception 'Invalid file location.' using errcode = '42501';
  end if;
  if char_length(v_name) = 0 then raise exception 'File name is required.' using errcode = '22023'; end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'attachments' and o.name = p_storage_path;
  if not found then raise exception 'Uploaded file not found. Please upload it again.' using errcode = 'PT404'; end if;
  if (select count(*) from public.attachments where version_id = v_ver.id) >= 10 then
    raise exception 'A version can have at most 10 attachments.' using errcode = '22023';
  end if;
  insert into public.attachments (org_id, item_id, version_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (m.org_id, v_item.id, v_ver.id, p_storage_path, v_name,
          coalesce(v_obj.metadata ->> 'mimetype', 'application/octet-stream'),
          coalesce((v_obj.metadata ->> 'size')::bigint, 0), m.user_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.remove_attachment(p_attachment_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := private.require_member(array['admin', 'team']);
  v_att public.attachments;
begin
  select * into v_att from public.attachments where id = p_attachment_id and org_id = m.org_id;
  if not found then raise exception 'Attachment not found.' using errcode = 'PT404'; end if;
  -- The trigger rejects this for submitted versions; the stored file is kept,
  -- because earlier versions may still reference it.
  delete from public.attachments where id = v_att.id;
end $$;

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'You must be signed in.' using errcode = '28000'; end if;
  update public.notifications set read_at = now()
  where user_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids));
end $$;

-- -----------------------------------------------------------------------------
-- Function privileges: only signed-in users may call the API functions.
-- -----------------------------------------------------------------------------

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.purge_demo_workspace() from authenticated;
-- The invitation preview is shown on the sign-up page before an account exists.
grant execute on function public.get_invitation_preview(text) to anon;

-- -----------------------------------------------------------------------------
-- Storage: private bucket + policies
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 26214400,
  array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf', 'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "agency uploads attachments to editable items" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (select private.is_agency())
    and (storage.foldername(name))[1] = (select private.org_id())::text
    and exists (
      select 1 from public.content_items i
      where i.id::text = (storage.foldername(name))[2]
        and i.org_id = (select private.org_id())
        and i.status in ('draft', 'revision_required')
    )
  );

create policy "members read attachments they can see" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select private.org_id())::text
    and (
      (select private.is_agency())
      or exists (
        select 1 from public.attachments a
        join public.content_versions v on v.id = a.version_id
        where a.storage_path = objects.name and v.submitted_at is not null and private.can_view_item(a.item_id)
      )
    )
  );
-- No UPDATE or DELETE policies: stored files are immutable once uploaded.
