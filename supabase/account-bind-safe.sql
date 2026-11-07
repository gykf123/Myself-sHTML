-- ============================================================
--  GitHub 绑定迁移 · 线上安全版（2026-11-07 已通过 Management API 执行）
--  项目：yowwyasttkywyqgseuqz
--
--  与 account-bind.sql 的区别：**只加列 + 唯一索引，不动任何 GRANT / RLS / POLICY**。
--  原因：线上 users 表实际是「列级」授权，anon 只有部分列的 SELECT，
--  authenticated 有 nickname/bio/avatar_url/qq 的列级 UPDATE（QQ 号保存走 PATCH REST
--  就靠它），password_hash / reason / contact / reject_reason / reviewed_at 只有 REFERENCES。
--  account-bind.sql 里的 `revoke all on table public.users from anon, authenticated`
--  会连带撤销这些列级权限，导致 QQ 绑定、公开名片、主站登录态一起挂掉，故不执行。
--
--  新增列不显式授权：列级 GRANT 不会自动覆盖新列，anon 读不到 github_*，
--  绑定资料统一由 Edge Function account（service_role）代理读取，符合最小权限。
-- ============================================================

-- 1) 绑定字段（幂等，重复执行安全）
alter table public.users add column if not exists github_id          text;
alter table public.users add column if not exists github_login        text;
alter table public.users add column if not exists github_avatar_url   text;
alter table public.users add column if not exists github_linked_at    timestamptz;
-- qq 列线上已存在，保留兼容
alter table public.users add column if not exists qq                  text;

-- 2) 一个 GitHub 账号只能绑一个本站账号（NULL 不参与唯一约束）
create unique index if not exists users_github_id_key
  on public.users (github_id) where github_id is not null;

-- 3) 自检
-- select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='users' and column_name like 'github%'
--   order by column_name;
-- select indexname, indexdef from pg_indexes
--   where tablename='users' and indexname='users_github_id_key';
