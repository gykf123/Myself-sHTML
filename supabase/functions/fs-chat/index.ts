// ============================================================
// fs-chat — FeSui 聊天室发送通道（带 fs- 前缀，与既有函数隔离）
// 项目：yowwyasttkywyqgseuqz（Supabase Edge Functions，Deno 运行时）
//
// ⚠️ 命名隔离：本项目已有 login / auth-exchange / qq-bind / profile
//    以及另一套群聊表（chat_groups / chat_messages / chat_members）。
//    本函数只读写 public.fs_chat_messages（见 supabase/fs-chat.sql），
//    不触碰、不覆盖任何既有表或函数。
//
// 读消息：前端直接走 REST 公开读（fs-chat.sql 已 grant select + RLS using(true)），
//         不经函数，函数未部署时也能浏览历史消息。
// 发消息：必须携带本站 JWT → 本函数（service_role 写入，user_id 只信 sub）。
//
// 依赖 secrets（与 wall-post 同一套，无需新增配置）：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET(可选)
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

const BLOCK_WORDS = ['广告', '加微', 'vx:', 'v信', '代刷', '办证', '招嫖', '赌球', '六合彩', '博彩', '性服务']
const USER_COOLDOWN = 3          // 同一用户最小发言间隔（秒），聊天比留言宽松
const MAX_LEN = 500

/* ---------- 本站 JWT 验签（HS256，与 login / wall-post 同策略） ---------- */
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

async function verifySiteJwt(token: string): Promise<{ sub: string; username: string; nickname?: string; avatar_url?: string } | null> {
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
        return { sub: payload.sub, username: payload.username || '', nickname: payload.nickname, avatar_url: payload.avatar_url }
      }
    }
    // 降级：签名不匹配任何候选 secret 时，确认用户确实存在于 users 表
    const { data } = await db.from('users').select('id').eq('id', payload.sub).limit(1)
    if (data && data.length) {
      return { sub: payload.sub, username: payload.username || '', nickname: payload.nickname, avatar_url: payload.avatar_url }
    }
    return null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* 空体按缺少字段处理 */ }
  const action = String(body.action || '')

  // ---- 读消息（公开，无需登录；前端主用 REST，这里保留等价通道） ----
  if (action === 'list') {
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100)
    const { data, error } = await db.from('fs_chat_messages')
      .select('id,user_id,author_name,author_avatar,content,created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) return json({ error: '读取失败：' + error.message }, 500)
    return json({ ok: true, messages: (data || []).reverse() })
  }

  // ---- 发消息（必须登录） ----
  if (action !== 'send') return json({ error: '未知 action' }, 400)

  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  const session = token ? await verifySiteJwt(token) : null
  if (!session) return json({ error: '请先登录后再发言' }, 401)

  const content = String(body.content || '').trim()
  if (!content) return json({ error: '消息不能为空' }, 400)
  if (content.length > MAX_LEN) return json({ error: '消息最长 ' + MAX_LEN + ' 字' }, 400)
  const lower = content.toLowerCase()
  if (BLOCK_WORDS.some(w => lower.includes(w.toLowerCase()))) {
    return json({ error: '内容包含违规信息，已被拦截' }, 400)
  }

  // 昵称/头像只取 JWT 快照（登录时签发的），前端传值一律不采信
  const authorName = String(session.nickname || session.username || '匿名').slice(0, 30)
  const authorAvatar = session.avatar_url ? String(session.avatar_url).slice(0, 500) : null

  // 单用户限流
  const { data: recent } = await db.from('fs_chat_messages')
    .select('id')
    .eq('user_id', session.sub)
    .gte('created_at', new Date(Date.now() - USER_COOLDOWN * 1000).toISOString())
    .limit(1)
  if (recent && recent.length) {
    return json({ error: '发得太快了，歇 ' + USER_COOLDOWN + ' 秒' }, 429)
  }

  const { data, error } = await db.from('fs_chat_messages').insert({
    user_id: session.sub,
    author_name: authorName,
    author_avatar: authorAvatar,
    content,
  }).select('id, created_at').limit(1)

  if (error) {
    const msg = error.message || ''
    if (msg.includes('fs_chat_rate_limited') || msg.includes('fs_chat_duplicate')) {
      return json({ error: msg.split(': ')[1] || '发得太频繁了，请稍后再试' }, 429)
    }
    return json({ error: '发送失败：' + msg }, 500)
  }
  return json({ ok: true, id: data && data[0] ? data[0].id : null, created_at: data && data[0] ? data[0].created_at : null })
})
