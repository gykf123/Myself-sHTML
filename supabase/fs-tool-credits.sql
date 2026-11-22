-- ============================================================
-- fs-tool-credits.sql — 工具使用积分 + 个人中心签到聚合
-- ------------------------------------------------------------
-- 背景：积分系统（public.users.active_value）早已存在，签到走
-- do_sign_in() / my_sign_status()，本文件只补两块：
--   1) 工具使用奖励：每用一次工具 +5，每天最多 3 次（15 分）
--   2) 个人中心聚合：一次请求拿到余额 / 签到 / 工具进度 / 等级
--
-- 设计约束：
--   · 全部新增，fs_ 前缀，不 drop / alter 任何既有对象；
--   · 工具奖励只加不减，不设消费门槛，工具本身永远免登录可用；
--   · 流水表 RLS 无 policy + revoke，前端一条都读不到，只走 RPC；
--   · 并发用 advisory lock 串行，同一天不会多领第 4 次；
--   · 幂等：重复执行安全。
-- ============================================================

create table if not exists public.fs_tool_credits (
  id          bigserial primary key,
  user_id     uuid not null references public.users(id) on delete cascade,
  tool        text not null check (char_length(tool) between 1 and 32),
  amount      numeric(12,2) not null default 5,
  day         date not null default current_date,
  slot        smallint not null check (slot between 1 and 3),
  created_at  timestamptz not null default now(),
  unique (user_id, day, slot)
);

create index if not exists fs_tool_credits_day_idx  on public.fs_tool_credits (day);
create index if not exists fs_tool_credits_user_idx on public.fs_tool_credits (user_id, day);

alter table public.fs_tool_credits enable row level security;
revoke all on public.fs_tool_credits from public;
revoke all on public.fs_tool_credits from anon, authenticated;
grant all on public.fs_tool_credits to service_role;
grant usage, select on sequence public.fs_tool_credits_id_seq to service_role;

-- ------------------------------------------------------------
-- 工具使用奖励：+5 / 次，日限 3 次
-- 返回：{ok, awarded, delta, used, limit, amount, balance, reason?}
-- ------------------------------------------------------------
create or replace function public.fs_tool_reward(p_tool text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid;
  v_tool   text;
  v_used   int;
  v_amount numeric := 5;
  v_limit  int := 3;
  v_bal    numeric;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'need_login', true, 'msg', '登录后使用工具才有积分');
  end if;

  -- 工具名只留安全字符，未知一律归 unknown，避免脏数据
  v_tool := lower(regexp_replace(coalesce(p_tool, ''), '[^a-zA-Z0-9_-]', '', 'g'));
  if v_tool = '' then v_tool := 'unknown'; end if;
  if char_length(v_tool) > 32 then v_tool := left(v_tool, 32); end if;

  -- 同用户同一天串行，防并发多领
  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || current_date::text));

  select count(*) into v_used
    from public.fs_tool_credits
   where user_id = v_uid and day = current_date;

  if v_used >= v_limit then
    select active_value into v_bal from public.users where id = v_uid;
    return jsonb_build_object('ok', true, 'awarded', false, 'delta', 0,
      'used', v_used, 'limit', v_limit, 'amount', v_amount,
      'balance', v_bal, 'reason', 'daily_limit');
  end if;

  insert into public.fs_tool_credits (user_id, tool, amount, day, slot)
  values (v_uid, v_tool, v_amount, current_date, v_used + 1);

  update public.users
     set active_value = coalesce(active_value, 0) + v_amount
   where id = v_uid
  returning active_value into v_bal;

  return jsonb_build_object('ok', true, 'awarded', true, 'delta', v_amount,
    'used', v_used + 1, 'limit', v_limit, 'amount', v_amount,
    'balance', v_bal, 'tool', v_tool);
end;
$function$;

revoke all on function public.fs_tool_reward(text) from public;
grant execute on function public.fs_tool_reward(text) to authenticated;

-- ------------------------------------------------------------
-- 个人中心聚合：余额 / 签到 / 工具进度 / 等级
-- ------------------------------------------------------------
create or replace function public.fs_member_overview()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid      uuid;
  v_bal      numeric;
  v_last     date;
  v_streak   int;
  v_signed   boolean;
  v_next     numeric;
  v_used     int;
  v_earned   numeric;
  v_week     jsonb;
  v_recent   jsonb;
  v_days     int;
  v_tools    int;
  v_score    int;
  v_name     text;
  v_nextname text;
  v_need     int;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'need_login', true, 'msg', '未登录');
  end if;

  select coalesce(active_value, 0) into v_bal from public.users where id = v_uid;

  -- 签到状态（与 my_sign_status 同口径）
  select max(sign_date) into v_last from public.sign_ins where user_id = v_uid;
  v_signed := coalesce(v_last = current_date, false);

  if v_signed then
    select streak into v_streak from public.sign_ins
     where user_id = v_uid and sign_date = current_date;
  elsif v_last = current_date - 1 then
    select streak into v_streak from public.sign_ins
     where user_id = v_uid and sign_date = v_last;
  else
    v_streak := 0;
  end if;
  v_streak := coalesce(v_streak, 0);

  v_next := 5 + v_streak;
  if (v_streak + 1) % 7 = 0 then v_next := v_next + 10; end if;
  v_next := round(least(v_next, 20), 2);

  -- 今日工具积分
  select count(*), coalesce(sum(amount), 0) into v_used, v_earned
    from public.fs_tool_credits
   where user_id = v_uid and day = current_date;

  -- 最近 7 天签到格子（含今天）
  select jsonb_agg(jsonb_build_object(
           'date', d::date,
           'signed', exists (select 1 from public.sign_ins s
                              where s.user_id = v_uid and s.sign_date = d::date))
         order by d)
    into v_week
    from generate_series(current_date - 6, current_date, interval '1 day') d;

  -- 最近 5 条工具奖励
  select jsonb_agg(jsonb_build_object('tool', tool, 'amount', amount, 'at', created_at)
                   order by created_at desc)
    into v_recent
    from (select tool, amount, created_at from public.fs_tool_credits
           where user_id = v_uid order by created_at desc limit 5) t;

  -- 等级：纯荣誉，不锁任何功能，不影响积分收支
  select count(*) into v_days  from public.sign_ins       where user_id = v_uid;
  select count(*) into v_tools from public.fs_tool_credits where user_id = v_uid;
  v_score := coalesce(v_days, 0) + coalesce(v_tools, 0);

  if    v_score >= 100 then v_name := '元老';   v_nextname := null;
  elsif v_score >= 40  then v_name := '老朋友'; v_nextname := '元老';
  elsif v_score >= 15  then v_name := '熟客';   v_nextname := '老朋友';
  elsif v_score >= 5   then v_name := '常来';   v_nextname := '熟客';
  else                      v_name := '新面孔'; v_nextname := '常来';
  end if;

  v_need := case
    when v_name = '元老'   then 0
    when v_name = '老朋友' then 100 - v_score
    when v_name = '熟客'   then 40 - v_score
    when v_name = '常来'   then 15 - v_score
    else 5 - v_score
  end;

  return jsonb_build_object(
    'ok', true,
    'balance', v_bal,
    'sign', jsonb_build_object(
      'signed_today', v_signed,
      'streak', v_streak,
      'last_date', v_last,
      'next_delta', v_next,
      'week', coalesce(v_week, '[]'::jsonb)
    ),
    'tool', jsonb_build_object(
      'used', v_used,
      'limit', 3,
      'amount', 5,
      'earned', v_earned,
      'recent', coalesce(v_recent, '[]'::jsonb)
    ),
    'level', jsonb_build_object(
      'name', v_name,
      'score', v_score,
      'next', v_nextname,
      'need', greatest(v_need, 0)
    )
  );
end;
$function$;

revoke all on function public.fs_member_overview() from public;
grant execute on function public.fs_member_overview() to authenticated;

-- 新增 RPC 后 schema cache 有滞后，必须主动 reload
notify pgrst, 'reload schema';
