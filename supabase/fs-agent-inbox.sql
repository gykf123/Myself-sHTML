-- ============================================================
-- 「给 AI 的指令」收件箱 —— 管理员后台下发 / 定时任务每 12 小时取件执行
-- 项目：yowwyasttkywyqgseuqz
--
-- 私有表：RLS 开启但无 policy，且 revoke all from public/anon/authenticated，
-- 前端零权限；只有 Edge Function 的 service_role 能读写。
-- 认领必须是原子的（FOR UPDATE SKIP LOCKED），否则两次定时重叠会重复执行。
-- ============================================================

create table if not exists public.fs_agent_tasks (
  id               bigint generated always as identity primary key,
  body             text        not null,
  priority         text        not null default 'normal',
  status           text        not null default 'pending',
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  claimed_at       timestamptz,
  finished_at      timestamptz,
  result           text,
  attempts         integer     not null default 0,
  last_error       text,
  constraint fs_agent_body_len    check (char_length(body) between 1 and 4000),
  constraint fs_agent_priority_chk check (priority in ('normal', 'high')),
  constraint fs_agent_status_chk   check (status in ('pending','claimed','done','failed','cancelled'))
);

create index if not exists fs_agent_pending_idx
  on public.fs_agent_tasks (created_at) where status = 'pending';
create index if not exists fs_agent_status_idx
  on public.fs_agent_tasks (status, created_at desc);

-- 定时执行器的心跳：后台据此显示「上次检查 / 是否在线」
create table if not exists public.fs_agent_worker (
  id          integer primary key default 1,
  last_seen   timestamptz,
  last_ok     timestamptz,
  last_error  text,
  note        text,
  runs        integer not null default 0
);
insert into public.fs_agent_worker (id) values (1) on conflict (id) do nothing;

alter table public.fs_agent_tasks  enable row level security;
alter table public.fs_agent_worker enable row level security;

revoke all on public.fs_agent_tasks  from public, anon, authenticated;
revoke all on public.fs_agent_worker from public, anon, authenticated;

-- ---------- 原子认领 ----------
-- 先把「认领超过 2 小时仍未回写」的僵尸任务放回 pending，防止执行器崩了指令永久卡住。
-- 注意：UPDATE ... RETURNING 不保证返回顺序，子查询里的 ORDER BY 会被丢掉，
-- 所以先按「紧急优先 + 先提交优先」把 id 收进数组，最后用 unnest WITH ORDINALITY
-- 还原顺序返回，保证执行器拿到的第一条确实是优先级最高的那条。
create or replace function public.fs_agent_claim(p_limit int default 5)
returns setof public.fs_agent_tasks
language plpgsql security definer set search_path = public as $$
declare
  v_ids bigint[] := array[]::bigint[];
  r record;
begin
  update public.fs_agent_tasks
     set status = 'pending', claimed_at = null, updated_at = now()
   where status = 'claimed' and claimed_at < now() - interval '2 hours';

  for r in
    select id from public.fs_agent_tasks
     where status = 'pending'
     order by case priority when 'high' then 0 else 1 end, created_at asc
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 5), 20))
  loop
    v_ids := array_append(v_ids, r.id);
  end loop;

  if array_length(v_ids, 1) is null then return; end if;

  update public.fs_agent_tasks
     set status = 'claimed', claimed_at = now(), updated_at = now(),
         attempts = attempts + 1
   where id = any(v_ids);

  return query
    select t.* from unnest(v_ids) with ordinality as o(id, ord)
    join public.fs_agent_tasks t on t.id = o.id
    order by o.ord;
end $$;

-- ---------- 回写执行结果 ----------
create or replace function public.fs_agent_finish(
  p_id bigint, p_ok boolean, p_result text, p_error text
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.fs_agent_tasks
     set status = case when p_ok then 'done' else 'failed' end,
         finished_at = now(), updated_at = now(),
         result = nullif(left(coalesce(p_result, ''), 8000), ''),
         last_error = nullif(left(coalesce(p_error, ''), 2000), '')
   where id = p_id and status = 'claimed';
  return found;
end $$;

-- ---------- 心跳 ----------
create or replace function public.fs_agent_heartbeat(p_note text, p_ok boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.fs_agent_worker (id, last_seen, last_ok, last_error, note, runs)
  values (1, now(), case when p_ok then now() else null end,
          case when p_ok then null else left(coalesce(p_note, ''), 2000) end,
          left(coalesce(p_note, ''), 500), 1)
  on conflict (id) do update set
    last_seen = now(),
    last_ok = case when p_ok then now() else public.fs_agent_worker.last_ok end,
    last_error = case when p_ok then null else left(coalesce(p_note, ''), 2000) end,
    note = left(coalesce(p_note, ''), 500),
    runs = public.fs_agent_worker.runs + 1;
end $$;

revoke all on function public.fs_agent_claim(int) from public, anon, authenticated;
revoke all on function public.fs_agent_finish(bigint, boolean, text, text) from public, anon, authenticated;
revoke all on function public.fs_agent_heartbeat(text, boolean) from public, anon, authenticated;
grant execute on function public.fs_agent_claim(int) to service_role;
grant execute on function public.fs_agent_finish(bigint, boolean, text, text) to service_role;
grant execute on function public.fs_agent_heartbeat(text, boolean) to service_role;

notify pgrst, 'reload schema';
