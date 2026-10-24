-- ============================================================
--  留言墙安全加固（wall-security）
--  项目：yowwyasttkywyqgseuqz（与 guestbook.sql 同一项目）
--
--  执行方式：Supabase Dashboard → SQL Editor 粘贴执行
--
--  背景：guestbook 表此前 anon 可直插（RLS with check(true)），
--  且 App 端（adapp / iOS-app）依赖该通道，不能直接撤权。
--  本迁移用「函数验签通道（网页端）+ 数据库 trigger 兜底（所有端）」双层：
--    1) before-insert trigger：全局洪泛限流 + 重复内容去重
--    2) Edge Function wall-post：验 JWT、user_id 从 sub 提取（不可伪造）、
--       单用户频率限流、敏感词过滤（网页端主路径，体验最好）
-- ============================================================

-- 1) 洪泛防护 trigger：任何来源的 insert（anon 直插 / 函数 service_role）都过这关
create or replace function public.guestbook_guard()
returns trigger
language plpgsql
as $$
declare
  recent_total int;
  dup_count   int;
begin
  -- 1a. 全局频率：最近 60 秒全表 insert 超过 20 条 → 拒（挡灌水脚本）
  select count(*) into recent_total
  from public.guestbook
  where created_at > now() - interval '60 seconds';
  if recent_total >= 20 then
    raise exception 'wall_rate_limited: 留言太频繁了，请稍后再试'
      using errcode = 'check_violation';
  end if;

  -- 1b. 重复去重：同昵称 + 同内容 60 秒内只允许一条（挡复制粘贴刷屏）
  select count(*) into dup_count
  from public.guestbook
  where nickname = new.nickname
    and content = new.content
    and created_at > now() - interval '60 seconds';
  if dup_count > 0 then
    raise exception 'wall_duplicate: 相同内容刚发过了，换一句吧'
      using errcode = 'check_violation';
  end if;

  -- 1c. 长度兜底（与表 check 重复一道，防未来 check 被改掉）
  if char_length(new.content) > 500 then
    raise exception 'wall_too_long: 留言最长 500 字'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists guestbook_guard_trg on public.guestbook;
create trigger guestbook_guard_trg
  before insert on public.guestbook
  for each row execute function public.guestbook_guard();

-- 2) 频率索引：trigger 两处查询都按 created_at / nickname+content 过滤，
--    guestbook_created_at_idx 已存在；补一个 (nickname, content, created_at) 复合索引
create index if not exists guestbook_dup_idx
  on public.guestbook (nickname, content, created_at desc);

-- 3) 自检
-- select * from pg_trigger where tgname = 'guestbook_guard_trg';
-- insert into guestbook (content, nickname) values ('trigger 测试', '匿名访客');
-- 再插一条相同内容应立即被拒（wall_duplicate）。
