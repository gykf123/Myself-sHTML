/* ============================================================
   访问统计（stats/）页面逻辑
   - 只读：POST fs_visit_stats_public RPC 取聚合数值
   - 严禁写入：不调用 record_visit、不插入任何测试数据、不写库
   - 本页同样引入 /visit.js：统计页本身也是一次站点访问，与其他页面口径一致
   - 图表全部手写 SVG / CSS，零外部依赖
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
const ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
const RPC_PATH = '/rest/v1/rpc/fs_visit_stats_public';
const SITE = 'fesui';
const TIMEOUT_MS = 10000;

const $ = (sel, root = document) => root.querySelector(sel);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function fmtNum(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return v.toLocaleString('zh-CN');
}
function fmtAxis(v) {
  return String(Math.round(v * 10) / 10);
}
function shortDay(s) {
  const t = String(s || '');
  const m = t.match(/^\d{4}-(\d{2}-\d{2})/);
  return m ? m[1] : t.slice(-5);
}
/* 北京时间 = UTC+8，不依赖 Intl 时区数据库 */
function fmtBeijing(d) {
  const p = n => String(n).padStart(2, '0');
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return p(bj.getUTCMonth() + 1) + '-' + p(bj.getUTCDate()) + ' ' +
    p(bj.getUTCHours()) + ':' + p(bj.getUTCMinutes()) + ':' + p(bj.getUTCSeconds());
}

/* ---------- 页面状态 ---------- */
const state = {
  days: 30,
  status: 'idle',        // idle | loading | ok | error
  data: null,
  error: '',
  updatedAt: null,
};
let reqSeq = 0;          // 防止快速切换窗口时旧响应覆盖新结果

function normalize(d) {
  return {
    total: Math.max(0, Number(d.total) || 0),
    unique_users: Math.max(0, Number(d.unique_users) || 0),
    today: Math.max(0, Number(d.today) || 0),
    yesterday: Math.max(0, Number(d.yesterday) || 0),
    by_day: Array.isArray(d.by_day) ? d.by_day.map(x => ({
      day: String(x && x.day != null ? x.day : ''),
      visits: Math.max(0, Number(x && x.visits) || 0),
      users: Math.max(0, Number(x && x.users) || 0),
    })) : [],
    by_path: Array.isArray(d.by_path) ? d.by_path.map(x => ({
      path: String(x && x.path != null ? x.path : '/'),
      visits: Math.max(0, Number(x && x.visits) || 0),
    })) : [],
  };
}
function hasData(d) {
  return !!(d && (
    d.total > 0 ||
    d.by_day.some(x => x.visits > 0) ||
    d.by_path.some(x => x.visits > 0)
  ));
}

/* ---------- 只读 RPC（带超时） ---------- */
async function rpc(days) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SUPABASE_URL + RPC_PATH, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_site: SITE, p_days: days }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const raw = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = raw && (raw.message || raw.error) ? String(raw.message || raw.error) : ('HTTP ' + res.status);
      throw new Error(msg);
    }
    let payload = raw;
    if (Array.isArray(payload)) payload = payload.length === 1 ? payload[0] : null;
    if (!payload || typeof payload !== 'object' || payload.ok !== true) {
      const why = payload && (payload.message || payload.error) ? String(payload.message || payload.error) : '接口返回异常';
      throw new Error(why);
    }
    return normalize(payload);
  } finally {
    clearTimeout(timer);
  }
}

async function load(days) {
  const seq = ++reqSeq;
  state.days = days;
  state.status = 'loading';
  state.error = '';
  render();
  try {
    const data = await rpc(days);
    if (seq !== reqSeq) return;
    state.data = data;
    state.status = 'ok';
    state.updatedAt = new Date();
  } catch (e) {
    if (seq !== reqSeq) return;
    state.status = 'error';
    state.error = (e && e.name === 'AbortError')
      ? '请求超时，请检查网络后重试'
      : (e && e.message ? String(e.message) : '网络异常，请稍后重试');
  }
  render();
}

/* ---------- 状态块 ---------- */
function statusHtml(kind, detail) {
  if (kind === 'loading') {
    return '<div class="st-status" role="status">' +
      '<span class="st-spinner" aria-hidden="true"></span>' +
      '<span>正在加载统计数据…</span></div>';
  }
  if (kind === 'error') {
    return '<div class="st-status st-status-error" role="alert">' +
      '<div class="st-status-ico" aria-hidden="true">⚠️</div>' +
      '<p class="st-status-title">数据加载失败</p>' +
      '<p class="st-status-detail">' + escapeHtml(detail || '网络异常，请稍后重试') + '</p>' +
      '<button type="button" class="act-btn small st-retry-btn" data-action="retry">重试</button>' +
      '</div>';
  }
  return '<div class="st-status">' +
    '<div class="st-status-ico" aria-hidden="true">📭</div>' +
    '<p class="st-status-title">还没有访问数据</p>' +
    '<p class="st-status-detail">等站点产生匿名访问上报后，这里就会出现趋势与排行。</p>' +
    '</div>';
}

/* ---------- 概览卡 ---------- */
function renderCards() {
  const box = $('#stCards');
  if (!box) return;
  const d = state.data;
  const value = (k) => {
    if (state.status === 'loading') return '…';
    if (state.status === 'error') return '—';
    return d ? fmtNum(d[k]) : '0';
  };
  let delta = '';
  if (d && state.status === 'ok') {
    const diff = d.today - d.yesterday;
    if (diff > 0) delta = '<span class="st-delta up">↑ +' + fmtNum(diff) + ' 较昨日</span>';
    else if (diff < 0) delta = '<span class="st-delta down">↓ -' + fmtNum(-diff) + ' 较昨日</span>';
    else delta = '<span class="st-delta">— 与昨日持平</span>';
  }
  const cards = [
    ['总访问量', value('total'), escapeHtml('近 ' + state.days + ' 天累计')],
    ['独立访客', value('unique_users'), '统计窗口内去重访客'],
    ['今日', value('today'), delta || '北京时间今日'],
    ['昨日', value('yesterday'), '北京时间昨日'],
  ];
  box.innerHTML = cards.map(c =>
    '<div class="st-card">' +
      '<div class="st-card-label">' + escapeHtml(c[0]) + '</div>' +
      '<div class="st-card-value">' + escapeHtml(c[1]) + '</div>' +
      '<div class="st-card-note">' + c[2] + '</div>' +
    '</div>'
  ).join('');
}

/* ---------- 趋势图（原生 SVG） ---------- */
function niceScale(maxV) {
  const v = Math.max(0, Number(maxV) || 0);
  if (v <= 4) return { max: 4, step: 1 };          // 避免除以 0 / NaN 坐标
  const raw = v / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const stepN = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = stepN * pow;
  return { max: Math.max(step, Math.ceil(v / step) * step), step: step };
}

function buildTrendSvg(days) {
  const W = 760, H = 260;
  const padL = 48, padR = 16, padT = 16, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;
  const n = days.length;
  const values = days.map(x => x.visits);
  const maxV = Math.max.apply(null, values.concat([0]));
  const scale = niceScale(maxV);
  const xAt = i => padL + (n === 1 ? plotW / 2 : plotW * i / (n - 1));
  const yAt = v => baseY - plotH * (v / scale.max);
  const pts = values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));

  const out = [];
  out.push('<svg class="st-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
    'aria-label="每日访问量趋势折线图" preserveAspectRatio="xMidYMid meet">');
  // 渐变色走 CSS 变量；currentColor 作为不支持 CSS stop-color 时的兜底
  out.push('<defs><linearGradient id="stAreaGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" class="st-grad-top" stop-color="currentColor" stop-opacity="0.34" />' +
    '<stop offset="100%" class="st-grad-bottom" stop-color="currentColor" stop-opacity="0.02" />' +
    '</linearGradient></defs>');

  const lines = Math.max(1, Math.round(scale.max / scale.step));
  for (let i = 0; i <= lines; i++) {
    const gv = i * scale.step;
    const gy = yAt(gv);
    out.push('<line class="st-grid" x1="' + padL + '" y1="' + gy.toFixed(1) +
      '" x2="' + (padL + plotW) + '" y2="' + gy.toFixed(1) + '" />');
    out.push('<text class="st-axis-y" x="' + (padL - 9) + '" y="' + (gy + 4).toFixed(1) +
      '" text-anchor="end">' + escapeHtml(fmtAxis(gv)) + '</text>');
  }
  out.push('<line class="st-axis-line" x1="' + padL + '" y1="' + padT +
    '" x2="' + padL + '" y2="' + baseY + '" />');
  out.push('<line class="st-axis-line" x1="' + padL + '" y1="' + baseY +
    '" x2="' + (padL + plotW) + '" y2="' + baseY + '" />');

  // X 轴标签抽稀：总点数多时按间隔显示，且与末标签保持距离避免重叠
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const labelIdx = [];
  for (let i = 0; i < n; i++) if (i % labelEvery === 0) labelIdx.push(i);
  if (n > 1 && labelIdx[labelIdx.length - 1] !== n - 1) labelIdx.push(n - 1);
  const minGap = labelEvery > 1 ? 2 : 1;
  let prev = -1e9;
  for (let k = 0; k < labelIdx.length; k++) {
    const idx = labelIdx[k];
    if (idx - prev < minGap) continue;
    prev = idx;
    out.push('<text class="st-axis-x" x="' + xAt(idx).toFixed(1) + '" y="' + (baseY + 21) +
      '" text-anchor="middle">' + escapeHtml(shortDay(days[idx].day)) + '</text>');
  }

  const lineD = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  const areaD = 'M' + pts[0].x.toFixed(1) + ',' + baseY.toFixed(1) + ' ' +
    pts.map(p => 'L' + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ') +
    ' L' + pts[n - 1].x.toFixed(1) + ',' + baseY.toFixed(1) + ' Z';
  out.push('<path class="st-area" d="' + areaD + '" />');
  out.push('<path class="st-line" d="' + lineD + '" />');

  const showDots = n <= 31;
  if (showDots) {
    for (let i = 0; i < n; i++) {
      out.push('<circle class="st-dot" cx="' + pts[i].x.toFixed(1) +
        '" cy="' + pts[i].y.toFixed(1) + '" r="3" />');
    }
  }
  // 透明命中圆 + <title> 实现零依赖的 hover 提示
  for (let i = 0; i < n; i++) {
    const tip = days[i].day + ' · ' + fmtNum(days[i].visits) + ' 次访问 · ' +
      fmtNum(days[i].users) + ' 位访客';
    out.push('<circle class="st-hit" cx="' + pts[i].x.toFixed(1) +
      '" cy="' + pts[i].y.toFixed(1) + '" r="11"><title>' + escapeHtml(tip) + '</title></circle>');
  }
  out.push('</svg>');
  return out.join('');
}

function renderTrend() {
  const box = $('#stTrendChart');
  if (!box) return;
  if (state.status === 'loading' || state.status === 'idle') { box.innerHTML = statusHtml('loading'); return; }
  if (state.status === 'error') { box.innerHTML = statusHtml('error', state.error); return; }
  const d = state.data;
  if (!d || !hasData(d) || !d.by_day.length) { box.innerHTML = statusHtml('empty'); return; }
  box.innerHTML = buildTrendSvg(d.by_day);
}

/* ---------- 路径 Top 10 ---------- */
/* 只允许跳到本站内路径：以站点根为 base 解析，校验同源 + http(s) */
function safePathHref(path) {
  const p = String(path || '').trim();
  if (!p) return '../';
  try {
    const root = new URL('../', location.href);
    const rel = p.replace(/^\/+/, '');           // 去掉前导斜杠，拼到站点根
    const u = new URL(rel, root);
    if (u.origin !== location.origin) return '../';
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '../';
    return u.href;
  } catch (e) {
    return '../';
  }
}

function renderPaths() {
  const box = $('#stPaths');
  if (!box) return;
  if (state.status === 'loading' || state.status === 'idle') { box.innerHTML = statusHtml('loading'); return; }
  if (state.status === 'error') { box.innerHTML = statusHtml('error', state.error); return; }
  const d = state.data;
  const items = d && d.by_path ? d.by_path.slice(0, 10) : [];
  if (!items.length || !hasData(d)) { box.innerHTML = statusHtml('empty'); return; }

  box.textContent = '';            // 清空并全程用 textContent 写入，杜绝 XSS
  const max = Math.max.apply(null, items.map(x => x.visits).concat([0])) || 1;
  items.forEach(it => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'st-path-row';
    row.title = it.path + ' · ' + fmtNum(it.visits) + ' 次访问（点击访问该页面）';

    const label = document.createElement('span');
    label.className = 'st-path-label';
    label.textContent = it.path;          // 路径文本：textContent，绝不拼接 innerHTML

    const track = document.createElement('span');
    track.className = 'st-path-track';
    const fill = document.createElement('span');
    fill.className = 'st-path-fill';
    fill.style.width = (it.visits / max * 100).toFixed(1) + '%';
    track.appendChild(fill);

    const val = document.createElement('span');
    val.className = 'st-path-value';
    val.textContent = fmtNum(it.visits);

    row.appendChild(label);
    row.appendChild(track);
    row.appendChild(val);
    row.addEventListener('click', () => { location.href = safePathHref(it.path); });
    box.appendChild(row);
  });
}

/* ---------- 总渲染 ---------- */
function render() {
  const btns = document.querySelectorAll('.st-range-btn');
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i];
    const on = Number(b.getAttribute('data-days')) === state.days;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const refresh = $('#stRefresh');
  if (refresh) {
    refresh.disabled = state.status === 'loading';
    refresh.textContent = state.status === 'loading' ? '加载中…' : '刷新';
  }
  const upd = $('#stUpdated');
  if (upd) {
    if (state.status === 'loading') upd.textContent = '正在更新…';
    else if (state.updatedAt) upd.textContent = '更新于 ' + fmtBeijing(state.updatedAt);
    else if (state.status === 'error') upd.textContent = '更新失败';
    else upd.textContent = '';
  }
  const wl = $('#stTrendWindow');
  if (wl) wl.textContent = '近 ' + state.days + ' 天';

  renderCards();
  renderTrend();
  renderPaths();
}

/* ---------- 启动 ---------- */
(function init() {
  const y = $('#footYear');
  if (y) y.textContent = String(new Date().getFullYear());

  const btns = document.querySelectorAll('.st-range-btn');
  for (let i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', () => {
      const days = Number(btns[i].getAttribute('data-days'));
      if (days === 7 || days === 30 || days === 90) load(days);
    });
  }
  const refresh = $('#stRefresh');
  if (refresh) refresh.addEventListener('click', () => load(state.days));

  // 失败态里的「重试」按钮是动态生成的，用事件委托统一接管
  document.addEventListener('click', (e) => {
    const t = e.target;
    const retry = t && t.closest ? t.closest('[data-action="retry"]') : null;
    if (retry) { e.preventDefault(); load(state.days); }
  });

  load(30);
})();
