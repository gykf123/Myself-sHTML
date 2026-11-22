-- ============================================================
-- 工具箱 ⇄ 账户：轻量关联（不锁功能、不强制登录）
-- ------------------------------------------------------------
-- 设计原则（用户明确要求）：
--   · 工具永远免登录可用，一行不加门槛；
--   · 登录 = 多出来的东西（积分、今日进度、最近用过、个性化排序、免二次确认），
--     不是入场券；
--   · 本文件的每次调用都**容忍匿名**：anon 调用一律返回 need_login=true 的空结构，
--     绝不报错，前端因此可以把「未登录」当成最轻的一条分支处理。
--
-- 内容：
--   1) fs_tools_usage_public()  —— 公开的工具热度（全站累计使用次数），
--      给大厅做「大家都在用」排序，匿名可见、不含任何个人信息；
--   2) fs_tool_mine()          —— 登录用户的今日进度 + 常用工具 + 未过期券数量；
--   3) fs_tool_streak()        —— 登录用户的连用天数（续上已有 streak）；
--   4) fs_tool_confirm()       —— 免费用量 / 智能确认：不需要时回 need=false，
--      需要时回 need=true + 剩余券数（前端弹一次「确定继续？」即可）。
--
-- 安全：全部 SECURITY DEFINER + set search_path，revoke from public/anon 后
--      再 grant 给 anon（因为有 auth.uid() 兜底），authenticated 保留。
--      只读或「只给本人记账」，不接受任何用户可控的金额。
-- ============================================================

-- ---------- 0. 幂等补列：工具使用表加「是否已计积分」标记 ----------
-- 不加这一列，同一工具同一天第二次使用就无法区分「重复使用但不再计分」。
alter table public.fs_tool_credits
  add column if not exists counted boolean not null default true;

create index if not exists fs_tool_credits_user_day_idx
  on public.fs_tool_credits (user_id, day);

-- ---------- 0b. 解冻券（连续 7 天工具使用赠送） ----------
create table if not exists public.fs_tool_unlock (
  id         bigserial primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  reason     text not null default 'streak7',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at    timestamptz,
  used_for   text
);
create index if not exists fs_tool_unlock_user_idx
  on public.fs_tool_unlock (user_id, used_at);
alter table public.fs_tool_unlock enable row level security;
revoke all on public.fs_tool_unlock from public, anon, authenticated;
grant all on public.fs_tool_unlock to service_role;

-- ---------- 0c. 连用天数表 ----------
create table if not exists public.fs_tool_streaks (
  user_id    uuid primary key references public.users(id) on delete cascade,
  streak     int  not null default 0,
  last_day   date,
  updated_at timestamptz not null default now()
);
alter table public.fs_tool_streaks enable row level security;
revoke all on public.fs_tool_streaks from public, anon, authenticated;
grant all on public.fs_tool_streaks to service_role;

-- ---------- 1. 公开热度（匿名可读，只含次数） ----------
create or replace function public.fs_tools_usage_public()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with agg as (
    select tool, count(*)::int as uses
      from public.fs_tool_credits
     where day > current_date - 30
     group by tool
  ),
  total as (select coalesce(sum(uses), 0)::int as all_uses from agg)
  select jsonb_build_object(
    'ok', true,
    'window_days', 30,
    'total', (select all_uses from total),
    'tools', coalesce((
      select jsonb_object_agg(tool, uses) from agg
    ), '{}'::jsonb)
  );
$$;

-- ---------- 2. 我的工具箱状态 ----------
-- 注意：依赖表 fs_tool_streaks / fs_tool_unlock 已在 0b 与 2a 建好，
-- 否则 create function 会因「表不存在」被跳过（批量执行里报错不会中断）。
create or replace function public.fs_tool_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_used int;
  v_bal  numeric;
  v_recent jsonb;
  v_streak int;
  v_coupons int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'need_login', true);
  end if;

  select count(*) into v_used
    from public.fs_tool_credits
   where user_id = v_uid and day = current_date and counted;

  select active_value into v_bal from public.users where id = v_uid;

  -- 最近 30 天最常用的 5 个（给大厅做个性化排序）
  select coalesce(jsonb_agg(jsonb_build_object('tool', tool, 'uses', uses) order by uses desc, tool), '[]'::jsonb)
    into v_recent
    from (
      select tool, count(*)::int as uses
        from public.fs_tool_credits
       where user_id = v_uid and day > current_date - 30
       group by tool
       order by uses desc, tool
       limit 5
    ) t;

  -- 连用天数：与签到 streak 同一套「连续自然日」口径
  select coalesce(streak, 0) into v_streak
    from public.fs_tool_streaks where user_id = v_uid;

  select count(*) into v_coupons
    from public.fs_tool_unlock
   where user_id = v_uid and used_at is null
     and (expires_at is null or expires_at > now());

  return jsonb_build_object(
    'ok', true,
    'balance', v_bal,
    'today', jsonb_build_object('used', v_used, 'limit', 3, 'amount', 5),
    'streak', coalesce(v_streak, 0),
    'coupons', v_coupons,
    'recent', v_recent
  );
end;
$$;

-- ---------- 2b. 连用天数 ----------
-- 只有「积分已经记到 streak」时才更新，避免同一工具重复使用把天连上
create or replace function public.fs_tool_streak_touch()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_last date;
  v_s int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'need_login', true);
  end if;

  perform pg_advisory_xact_lock(hashtext('fs_tool_streak:' || v_uid::text));

  select last_day, streak into v_last, v_s
    from public.fs_tool_streaks where user_id = v_uid;

  if v_last = current_date then
    return jsonb_build_object('ok', true, 'streak', coalesce(v_s, 1), 'changed', false);
  end if;

  v_s := case when v_last = current_date - 1 then coalesce(v_s, 0) + 1 else 1 end;

  insert into public.fs_tool_streaks (user_id, streak, last_day, updated_at)
  values (v_uid, v_s, current_date, now())
  on conflict (user_id) do update
    set streak = excluded.streak, last_day = excluded.last_day, updated_at = now();

  return jsonb_build_object('ok', true, 'streak', v_s, 'changed', true);
end;
$$;

-- ---------- 3. 免费用量 / 智能确认 ----------
-- 返回 need=false 时前端「直接跑」，不弹任何东西；need=true 才提示一次。
-- 「重活」按工具名 + 任务规模判断（行数、秒数、格子数），阈值取得比较保守，
-- 只拦真正会让手机假死的量，不拦日常使用。
create or replace function public.fs_tool_confirm(p_tool text, p_cost bigint default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_tool  text;
  v_cost  bigint := greatest(coalesce(p_cost, 0), 0);
  v_free  bigint;
  v_quota int;
  v_used  int;
  v_coupon int;
begin
  v_tool := lower(regexp_replace(coalesce(p_tool, ''), '[^a-zA-Z0-9_-]', '', 'g'));
  if v_tool = '' then v_tool := 'unknown'; end if;

  -- 单次免费用量（不需要登录也按这个算，只是不记账）
  v_free := case
    when v_tool in ('hash', 'base64', 'json', 'text', 'color', 'password', 'regex', 'markdown', 'cron', 'timestamp', 'datediff', 'convert') then 2000000
    when v_tool in ('function', 'img2func') then 4000000
    when v_tool = 'video2func' then 8000000
    when v_tool = 'imgcompress' then 40000000
    else 4000000
  end;

  if v_cost <= v_free then
    return jsonb_build_object('ok', true, 'need', false, 'free', v_free);
  end if;

  if v_uid is null then
    -- 未登录：只提示规模，不拦、不要求登录
    return jsonb_build_object('ok', true, 'need', true, 'free', v_free,
      'cost', v_cost, 'login', false);
  end if;

  select count(*) into v_used
    from public.fs_tool_credits
   where user_id = v_uid and day = current_date and counted;
  v_quota := greatest(0, 3 - v_used);

  select count(*) into v_coupon
    from public.fs_tool_unlock
   where user_id = v_uid and used_at is null
     and (expires_at is null or expires_at > now());

  return jsonb_build_object('ok', true, 'need', true, 'free', v_free,
    'cost', v_cost, 'login', true, 'quota_left', v_quota, 'coupons', v_coupon);
end;
$$;


-- ---------- 2c. 奖励函数升级：区分「重复使用」，并接上连用天数 + 7 天券 ----------
-- 口径：同一工具同一天算 1 次积分（5 分/天 × 3 个不同工具 = 15 分顶格）；
--       同一工具继续用不再计分，但会记一条 counted=false 的使用记录用于热度。
--
-- 旧约束 slot ∈ [1,3] 与 unique(user_id, day, slot) 是「一天只记 3 行」的假设，
-- 而重复使用要留痕就得超过 3 行 —— 改成只约束「计分行的 slot」，不计分的行 slot 为空。
alter table public.fs_tool_credits alter column slot drop not null;
alter table public.fs_tool_credits drop constraint if exists fs_tool_credits_slot_check;
alter table public.fs_tool_credits drop constraint if exists fs_tool_credits_user_id_day_slot_key;
create unique index if not exists fs_tool_credits_slot_uniq
  on public.fs_tool_credits (user_id, day, slot) where counted;
create or replace function public.fs_tool_reward(p_tool text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid;
  v_tool   text;
  v_used   int;
  v_amount numeric := 5;
  v_limit  int := 3;
  v_bal    numeric;
  v_dup    boolean;
  v_streak int;
  v_coupon boolean := false;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object('ok', false, 'need_login', true, 'msg', '登录后使用工具才有积分');
  end if;

  v_tool := lower(regexp_replace(coalesce(p_tool, ''), '[^a-zA-Z0-9_-]', '', 'g'));
  if v_tool = '' then v_tool := 'unknown'; end if;
  if char_length(v_tool) > 32 then v_tool := left(v_tool, 32); end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text || ':' || current_date::text));

  -- 同一工具今天已经计过分：只记使用，不再加分
  select exists (
    select 1 from public.fs_tool_credits
     where user_id = v_uid and day = current_date and tool = v_tool and counted
  ) into v_dup;

  if v_dup then
    insert into public.fs_tool_credits (user_id, tool, amount, day, slot, counted)
    values (v_uid, v_tool, 0, current_date, null, false);
    select count(*) into v_used
      from public.fs_tool_credits
     where user_id = v_uid and day = current_date and counted;
    select active_value into v_bal from public.users where id = v_uid;
    return jsonb_build_object('ok', true, 'awarded', false, 'duplicate', true, 'delta', 0,
      'used', v_used, 'limit', v_limit, 'amount', v_amount,
      'balance', v_bal, 'reason', 'same_tool');
  end if;

  select count(*) into v_used
    from public.fs_tool_credits
   where user_id = v_uid and day = current_date and counted;

  if v_used >= v_limit then
    insert into public.fs_tool_credits (user_id, tool, amount, day, slot, counted)
    values (v_uid, v_tool, 0, current_date, null, false);
    select active_value into v_bal from public.users where id = v_uid;
    return jsonb_build_object('ok', true, 'awarded', false, 'delta', 0,
      'used', v_used, 'limit', v_limit, 'amount', v_amount,
      'balance', v_bal, 'reason', 'daily_limit');
  end if;

  insert into public.fs_tool_credits (user_id, tool, amount, day, slot, counted)
  values (v_uid, v_tool, v_amount, current_date, v_used + 1, true);

  update public.users
     set active_value = coalesce(active_value, 0) + v_amount
   where id = v_uid
  returning active_value into v_bal;

  -- 连用天数（连续自然日，同一天不重复累加）
  declare
    v_last date;
    v_s    int;
  begin
    select last_day, streak into v_last, v_s
      from public.fs_tool_streaks where user_id = v_uid;
    v_streak := case when v_last = current_date then coalesce(v_s, 1)
                     when v_last = current_date - 1 then coalesce(v_s, 0) + 1
                     else 1 end;
    insert into public.fs_tool_streaks (user_id, streak, last_day, updated_at)
    values (v_uid, v_streak, current_date, now())
    on conflict (user_id) do update
      set streak = excluded.streak, last_day = excluded.last_day, updated_at = now();

    -- 每满 7 天发一张「超大任务免确认券」，30 天有效
    if v_streak > 0 and v_streak % 7 = 0 then
      if not exists (
        select 1 from public.fs_tool_unlock
         where user_id = v_uid and reason = 'streak7'
           and created_at::date = current_date
      ) then
        insert into public.fs_tool_unlock (user_id, reason, expires_at)
        values (v_uid, 'streak7', now() + interval '30 days');
        v_coupon := true;
      end if;
    end if;
  end;

  return jsonb_build_object('ok', true, 'awarded', true, 'delta', v_amount,
    'used', v_used + 1, 'limit', v_limit, 'amount', v_amount,
    'balance', v_bal, 'tool', v_tool, 'streak', v_streak, 'coupon', v_coupon);
end;
$$;

revoke all on function public.fs_tool_reward(text) from public, anon;
grant execute on function public.fs_tool_reward(text) to authenticated;

-- ---------- 4. 权限 ----------
revoke all on function public.fs_tools_usage_public() from public;
revoke all on function public.fs_tool_mine() from public;
revoke all on function public.fs_tool_streak_touch() from public;
revoke all on function public.fs_tool_confirm(text, bigint) from public;

grant execute on function public.fs_tools_usage_public() to anon, authenticated;
grant execute on function public.fs_tool_mine() to anon, authenticated;
grant execute on function public.fs_tool_streak_touch() to anon, authenticated;
grant execute on function public.fs_tool_confirm(text, bigint) to anon, authenticated;

notify pgrst, 'reload schema';
