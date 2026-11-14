// ============================================================
// fs-agent — 「给 AI 的指令」收件箱
// 项目：yowwyasttkywyqgseuqz（Deno Edge Functions）
//
// 两套鉴权，互不混用：
//   · 管理员（后台页面）：Authorization: Bearer <本站 JWT> + users.role='admin'
//     → create / list / cancel / stats
//   · 定时执行器（WorkBuddy 项目自动化任务）：X-Agent-Token 头
//     → claim / complete / fail / heartbeat
//     agent token 是只能操作指令队列的低权限专用密钥，不接触管理员登录态，
//     也不把 Supabase PAT / service_role 放进定时任务配置里。
//   · 代写通道：X-Write-Token 头（FS_AGENT_WRITE_TOKEN，独立生成、可单独撤销）
//     → 只允许对 fs_ 前缀业务表做 insert / upsert / update，用函数内的
//     service_role 执行。真正的 service_role 永远不下发给 AI。
//
// 私有表 fs_agent_tasks 前端零权限（RLS 无 policy + revoke all），
// 所有读写都走本函数的 service_role；认领走原子 RPC（FOR UPDATE SKIP LOCKED）。
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AGENT_TOKEN = Deno.env.get('FS_AGENT_TOKEN') || ''
const WRITE_TOKEN = Deno.env.get('FS_AGENT_WRITE_TOKEN') || ''
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-agent-token, x-write-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

const enc = new TextEncoder()
async function hmacSha256(key: string, msg: string): Promise<string> {
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
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)   // UTF-8 中文昵称必须显式解码
}

async function verifySiteJwt(token: string): Promise<{ sub: string; name: string } | null> {
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
        return {
          sub: String(payload.sub),
          name: String(payload.nickname || payload.username || '管理员'),
        }
      }
    }
    return null // 签名不匹配一律拒绝，绝不降级
  } catch { return null }
}

async function isAdmin(uid: string): Promise<boolean> {
  const { data } = await db.from('users').select('role').eq('id', uid).limit(1)
  return !!(data && data[0] && data[0].role === 'admin')
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: '仅支持 POST' }, 405)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return json({ ok: false, error: '请求体不是合法 JSON' }, 400) }
  const action = String(body.action || '').trim()

  const agentToken = req.headers.get('x-agent-token') || ''
  const writeToken = req.headers.get('x-write-token') || ''
  const auth = req.headers.get('authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  // 带 x-agent-token 的一律走 agent 通道，避免两种身份互相顶替
  const asAgent = agentToken.length > 0

  // ---------- 代写通道：独立密钥，只放行结构化写入 ----------
  // 真正的 service_role 只存在函数运行时；AI 手里只有这枚可单独撤销的 token。
  // 不给 delete、不给任意 SQL、不给队列表，避免绕过 complete/fail 状态机。
  if (!asAgent && writeToken.length > 0) {
    if (!WRITE_TOKEN || !safeEqual(writeToken, WRITE_TOKEN)) {
      return json({ ok: false, error: '代写密钥无效' }, 401)
    }
    if (action !== 'write') {
      return json({ ok: false, error: '代写通道只支持 write 操作' }, 400)
    }
    const table = String(body.table || '').trim()
    const op = String(body.op || '').trim()
    const data = body.data
    const BLOCKED = new Set(['fs_agent_tasks', 'fs_agent_worker'])
    if (!/^fs_[a-z0-9_]+$/.test(table) || BLOCKED.has(table)) {
      return json({ ok: false, error: '目标表不在允许范围内' }, 403)
    }
    if (!data || typeof data !== 'object') {
      return json({ ok: false, error: 'data 必须是对象或对象数组' }, 400)
    }
    const reason = String(body.reason || '').slice(0, 300)
    let q
    if (op === 'insert') {
      q = db.from(table).insert(data).select()
    } else if (op === 'upsert') {
      const oc = String(body.on_conflict || '').trim().slice(0, 120)
      q = oc
        ? db.from(table).upsert(data, { onConflict: oc }).select()
        : db.from(table).upsert(data).select()
    } else if (op === 'update') {
      const match = body.match
      if (!match || typeof match !== 'object' || Array.isArray(match) || !Object.keys(match).length) {
        return json({ ok: false, error: 'update 必须带 match 条件，禁止全表更新' }, 400)
      }
      q = db.from(table).update(data)
      for (const [k, v] of Object.entries(match)) {
        if (!/^[a-z0-9_]+$/.test(k)) return json({ ok: false, error: 'match 列名不合法' }, 400)
        q = q.eq(k, v)
      }
      q = q.select()
    } else {
      return json({ ok: false, error: 'op 只支持 insert / upsert / update' }, 400)
    }
    const { data: rows, error } = await q
    if (error) return json({ ok: false, error: error.message }, 400)
    console.log('[fs-agent write]', JSON.stringify({ table, op, reason, rows: (rows || []).length }))
    return json({ ok: true, table, op, rows: rows || [] })
  }

  if (asAgent) {
    if (!AGENT_TOKEN || !safeEqual(agentToken, AGENT_TOKEN)) {
      return json({ ok: false, error: '执行器密钥无效' }, 401)
    }
    if (action === 'heartbeat') {
      const note = String(body.note || '定时检查').slice(0, 400)
      const ok = body.ok !== false
      const { error } = await db.rpc('fs_agent_heartbeat', { p_note: note, p_ok: ok })
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true, note, at: new Date().toISOString() })
    }
    if (action === 'claim') {
      const limit = Math.max(1, Math.min(Number(body.limit) || 5, 20))
      const { data, error } = await db.rpc('fs_agent_claim', { p_limit: limit })
      if (error) return json({ ok: false, error: error.message }, 500)
      return json({ ok: true, count: (data || []).length, tasks: data || [] })
    }
    if (action === 'complete' || action === 'fail') {
      const id = Number(body.id)
      if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: '缺少有效 id' }, 400)
      const text = String(body.result || body.error || '').trim()
      if (action === 'complete' && !text) return json({ ok: false, error: '完成时必须写执行回执' }, 400)
      if (action === 'fail' && !text) return json({ ok: false, error: '失败时必须写原因' }, 400)
      const { data, error } = await db.rpc('fs_agent_finish', {
        p_id: id,
        p_ok: action === 'complete',
        p_result: action === 'complete' ? text.slice(0, 8000) : '',
        p_error: action === 'fail' ? text.slice(0, 2000) : '',
      })
      if (error) return json({ ok: false, error: error.message }, 500)
      if (!data) return json({ ok: false, error: '该指令不是「执行中」状态，回写被忽略' }, 409)
      return json({ ok: true, id, status: action === 'complete' ? 'done' : 'failed' })
    }
    return json({ ok: false, error: '执行器不支持该操作：' + action }, 400)
  }

  // ---------- 以下均为管理员通道 ----------
  const session = bearer ? await verifySiteJwt(bearer) : null
  if (!session) return json({ ok: false, error: '登录态无效或已过期，请重新登录' }, 401)
  if (!await isAdmin(session.sub)) return json({ ok: false, error: '需要管理员权限' }, 403)

  if (action === 'create') {
    const text = String(body.body || '').trim()
    if (!text || text.length > 4000) return json({ ok: false, error: '指令需 1–4000 字' }, 400)
    const priority = body.priority === 'high' ? 'high' : 'normal'
    const { data, error } = await db.from('fs_agent_tasks').insert({
      body: text,
      priority,
      status: 'pending',
      created_by: session.sub,
      created_by_name: session.name,
    }).select('id, body, priority, status, created_at').limit(1)
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true, task: data && data[0] ? data[0] : null })
  }

  if (action === 'list') {
    const { data, error } = await db.from('fs_agent_tasks')
      .select('id,body,priority,status,created_by_name,created_at,claimed_at,finished_at,result,attempts,last_error')
      .order('created_at', { ascending: false }).limit(50)
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true, list: data || [] })
  }

  if (action === 'cancel') {
    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: '缺少有效 id' }, 400)
    const { data, error } = await db.from('fs_agent_tasks')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'pending').select('id')
    if (error) return json({ ok: false, error: error.message }, 500)
    if (!data || !data.length) return json({ ok: false, error: '只能撤回「待处理」的指令' }, 409)
    return json({ ok: true, id })
  }

  if (action === 'stats') {
    const { data, error } = await db.from('fs_agent_tasks').select('status')
    if (error) return json({ ok: false, error: error.message }, 500)
    const counts: Record<string, number> = { pending: 0, claimed: 0, done: 0, failed: 0, cancelled: 0 }
    for (const r of data || []) {
      const k = String(r.status)
      if (k in counts) counts[k]++
    }
    const { data: w } = await db.from('fs_agent_worker')
      .select('last_seen,last_ok,last_error,note,runs').eq('id', 1).limit(1)
    const hb = w && w[0] ? w[0] : null
    // 定时任务是每 12 小时一次；没跑过时给不出「下次」，如实返回 null
    const nextAt = hb && hb.last_seen
      ? new Date(new Date(hb.last_seen).getTime() + 12 * 60 * 60 * 1000).toISOString()
      : null
    return json({
      ok: true, counts,
      worker: hb ? {
        last_seen: hb.last_seen, last_ok: hb.last_ok, last_error: hb.last_error,
        note: hb.note, runs: hb.runs,
      } : null,
      interval_hours: 12,
      next_at: nextAt,
    })
  }

  return json({ ok: false, error: '未知操作：' + action }, 400)
})
