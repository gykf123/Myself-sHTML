-- ============================================================
-- fs-sandbox.sql — 小小沙盒在线版：联机权限（1 积分解锁）
-- ------------------------------------------------------------
-- 设计约束：
--   · 只新增 fs_ 对象，不 drop / alter 任何既有对象，幂等可重复执行；
--   · 单人模式免登录，只有「联机」需要登录 + 1 积分解锁；
--   · 解锁一次性：扣过就不再扣，重复调用只返回已解锁；
--   · 扣费与写入解锁记录在同一函数里，advisory lock 串行防并发双扣；
--   · 解锁记录表 RLS 无 policy + revoke，前端一条都读不到，只走 RPC；
--   · RPC 默认 EXECUTE 给 PUBLIC，必须收回后只授权 authenticated。
-- ============================================================

create table if not exists public.fs_sandbox_unlock (
  user_id     uuid primary key references public.users(id) on delete cascade,
  cost        numeric(12,2) not null default 1,
  unlocked_at timestamptz not null default now()
);

alter table public.fs_sandbox_unlock enable row level security;
revoke all on public.fs_sandbox_unlock from public;
revoke all on public.fs_sandbox_unlock from anon, authenticated;
grant all on public.fs_sandbox_unlock to service_role;

-- ------------------------------------------------------------
-- 状态查询：未登录 / 余额 / 是否已解锁 / 单价
-- 返回：{ok, need_login, logged, unlocked, balance, cost}
-- ------------------------------------------------------------
create or replace function public.fs_sandbox_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_bal numeric;
  v_unlocked boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', true, 'need_login', true, 'logged', false,
      'unlocked', false, 'balance', 0, 'cost', 1);
  end if;

  select coalesce(active_value, 0) into v_bal from public.users where id = v_uid;
  select exists(select 1 from public.fs_sandbox_unlock where user_id = v_uid) into v_unlocked;

  return jsonb_build_object('ok', true, 'need_login', false, 'logged', true,
    'unlocked', coalesce(v_unlocked, false), 'balance', coalesce(v_bal, 0), 'cost', 1);
end;
$function$;

revoke all on function public.fs_sandbox_status() from public, anon;
grant execute on function public.fs_sandbox_status() to authenticated;

-- ------------------------------------------------------------
-- 解锁：原子扣 1 积分并写入解锁记录
-- 返回：{ok, unlocked, balance, cost, reason?}
-- reason: not_logged_in / insufficient / already_unlocked
-- ------------------------------------------------------------
create or replace function public.fs_sandbox_unlock()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_bal numeric;
  v_unlocked boolean;
  v_cost numeric := 1;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'unlocked', false, 'balance', 0,
      'cost', v_cost, 'reason', 'not_logged_in');
  end if;

  -- 同一用户串行，防并发双扣
  perform pg_advisory_xact_lock(hashtext('fs_sandbox:' || v_uid::text));

  select exists(select 1 from public.fs_sandbox_unlock where user_id = v_uid) into v_unlocked;
  if v_unlocked then
    select coalesce(active_value, 0) into v_bal from public.users where id = v_uid;
    return jsonb_build_object('ok', true, 'unlocked', true, 'balance', coalesce(v_bal, 0),
      'cost', v_cost, 'reason', 'already_unlocked');
  end if;

  select coalesce(active_value, 0) into v_bal from public.users where id = v_uid;
  if coalesce(v_bal, 0) < v_cost then
    return jsonb_build_object('ok', false, 'unlocked', false, 'balance', coalesce(v_bal, 0),
      'cost', v_cost, 'reason', 'insufficient');
  end if;

  update public.users
     set active_value = active_value - v_cost
   where id = v_uid
  returning coalesce(active_value, 0) into v_bal;

  insert into public.fs_sandbox_unlock (user_id, cost)
  values (v_uid, v_cost);

  return jsonb_build_object('ok', true, 'unlocked', true, 'balance', coalesce(v_bal, 0),
    'cost', v_cost);
end;
$function$;

revoke all on function public.fs_sandbox_unlock() from public, anon;
grant execute on function public.fs_sandbox_unlock() to authenticated;

notify pgrst, 'reload schema';
