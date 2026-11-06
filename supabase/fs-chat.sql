-- ============================================================
--  fs-chat —— FeSui 站点聊天室后端（带 fs_ 前缀，与既有对象隔离）
--  项目：yowwyasttkywyqgseuqz（Supabase · PostgreSQL + PostgREST）
--
--  ⚠️ 命名隔离说明（2026-11-06 线上探测结论）：
--    本项目此前已有一整套聊天相关对象，本迁移一律不碰、不覆盖：
--      · public.messages        （旧留言/聊天，含 2026-09 的历史数据）
--      · public.chat_groups     （群「滚木」等）
--      · public.chat_messages   （按 group_id 的群消息）
--      · public.chat_members    （群成员）
--      · public.stories / guestbook / qq_bind_codes / users
--    另有边缘函数 login / auth-exchange / qq-bind / profile 已部署。
--    本文件只新增 fs_ 前缀对象，绝不 drop/alter 上述任何既有对象。
--
--  执行方式：Supabase Dashboard → 项目 → SQL Editor 粘贴执行（幂等，可重复跑）
--  部署顺序：先跑本 SQL，再部署 supabase/functions/fs-chat（Edge Function）
-- ============================================================

-- 1) 建表：只放「公共大厅」消息，一列都不复用已有表
create table if not exists public.fs_chat_messages (
  id           bigint generated always as identity primary key,
  user_id      uuid        not null,                    -- 服务端从 JWT sub 提取，绝不信前端
  author_name  text        not null default '匿名' check (char_length(author_name) between 1 and 30),
  author_avatar text       null,                      -- 头像 URL，可空
  content      text        not null check (char_length(content) between 1 and 500),
  created_at   timestamptz not null default now()
);

-- 2) 索引：按时间倒序分页读
create index if not exists fs_chat_messages_created_at_idx
  on public.fs_chat_messages (created_at desc);

-- 3) 行级安全：读公开，写只走函数（service_role）
alter table public.fs_chat_messages enable row level security;

-- 幂等：重复执行时把所有写入策略一并清掉，确保匿名永远不能直插
drop policy if exists "fs_chat_messages_read"   on public.fs_chat_messages;
drop policy if exists "fs_chat_messages_insert" on public.fs_chat_messages;
drop policy if exists "fs_chat_messages_write"  on public.fs_chat_messages;

create policy "fs_chat_messages_read" on public.fs_chat_messages
  for select using (true);

-- 注意：不建 insert 策略 → anon / authenticated 无法直插，
-- 只能由 fs-chat 边缘函数用 service_role 写入（user_id 不可伪造）。

-- 4) GRANT：public schema 新建表必须显式授权，REST 才能读到
--    只放行 select；写入/更新/删除显式 revoke，防止 default privileges 偷偷授权
revoke insert, update, delete on table public.fs_chat_messages from anon, authenticated;
grant select on table public.fs_chat_messages to anon, authenticated;
-- 不给 sequence usage（identity 由函数侧 service_role 写入）

-- 5) 兜底 trigger：即使有人绕过函数直插，也做全局限流 + 去重
--    （与 wall-security.sql 的 guestbook_guard 同思路，但只作用于 fs_ 表）
create or replace function public.fs_chat_guard()
returns trigger
language plpgsql
as $$
declare
  recent_total int;
  dup_count    int;
begin
  select count(*) into recent_total
  from public.fs_chat_messages
  where created_at > now() - interval '60 seconds';
  if recent_total >= 30 then
    raise exception 'fs_chat_rate_limited: 聊天太热闹了，稍等一会儿再发'
      using errcode = 'check_violation';
  end if;

  select count(*) into dup_count
  from public.fs_chat_messages
  where user_id = new.user_id
    and content = new.content
    and created_at > now() - interval '60 seconds';
  if dup_count > 0 then
    raise exception 'fs_chat_duplicate: 相同内容刚发过了，换一句吧'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists fs_chat_guard_trg on public.fs_chat_messages;
create trigger fs_chat_guard_trg
  before insert on public.fs_chat_messages
  for each row execute function public.fs_chat_guard();
