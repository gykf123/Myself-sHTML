-- ============================================================
--  fs-mail-queue：GitHub Actions 邮件发送队列（2026-11-08）
--  项目：yowwyasttkywyqgseuqz
--
--  背景：Supabase Edge Functions 禁止出站 25/587 端口，Deno Deploy 也不提供
--  TCP socket，函数里无法直连新浪 / QQ / 163 的 SMTP。因此改异步队列：
--    fs-notify(announce/mail_test) 只负责把待发邮件塞进私有表
--    → GitHub Actions 定时任务（仓库 .github/workflows/mail-queue.yml）
--      用 nodemailer 连 SMTP 发出
--    → 调用 RPC fs_mail_mark_sent 回写状态并累加公告的 mailed_count
--
--  全部 fs_ 前缀、幂等，绝不 drop / alter 任何既有对象。
--  权限：队列表与心跳表完全私有（RLS 无 policy、revoke all），
--        只有 service_role（即 GitHub Actions 脚本）能读写。
--  执行后必须 notify pgrst 刷新 schema cache。
-- ============================================================

-- 1) 待发队列：一封邮件一行，逐封发送天然不暴露订阅名单
create table if not exists public.fs_mail_queue (
  id              bigint generated always as identity primary key,
  announcement_id bigint,                          -- null = 测试邮件
  email           text not null,
  subject         text not null,
  text_body       text not null,
  html_body       text not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'sent', 'failed')),
  attempts        integer not null default 0,
  error           text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  constraint fs_mail_queue_email_format
    check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- 同一公告 + 同一邮箱只入队一次（重发公告不会产生重复邮件）
create unique index if not exists fs_mail_queue_ann_email_key
  on public.fs_mail_queue (announcement_id, email);
create index if not exists fs_mail_queue_pending_idx
  on public.fs_mail_queue (status, created_at) where status = 'pending';

-- 2) 发信 worker 心跳：让后台能如实区分「代码就绪」与「Actions 真的跑过」
create table if not exists public.fs_mail_worker (
  id          integer primary key default 1 check (id = 1),
  last_seen   timestamptz,
  last_ok     timestamptz,
  last_error  text,
  smtp_host   text
);
insert into public.fs_mail_worker (id) values (1)
  on conflict (id) do nothing;

-- 3) 回写 RPC：一次调用同时更新队列状态与公告送达数（原子，避免并发重复累加）
create or replace function public.fs_mail_mark_sent(
  p_id bigint, p_ok boolean, p_error text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_ann bigint := null;
begin
  if p_ok then
    update public.fs_mail_queue
       set status = 'sent', sent_at = now(), error = null, attempts = attempts + 1
     where id = p_id and status = 'pending'
     returning announcement_id into v_ann;
    if v_ann is not null then
      update public.fs_announcements
         set mailed_count = mailed_count + 1, mailed_at = now()
       where id = v_ann;
    end if;
  else
    update public.fs_mail_queue
       set attempts = attempts + 1,
           status = case when attempts + 1 >= 5 then 'failed' else 'pending' end,
           error = left(coalesce(p_error, 'send failed'), 500)
     where id = p_id and status = 'pending';
  end if;
end $$;

-- 4) RLS + 最小权限（先清干净再授，避免残留 policy）
alter table public.fs_mail_queue enable row level security;
alter table public.fs_mail_worker enable row level security;

do $$
declare t text; p record;
begin
  foreach t in array array['fs_mail_queue','fs_mail_worker'] loop
    for p in select policyname from pg_policies
             where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- 函数默认 EXECUTE 是给 public 的，必须撤掉再只给 service_role
revoke all on function public.fs_mail_mark_sent(bigint, boolean, text)
  from public, anon, authenticated;
grant execute on function public.fs_mail_mark_sent(bigint, boolean, text)
  to service_role;

-- 5) PostgREST schema cache（历史踩过 PGRST202，新对象必须刷新）
notify pgrst, 'reload schema';
