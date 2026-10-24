-- ============================================================
--  账号绑定（GitHub OAuth + QQ）迁移 SQL
--  项目：yowwyasttkywyqgseuqz（与 guestbook.sql 同一项目）
--
--  执行方式：Supabase Dashboard → SQL Editor 粘贴执行
--  （本仓库不持有 Supabase Management PAT，SQL 由站点所有者执行）
--
--  背景：2026-10-24 探测发现 users 表 anon 可全表读（含 password_hash）。
--  本迁移一并收紧：撤销 anon 的 users 表读写，账号资料变更统一走
--  Edge Function（account，service_role 鉴权后写入）。
-- ============================================================

-- 1) 绑定相关新字段（幂等）
alter table public.users add column if not exists github_id          text;
alter table public.users add column if not exists github_login        text;
alter table public.users add column if not exists github_avatar_url   text;
alter table public.users add column if not exists github_linked_at    timestamptz;
alter table public.users add column if not exists qq                  text;

-- GitHub 账号全局唯一（一个 GitHub 只能绑一个本站账号）
create unique index if not exists users_github_id_key on public.users (github_id) where github_id is not null;

-- 2) RLS 收紧：先看后收（登录链路读 users 的 select 若被禁用，
--    login/apply Edge Function 走 service_role 不受 RLS 约束，不受影响）
-- 2a. 确保 RLS 开启
alter table public.users enable row level security;

-- 2b. 撤销 anon / authenticated 对 users 表的直接读写授权
--     （个人中心「我的资料」改由 Edge Function account 代理读取，
--       该函数用 service_role key，不受 GRANT 限制）
revoke all on table public.users from anon, authenticated;

-- 2c. 删除历史上可能放开的宽泛策略（如有）
drop policy if exists "users_read_all"   on public.users;
drop policy if exists "users_update_own" on public.users;
drop policy if exists "users_insert_self" on public.users;

-- 3) 迁移后自检（应看到 0 行 anon 授权、RLS 开启、新字段就位）
-- select relrowsecurity from pg_class where relname = 'users';
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'users' and grantee in ('anon','authenticated');
