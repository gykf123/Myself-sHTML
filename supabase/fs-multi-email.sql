-- ============================================================
--  fs-multi-email：一个账号可绑定多个邮箱（2026-11-08）
--  项目：yowwyasttkywyqgseuqz
--
--  原表：user_id uuid primary key → 一人只能有一条记录。
--  改法：换成独立 id 主键 + (user_id, email) 唯一；保留
--        lower(email) 全局唯一（防止同一邮箱被多个账号重复绑定，
--        否则同一封公告会往同一地址寄两遍）。
--
--  幂等：靠「id 列是否已存在」判断，重复执行只会跳过迁移，
--        绝不误删已经换成 id 的主键。不 drop 表、不丢存量数据。
--  执行后必须 notify pgrst 刷新 schema cache。
-- ============================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fs_email_subscriptions'
      and column_name = 'id'
  ) then
    -- 旧主键（user_id）改名为历史约束后删除；用 if exists 兜底
    alter table public.fs_email_subscriptions
      drop constraint if exists fs_email_subscriptions_pkey;
    alter table public.fs_email_subscriptions
      add column id bigint generated always as identity primary key;
  end if;
end $$;

-- 同一账号下同一邮箱只留一行（PostgREST upsert onConflict 需要列级唯一索引，
-- 所以这里用列而不是表达式；函数层已统一把邮箱转小写）
create unique index if not exists fs_email_user_addr_key
  on public.fs_email_subscriptions (user_id, email);

-- 全局唯一：一个邮箱只能属于一个账号（防止重复发信），沿用旧索引
create unique index if not exists fs_email_addr_key
  on public.fs_email_subscriptions (lower(email));

-- 公告群发按 subscribed 过滤，加个部分索引方便以后订阅量上来
create index if not exists fs_email_subscribed_idx
  on public.fs_email_subscriptions (user_id) where subscribed = true;

-- 权限不变：表仍然 RLS 开启、无任何 policy、前端零权限，只走 fs-notify
alter table public.fs_email_subscriptions enable row level security;

notify pgrst, 'reload schema';
