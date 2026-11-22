// ============================================================
// fs-status — 服务状态页数据代理（公开只读）
// 项目：yowwyasttkywyqseuqz（Deno Edge Functions）
//
// 为什么需要代理：
//   1) UptimeRobot 的 API 响应里带 http_username / http_password / keyword_value /
//      port / userId 等监控配置字段，放前端等于把配置公开；密钥也不能进公开仓库。
//   2) 免费版有速率限制，不能让每个访客各打一次上游接口 —— 这里做 60 秒
//      进程内缓存 + HTTP 缓存头。
//
// 取数方式：账号级 Main API Key 单次 getMonitors，返回账号下**全部监控项**，
// 新增监控不需要改代码、不需要加 Secret。顺序按角色规则排（主站 → API → FKD → bot），
// 认不出的监控项按创建时间排在后面，label 用 UptimeRobot 里的友好名称。
//
// 安全边界：本函数只做「白名单字段映射」，绝不把 monitor 原始对象透传；
// 不读数据库、不接受任何用户输入、不写任何数据、不需要鉴权。
// 主密钥存于 Supabase Secrets（仓库之外），轮换见 REMIND.md。
// ============================================================

const UP_API = 'https://api.uptimerobot.com/v2/getMonitors'
const CACHE_TTL = 60_000
const UP_TIMEOUT = 10_000
const RATIO_KEYS = ['d1', 'd7', 'd30', 'd90'] as const

// 账号级 Main API Key（可读全部监控）。仅存在 Supabase Secrets。
const ACCOUNT_KEY_ENV = 'UR_ACCOUNT_KEY'

type Role = { key: string; label: string; order: number }

// 只按「主机名」归类，不依赖监控 id 或显示名 —— 监控重建后依然认得出。
// 顺序即状态页排序：核心链路在前，附属服务在后。
const ROLES: Array<{ test: (host: string) => boolean; role: Role }> = [
  { test: (h) => h === 'fesui.xn--0iv.gay' || h === 'fesui.是.gay', role: { key: 'main', label: '主站', order: 10 } },
  { test: (h) => h.startsWith('api.') && h.includes('fesui'), role: { key: 'api', label: 'API 反代', order: 20 } },
  { test: (h) => h.startsWith('fkd.'), role: { key: 'fkd', label: 'FKD', order: 30 } },
  { test: (h) => h.includes('qqbot'), role: { key: 'qqbot', label: 'QQ bot', order: 40 } },
]
const FALLBACK_ORDER = 90

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=60, s-maxage=60',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
}

// UptimeRobot v2 monitor status
const STATUS: Record<number, { state: string; text: string }> = {
  0: { state: 'paused', text: '已暂停' },
  1: { state: 'pending', text: '待首次检测' },
  2: { state: 'up', text: '在线' },
  8: { state: 'seems_down', text: '疑似离线' },
  9: { state: 'down', text: '离线' },
}

// UptimeRobot v2 log type（只展示语义，不复述上游原始对象）
const LOG_TYPE: Record<number, string> = {
  1: '故障',
  2: '恢复',
  98: '恢复监控',
  99: '暂停监控',
}

// 监控类型：同一主机可能有 HTTP 与关键字两种探针，展示时要分得清。
const CHECK_TYPE: Record<number, string> = {
  1: 'HTTP',
  2: '关键字',
  3: 'Ping',
  4: '端口',
}

// 「405 · Method Not Allowed」的常见成因：目标在线但健康检查端点不接受探针
// 使用的探测方法，于是把请求挡了回来 —— 服务在网络层是有响应的，并不是故障。
// 只在「当前被判离线」且「最新故障事件原因就是它」时才重新解读为「大概率正常」；
// 其它 4xx/5xx、超时、DNS 等一律保留探针原始判定，绝不放宽。
const METHOD_405 = /\b405\b[\s\S]*method\s*not\s*allowed|\bmethod\s*not\s*allowed[\s\S]*\b405\b/i
const ASSESS_NOTE = '探针请求被目标拒绝（健康检查端点不接受该探测方法），说明服务在网络层有响应。这不等于服务故障，但也不等于已确证在线，仍建议核对监控配置。'
const ASSESS_TEXT = '大概率正常'

type CacheEntry = { at: number; body: unknown } | null
let cache: CacheEntry = null

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, ...extra, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function reasonText(r: unknown): string {
  if (!r) return ''
  if (typeof r === 'string') return r.slice(0, 120)
  if (typeof r !== 'object') return ''
  const o = r as Record<string, unknown>
  return [o.code, o.detail]
    .filter((x) => x !== undefined && x !== null && x !== '')
    .map((x) => String(x))
    .join(' · ')
    .slice(0, 120)
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** 从上游 monitor 里挑出「可公开展示」的字段，其余一律丢弃。 */
function pick(m: Record<string, unknown>) {
  const rawStatus = num(m.status)
  const st = STATUS[rawStatus] || { state: 'unknown', text: '未知' }
  const ratios = String(m.custom_uptime_ratio || '')
    .split('-')
    .map((x) => {
      const n = Number(x)
      return Number.isFinite(n) ? n : null
    })
  const uptime: Record<string, number | null> = {}
  RATIO_KEYS.forEach((k, i) => { uptime[k] = ratios[i] ?? null })

  const rts = Array.isArray(m.response_times) ? m.response_times : []
  const logs = Array.isArray(m.logs) ? m.logs : []

  const events = logs.slice(0, 5).map((x) => {
    const o = (x || {}) as Record<string, unknown>
    const type = num(o.type)
    return {
      type,
      type_text: LOG_TYPE[type] || '事件',
      t: num(o.datetime),
      duration: num(o.duration),
      reason: reasonText(o.reason),
    }
  }).filter((x) => x.t > 0)

  // 只有「当前仍被判离线」且「最新一条故障事件的原因明确是 405 Method Not Allowed」
  // 才重新解读。原始探针状态与文案一并保留，前端会把两者都展示出来，不隐藏异常。
  const latest = events[0]
  const likelyOk = (rawStatus === 9 || rawStatus === 8) &&
    !!latest && latest.type === 1 && METHOD_405.test(latest.reason)

  const url = String(m.url || '')
  const name = String(m.friendly_name || '')

  return {
    name,
    url,
    status: rawStatus,
    state: likelyOk ? 'likely_ok' : st.state,
    status_text: likelyOk ? ASSESS_TEXT : st.text,
    probe_state: st.state,
    probe_status_text: st.text,
    assessment: likelyOk ? { reason: latest ? latest.reason : '', note: ASSESS_NOTE } : null,
    interval: num(m.interval),
    check: num(m.type),
    check_text: CHECK_TYPE[num(m.type)] || '监控',
    uptime_all: num(m.all_time_uptime_ratio),
    uptime,
    avg_ms: num(m.average_response_time),
    response_times: rts.slice(0, 12).map((x) => {
      const o = (x || {}) as Record<string, unknown>
      return { t: num(o.datetime), ms: num(o.value) }
    }).filter((x) => x.t > 0),
    events,
    // 排序用，不进响应
    _order: 0,
    _created: num(m.create_datetime),
  }
}

type Service = ReturnType<typeof pick> & { key: string; label: string }

function classify(m: Record<string, unknown>): Service {
  const base = pick(m)
  const host = hostOf(base.url)
  const hit = ROLES.find((r) => r.test(host))
  const id = num(m.id)
  if (hit) {
    return { ...base, _order: hit.role.order, key: hit.role.key, label: hit.role.label }
  }
  // 认不出的监控项也照样展示：用友好名称或主机名当标签，排在有序项之后。
  return {
    ...base,
    _order: FALLBACK_ORDER,
    key: id ? `m${id}` : host || 'monitor',
    label: base.name || host || '监控项',
  }
}

function pathLabel(u: string): string {
  try {
    const p = new URL(u).pathname
    return !p || p === '/' ? '根路径' : p
  } catch {
    return '未知路径'
  }
}

/**
 * 同一角色可能挂多个监控（例如同一台机器既有 HTTP 探针又有关键字探针）。
 * 这类同名项会让访客分不清，给标签补上路径；路径也撞了就再补序号。
 */
function dedupe(list: Service[]): Service[] {
  const total = new Map<string, number>()
  for (const s of list) total.set(s.key, (total.get(s.key) || 0) + 1)
  const used = new Map<string, number>()
  return list.map((s) => {
    if ((total.get(s.key) || 0) <= 1) return s
    const suffix = pathLabel(s.url)
    const slug = suffix.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root'
    let key = `${s.key}-${slug}`
    let label = `${s.label} · ${suffix}`
    const n = used.get(key) || 0
    used.set(key, n + 1)
    if (n > 0) {
      label = `${label} #${n + 1}`
      key = `${key}-${n + 1}`
    }
    return { ...s, key, label }
  })
}

async function fetchAll(key: string): Promise<Record<string, unknown>[]> {
  const body = new URLSearchParams({
    api_key: key,
    format: 'json',
    logs: '1',
    logs_limit: '5',
    response_times: '1',
    response_times_limit: '12',
    all_time_uptime_ratio: '1',
    custom_uptime_ratios: '1-7-30-90',
  })
  const r = await fetch(UP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(UP_TIMEOUT),
  })
  if (!r.ok) throw new Error(`上游 HTTP ${r.status}`)
  const d = await r.json() as Record<string, unknown>
  if (d.stat !== 'ok') {
    const e = d.error as Record<string, unknown> | undefined
    throw new Error(String(e?.message || '上游返回失败'))
  }
  const monitors = Array.isArray(d.monitors) ? d.monitors : []
  if (!monitors.length) throw new Error('账号下没有监控项')
  return monitors as Record<string, unknown>[]
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'GET') return json({ ok: false, error: '只支持 GET' }, 405)

  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL) {
    return json(cache.body, 200, { 'X-Cache': 'HIT' })
  }

  const key = Deno.env.get(ACCOUNT_KEY_ENV) || ''
  if (!key) {
    return json({
      ok: false,
      error: `未配置账号级 API key（Secret ${ACCOUNT_KEY_ENV}）`,
      generated_at: new Date().toISOString(),
    }, 503)
  }

  let services: Service[]
  try {
    const monitors = await fetchAll(key)
    services = dedupe(monitors.map(classify))
      .sort((a, b) => (a._order - b._order) || (a._created - b._created))
      .map(({ _order, _created, ...rest }) => rest as Service)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return json({
      ok: false,
      error: `监控接口不可用：${msg.slice(0, 150)}`,
      generated_at: new Date().toISOString(),
    }, 502)
  }

  const up = services.filter((s) => s.state === 'up').length
  const likely = services.filter((s) => s.state === 'likely_ok').length
  const paused = services.filter((s) => s.state === 'paused').length
  const issues = services.filter((s) =>
    s.state !== 'up' && s.state !== 'paused' && s.state !== 'likely_ok',
  ).length

  const payload = {
    ok: true,
    generated_at: new Date().toISOString(),
    partial: false,
    // likely 单列：它不算 issues（不是故障），但也不能混进 up（未确证在线）。
    summary: { total: services.length, up, likely, paused, issues, all_ok: issues === 0 },
    services,
    note: '数据来自 UptimeRobot 账号级 GetMonitors，覆盖本站全部监控项，每 5 分钟探测一次；本响应缓存 60 秒。探针判离线但故障原因为「405 · Method Not Allowed」的，会在服务端重新解读为「大概率正常」并保留原始状态。',
  }

  cache = { at: now, body: payload }
  return json(payload, 200, { 'X-Cache': 'MISS' })
})
