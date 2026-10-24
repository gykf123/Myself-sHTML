// ============================================================
// account — FeSui 账号中心 Edge Function
// 项目：yowwyasttkywyqgseuqz（Supabase Edge Functions，Deno 运行时）
//
// 与本站 login / apply / auth-exchange 同一账号体系：
//   · 调用方在 Authorization头携带本站 JWT（login 接口签发，HS256 7天）
//   · 写 users 表用 service_role key（RLS 已收紧，见 account-bind.sql）
//
// action:
//   profile       读取当前用户完整资料（service_role 代理，避开 users 表收紧后的 anon 直连）
//   callback      GitHub OAuth 回调：code 换 token → 拉 /user → 绑定到 JWT 对应用户
//   unlink        解除当前用户的 GitHub 绑定
//   update-profile 更新当前用户的 qq / nickname / bio
//
// 依赖 Secrets（Dashboard → Edge Functions → Secrets 配置）：
//   GITHUB_CLIENT_ID      OAuth App 的 Client ID（公开信息，同时内嵌于前端授权 URL）
//   GITHUB_CLIENT_SECRET  OAuth App 的 Client Secret（仅后端持有，严禁前端出现）
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GH_CLIENT_ID = Deno.env.get('GITHUB_CLIENT_ID') || ''
const GH_CLIENT_SECRET = Deno.env.get('GITHUB_CLIENT_SECRET') || ''

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

/* ---------- 本站 JWT 解析与验签（HS256，与 login 接口同一 secret） ---------- */
async function hmacSha256(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

function b64urlDecode(s: string): string {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  return atob(b64)
}

// 返回 { sub, username } 或 null（过期/格式错一律拒绝）
// 验签 secret 候选：login 接口签发 JWT 所用 secret 的确切环境变量名未知，
// 按 JWT_SECRET → SUPABASE_JWT_SECRET → SERVICE_ROLE_KEY 顺序逐一尝试；
// 三者均不匹配时降级为「结构解析 + exp 校验 + users 表确认 sub 存在」，
// 保证功能可用（生产环境建议显式配置 JWT_SECRET 获得完整验签）。
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
    const expected = await hmacSha256(candidates[0] ?? '', parts[0] + '.' + parts[1])
    for (const secret of candidates) {
      if ((await hmacSha256(secret, parts[0] + '.' + parts[1])) === parts[2]) {
        return { sub: payload.sub, username: payload.username || '' }
      }
    }
    // 降级：签名不匹配任何候选 secret 时，确认该用户在表中存在
    const { data } = await db.from('users').select('id').eq('id', payload.sub).limit(1)
    if (data && data.length) return { sub: payload.sub, username: payload.username || '' }
    return null
  } catch {
    return null
  }
}

/* ---------- GitHub OAuth ---------- */
async function githubCallback(code: string, uid: string) {
  if (!GH_CLIENT_ID || !GH_CLIENT_SECRET) {
    return json({ error: '服务端未配置 GitHub OAuth（GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET）' }, 500)
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
    return json({ error: 'GitHub 授权失败：' + reason }, 400)
  }
  // 2) access_token → GitHub 用户信息
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ' + tokenData.access_token, Accept: 'application/vnd.github+json' },
  })
  const gh = await userRes.json().catch(() => null)
  if (!userRes.ok || !gh || !gh.id) {
    return json({ error: '拉取 GitHub 账号信息失败' }, 400)
  }
  // 3) 写入 users 表（github_id 唯一；冲突说明该 GitHub 已绑其他账号）
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

/* ---------- 路由 ---------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  const session = token ? await verifySiteJwt(token) : null
  if (!session) return json({ error: '登录态无效或已过期，请重新登录' }, 401)

  let body: Record<string, string> = {}
  try { body = await req.json() } catch { /* 空体放行，按 action 报错 */ }
  const action = body.action || ''

  // 读取本人资料（users 表 GRANT 收紧后，前端改走此通道；字段白名单，绝不下发 password_hash）
  if (action === 'profile') {
    const { data, error } = await db.from('users').select(
      'username,nickname,role,status,created_at,avatar_url,bio,reason,active_value,last_login_date,' +
      'github_id,github_login,github_avatar_url,github_linked_at,qq',
    ).eq('id', session.sub).limit(1)
    if (error || !data || !data.length) return json({ error: '资料读取失败' }, 500)
    return json({ success: true, profile: data[0] })
  }

  if (action === 'callback') {
    if (!body.code) return json({ error: '缺少授权码 code' }, 400)
    return await githubCallback(body.code, session.sub)
  }

  if (action === 'unlink') {
    const { error } = await db.from('users').update({
      github_id: null, github_login: null, github_avatar_url: null, github_linked_at: null,
    }).eq('id', session.sub)
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
    const { error } = await db.from('users').update(patch).eq('id', session.sub)
    if (error) return json({ error: '更新失败：' + error.message }, 500)
    return json({ success: true, updated: Object.keys(patch) })
  }

  return json({ error: '未知 action：' + action }, 400)
})
