-- ============================================================
--  fs-visits-patch —— 站点访问统计只读通道 + 私聊消息表
--  项目：yowwyasttkywyqgseuqz（Supabase · PostgreSQL 17）
--
--  背景：用户已在库里部署《账号封禁与访问记录复用指南》配套的
--        0027 迁移（account_bans / site_visits + 11 个 RPC + cron）。
--        本文件**不改动、不覆盖那些既有对象**，只新增 fs_ 前缀资产：
--          · fs_visit_stats_public()  —— 给公开统计页用的聚合只读函数
--          · public.fs_chat_dm        —— 私聊消息表（读写只走 fs-chat 函数）
--
--  为什么需要公开统计函数：site_visit_stats 要求管理员 JWT / service_role，
--  普通访客打不开统计页。本函数只返回聚合数字，不含 user_id / ip，
--  且用 `site = p_site` 字面相等过滤（传 '*' 不会变成通配）。
--
--  执行方式：Supabase Management API / SQL Editor（幂等，可重复跑）
-- ============================================================

-- 1) 公开访问统计（聚合只读） -------------------------------------------
create or replace function public.fs_visit_stats_public(
  p_site text default 'fesui',
  p_days int  default 30
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days      int;
  v_total     bigint;
  v_unique    bigint;
  v_today     bigint;
  v_yesterday bigint;
  v_by_day    json;
  v_by_path   json;
  v_site      text;
begin
  v_days := least(greatest(coalesce(p_days, 30), 1), 365);
  v_site := coalesce(nullif(trim(p_site), ''), 'fesui');

  -- 总量与独立访客
  select count(*), count(distinct user_id)
    into v_total, v_unique
    from public.site_visits
   where site = v_site
     and visited_at >= now() - (v_days || ' days')::interval;

  -- 按天趋势（北京时间，补零到连续 v_days 天，前端不必再补）
  with days as (
    select ((now() at time zone 'Asia/Shanghai')::date - (v_days - 1 - g)) as d
      from generate_series(0, v_days - 1) as g
  ), agg as (
    select (visited_at at time zone 'Asia/Shanghai')::date as d,
           count(*)::int as visits,
           count(distinct user_id)::int as users
      from public.site_visits
     where site = v_site
       and visited_at >= now() - (v_days || ' days')::interval
     group by 1
  )
  select coalesce(
           json_agg(
             json_build_object(
               'day',    to_char(days.d, 'YYYY-MM-DD'),
               'visits', coalesce(agg.visits, 0),
               'users',  coalesce(agg.users, 0)
             ) order by days.d
           ), '[]'::json)
    into v_by_day
    from days left join agg on agg.d = days.d;

  -- 访问路径 Top 10
  select coalesce(
           json_agg(json_build_object('path', p.path, 'visits', p.visits)
                    order by p.visits desc), '[]'::json)
    into v_by_path
    from (
      select coalesce(nullif(path, ''), '(未记录)') as path,
             count(*)::int as visits
        from public.site_visits
       where site = v_site
         and visited_at >= now() - (v_days || ' days')::interval
       group by 1
       order by 2 desc
       limit 10
    ) p;

  -- 今日 / 昨日（北京时间）
  select count(*) into v_today
    from public.site_visits
   where site = v_site
     and (visited_at at time zone 'Asia/Shanghai')::date
         = (now() at time zone 'Asia/Shanghai')::date;

  select count(*) into v_yesterday
    from public.site_visits
   where site = v_site
     and (visited_at at time zone 'Asia/Shanghai')::date
         = ((now() at time zone 'Asia/Shanghai') - interval '1 day')::date;

  return json_build_object(
    'ok',           true,
    'site',         v_site,
    'days',         v_days,
    'total',        v_total,
    'unique_users', v_unique,
    'today',        v_today,
    'yesterday',    v_yesterday,
    'by_day',       v_by_day,
    'by_path',      v_by_path
  );
end;
$$;

-- PostgreSQL 建函数默认把 EXECUTE 授给 PUBLIC，必须收回再按最小权限授。
-- 只给 anon / authenticated：公开统计页可调，但不开放任何表级权限。
revoke all on function public.fs_visit_stats_public(text, int)
  from public, anon, authenticated;
grant execute on function public.fs_visit_stats_public(text, int)
  to anon, authenticated;

-- 2) 私聊消息表 -----------------------------------------------------------
-- 与既有 chat_groups / chat_messages / chat_members（另一套群聊）完全隔离。
create table if not exists public.fs_chat_dm (
  id           bigint generated always as identity primary key,
  sender_id    uuid        not null,
  recipient_id uuid        not null,
  content      text        not null check (char_length(content) between 1 and 500),
  created_at   timestamptz not null default now(),
  read_at      timestamptz null,
  constraint fs_chat_dm_not_self check (sender_id <> recipient_id)
);

create index if not exists fs_chat_dm_pair_idx
  on public.fs_chat_dm (sender_id, recipient_id, created_at desc);
create index if not exists fs_chat_dm_inbox_idx
  on public.fs_chat_dm (recipient_id, read_at, created_at desc);

alter table public.fs_chat_dm enable row level security;

-- 幂等：清掉任何残留 policy，保证前端一条都读不到。
-- 私聊读写一律由 fs-chat 边缘函数用 service_role 完成（验签后 uid 只信 sub）。
do $$
declare r record;
begin
  for r in select policyname
             from pg_policies
            where schemaname = 'public' and tablename = 'fs_chat_dm' loop
    execute format('drop policy %I on public.fs_chat_dm', r.policyname);
  end loop;
end $$;

revoke all on table public.fs_chat_dm from public, anon, authenticated;
