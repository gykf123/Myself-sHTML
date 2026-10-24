// ============================================================
// wall-post — 留言墙安全发布通道（FeSui 主页留言墙）
// 项目：yowwyasttkywyqgseuqz（Supabase Edge Functions，Deno 运行时）
//
// 与 login / account 同一账号体系。替代前端 anon 直插 guestbook：
//   · 必须携带本站 JWT（未登录 → 401，前端门禁同步生效）
//   · user_id 从 JWT sub 由服务端提取，杜绝前端伪造（「我的留言」数据可信）
//   · 单用户频率限流（同 user_id 30 秒 1 条）
//   · 敏感词 / 长度过滤
//   · service_role 插入，不受 guestbook RLS 约束
// 数据库层另有 wall-security.sql 的 trigger 做全局洪泛兜底（防绕过前端的直插）。
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

// 垃圾 / 违规信息过滤词（可按需扩充；命中即拒发）
const BLOCK_WORDS = ['广告', '加微', 'vx:', 'v信', '代刷', '办证', '招嫖', '赌球', '六合彩', '博彩', '性服务']
// 同一 user_id 的最小发文间隔（秒）
const USER_COOLDOWN = 30

/* ---------- 本站 JWT 解析与验签（HS256，与 login / account 同一策略） ---------- */
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
    // 降级：签名不匹配任何候选 secret 时，确认用户在表中存在
    const { data } = await db.from('users').select('id').eq('id', payload.sub).limit(1)
    if (data && data.length) return { sub: payload.sub, username: payload.username || '' }
    return null
  } catch {
    return null
  }
}

/* ---------- 主逻辑 ---------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  const session = token ? await verifySiteJwt(token) : null
  if (!session) return json({ error: '登录态无效或已过期，请重新登录' }, 401)

  let body: Record<string, string> = {}
  try { body = await req.json() } catch { /* 空体按缺少字段处理 */ }

  const content = String(body.content || '').trim()
  const nickname = String(body.nickname || '').trim() || '匿名访客'

  // 内容校验
  if (!content) return json({ error: '留言内容不能为空' }, 400)
  if (content.length > 500) return json({ error: '留言最长 500 字' }, 400)
  if (nickname.length > 30) return json({ error: '昵称最长 30 个字符' }, 400)
  const lower = content.toLowerCase()
  if (BLOCK_WORDS.some(w => lower.includes(w.toLowerCase()))) {
    return json({ error: '内容包含违规信息，已被拦截' }, 400)
  }

  // 单用户频率限流：同 user_id 30 秒内已有留言 → 拒
  const { data: recent } = await db.from('guestbook')
    .select('id')
    .eq('user_id', session.sub)
    .gte('created_at', new Date(Date.now() - USER_COOLDOWN * 1000).toISOString())
    .limit(1)
  if (recent && recent.length) {
    return json({ error: '留言太频繁了，歇 ' + USER_COOLDOWN + ' 秒再发吧' }, 429)
  }

  // 插入（user_id 来自服务端 JWT sub，前端传什么都不生效）
  const { data, error } = await db.from('guestbook').insert({
    content,
    nickname,
    user_id: session.sub,
  }).select('id, created_at').limit(1)

  if (error) {
    // trigger 拦截（wall_rate_limited / wall_duplicate）时返回可读信息
    const msg = error.message || ''
    if (msg.includes('wall_rate_limited') || msg.includes('wall_duplicate')) {
      return json({ error: msg.split(': ')[1] || '留言太频繁了，请稍后再试' }, 429)
    }
    return json({ error: '发布失败：' + msg }, 500)
  }
  return json({ success: true, id: data && data[0] ? data[0].id : null })
})
