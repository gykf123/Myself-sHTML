-- ============================================================
--  留言墙 guestbook 表结构（Supabase · FKD 项目）
--  与本项目已有的 messages / users / stories 等表完全隔离，
--  专用于 FeSui 主页留言墙「留一句话证明你来过」。
--
--  执行方式（任选其一）：
--    A. Supabase Dashboard → 项目 yowwyasttkywyqgseuqz → SQL Editor 粘贴执行；
--    B. 经 Management API（PAT）POST /v1/projects/{ref}/database/query 执行
--       （本仓库自动化采用方式 B，详见 .github/ 或部署脚本）。
-- ============================================================

-- 1) 建表（幂等）
create table if not exists public.guestbook (
  id         bigint generated always as identity primary key,
  content    text        not null check (char_length(content) between 1 and 500),
  nickname   text        not null default '匿名访客' check (char_length(nickname) between 1 and 30),
  user_id    uuid        null,
  created_at timestamptz not null default now()
);

-- 2) 索引：按时间倒序读取
create index if not exists guestbook_created_at_idx on public.guestbook (created_at desc);

-- 3) 行级安全
alter table public.guestbook enable row level security;

drop policy if exists "guestbook_read"   on public.guestbook;
drop policy if exists "guestbook_insert" on public.guestbook;

-- 任何人可读取留言墙
create policy "guestbook_read" on public.guestbook
  for select using (true);

-- 写入：个人站点宽松写（真要严格鉴权可改由 Edge Function 校验 login token）
create policy "guestbook_insert" on public.guestbook
  for insert with check (true);

-- 4) 2026-10-30 新政策：public 新建表必须在同一迁移里显式 GRANT，
--    否则 REST Data API（anon / authenticated 角色）会返回 permission denied
grant select, insert on table public.guestbook to anon, authenticated;
grant usage, select on sequence public.guestbook_id_seq to anon, authenticated;
