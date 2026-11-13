-- JOSH video platform — Supabase schema
--
-- Prepared for the Supabase project. Nothing here runs automatically: apply it
-- in the Supabase SQL editor (or `supabase db push`) after connecting a project.
-- The application currently runs on its own local store; connecting Supabase
-- switches auth, storage and persistence to these tables.
--
-- Conventions
--   * money is integer micro-USDT (1 USDT = 1_000_000) to avoid float drift
--   * roles live on profiles.role and are enforced by RLS, not by the UI
--   * creator share is 60% / platform 40%, computed from revenue_events

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null check (char_length(display_name) between 1 and 40),
  role         text not null default 'viewer' check (role in ('viewer', 'creator', 'admin')),
  created_at   timestamptz not null default now()
);

-- Role check used by every policy. security definer so policies can read
-- profiles without recursing through profiles' own RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- New auth users get a profile. The very first user is promoted to admin
-- manually (see README) so nobody can self-assign the role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email, 'user'), '@', 1)),
    'viewer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy "profiles: read own or admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

create policy "profiles: update own name"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Only admins may change a role. Separate policy so the self-update policy
-- above can never be used to escalate.
create policy "profiles: admin manages all"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());

-- Column-level guard: a self-update that changes role is silently rejected.
create or replace function public.protect_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'only administrators can change roles';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute function public.protect_role();

-- ------------------------------------------------------------------ videos

create table if not exists public.videos (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 120),
  description    text not null default '' check (char_length(description) <= 2000),
  storage_path   text,
  thumbnail_path text,
  duration_sec   integer not null default 0 check (duration_sec >= 0),
  size_bytes     bigint  not null default 0 check (size_bytes >= 0),
  mime_type      text    not null default 'video/mp4',
  status         text    not null default 'draft'
                 check (status in ('draft', 'published', 'unlisted', 'removed')),
  created_at     timestamptz not null default now(),
  published_at   timestamptz
);

create index if not exists videos_published_idx
  on public.videos (published_at desc) where status = 'published';
create index if not exists videos_owner_idx on public.videos (user_id);

alter table public.videos enable row level security;

create policy "videos: published are public"
  on public.videos for select
  using (status = 'published' or user_id = auth.uid() or public.is_admin());

create policy "videos: creator inserts own"
  on public.videos for insert
  with check (user_id = auth.uid());

create policy "videos: creator updates own"
  on public.videos for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy "videos: creator deletes own"
  on public.videos for delete
  using (user_id = auth.uid() or public.is_admin());

-- ------------------------------------------------------------------- views

create table if not exists public.video_views (
  id         bigint generated always as identity primary key,
  video_id   uuid not null references public.videos (id) on delete cascade,
  viewer_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists video_views_video_idx on public.video_views (video_id);

alter table public.video_views enable row level security;

-- Anyone may record a view (that is what "public feed" means), but only the
-- owning creator and admins can read the counts.
create policy "views: anyone records"
  on public.video_views for insert
  with check (true);

create policy "views: owner and admin read"
  on public.video_views for select
  using (
    exists (
      select 1 from public.videos v
      where v.id = video_views.video_id
        and (v.user_id = auth.uid() or public.is_admin())
    )
  );

-- ------------------------------------------------------------------- likes

create table if not exists public.likes (
  video_id   uuid not null references public.videos (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

alter table public.likes enable row level security;

create policy "likes: readable by all"
  on public.likes for select using (true);
create policy "likes: insert own"
  on public.likes for insert with check (user_id = auth.uid());
create policy "likes: delete own"
  on public.likes for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------- comments

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  video_id   uuid not null references public.videos (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists comments_video_idx on public.comments (video_id, created_at desc);

alter table public.comments enable row level security;

create policy "comments: readable by all"
  on public.comments for select using (true);
create policy "comments: insert own"
  on public.comments for insert with check (user_id = auth.uid());
create policy "comments: delete own or admin"
  on public.comments for delete using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------- revenue ledger

-- A revenue event is money the platform actually received, entered by an
-- administrator. There is no synthetic row generator: an empty table means
-- zero earnings, which is the honest state until payments are connected.
create table if not exists public.revenue_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  video_id     uuid references public.videos (id) on delete set null,
  gross_micro  bigint not null check (gross_micro > 0),
  source       text not null check (char_length(source) between 1 and 60),
  external_ref text unique,
  note         text not null default '',
  occurred_at  timestamptz not null default now(),
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);

create index if not exists revenue_user_idx on public.revenue_events (user_id, occurred_at desc);

alter table public.revenue_events enable row level security;

create policy "revenue: creator reads own"
  on public.revenue_events for select
  using (user_id = auth.uid() or public.is_admin());

create policy "revenue: admin writes"
  on public.revenue_events for insert
  with check (public.is_admin());

-- ------------------------------------------------------- withdrawal requests

create table if not exists public.withdrawal_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  amount_micro bigint not null
               check (amount_micro >= 500000),        -- 0.5 USDT minimum
  network     text not null default 'BEP20' check (network = 'BEP20'),
  address     text not null check (address ~ '^0x[0-9a-fA-F]{40}$'),
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected', 'paid')),
  tx_hash     text check (tx_hash is null or tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  note        text not null default '',
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references public.profiles (id)
);

create index if not exists withdrawals_user_idx on public.withdrawal_requests (user_id, created_at desc);
create index if not exists withdrawals_status_idx on public.withdrawal_requests (status);

alter table public.withdrawal_requests enable row level security;

create policy "withdrawals: creator reads own"
  on public.withdrawal_requests for select
  using (user_id = auth.uid() or public.is_admin());

create policy "withdrawals: creator requests own"
  on public.withdrawal_requests for insert
  with check (user_id = auth.uid() and status = 'pending');

-- Only admins move a request forward, and they must record a transaction hash
-- before marking it paid. Nothing here can claim a payout that did not happen.
create policy "withdrawals: admin decides"
  on public.withdrawal_requests for update
  using (public.is_admin())
  with check (
    public.is_admin()
    and (status <> 'paid' or tx_hash is not null)
  );

-- ------------------------------------------------------------- live sessions

create table if not exists public.live_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120),
  status       text not null default 'scheduled'
               check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  provider     text not null default 'none',
  ingest_url   text,
  playback_url text,
  scheduled_for timestamptz,
  started_at   timestamptz,
  ended_at     timestamptz,
  created_at   timestamptz not null default now()
);

alter table public.live_sessions enable row level security;

create policy "live: public reads scheduled and live"
  on public.live_sessions for select
  using (status in ('scheduled', 'live') or user_id = auth.uid() or public.is_admin());

create policy "live: creator manages own"
  on public.live_sessions for insert with check (user_id = auth.uid());

create policy "live: creator updates own"
  on public.live_sessions for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------- balances

-- Creator balance derived from the ledger: 60% of gross revenue, minus
-- requests that are still pending, approved or already paid. All integers.
create or replace view public.creator_balances
with (security_invoker = true) as
select
  p.id as user_id,
  coalesce(sum(r.gross_micro) * 6000 / 10000, 0)::bigint            as earned_micro,
  coalesce(sum(r.gross_micro) * 4000 / 10000, 0)::bigint            as platform_micro,
  coalesce((
    select sum(w.amount_micro) from public.withdrawal_requests w
    where w.user_id = p.id and w.status in ('pending', 'approved', 'paid')
  ), 0)::bigint                                                     as committed_micro,
  (
    coalesce(sum(r.gross_micro) * 6000 / 10000, 0)
    - coalesce((
        select sum(w.amount_micro) from public.withdrawal_requests w
        where w.user_id = p.id and w.status in ('pending', 'approved', 'paid')
      ), 0)
  )::bigint                                                          as available_micro
from public.profiles p
left join public.revenue_events r on r.user_id = p.id
group by p.id;

-- ------------------------------------------------------------------ storage

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('videos', 'videos', false, 52428800,
   array['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska']),
  ('thumbnails', 'thumbnails', true, 2097152,
   array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Uploads must live in a folder named after the uploader's user id.
create policy "storage: creators upload own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('videos', 'thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage: owners read own objects"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('videos', 'thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Thumbnails are public so the feed can render without signed URLs.
create policy "storage: thumbnails public read"
  on storage.objects for select to anon
  using (bucket_id = 'thumbnails');

create policy "storage: owners delete own objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('videos', 'thumbnails')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ------------------------------------------------------------------- notes

-- Bootstrap the first administrator after signing up once:
--   update public.profiles set role = 'admin' where email = 'you@example.com';
