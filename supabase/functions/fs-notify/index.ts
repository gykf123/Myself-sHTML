// ============================================================
// fs-notify — 邮箱绑定 / 订阅名单 / 项目公告 / 群发邮件
// 项目：yowwyasttkywyqgseuqz（Deno Edge Functions）
//
// 设计要点：
//   · user_id 一律只信本站 JWT 的 sub，前端传什么都不生效；
//   · fs_email_subscriptions 前端零权限（RLS 无 policy），只走本函数 service_role；
//   · 邮件走 Resend HTTP API。未配置 RESEND_API_KEY 时功能不报错：
//     公告照常发布（站内可见），只是不发信，mail_configured=false 让前端如实提示；
//   · verified 字段是预留位：当前不做验证码，故群发不按 verified 过滤，
//     等验证码通道上线后再加条件（见下方 TODO）。
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') || ''
const MAIL_FROM = Deno.env.get('FS_MAIL_FROM') || 'FeSui <onboarding@resend.dev>'
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

function mailConfigured(): boolean { return RESEND_KEY.length > 0 }

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

/* ---------- Resend 批量发信（免费层单次上限 100 封，故分批） ---------- */
async function sendBatch(emails: string[], title: string, body: string): Promise<number> {
  let sent = 0
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100)
    const html =
      '<div style="font:15px/1.7 -apple-system,Segoe UI,PingFang SC,sans-serif;color:#1f2328">' +
      '<h2>' + esc(title) + '</h2>' +
      '<div>' + esc(body).replace(/\n/g, '<br>') + '</div>' +
      '<hr style="margin:24px 0;border:0;border-top:1px solid #ddd">' +
      '<p style="font-size:13px;color:#6b7280">你收到这封邮件，是因为在 ' +
      '<a href="' + SITE_URL + '/">' + SITE_URL + '</a> 绑定了邮箱并订阅项目公告。' +
      '可在 <a href="' + SITE_URL + '/user/">个人中心</a> 取消订阅。</p></div>'
    try {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + RESEND_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk.map(to => ({
          from: MAIL_FROM,
          to: [to],
          subject: '【FeSui 项目公告】' + title,
          text: title + '\n\n' + body + '\n\n--\n' + SITE_URL +
                '\n取消订阅：' + SITE_URL + '/user/',
          html,
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

  // 公开：邮件通道状态（前端据此显示「已开通 / 待配置」）
  if (action === 'mail_status') {
    return json({ ok: true, configured: mailConfigured(), from: MAIL_FROM })
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
    return json({ ok: true, bound: !!row, email: row?.email || '',
                  verified: !!row?.verified, subscribed: !!row?.subscribed,
                  configured: mailConfigured() })
  }

  if (action === 'email_bind' || action === 'email_subscribe') {
    const email = String(body.email || '').trim().toLowerCase()
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: '邮箱格式不正确' }, 400)
    }
    // TODO: 邮件通道开通后，这里改为「发送验证码 + verify 兑换」，
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

    let mailed = 0
    if (mailConfigured()) {
      const { data: subs } = await db.from('fs_email_subscriptions')
        .select('email').eq('subscribed', true)
      const emails = (subs || []).map(s => String(s.email)).filter(Boolean)
      mailed = await sendBatch(emails, title, text)
      await db.from('fs_announcements')
        .update({ mailed_count: mailed, mailed_at: mailed ? new Date().toISOString() : null })
        .eq('id', id)
    }
    return json({ ok: true, id, mailed, configured: mailConfigured(),
                  note: mailConfigured() ? null : '邮件通道未配置，本次仅站内发布' })
  }

  return json({ ok: false, error: '未知操作：' + action }, 400)
})
