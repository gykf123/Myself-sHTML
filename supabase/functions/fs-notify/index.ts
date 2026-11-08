// ============================================================
// fs-notify — 邮箱绑定 / 订阅名单 / 项目公告 / 邮件发送
// 项目：yowwyasttkywyqgseuqz（Deno Edge Functions）
//
// 设计要点：
//   · user_id 一律只信本站 JWT 的 sub，前端传什么都不生效；
//   · fs_email_subscriptions / fs_mail_queue 前端零权限（RLS 无 policy），
//     只走本函数 service_role；
//   · 默认通道 = queue（GitHub Actions 异步队列）。Supabase Edge Functions
//     禁止出站 25/587 且 Deno Deploy 无 TCP socket，函数内无法直连 SMTP，
//     所以只把待发邮件写入私有队列表，由仓库的 mail-queue.yml 定时发出。
//     显式设置 FS_MAIL_PROVIDER=resend 可切回 Resend HTTP API，
//     设为 none 则只发站内公告（不发信也不假装发过）；
//   · ready 由 fs_mail_worker 心跳决定：代码就绪 ≠ Actions 真的跑过，
//     后台必须如实区分这两种状态；
//   · verified 字段是预留位：当前不做验证码，故群发不按 verified 过滤。
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PROVIDER = (Deno.env.get('FS_MAIL_PROVIDER') || 'queue').trim().toLowerCase()
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || ''
const MAIL_FROM = Deno.env.get('FS_MAIL_FROM') || ''
const SITE_URL = 'https://fesui.xn--0iv.gay'
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] || c))
}

function providerLabel(): string {
  if (PROVIDER === 'queue') return 'GitHub Actions 队列 · SMTP'
  if (PROVIDER === 'resend') return 'Resend HTTP API'
  return '未配置'
}
function mailConfigured(): boolean {
  return PROVIDER === 'queue' || (PROVIDER === 'resend' && RESEND_KEY.length > 0)
}

/* ---------- 本站 JWT 验签（HS256 + base64url，与 login/_shared/jwt.ts 一致） ---------- */
async function hmacSha256(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const ck = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', ck, enc.encode(msg)))
  return btoa(String.fromCharCode(...sig))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  // atob() 返回字节字符串，UTF-8 中文需显式解码，否则 payload 里中文变 mojibake
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function verifySiteJwt(token: string): Promise<{ sub: string; username: string } | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(b64urlDecode(parts[1]))
    if (!payload || !payload.sub || !payload.exp || payload.exp * 1000 <= Date.now()) return null
    const candidates = [
      Deno.env.get('JWT_SECRET'),
      Deno.env.get('SUPABASE_JWT_SECRET'),
      SERVICE_KEY,
    ].filter(Boolean) as string[]
    for (const secret of candidates) {
      if ((await hmacSha256(secret, parts[0] + '.' + parts[1])) === parts[2]) {
        return { sub: payload.sub, username: payload.username || '' }
      }
    }
    return null // 签名不匹配一律拒绝，绝不降级
  } catch { return null }
}

async function isAdmin(uid: string): Promise<boolean> {
  const { data } = await db.from('users').select('role').eq('id', uid).limit(1)
  return !!(data && data[0] && data[0].role === 'admin')
}

/* ---------- 邮件模板 ------------------------------------------------------
   邮件客户端不认 flex/grid/CSS 变量/外链样式，一律 table 布局 + 内联样式；
   纯色背景打底、渐变只作增强（不支持的客户端自动退回纯色）。
   所有用户可控文本（标题 / 正文）统一先 esc()，绝不拼进未经转义的 HTML。
   ------------------------------------------------------------------------ */
function paraHtml(raw: string): string {
  // 先转义，再分段；段内单换行保留为 <br>，避免一整段挤成一条长线
  return esc(raw).split(/\n{2,}/).map(p =>
    '<p style="margin:0 0 14px;font-size:15px;line-height:1.85;color:#374151;">' +
    p.replace(/\n/g, '<br />') + '</p>',
  ).join('')
}

function mailHtml(o: { eyebrow: string; title: string; body: string;
                       ctaText?: string; ctaHref?: string }): string {
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())
  const home = SITE_URL + '/'
  const blog = SITE_URL + '/blog/'
  const user = SITE_URL + '/user/'
  const cta = o.ctaHref
    ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px;"><tr>' +
      '<td align="center" style="background:#4f46e5;border-radius:9px;">' +
      '<a href="' + esc(o.ctaHref) + '" target="_blank" rel="noopener noreferrer" ' +
      'style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;' +
      'font-weight:600;text-decoration:none;">' + esc(o.ctaText || '查看详情') + ' →</a>' +
      '</td></tr></table>'
    : ''
  return '<!DOCTYPE html><html lang="zh-CN"><head>' +
    '<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />' +
    '<title>' + esc(o.title) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f3f4f6;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="background:#f3f4f6;padding:28px 12px;"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" ' +
    'style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;' +
    'overflow:hidden;box-shadow:0 4px 18px rgba(20,24,40,.08);' +
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'PingFang SC\',\'Microsoft YaHei\',sans-serif;">' +
      // 顶部品牌条
      '<tr><td style="padding:26px 32px;background:#4f46e5;' +
      'background-image:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);color:#ffffff;">' +
      '<div style="font-size:20px;font-weight:700;letter-spacing:.5px;">' +
      '<span style="display:inline-block;width:9px;height:9px;margin-right:9px;' +
      'border-radius:50%;background:#ffffff;vertical-align:middle;"></span>FeSui</div>' +
      '<div style="font-size:12px;opacity:.88;margin-top:5px;">项目公告 · 站点更新通知</div>' +
      '</td></tr>' +
      // 标签 / 标题 / 日期
      '<tr><td style="padding:30px 32px 0;">' +
      '<div style="display:inline-block;padding:5px 12px;border-radius:20px;' +
      'background:#eef2ff;color:#4f46e5;font-size:12px;font-weight:600;">' +
      esc(o.eyebrow) + '</div>' +
      '<h1 style="margin:16px 0 8px;font-size:23px;line-height:1.45;' +
      'font-weight:700;color:#111827;">' + esc(o.title) + '</h1>' +
      '<div style="font-size:12px;color:#9ca3af;">' + esc(date) + '（北京时间）</div>' +
      '<div style="margin-top:22px;height:1px;background:#eef0f3;"></div>' +
      '</td></tr>' +
      // 正文
      '<tr><td style="padding:22px 32px 6px;">' + paraHtml(o.body) + '</td></tr>' +
      // 按钮
      (cta ? '<tr><td style="padding:8px 32px 30px;">' + cta + '</td></tr>' : '') +
      // 页脚
      '<tr><td style="padding:18px 32px;background:#f9fafb;border-top:1px solid #eef0f3;' +
      'font-size:12px;line-height:1.8;color:#9ca3af;">' +
      '你收到这封邮件，是因为在 <a href="' + home + '" style="color:#6b7280;">FeSui</a> ' +
      '绑定了邮箱并订阅了项目公告。<br />' +
      '<a href="' + blog + '" style="color:#6b7280;">查看全部公告</a> · ' +
      '<a href="' + user + '" style="color:#6b7280;">取消订阅</a>' +
      '</td></tr>' +
    '</table>' +
    '<div style="margin-top:16px;font-size:11px;color:#b6bcc7;">' +
    '© FeSui · 本邮件由系统自动发送，请勿直接回复</div>' +
    '</td></tr></table></body></html>'
}

function buildMail(title: string, body: string) {
  const subject = '【FeSui 项目公告】' + title
  const text = title + '\n\n' + body + '\n\n———\n查看全部公告：' + SITE_URL + '/blog/' +
               '\n取消订阅：' + SITE_URL + '/user/'
  const html = mailHtml({
    eyebrow: '项目公告', title, body,
    ctaText: '查看博客与公告', ctaHref: SITE_URL + '/blog/',
  })
  return { subject, text, html }
}

/* ---------- worker 心跳（公开状态只暴露时间，不暴露任何凭据） ---------- */
async function workerState(): Promise<{ ready: boolean; last_seen: string | null; last_ok: string | null }> {
  const { data } = await db.from('fs_mail_worker')
    .select('last_seen,last_ok').eq('id', 1).limit(1)
  const row = data && data[0] ? data[0] : null
  const seen = row?.last_seen ? new Date(row.last_seen).getTime() : 0
  return {
    ready: !!seen && (Date.now() - seen) < 26 * 3600 * 1000,
    last_seen: row?.last_seen || null,
    last_ok: row?.last_ok || null,
  }
}

/* ---------- 通道 A：入队（默认） ---------- */
async function enqueue(announcementId: number | null, emails: string[],
                       mail: { subject: string; text: string; html: string }): Promise<number> {
  let n = 0
  for (let i = 0; i < emails.length; i += 100) {
    const rows = emails.slice(i, i + 100).map(email => ({
      announcement_id: announcementId,
      email,
      subject: mail.subject,
      text_body: mail.text,
      html_body: mail.html,
    }))
    // ON CONFLICT DO NOTHING：同一公告 + 同一邮箱只排一次，重复发布不会重复发信
    const { data, error } = await db.from('fs_mail_queue')
      .upsert(rows, { onConflict: 'announcement_id,email', ignoreDuplicates: true })
      .select('id')
    if (error) { console.error('enqueue failed', error.message); continue }
    n += (data || []).length
  }
  return n
}

/* ---------- 通道 B：Resend HTTP API（显式切换时才用） ---------- */
async function sendResend(emails: string[], title: string, body: string): Promise<number> {
  let sent = 0
  const mail = buildMail(title, body)
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100)
    try {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + RESEND_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk.map(to => ({
          from: MAIL_FROM || 'FeSui <onboarding@resend.dev>',
          to: [to], subject: mail.subject, text: mail.text, html: mail.html,
        }))),
      })
      if (r.ok) sent += chunk.length
      else console.error('resend batch failed', r.status, await r.text())
    } catch (e) { console.error('resend batch error', String(e)) }
  }
  return sent
}

/* ---------- 主逻辑 ---------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* 空体按缺字段处理 */ }
  const action = String(body.action || '')

  // 公开：邮件通道状态（前端据此显示「已开通 / 等待首次运行 / 待配置」）
  if (action === 'mail_status') {
    const w = PROVIDER === 'queue' ? await workerState() : null
    return json({
      ok: true,
      configured: mailConfigured(),
      provider: PROVIDER,
      label: providerLabel(),
      ready: w ? w.ready : mailConfigured(),
      last_seen: w?.last_seen || null,
      last_ok: w?.last_ok || null,
      from: MAIL_FROM,
    })
  }

  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  const session = token ? await verifySiteJwt(token) : null
  if (!session) return json({ ok: false, error: '登录态无效或已过期，请重新登录' }, 401)
  const uid = session.sub

  /* ---------- 邮箱绑定 / 订阅 ---------- */
  if (action === 'email_get') {
    const { data, error } = await db.from('fs_email_subscriptions')
      .select('email,verified,subscribed,updated_at').eq('user_id', uid).limit(1)
    if (error) return json({ ok: false, error: error.message }, 500)
    const row = data && data[0] ? data[0] : null
    const w = PROVIDER === 'queue' ? await workerState() : null
    return json({ ok: true, bound: !!row, email: row?.email || '',
                  verified: !!row?.verified, subscribed: !!row?.subscribed,
                  configured: mailConfigured(), provider: PROVIDER,
                  ready: w ? w.ready : true })
  }

  if (action === 'email_bind' || action === 'email_subscribe') {
    const email = String(body.email || '').trim().toLowerCase()
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: '邮箱格式不正确' }, 400)
    }
    // TODO: 邮件通道稳定后改为「发送验证码 + verify 兑换」，
    //       只有 verified=true 才进入群发名单；当前 verified 字段仅预留。
    const { error } = await db.from('fs_email_subscriptions').upsert({
      user_id: uid, email, verified: false, subscribed: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) {
      const dup = error.code === '23505' || /duplicate|unique/i.test(error.message)
      return json({ ok: false, error: dup ? '该邮箱已被其他账号绑定' : ('保存失败：' + error.message) },
                  dup ? 409 : 500)
    }
    return json({ ok: true, email, configured: mailConfigured() })
  }

  if (action === 'email_unsubscribe' || action === 'email_remove') {
    if (action === 'email_remove') {
      const { error } = await db.from('fs_email_subscriptions').delete().eq('user_id', uid)
      if (error) return json({ ok: false, error: error.message }, 500)
    } else {
      const { error } = await db.from('fs_email_subscriptions')
        .update({ subscribed: false, updated_at: new Date().toISOString() })
        .eq('user_id', uid)
      if (error) return json({ ok: false, error: error.message }, 500)
    }
    return json({ ok: true })
  }

  /* ---------- 管理员：队列状态 / 测试邮件 ---------- */
  if (action === 'mail_queue_stats') {
    if (!await isAdmin(uid)) return json({ ok: false, error: '需要管理员权限' }, 403)
    const { data, error } = await db.from('fs_mail_queue').select('status').limit(5000)
    if (error) return json({ ok: false, error: error.message }, 500)
    const stat = { pending: 0, sent: 0, failed: 0 }
    for (const r of data || []) {
      const k = String(r.status) as keyof typeof stat
      if (k in stat) stat[k]++
    }
    return json({ ok: true, ...stat })
  }

  if (action === 'mail_test') {
    if (!await isAdmin(uid)) return json({ ok: false, error: '需要管理员权限' }, 403)
    const to = String(body.email || '').trim().toLowerCase()
    if (to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return json({ ok: false, error: '邮箱格式不正确' }, 400)
    }
    const mail = {
      subject: '【FeSui】邮件通道测试',
      text: '邮件通道测试\n\n看到这封信，说明 GitHub Actions 发信链路已经打通，' +
            '项目公告以后会按这个样式送到你邮箱。\n\n———\n访问站点：' + SITE_URL +
            '\n取消订阅：' + SITE_URL + '/user/',
      html: mailHtml({
        eyebrow: '通道测试', title: '发信链路已经打通',
        body: '看到这封信，说明 GitHub Actions 队列 → 新浪 SMTP 这一整条链路都正常。\n\n' +
              '以后每次发布项目公告，都会按这个样式自动送到已订阅用户的邮箱；' +
              '博客文章不会发邮件，只在站内展示。',
        ctaText: '去站点看看', ctaHref: SITE_URL + '/blog/',
      }),
    }
    const n = await enqueue(null, [to], mail)
    return json({ ok: true, queued: n, provider: PROVIDER,
                  note: '已加入队列；去 GitHub Actions 手动触发「发送公告邮件队列」即可立即发送' })
  }

  /* ---------- 项目公告（管理员） ---------- */
  if (action === 'announce') {
    if (!await isAdmin(uid)) return json({ ok: false, error: '需要管理员权限' }, 403)
    const title = String(body.title || '').trim()
    const text = String(body.body || body.content || '').trim()
    if (!title || title.length > 120) return json({ ok: false, error: '标题需 1–120 字' }, 400)
    if (!text || text.length > 5000) return json({ ok: false, error: '正文需 1–5000 字' }, 400)

    const { data, error } = await db.from('fs_announcements')
      .insert({ title, body: text, author_id: uid })
      .select('id, created_at').limit(1)
    if (error) return json({ ok: false, error: error.message }, 500)
    const id = data && data[0] ? data[0].id : null
    const mail = buildMail(title, text)

    let mailed = 0, queued = 0
    if (mailConfigured()) {
      const { data: subs } = await db.from('fs_email_subscriptions')
        .select('email').eq('subscribed', true)
      const emails = (subs || []).map(s => String(s.email)).filter(Boolean)
      if (PROVIDER === 'queue') {
        queued = await enqueue(id, emails, mail)
      } else if (PROVIDER === 'resend') {
        mailed = await sendResend(emails, title, text)
        await db.from('fs_announcements')
          .update({ mailed_count: mailed, mailed_at: mailed ? new Date().toISOString() : null })
          .eq('id', id)
      }
    }
    return json({
      ok: true, id, mailed, queued, configured: mailConfigured(), provider: PROVIDER,
      note: !mailConfigured() ? '邮件通道未配置，本次仅站内发布'
            : PROVIDER === 'queue'
              ? ('已加入邮件队列 ' + queued + ' 封，由 GitHub Actions 定时任务发送')
              : null,
    })
  }

  return json({ ok: false, error: '未知操作：' + action }, 400)
})
