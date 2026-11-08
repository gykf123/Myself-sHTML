// ============================================================
// account — FeSui 账号中心 Edge Function
// 项目：yowwyasttkywyqgseuqz（Supabase Edge Functions，Deno 运行时）
//
// 与本站 login / apply / auth-exchange 同一账号体系：
//   · 除 github_login 外，调用方须在 Authorization 头携带本站 JWT（HS256 7 天）
//   · 写 users / auth_tickets 表用 service_role key（RLS 已收紧）
//
// action:
//   profile         读取当前用户完整资料（service_role 代理，字段白名单）
//   callback        GitHub OAuth 回调：code → 绑定 GitHub 到「当前已登录」用户
//   unlink          解除当前用户的 GitHub 绑定
//   update-profile  更新当前用户的 qq / nickname / bio
//   github_login    【免登录态】已关联 GitHub 的账号一键登录：
//                   code → GitHub 身份 → 按 github_id 查 users → 签本站 JWT
//                   → 直接写 auth_tickets 生成一次性 ticket 返回。
//                   JWT 全程不出现在前端、URL、日志里，与 login 页换票机制一致。
//
// 安全要点：
//   · github_login 是唯一匿名入口；其余 action 一律先验签，绝不按 action 降级；
//   · 只用 GitHub 返回的不可伪造 id 查库，前端传 uid / username 一律无效；
//   · 校验 users.status=approved，封禁/待审核账号拿不到票据；
//   · state 防 CSRF 在回调落地页校验（sessionStorage，跨站拿不到）；
//   · GitHub authorization code 本身一次性、10 分钟过期。
//
// 依赖 Secrets：
//   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / JWT_SECRET（均已配置）
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GH_CLIENT_ID = Deno.env.get('GITHUB_CLIENT_ID') || ''
const GH_CLIENT_SECRET = Deno.env.get('GITHUB_CLIENT_SECRET') || ''
const JWT_SECRET = Deno.env.get('JWT_SECRET') || ''

const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // 响应体可能含票据，绝不进缓存；同时禁 MIME 嗅探 / iframe 嵌套 / 回传 referrer
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/* ---------- 本站 JWT 解析与验签（HS256，与 login 接口同一 secret） ---------- */
const enc = new TextEncoder()

function b64urlEncodeBytes(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmacSha256(key: string, msg: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg)))
  // JWT 签名段是 base64url（无 padding），必须与 login/_shared/jwt.ts 的 b64urlEncode 一致
  return b64urlEncodeBytes(sig)
}

// 与 login/_shared/jwt.ts 的 signJWT 逐字节一致：header 固定 {alg,typ}，HS256(JWT_SECRET)
async function signSiteJwt(payload: Record<string, unknown>): Promise<string> {
  const data = b64urlEncodeBytes(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))) +
    '.' + b64urlEncodeBytes(enc.encode(JSON.stringify(payload)))
  return data + '.' + (await hmacSha256(JWT_SECRET, data))
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

// 返回 { sub, username } 或 null（过期/格式错/签名不匹配一律拒绝）
// 验签 secret 候选：JWT_SECRET → SUPABASE_JWT_SECRET → SERVICE_ROLE_KEY。
// 2026-11-07 修正：早期版本把 btoa() 标准 base64 直接拿来比对 base64url 签名段，
// 导致签名永远不匹配、全部落入「查 users 表确认 sub 存在」的降级路径——
// 而 uid 是公开信息，等于任何人都能伪造他人身份，已删除该降级路径。
async function verifySiteJwt(token: string): Promise<{ sub: string; username: string } | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(b64urlDecode(parts[1]))
    if (!payload || !payload.sub || !payload.exp || payload.exp * 1000 <= Date.now()) return null
    const candidates = [
      JWT_SECRET,
      Deno.env.get('SUPABASE_JWT_SECRET'),
      SERVICE_KEY,
    ].filter(Boolean) as string[]
    for (const secret of candidates) {
      if ((await hmacSha256(secret, parts[0] + '.' + parts[1])) === parts[2]) {
        return { sub: payload.sub, username: payload.username || '' }
      }
    }
    // 签名不匹配一律拒绝，绝不降级（uid 可从公开资料页取得，降级 = 身份可伪造）
    return null
  } catch {
    return null
  }
}

/* ---------- GitHub OAuth：code → access_token → GitHub 用户 ---------- */
type GhUser = { id: number | string; login?: string; avatar_url?: string; html_url?: string }
type GhResult = { gh: GhUser } | { error: string; status: number }

async function exchangeGithub(code: string): Promise<GhResult> {
  if (!GH_CLIENT_ID || !GH_CLIENT_SECRET) {
    return { error: '服务端未配置 GitHub OAuth（GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET）', status: 500 }
  }
  // 1) code → access_token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      client_id: GH_CLIENT_ID,
      client_secret: GH_CLIENT_SECRET,
      code,
    }),
  })
  const tokenData = await tokenRes.json().catch(() => null)
  if (!tokenData || !tokenData.access_token) {
    const reason = tokenData?.error_description || tokenData?.error || '授权码无效或已过期'
    return { error: 'GitHub 授权失败：' + reason, status: 400 }
  }
  // 2) access_token → GitHub 用户信息（只取 read:user 范围内的公开资料）
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ' + tokenData.access_token, Accept: 'application/vnd.github+json' },
  })
  const gh = await userRes.json().catch(() => null)
  if (!userRes.ok || !gh || !gh.id) {
    return { error: '拉取 GitHub 账号信息失败', status: 400 }
  }
  return { gh: gh as GhUser }
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
         req.headers.get('x-real-ip') || 'unknown'
}

/* ---------- 已登录态：把 GitHub 绑定到当前账号 ---------- */
async function githubCallback(code: string, uid: string) {
  const result = await exchangeGithub(code)
  if ('error' in result) return json({ error: result.error }, result.status)
  const gh = result.gh
  const { error } = await db.from('users').update({
    github_id: String(gh.id),
    github_login: gh.login || null,
    github_avatar_url: gh.avatar_url || null,
    github_linked_at: new Date().toISOString(),
  }).eq('id', uid)
  if (error) {
    if (error.code === '23505') {
      return json({ error: '该 GitHub 账号已绑定其他用户，请先解绑' }, 409)
    }
    return json({ error: '写入绑定关系失败：' + error.message }, 500)
  }
  return json({
    success: true,
    github: { id: String(gh.id), login: gh.login, avatar_url: gh.avatar_url, html_url: gh.html_url },
  })
}

/* ---------- 免登录态：已关联 GitHub 的账号一键登录 ----------
   不信任任何前端传入的身份：唯一凭据是 GitHub 自己返回的 id。
   查到用户后签本站 JWT，再直接写 auth_tickets 换成 2 分钟一次性票；
   真正的 JWT 只存在于数据库票据行里，redeem 时经 POST 响应体下发。 */
async function githubLogin(code: string, req: Request) {
  // 与 login 一致的 IP 封禁检查；限流组件异常不阻断登录
  try {
    const ban = await db.rpc('fkd_is_banned', { p_ip: clientIp(req) })
    if (ban.data && ban.data.banned) {
      return json({ error: '访问过于频繁，请稍后再试' }, 429)
    }
  } catch { /* 静默跳过 */ }

  const result = await exchangeGithub(code)
  if ('error' in result) return json({ error: result.error }, result.status)
  const ghId = String(result.gh.id)

  const { data: rows, error } = await db.from('users')
    .select('id,username,nickname,role,status,avatar_url')
    .eq('github_id', ghId).limit(1)
  if (error) return json({ error: '账号查询失败：' + error.message }, 500)
  const user = rows && rows[0]
  if (!user) {
    return json({
      error: '这个 GitHub 账号还没有关联本站账号。请先用用户名密码登录，再到个人中心点「关联 GitHub」，之后就能一键登录了。',
      code: 'NOT_LINKED',
      github_login: result.gh.login || null,
    }, 404)
  }
  if (user.status !== 'approved') {
    return json({
      error: user.status === 'pending' ? '该账号待审核，请联系管理员' : '该账号未通过审核，无法登录',
      code: 'NOT_APPROVED',
    }, 403)
  }
  if (!JWT_SECRET) return json({ error: '服务端登录密钥未配置' }, 500)

  const now = Math.floor(Date.now() / 1000)
  const token = await signSiteJwt({
    sub: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    username: user.username,
    nickname: user.nickname || null,
    app_role: user.role,
    status: user.status,
    avatar_url: user.avatar_url ?? null,
    iat: now,
    exp: now + 60 * 60 * 24 * 7,
  })

  // 直接落一次性票（auth_tickets.expires_at 默认 now()+2min）；
  // 不经过前端、不经过 URL，兑换逻辑复用 auth-exchange redeem / auth-ticket.js。
  const ticket = crypto.randomUUID()
  const { error: ticketErr } = await db.from('auth_tickets').insert({ ticket, token })
  if (ticketErr) return json({ error: '登录票据生成失败，请重试' }, 500)

  return json({
    success: true,
    ticket,
    username: user.username,
    nickname: user.nickname || null,
    role: user.role,
    avatar_url: user.avatar_url ?? null,
    github_login: result.gh.login || null,
  })
}

/* ---------- 路由 ---------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let body: Record<string, string> = {}
  try { body = await req.json() } catch { /* 空体放行，按 action 报错 */ }
  const action = body.action || ''

  // github_login 是唯一允许匿名调用的 action：用户此时还没登录。
  // 其余 action 一律先验签，绝不因为「看起来无害」就放行。
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  const session = token ? await verifySiteJwt(token) : null
  if (!session && action !== 'github_login') {
    return json({ error: '登录态无效或已过期，请重新登录' }, 401)
  }
  const uid = session?.sub || ''

  if (action === 'github_login') {
    if (!body.code) return json({ error: '缺少授权码 code' }, 400)
    return await githubLogin(String(body.code), req)
  }

  // 读取本人资料（users 表 GRANT 收紧后，前端改走此通道；字段白名单，绝不下发 password_hash）
  if (action === 'profile') {
    const { data, error } = await db.from('users').select(
      'username,nickname,role,status,created_at,avatar_url,bio,reason,active_value,last_login_date,' +
      'github_id,github_login,github_avatar_url,github_linked_at,qq',
    ).eq('id', uid).limit(1)
    if (error || !data || !data.length) return json({ error: '资料读取失败' }, 500)
    return json({ success: true, profile: data[0] })
  }

  if (action === 'callback') {
    if (!body.code) return json({ error: '缺少授权码 code' }, 400)
    return await githubCallback(body.code, uid)
  }

  if (action === 'unlink') {
    const { error } = await db.from('users').update({
      github_id: null, github_login: null, github_avatar_url: null, github_linked_at: null,
    }).eq('id', uid)
    if (error) return json({ error: '解除绑定失败：' + error.message }, 500)
    return json({ success: true })
  }

  if (action === 'update-profile') {
    const patch: Record<string, string | null> = {}
    // QQ：5-12 位数字
    if (typeof body.qq === 'string') {
      const qq = body.qq.trim()
      if (qq && !/^\d{5,12}$/.test(qq)) return json({ error: 'QQ 号格式不正确（5-12 位数字）' }, 400)
      patch.qq = qq || null
    }
    // 昵称：1-30 字符
    if (typeof body.nickname === 'string') {
      const nick = body.nickname.trim()
      if (nick && (nick.length < 1 || nick.length > 30)) {
        return json({ error: '昵称需在 1-30 个字符之间' }, 400)
      }
      patch.nickname = nick || null
    }
    // 简介：最多 200 字符
    if (typeof body.bio === 'string') {
      const bio = body.bio.trim()
      if (bio.length > 200) return json({ error: '简介最多 200 个字符' }, 400)
      patch.bio = bio || null
    }
    if (!Object.keys(patch).length) return json({ error: '没有需要更新的字段' }, 400)
    const { error } = await db.from('users').update(patch).eq('id', uid)
    if (error) return json({ error: '更新失败：' + error.message }, 500)
    return json({ success: true, updated: Object.keys(patch) })
  }

  return json({ error: '未知 action：' + action }, 400)
})
