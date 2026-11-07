-- ============================================================
--  fs-content：邮箱绑定 / 项目公告 / 博客（2026-11-07）
--  项目：yowwyasttkywyqgseuqz
--
--  全部 fs_ 前缀，幂等，绝不 drop / alter 任何既有对象。
--  权限模型：
--    · fs_email_subscriptions 完全私有 —— RLS 无 policy，前端一条都读不到，
--      读写只走 fs-notify 函数（service_role），user_id 只信 JWT sub。
--    · fs_announcements / fs_posts 公开只读（anon SELECT policy），
--      写操作只走函数且服务端验 users.role='admin'。
--  执行后必须 notify pgrst 刷新 schema cache，否则新表在 REST 里看不见。
-- ============================================================

-- 1) 邮箱绑定 = 订阅名单（一张表两个用途，公告群发直接取 subscribed=true）
create table if not exists public.fs_email_subscriptions (
  user_id     uuid primary key,
  email       text not null,
  verified    boolean not null default false,   -- 预留：验证码机制待邮件通道开通后启用
  subscribed  boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint fs_email_format check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
create unique index if not exists fs_email_addr_key
  on public.fs_email_subscriptions (lower(email));

-- 2) 项目公告
create table if not exists public.fs_announcements (
  id           bigint generated always as identity primary key,
  title        text not null check (char_length(title) between 1 and 120),
  body         text not null check (char_length(body) between 1 and 5000),
  author_id    uuid not null,
  mailed_count integer not null default 0,
  mailed_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists fs_announcements_created_idx
  on public.fs_announcements (created_at desc);

-- 3) 博客文章
create table if not exists public.fs_posts (
  id          bigint generated always as identity primary key,
  slug        text not null unique,
  title       text not null check (char_length(title) between 1 and 120),
  summary     text not null default '' check (char_length(summary) <= 300),
  content     text not null,
  published   boolean not null default false,
  author_id   uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint fs_post_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$')
);
create index if not exists fs_posts_published_idx
  on public.fs_posts (published, created_at desc);

-- 4) RLS + 权限（先清干净再按最小权限授予）
alter table public.fs_email_subscriptions enable row level security;
alter table public.fs_announcements      enable row level security;
alter table public.fs_posts              enable row level security;

do $$
declare t text; p record;
begin
  foreach t in array array['fs_email_subscriptions','fs_announcements','fs_posts'] loop
    for p in select policyname from pg_policies
             where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- 公开只读：公告全公开；博客只放行已发布文章（草稿前端看不到）
create policy fs_announcements_public_read on public.fs_announcements
  for select to anon, authenticated using (true);
create policy fs_posts_public_read on public.fs_posts
  for select to anon, authenticated using (published = true);
grant select on public.fs_announcements to anon, authenticated;
grant select on public.fs_posts         to anon, authenticated;

-- fs_email_subscriptions 无 policy、无 grant：只有 service_role 函数能碰

-- 5) PostgREST schema cache（历史踩过 PGRST202，新对象必须刷新）
notify pgrst, 'reload schema';
