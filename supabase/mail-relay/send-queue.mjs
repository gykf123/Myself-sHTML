/* ============================================================
   FeSui 邮件队列 worker（GitHub Actions 定时任务 / 本地均可跑）

   背景：Supabase Edge Functions 禁止出站 25/587、Deno Deploy 无 TCP socket，
   早期方案是「函数入队 → Actions 连新浪 SMTP 发出」。但实测自发自收会被
   收件方静默丢弃（队列显示 sent，用户却收不到），已改为 fs-notify 直接用
   Resend HTTPS API 直发。本 worker 保留为兜底：处理队列里残留的待发邮件，
   默认同样走 Resend，显式设 MAIL_PROVIDER=smtp 才回退到旧 SMTP 通道。

   必需环境变量（都放 GitHub Repository Secrets，不要写进文件）：
     SUPABASE_SERVICE_ROLE_KEY  Supabase → Project Settings → API → service_role
     RESEND_API_KEY             Resend 发信 key（默认通道必需）

   仅 MAIL_PROVIDER=smtp 时需要：
     SINA_SMTP_USER             完整邮箱地址，如 you@sina.com
     SINA_SMTP_PASS             16 位「客户端授权码」，不是网页登录密码

   可选：
     MAIL_PROVIDER  默认 resend；设 smtp 走旧通道
     FS_MAIL_FROM   默认 FeSui 项目公告 <onboarding@resend.dev>；自有域名在
                    Resend 验证通过后改成 notify@自有域名 即可，代码不用动
     SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_FROM  旧 SMTP 通道参数
     MAIL_BATCH     单轮最多处理多少封，默认 50
     DRY_RUN        设为 1 时只打印认领数量、不发信也不改状态（用于本地验收）

   发信策略：逐封发送（To 只有收件人自己），天然不泄露订阅名单；
   成功调用 RPC fs_mail_mark_sent 回写状态并累加公告送达数；
   失败累计 5 次后标记 failed，不再重试，避免无限重发。
   ============================================================ */
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';

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
const MAIL_PROVIDER = (process.env.MAIL_PROVIDER || 'resend').trim().toLowerCase();
const USE_RESEND = MAIL_PROVIDER !== 'smtp';
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.FS_MAIL_FROM || 'FeSui 项目公告 <onboarding@resend.dev>';
const SITE_URL = 'https://fesui.xn--0iv.gay';
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
  if (!DRY_RUN && USE_RESEND && !RESEND_KEY) miss.push('RESEND_API_KEY');
  if (!DRY_RUN && !USE_RESEND) {
    if (!SMTP_USER) miss.push('SINA_SMTP_USER');
    if (!SMTP_PASS) miss.push('SINA_SMTP_PASS');
  }
  if (miss.length) {
    console.error('缺少环境变量：' + miss.join('、') + '（请在 GitHub Repository Secrets 中配置）');
    process.exit(1);
  }
  // DRY_RUN 仍需要 KEY 才能读队列；发信凭据可以没有
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

/* 单封发送：Resend 走 HTTPS API（默认），SMTP 是旧通道兜底。
   Resend 前面的 CDN 会拦无浏览器风格 UA 的请求（403 error code 1010），
   所以 User-Agent 必须显式带。 */
async function sendOne(row, transport) {
  if (USE_RESEND) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_KEY,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; FeSuiMailWorker/1.0)',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [row.email],
        subject: row.subject,
        text: row.text_body,
        html: row.html_body,
        headers: {
          'List-Unsubscribe': '<' + SITE_URL + '/user/>',
        },
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('Resend ' + r.status + ': ' + t.slice(0, 300));
    }
    return;
  }
  await transport.sendMail({
    from: { name: 'FeSui 项目公告', address: SMTP_FROM },
    to: row.email,
    subject: row.subject,
    text: row.text_body,
    html: row.html_body,
    // nodemailer 默认用本机 hostname 拼 Message-ID 的域名部分；在 GitHub
    // Actions runner 上是随机主机名，容易被收件方当垃圾。改用自有域名。
    messageId: '<' + randomUUID() + '@fesui.xn--0iv.gay>',
    headers: {
      'List-Unsubscribe': '<' + SITE_URL + '/user/>',
    },
  });
}

async function main() {
  need();
  const now = () => new Date().toISOString();
  const channel = USE_RESEND ? 'Resend HTTPS API' : 'SMTP ' + SMTP_HOST + ':' + SMTP_PORT;

  // 1) 先报心跳：只要任务跑起来，后台就能区分「代码就绪」和「Actions 真跑过」
  await heartbeat({ last_seen: now(), smtp_host: USE_RESEND ? 'resend-https-api' : SMTP_HOST });
  console.log('worker 心跳已写入 · 通道 ' + channel);

  // 2) 认领待发队列
  const rows = await sb(
    'fs_mail_queue?select=id,announcement_id,email,subject,text_body,html_body,attempts' +
    '&status=eq.pending&attempts=lt.5&order=created_at.asc&limit=' + BATCH
  );
  const list = Array.isArray(rows) ? rows : [];
  console.log('本轮认领 ' + list.length + ' 封待发邮件');

  if (DRY_RUN) {
    console.log('[DRY_RUN] 不连接发信服务、不发信、不改动队列状态');
    for (const r of list) console.log('  #' + r.id + ' → ' + r.email + ' | ' + r.subject);
    return;
  }

  // 3) 旧 SMTP 通道即使队列为空也验证一次连通性；Resend 是纯 HTTPS，
  //    没有可 verify 的长连接，真实错误在发信时才暴露（sending-only key
  //    也没有 /domains 读权限，不能靠查域名列表做「假连通性检查」）。
  let transport = null;
  if (!USE_RESEND) {
    transport = nodemailer.createTransport({
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
  } else {
    console.log('Resend 通道 · 发件人 ' + RESEND_FROM);
  }

  let sent = 0, failed = 0;
  for (const row of list) {
    try {
      await sendOne(row, transport);
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
  if (transport) transport.close();
  console.log('完成：成功 ' + sent + ' 封，失败 ' + failed + ' 封（失败 5 次后停止重试）');
  if (failed > 0) process.exitCode = 1;
}

main().catch(e => {
  console.error('worker 异常：' + String(e && e.stack ? e.stack : e));
  process.exit(1);
});
