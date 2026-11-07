// ============================================================
// fs-chat — FeSui 聊天室后端（带 fs- 前缀，与既有函数/表隔离）
// 项目：yowwyasttkywyqgseuqz（Supabase Edge Functions，Deno 运行时）
//
// ⚠️ 命名隔离：本项目已有 login / auth-exchange / qq-bind / profile
//    以及另一套群聊表（chat_groups / chat_messages / chat_members），
//    还有 0027 迁移的 account_bans / site_visits。
//    本函数只读写 public.fs_chat_messages（公共大厅）与 public.fs_chat_dm（私聊），
//    不触碰、不覆盖任何既有表或函数。
//
// 公共大厅：
//   读 = 前端直接 REST 公开读（fs-chat.sql 已 grant select + RLS using(true)）
//   写 = 本函数（service_role，user_id 只信 JWT sub）
// 私聊：
//   读写一律走本函数（fs_chat_dm 不开放任何前端表权限、无 RLS policy）
//   验签后 sender_id 只信 sub，recipient 只能由 username/uid 解析
// 封禁：
//   所有写操作前调 is_account_banned(p_user=sub, p_site='fesui') 做服务端拦截，
//   与 0027 的站点级封禁联动（全局封禁另由 login 的 users.status 天然拦住）。
//
// 依赖 secrets（与 wall-post 同一套，无需新增配置）：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET(可选)
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const db = createClient(SUPABASE_URL, SERVICE_KEY)
const SITE = 'fesui'   // 站点标识：与访问记录 / 封禁的 site 字段一致，绝不能用 '*'

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
const USER_COOLDOWN = 3          // 同一用户最小发言间隔（秒）
const MAX_LEN = 500

type Session = { sub: string; username: string; nickname?: string; avatar_url?: string }
type Peer = { uid: string; name: string; avatar: string | null }

/* ---------- 本站 JWT 验签（HS256，与 login/_shared/jwt.ts 一致） ---------- */
async function hmacSha256(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg)))
  // JWT 签名段是 base64url（无 padding）。早期版本直接返回 btoa() 标准 base64，
  // 导致签名永远比对不上、全部落到「查 users 表确认 uid 存在就放行」的降级路径
  // （uid 是公开信息，等于任何人可伪造他人身份），已修复且删除降级。
  return btoa(String.fromCharCode(...sig))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  // atob() 返回的是「字节字符串」：JWT payload 里 UTF-8 编码的中文会被逐字节
  // 当成 Latin-1 字符，直接 JSON.parse 就成了 mojibake（聊天室中文昵称乱码根因）。
  // 必须先还原成字节数组再按 UTF-8 解码。验签比对的是原始 parts[0]/parts[1]，
  // 不受此处影响。
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function verifySiteJwt(token: string): Promise<Session | null> {
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
    // 签名不匹配一律拒绝，绝不降级
    return null
  } catch {
    return null
  }
}

/* ---------- 封禁检查（服务端，前端绕不过） ---------- */
async function checkBan(uid: string): Promise<{ banned: boolean; reason?: string; until?: string; permanent?: boolean }> {
  try {
    const { data, error } = await db.rpc('is_account_banned', { p_user: uid, p_site: SITE })
    // 封禁系统本身异常时不阻断全站发言（可用性优先），但记录日志便于排查
    if (error) {
      console.warn('fs-chat: is_account_banned failed', error.message)
      return { banned: false }
    }
    const d = data as Record<string, unknown> | null
    if (d && d.banned === true) {
      return {
        banned: true,
        reason: d.reason ? String(d.reason) : undefined,
        until: d.until ? String(d.until) : undefined,
        permanent: d.permanent === true,
      }
    }
  } catch (e) {
    console.warn('fs-chat: is_account_banned threw', String(e))
  }
  return { banned: false }
}

/* ---------- 通用工具 ---------- */
function validateContent(raw: unknown): string | { error: string } {
  const content = String(raw || '').trim()
  if (!content) return { error: '消息不能为空' }
  if (content.length > MAX_LEN) return { error: `消息最长 ${MAX_LEN} 字` }
  const lower = content.toLowerCase()
  if (BLOCK_WORDS.some((w) => lower.includes(w.toLowerCase()))) {
    return { error: '内容包含违规信息，已被拦截' }
  }
  return content
}

// 只认 username 或 uuid，且必须能在 users 表里查到；不做模糊搜索避免枚举
async function resolvePeer(body: Record<string, unknown>): Promise<Peer | null> {
  const username = String(body.peer_username || body.to_username || '').trim().slice(0, 60)
  const uid = String(body.peer_uid || body.to_uid || '').trim()
  let row: Record<string, unknown> | undefined
  if (uid) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) return null
    const { data } = await db.from('users').select('id,username,nickname,avatar_url').eq('id', uid).limit(1)
    row = (data || [])[0] as Record<string, unknown> | undefined
  } else if (username) {
    const { data } = await db.from('users').select('id,username,nickname,avatar_url').eq('username', username).limit(1)
    row = (data || [])[0] as Record<string, unknown> | undefined
  }
  if (!row || !row.id) return null
  return {
    uid: String(row.id),
    name: String(row.nickname || row.username || '用户').slice(0, 30),
    avatar: row.avatar_url ? String(row.avatar_url).slice(0, 500) : null,
  }
}

async function cooldownHit(table: 'fs_chat_messages' | 'fs_chat_dm', uid: string, column: string): Promise<boolean> {
  const { data } = await db.from(table).select('id')
    .eq(column, uid)
    .gte('created_at', new Date(Date.now() - USER_COOLDOWN * 1000).toISOString())
    .limit(1)
  return !!data && data.length > 0
}

/* ---------- 公共大厅 ---------- */
async function handlePublicList(body: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100)
  const { data, error } = await db.from('fs_chat_messages')
    .select('id,user_id,author_name,author_avatar,content,created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return json({ error: '读取失败：' + error.message }, 500)
  return json({ ok: true, messages: (data || []).reverse() })
}

async function handlePublicSend(body: Record<string, unknown>, session: Session) {
  const content = validateContent(body.content)
  if (typeof content !== 'string') return json(content, 400)

  // 昵称/头像只取 JWT 快照（登录时签发的），前端传值一律不采信
  const authorName = String(session.nickname || session.username || '匿名').slice(0, 30)
  const authorAvatar = session.avatar_url ? String(session.avatar_url).slice(0, 500) : null

  if (await cooldownHit('fs_chat_messages', session.sub, 'user_id')) {
    return json({ error: `发得太快了，歇 ${USER_COOLDOWN} 秒` }, 429)
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
  return json({ ok: true, id: data?.[0]?.id ?? null, created_at: data?.[0]?.created_at ?? null })
}

/* ---------- 私聊 ---------- */
type DmRow = {
  id: number
  sender_id: string
  recipient_id: string
  content: string
  created_at: string
  read_at: string | null
}

async function handleDmSend(body: Record<string, unknown>, session: Session) {
  const content = validateContent(body.content)
  if (typeof content !== 'string') return json(content, 400)

  const peer = await resolvePeer(body)
  if (!peer) return json({ error: '找不到这个用户' }, 404)
  if (peer.uid === session.sub) return json({ error: '不能给自己发私聊' }, 400)

  if (await cooldownHit('fs_chat_dm', session.sub, 'sender_id')) {
    return json({ error: `发得太快了，歇 ${USER_COOLDOWN} 秒` }, 429)
  }

  const { data, error } = await db.from('fs_chat_dm').insert({
    sender_id: session.sub,
    recipient_id: peer.uid,
    content,
  }).select('id, created_at').limit(1)

  if (error) return json({ error: '发送失败：' + error.message }, 500)
  return json({
    ok: true,
    id: data?.[0]?.id ?? null,
    created_at: data?.[0]?.created_at ?? null,
    peer: { uid: peer.uid, name: peer.name, avatar: peer.avatar },
  })
}

async function handleDmThread(body: Record<string, unknown>, session: Session) {
  const peer = await resolvePeer(body)
  if (!peer) return json({ error: '找不到这个用户' }, 404)
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 100)

  // 两个方向各查一次再合并：比 PostgREST 嵌套 or(and(...)) 更稳
  const [sent, recv] = await Promise.all([
    db.from('fs_chat_dm').select('id,sender_id,recipient_id,content,created_at,read_at')
      .eq('sender_id', session.sub).eq('recipient_id', peer.uid)
      .order('created_at', { ascending: false }).limit(limit),
    db.from('fs_chat_dm').select('id,sender_id,recipient_id,content,created_at,read_at')
      .eq('sender_id', peer.uid).eq('recipient_id', session.sub)
      .order('created_at', { ascending: false }).limit(limit),
  ])
  if (sent.error || recv.error) {
    return json({ error: '读取失败：' + (sent.error?.message || recv.error?.message) }, 500)
  }
  const rows = ([...(sent.data || []), ...(recv.data || [])] as DmRow[])
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-limit)

  // 打开会话即把对方发给我的未读标记已读（失败不影响返回消息）
  await db.from('fs_chat_dm').update({ read_at: new Date().toISOString() })
    .eq('sender_id', peer.uid).eq('recipient_id', session.sub).is('read_at', null)

  return json({
    ok: true,
    peer,
    messages: rows.map((m) => ({
      id: m.id,
      content: m.content,
      created_at: m.created_at,
      mine: m.sender_id === session.sub,
      read_at: m.read_at,
    })),
  })
}

async function handleDmConversations(session: Session) {
  const { data, error } = await db.from('fs_chat_dm')
    .select('id,sender_id,recipient_id,content,created_at,read_at')
    .or(`sender_id.eq.${session.sub},recipient_id.eq.${session.sub}`)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return json({ error: '读取失败：' + error.message }, 500)

  const conv = new Map<string, { last: DmRow; unread: number }>()
  for (const m of (data || []) as DmRow[]) {
    const pid = m.sender_id === session.sub ? m.recipient_id : m.sender_id
    const cur = conv.get(pid)
    if (!cur) conv.set(pid, { last: m, unread: 0 })
    if (m.recipient_id === session.sub && !m.read_at) {
      conv.get(pid)!.unread += 1
    }
  }

  const ids = [...conv.keys()]
  const profiles = new Map<string, { name: string; avatar: string | null }>()
  if (ids.length) {
    const { data: users } = await db.from('users')
      .select('id,username,nickname,avatar_url').in('id', ids)
    for (const u of (users || []) as Record<string, unknown>[]) {
      profiles.set(String(u.id), {
        name: String(u.nickname || u.username || '用户').slice(0, 30),
        avatar: u.avatar_url ? String(u.avatar_url).slice(0, 500) : null,
      })
    }
  }

  const list = [...conv.entries()].map(([uid, c]) => ({
    peer_uid: uid,
    peer_name: profiles.get(uid)?.name || '用户',
    peer_avatar: profiles.get(uid)?.avatar || null,
    last_content: c.last.content,
    last_at: c.last.created_at,
    last_mine: c.last.sender_id === session.sub,
    unread: c.unread,
  })).sort((a, b) => b.last_at.localeCompare(a.last_at))

  return json({ ok: true, list })
}

/* ---------- 路由 ---------- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* 空体按缺少字段处理 */ }
  const action = String(body.action || '')

  // 公共大厅读消息：公开，无需登录
  if (action === 'list') return handlePublicList(body)

  const NEED_LOGIN = ['send', 'dm_send', 'dm_thread', 'dm_conversations']
  if (!NEED_LOGIN.includes(action)) return json({ error: '未知 action' }, 400)

  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  const session = token ? await verifySiteJwt(token) : null
  if (!session) return json({ error: '请先登录后再发言' }, 401)

  // 写操作前做服务端封禁检查（站点级 + 全局封禁都会被 is_account_banned 命中）
  if (action === 'send' || action === 'dm_send') {
    const ban = await checkBan(session.sub)
    if (ban.banned) {
      const msg = ban.permanent ? '账号已被封禁' : `账号封禁至 ${ban.until || '到期'}`
      return json({ error: msg, reason: ban.reason || null, until: ban.until || null, banned: true }, 403)
    }
  }

  switch (action) {
    case 'send': return handlePublicSend(body, session)
    case 'dm_send': return handleDmSend(body, session)
    case 'dm_thread': return handleDmThread(body, session)
    case 'dm_conversations': return handleDmConversations(session)
  }
  return json({ error: '未知 action' }, 400)
})
