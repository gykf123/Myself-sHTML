// ============================================================
// fs-blog — 博客文章写通道（管理员）
// 项目：yowwyasttkywyqgseuqz（Deno Edge Functions）
//
// 读：公开文章直接走 REST（fs_posts_public_read policy 只放行 published=true），
//     草稿前端一条都看不到，省一次函数调用。
// 写：只走本函数，服务端验 users.role='admin'，author_id 只信 JWT sub。
// 博客前台渲染 Markdown 时在浏览器里做转义，这里存原始文本即可。
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

async function verifySiteJwt(token: string): Promise<string | null> {
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
      if ((await hmacSha256(secret, parts[0] + '.' + parts[1])) === parts[2]) return payload.sub
    }
    return null
  } catch { return null }
}

async function isAdmin(uid: string): Promise<boolean> {
  const { data } = await db.from('users').select('role').eq('id', uid).limit(1)
  return !!(data && data[0] && data[0].role === 'admin')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const auth = req.headers.get('Authorization') || ''
  const uid = await verifySiteJwt(auth.replace(/^Bearer\s+/i, ''))
  if (!uid) return json({ ok: false, error: '登录态无效或已过期，请重新登录' }, 401)
  if (!await isAdmin(uid)) return json({ ok: false, error: '需要管理员权限' }, 403)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* 空体按缺字段处理 */ }
  const action = String(body.action || '')

  if (action === 'post_list') {
    const { data, error } = await db.from('fs_posts')
      .select('id,slug,title,summary,published,created_at,updated_at')
      .order('created_at', { ascending: false }).limit(200)
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true, posts: data || [] })
  }

  if (action === 'post_get') {
    const id = Number(body.id)
    if (!Number.isFinite(id)) return json({ ok: false, error: '缺少文章 id' }, 400)
    const { data, error } = await db.from('fs_posts').select('*').eq('id', id).limit(1)
    if (error) return json({ ok: false, error: error.message }, 500)
    if (!data || !data[0]) return json({ ok: false, error: '文章不存在' }, 404)
    return json({ ok: true, post: data[0] })
  }

  if (action === 'post_save') {
    const slug = String(body.slug || '').trim().toLowerCase()
    const title = String(body.title || '').trim()
    const summary = String(body.summary || '').trim()
    const content = String(body.content || '')
    const published = body.published === true
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
      return json({ ok: false, error: 'slug 只允许小写字母/数字/连字符，且不超过 80 字符' }, 400)
    }
    if (!title || title.length > 120) return json({ ok: false, error: '标题需 1–120 字' }, 400)
    if (summary.length > 300) return json({ ok: false, error: '摘要最长 300 字' }, 400)
    if (!content) return json({ ok: false, error: '正文不能为空' }, 400)
    if (content.length > 100000) return json({ ok: false, error: '正文过长' }, 400)

    const id = Number(body.id)
    const patch = {
      slug, title, summary, content, published,
      updated_at: new Date().toISOString(),
    }
    let error: { message: string; code?: string } | null = null
    let savedId: number | null = null
    if (Number.isFinite(id) && id > 0) {
      const r = await db.from('fs_posts').update(patch).eq('id', id).select('id').limit(1)
      error = r.error
      savedId = id
    } else {
      const r = await db.from('fs_posts')
        .insert({ ...patch, author_id: uid }).select('id').limit(1)
      error = r.error
      savedId = r.data && r.data[0] ? r.data[0].id : null
    }
    if (error) {
      const dup = error.code === '23505' || /duplicate|unique/i.test(error.message)
      return json({ ok: false, error: dup ? '该 slug 已被占用，换一个' : ('保存失败：' + error.message) },
                  dup ? 409 : 500)
    }
    return json({ ok: true, id: savedId })
  }

  if (action === 'post_delete') {
    const id = Number(body.id)
    if (!Number.isFinite(id)) return json({ ok: false, error: '缺少文章 id' }, 400)
    const { error } = await db.from('fs_posts').delete().eq('id', id)
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true })
  }

  return json({ ok: false, error: '未知操作：' + action }, 400)
})
