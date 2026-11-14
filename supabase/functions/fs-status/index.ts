// ============================================================
// fs-status — 服务状态页数据代理（公开只读）
// 项目：yowwyasttkywyqseuqz（Deno Edge Functions）
//
// 为什么需要代理：
//   1) UptimeRobot 的 read-only API key 虽然不能写，但 getMonitors 原始响应
//      里带 http_username / http_password / keyword_value / port / userId 等
//      监控配置字段，放前端等于把配置公开；三把 key 也不能进公开仓库。
//   2) 免费版有速率限制，不能让每个访客各打一次上游接口 —— 这里做 60 秒
//      进程内缓存 + HTTP 缓存头。
//
// 安全边界：本函数只做「白名单字段映射」，绝不把 monitor 原始对象透传；
// 不读数据库、不接受任何用户输入、不写任何数据、不需要鉴权。
// 三把只读 key 存于 Supabase Secrets（仓库之外），轮换见 REMIND.md ⑳。
// ============================================================

const UP_API = 'https://api.uptimerobot.com/v2/getMonitors'
const CACHE_TTL = 60_000
const UP_TIMEOUT = 8_000
const RATIO_KEYS = ['d1', 'd7', 'd30', 'd90'] as const

const SERVICES = [
  { key: 'main', label: '主站', env: 'UR_MAIN_KEY' },
  { key: 'fkd', label: 'FKD', env: 'UR_FKD_KEY' },
  { key: 'qqbot', label: 'QQ bot', env: 'UR_QQBOT_KEY' },
] as const

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

  return {
    name: String(m.friendly_name || ''),
    url: String(m.url || ''),
    status: rawStatus,
    state: likelyOk ? 'likely_ok' : st.state,
    status_text: likelyOk ? ASSESS_TEXT : st.text,
    probe_state: st.state,
    probe_status_text: st.text,
    assessment: likelyOk ? { reason: latest ? latest.reason : '', note: ASSESS_NOTE } : null,
    interval: num(m.interval),
    uptime_all: num(m.all_time_uptime_ratio),
    uptime,
    avg_ms: num(m.average_response_time),
    response_times: rts.slice(0, 12).map((x) => {
      const o = (x || {}) as Record<string, unknown>
      return { t: num(o.datetime), ms: num(o.value) }
    }).filter((x) => x.t > 0),
    events,
  }
}

async function fetchMonitor(key: string): Promise<Record<string, unknown>> {
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
  if (!monitors.length) throw new Error('该 key 下没有监控项')
  return (monitors[0] || {}) as Record<string, unknown>
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'GET') return json({ ok: false, error: '只支持 GET' }, 405)

  const now = Date.now()
  if (cache && now - cache.at < CACHE_TTL) {
    return json(cache.body, 200, { 'X-Cache': 'HIT' })
  }

  const services = await Promise.all(SERVICES.map(async (s) => {
    const key = Deno.env.get(s.env) || ''
    const base = { key: s.key, label: s.label }
    if (!key) {
      return { ...base, error: '未配置只读 API key（Supabase Secret）' }
    }
    try {
      return { ...base, ...pick(await fetchMonitor(key)), error: null }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ...base, error: msg.slice(0, 150) }
    }
  }))

  const up = services.filter((s) => 'state' in s && s.state === 'up').length
  const likely = services.filter((s) => 'state' in s && s.state === 'likely_ok').length
  const issues = services.filter((s) =>
    ('error' in s && s.error) ||
    ('state' in s && s.state !== 'up' && s.state !== 'paused' && s.state !== 'likely_ok'),
  ).length

  const payload = {
    ok: true,
    generated_at: new Date().toISOString(),
    partial: services.some((s) => 'error' in s && !!s.error),
    // likely 单列：它不算 issues（不是故障），但也不能混进 up（未确证在线）。
    summary: { total: services.length, up, likely, issues, all_ok: issues === 0 },
    services,
    note: '数据来自 UptimeRobot 只读 GetMonitors，监控每 5 分钟探测一次；本响应缓存 60 秒。探针判离线但故障原因为「405 · Method Not Allowed」的，会在服务端重新解读为「大概率正常」并保留原始状态。',
  }

  cache = { at: now, body: payload }
  return json(payload, 200, { 'X-Cache': 'MISS' })
})
