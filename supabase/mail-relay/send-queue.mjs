/* ============================================================
   FeSui 邮件队列 worker（GitHub Actions 定时任务 / 本地均可跑）

   为什么需要它：Supabase Edge Functions 禁止出站 25/587 端口，
   Deno Deploy 也不提供 TCP socket —— 函数里连不了新浪/QQ/163 的 SMTP。
   所以 Edge Function 只把待发邮件写进私有表 fs_mail_queue，
   由这个脚本在 GitHub Actions（或任意 Node 环境）里连 SMTP 发出。

   必需环境变量（都放 GitHub Repository Secrets，不要写进文件）：
     SUPABASE_SERVICE_ROLE_KEY  Supabase Dashboard → Project Settings → API → service_role
     SINA_SMTP_USER             完整邮箱地址，如 you@sina.com
     SINA_SMTP_PASS             16 位「客户端授权码」，不是网页登录密码

   可选：
     SMTP_HOST     默认 smtp.sina.com
     SMTP_PORT     默认 465
     SMTP_SECURE   默认 true（465 用 SSL；改 587 时设 false 走 STARTTLS）
     SMTP_FROM     默认等于 SINA_SMTP_USER（新浪要求发件地址与认证账号一致）
     MAIL_BATCH    单轮最多处理多少封，默认 50
     DRY_RUN       设为 1 时只打印认领数量、不发信也不改状态（用于本地验收）

   发信策略：逐封发送（To 只有收件人自己），天然不泄露订阅名单；
   成功调用 RPC fs_mail_mark_sent 回写状态并累加公告送达数；
   失败累计 5 次后标记 failed，不再重试，避免无限重发。
   ============================================================ */
import nodemailer from 'nodemailer';

// 允许自托管 / 本地联调时覆盖，但只放行 Supabase 官方域与本机地址，
// 避免 service_role key 被意外发到第三方服务器。
const SUPABASE_URL = (process.env.SUPABASE_URL ||
  'https://yowwyasttkywyqgseuqz.supabase.co').replace(/\/+$/, '');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) &&
    !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(SUPABASE_URL)) {
  console.error('SUPABASE_URL 不合法：只允许 *.supabase.co 或本机测试地址');
  process.exit(1);
}
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SMTP_USER = process.env.SINA_SMTP_USER || '';
const SMTP_PASS = process.env.SINA_SMTP_PASS || '';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.sina.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'true') !== 'false';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const DRY_RUN = process.env.DRY_RUN === '1';
const BATCH = Math.min(Math.max(Number(process.env.MAIL_BATCH || 50), 1), 200);

function need() {
  const miss = [];
  if (!KEY) miss.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!SMTP_USER) miss.push('SINA_SMTP_USER');
  if (!SMTP_PASS) miss.push('SINA_SMTP_PASS');
  if (!DRY_RUN && miss.length) {
    console.error('缺少环境变量：' + miss.join('、') + '（请在 GitHub Repository Secrets 中配置）');
    process.exit(1);
  }
  // DRY_RUN 仍需要 KEY 才能读队列；SMTP 凭据可以没有
  if (DRY_RUN && !KEY) {
    console.error('DRY_RUN 也需要 SUPABASE_SERVICE_ROLE_KEY 才能读队列');
    process.exit(1);
  }
}

async function sb(path, init = {}) {
  const headers = {
    apikey: KEY,
    Authorization: 'Bearer ' + KEY,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('REST ' + res.status + ': ' + txt.slice(0, 300));
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function heartbeat(fields) {
  await sb('fs_mail_worker?id=eq.1', {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(fields),
  });
}

async function main() {
  need();
  const now = () => new Date().toISOString();

  // 1) 先报心跳：只要任务跑起来，后台就能区分「代码就绪」和「Actions 真跑过」
  await heartbeat({ last_seen: now(), smtp_host: SMTP_HOST });
  console.log('worker 心跳已写入 · SMTP ' + SMTP_HOST + ':' + SMTP_PORT +
              (SMTP_SECURE ? ' (SSL)' : ' (STARTTLS)'));

  // 2) 认领待发队列
  const rows = await sb(
    'fs_mail_queue?select=id,announcement_id,email,subject,text_body,html_body,attempts' +
    '&status=eq.pending&attempts=lt.5&order=created_at.asc&limit=' + BATCH
  );
  const list = Array.isArray(rows) ? rows : [];
  console.log('本轮认领 ' + list.length + ' 封待发邮件');

  if (DRY_RUN) {
    console.log('[DRY_RUN] 不连接 SMTP、不发信、不改动队列状态');
    for (const r of list) console.log('  #' + r.id + ' → ' + r.email + ' | ' + r.subject);
    return;
  }

  // 3) 即使队列为空也验证一次 SMTP 连通性，方便首次配置时立刻发现问题
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2' },
  });
  try {
    await transport.verify();
    console.log('SMTP 连接验证通过 · 发件人 ' + SMTP_FROM);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e).slice(0, 400);
    await heartbeat({ last_error: msg });
    console.error('SMTP 连接失败：' + msg);
    console.error('排查：① 授权码是否为 16 位客户端授权码（不是登录密码）；' +
                  '② 网页版邮箱是否开启「客户端 POP/IMAP/SMTP」；' +
                  '③ 465 不通可改 SMTP_PORT=587 + SMTP_SECURE=false。');
    process.exit(1);
  }

  let sent = 0, failed = 0;
  for (const row of list) {
    try {
      await transport.sendMail({
        from: SMTP_FROM,
        to: row.email,
        subject: row.subject,
        text: row.text_body,
        html: row.html_body,
      });
      await sb('rpc/fs_mail_mark_sent', {
        method: 'POST',
        body: JSON.stringify({ p_id: row.id, p_ok: true }),
      });
      sent++;
      console.log('  ✓ #' + row.id + ' → ' + row.email);
    } catch (e) {
      failed++;
      const msg = String(e && e.message ? e.message : e).slice(0, 380);
      console.error('  ✗ #' + row.id + ' → ' + row.email + '：' + msg);
      try {
        await sb('rpc/fs_mail_mark_sent', {
          method: 'POST',
          body: JSON.stringify({ p_id: row.id, p_ok: false, p_error: msg }),
        });
      } catch (ackErr) {
        console.error('    回写失败状态也失败了：' + String(ackErr));
      }
    }
  }

  const tail = { last_error: failed ? (failed + ' 封发送失败，查看 Actions 日志') : null };
  if (sent > 0) { tail.last_ok = now(); }
  await heartbeat(tail);
  transport.close();
  console.log('完成：成功 ' + sent + ' 封，失败 ' + failed + ' 封（失败 5 次后停止重试）');
  if (failed > 0) process.exitCode = 1;
}

main().catch(e => {
  console.error('worker 异常：' + String(e && e.stack ? e.stack : e));
  process.exit(1);
});
