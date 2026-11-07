/* ============================================================
   管理后台（admin/）页面逻辑
   - 门禁：本地判断登录态 → 服务端用 list_account_bans 判定管理员
   - 所有管理 RPC 只用「当前登录用户自己的 JWT」，服务端内部验
     users.role='admin'；前端绝不放 service_role，也不留任何绕过路径
   - 业务错误约定：HTTP 200 + {ok:false,msg}，必须看 ok 字段
   - 用户可控文本一律 escapeHtml / textContent，杜绝 XSS
   - 封禁 / 解封是敏感写操作，一律二次确认
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
const ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
const AUTH_KEY = 'fe_token';
const SITE = 'fesui';
const $ = (s, r = document) => r.querySelector(s);

function getToken() { try { return localStorage.getItem(AUTH_KEY) || ''; } catch (e) { return ''; } }
function clearToken() { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} }
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function parseJwt(t) {
  try {
    const p = String(t).split('.');
    if (p.length !== 3) return null;
    let b64 = p[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch (e) { return null; }
}
function session() {
  const t = getToken(), p = t ? parseJwt(t) : null;
  if (!p || !p.sub || (p.exp && p.exp * 1000 <= Date.now())) return null;
  return { token: t, payload: p, name: String(p.nickname || p.username || '管理员') };
}
function fmtDateTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  } catch (e) { return '—'; }
}
function loginHref() {
  const back = location.origin + location.pathname;
  return '../login/index.html?brand=FeSui&home=' +
    encodeURIComponent(location.origin + '/') +
    '&redirect=' + encodeURIComponent(back);
}
function showToast(text) {
  let el = $('#adminToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'adminToast';
    el.className = 'user-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------- RPC（一律带当前用户 JWT） ---------- */
async function rpc(name, body, s) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.token
    },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const main = $('#adminMain');
let bans = [];

/* ---------- 门禁态 ---------- */
function renderGate(kind, detail) {
  const cfg = {
    login: {
      ico: '🔑', title: '需要登录',
      text: '管理后台只对站点管理员开放，请先用管理员账号登录。',
      btn: '登录 / 注册', href: loginHref()
    },
    denied: {
      ico: '⛔', title: '没有管理权限',
      text: '当前账号不是管理员。封禁记录与访问明细不会向普通账号开放。',
      btn: '返回个人中心', href: '../user/'
    },
    error: {
      ico: '⚠️', title: '暂时读不到数据',
      text: detail || '管理接口没有正常返回，稍后再试一次。',
      btn: '重试', href: null
    }
  }[kind];
  main.textContent = '';
  const sec = document.createElement('section');
  sec.className = 'user-card';
  sec.innerHTML =
    '<div class="ad-gate">' +
      '<div class="ad-gate-ico" aria-hidden="true">' + cfg.ico + '</div>' +
      '<h2>' + escapeHtml(cfg.title) + '</h2>' +
      '<p>' + escapeHtml(cfg.text) + '</p>' +
      (cfg.href
        ? '<a class="act-btn primary" href="' + escapeHtml(cfg.href) + '">' + escapeHtml(cfg.btn) + '</a>'
        : '<button class="act-btn primary" id="adRetry" type="button">' + escapeHtml(cfg.btn) + '</button>') +
    '</div>';
  main.appendChild(sec);
  const retry = $('#adRetry');
  if (retry) retry.addEventListener('click', boot);
}

/* ---------- 管理界面骨架 ---------- */
function renderShell(s) {
  main.textContent = '';
  main.innerHTML =
    '<section class="user-card ad-head-card">' +
      '<h1 class="ad-title">🛡️ 管理后台</h1>' +
      '<p class="ad-sub">封禁管理与站点访问概览。所有操作都用你自己的登录凭证在服务端验权，页面不保存任何后台密钥。</p>' +
      '<div class="ad-who">👤 当前操作员：<b>' + escapeHtml(s.name) + '</b></div>' +
    '</section>' +

    '<section class="user-card">' +
      '<div class="ad-card-head"><h2><span class="card-ico" aria-hidden="true">📈</span>站点访问概览</h2>' +
        '<button class="act-btn small" id="adRefresh" type="button">刷新</button></div>' +
      '<p class="ad-note">近 30 天 · 北京时间 · 仅本站 <code>' + SITE + '</code> 的数据</p>' +
      '<div id="adStats"><div class="user-loading">加载中…</div></div>' +
    '</section>' +

    '<section class="user-card">' +
      '<h2><span class="card-ico" aria-hidden="true">🚫</span>新增封禁</h2>' +
      '<p class="ad-note">默认只在本站生效；选「全局」会把用户 <code>status</code> 置为 <code>banned</code>，连登录都会被拦住，请谨慎。</p>' +
      '<form class="ad-form" id="adBanForm" autocomplete="off">' +
        '<div class="ad-field">' +
          '<label class="ad-label" for="adTarget">目标用户（用户名或 UID）</label>' +
          '<input class="ad-input" id="adTarget" type="text" maxlength="80" placeholder="例如 someuser" required />' +
        '</div>' +
        '<div class="ad-field">' +
          '<label class="ad-label" for="adScope">生效范围</label>' +
          '<select class="ad-input" id="adScope">' +
            '<option value="fesui">仅本站（fesui）</option>' +
            '<option value="*">全局（所有项目 + 禁止登录）</option>' +
          '</select>' +
        '</div>' +
        '<div class="ad-field">' +
          '<label class="ad-label" for="adReason">封禁原因（留痕审计）</label>' +
          '<input class="ad-input" id="adReason" type="text" maxlength="120" placeholder="例如：恶意刷屏" required />' +
        '</div>' +
        '<div class="ad-field">' +
          '<label class="ad-label" for="adDays">时长（天，留空 = 永久）</label>' +
          '<input class="ad-input" id="adDays" type="number" min="0.01" max="3650" step="any" placeholder="留空为永久" />' +
        '</div>' +
        '<div class="ad-form-actions">' +
          '<button class="act-btn primary" id="adBanSubmit" type="submit">提交封禁</button>' +
          '<span class="ad-hint ad-danger-note">封禁会立刻影响该用户在对应范围的登录 / 发言。</span>' +
        '</div>' +
      '</form>' +
    '</section>' +

    '<section class="user-card">' +
      '<div class="ad-card-head"><h2><span class="card-ico" aria-hidden="true">📋</span>封禁记录 <span class="badge" id="adBanCount">…</span></h2></div>' +
      '<div class="ad-table-scroll" id="adBanBox"><div class="user-loading">加载中…</div></div>' +
    '</section>';
}

/* ---------- 访问概览 ---------- */
async function loadStats(s) {
  const box = $('#adStats');
  if (!box) return;
  try {
    const { status, data } = await rpc('site_visit_stats', { p_site: SITE, p_days: 30 }, s);
    if (status !== 200 || !data || data.ok !== true) {
      box.innerHTML = '<div class="ad-err">' + escapeHtml((data && (data.msg || data.message)) || ('HTTP ' + status)) + '</div>';
      return;
    }
    const days = Array.isArray(data.by_day) ? data.by_day.slice(-14) : [];
    const max = Math.max.apply(null, days.map(d => Number(d.visits) || 0).concat([1]));
    box.textContent = '';
    const grid = document.createElement('div');
    grid.className = 'ad-stats';
    [['总访问量', data.total], ['独立访客', data.unique_users], ['统计天数', data.days]].forEach(pair => {
      const cell = document.createElement('div');
      cell.className = 'ad-stat';
      const b = document.createElement('b');
      b.textContent = String(Math.max(0, Number(pair[1]) || 0));
      const sp = document.createElement('span');
      sp.textContent = pair[0];
      cell.appendChild(b); cell.appendChild(sp);
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    if (days.length) {
      const spark = document.createElement('div');
      spark.className = 'ad-spark';
      days.forEach(d => {
        const col = document.createElement('span');
        col.className = 'ad-spark-col';
        col.style.height = Math.max(3, (Number(d.visits) || 0) / max * 100) + '%';
        col.title = d.day + ' · ' + (Number(d.visits) || 0) + ' 次访问';
        spark.appendChild(col);
      });
      box.appendChild(spark);
    }
  } catch (e) {
    box.innerHTML = '<div class="ad-err">网络异常，稍后再试</div>';
  }
}

/* ---------- 封禁记录表 ---------- */
function renderBans() {
  const box = $('#adBanBox'), count = $('#adBanCount');
  if (count) count.textContent = bans.length + ' 条';
  if (!box) return;
  if (!bans.length) {
    box.innerHTML = '<div class="ad-empty">还没有封禁记录，挺好 🌱</div>';
    return;
  }
  box.innerHTML =
    '<table class="ad-table"><thead><tr>' +
      '<th>用户</th><th>范围</th><th>原因</th><th>操作者</th><th>生效至</th><th>状态</th><th></th>' +
    '</tr></thead><tbody>' +
    bans.map(r => {
      const active = r.active === true;
      const scope = r.site === '*' ? '全局' : escapeHtml(String(r.site || '—'));
      const until = r.banned_until ? fmtDateTime(r.banned_until) : '永久';
      return '<tr>' +
        '<td><span class="ad-user">' + escapeHtml(r.username || '未知用户') + '</span>' +
          '<span class="ad-uid">' + escapeHtml(String(r.user_id || '').slice(0, 8)) + '…</span></td>' +
        '<td><span class="ad-pill site">' + scope + '</span></td>' +
        '<td class="ad-reason">' + escapeHtml(r.reason || '—') + '</td>' +
        '<td class="ad-nowrap">' + escapeHtml(r.banned_by || '—') + '</td>' +
        '<td class="ad-nowrap">' + escapeHtml(until) + '</td>' +
        '<td><span class="ad-pill ' + (active ? 'on' : 'off') + '">' + (active ? '生效中' : '已失效') + '</span></td>' +
        '<td>' + (active
          ? '<button class="act-btn small ad-unban" type="button" data-id="' + escapeHtml(String(r.id)) +
            '" data-username="' + escapeHtml(r.username || '') +
            '" data-site="' + escapeHtml(r.site || '') + '">解封</button>'
          : '') + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

async function loadBans(s, forGate) {
  const { status, data } = await rpc('list_account_bans', { p_site: null, p_limit: 100 }, s);
  if (forGate) return { status, data };
  const box = $('#adBanBox');
  if (status === 401 || (data && data.ok === false)) {
    if (box) box.innerHTML = '<div class="ad-err">' + escapeHtml((data && data.msg) || '没有权限') + '</div>';
    return;
  }
  if (status !== 200 || !data || data.ok !== true) {
    if (box) box.innerHTML = '<div class="ad-err">读取失败（HTTP ' + status + '）</div>';
    return;
  }
  bans = Array.isArray(data.list) ? data.list : [];
  renderBans();
}

/* ---------- 提交封禁 ---------- */
async function submitBan(e, s) {
  e.preventDefault();
  const target = ($('#adTarget').value || '').trim();
  const scope = $('#adScope').value === '*' ? '*' : SITE;
  const reason = ($('#adReason').value || '').trim();
  const rawDays = ($('#adDays').value || '').trim();
  const btn = $('#adBanSubmit');

  if (!target) { showToast('请填写目标用户'); return; }
  if (!reason) { showToast('请填写封禁原因'); return; }
  const days = rawDays === '' ? null : Number(rawDays);
  if (days !== null && (!isFinite(days) || days <= 0)) { showToast('天数要大于 0，留空表示永久'); return; }
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);
  if (isUuid && target === s.payload.sub) { showToast('不能封禁自己'); return; }
  if (!isUuid && (target === s.payload.username || target === s.name)) { showToast('不能封禁自己'); return; }

  const dur = days === null ? '永久' : days + ' 天';
  const msg = '确认封禁 ' + target + ' ？\n范围：' + (scope === '*' ? '全局（会禁止登录）' : '仅本站 fesui') +
    '\n时长：' + dur + '\n原因：' + reason;
  if (!window.confirm(msg)) return;

  btn.disabled = true;
  btn.textContent = '提交中…';
  try {
    const body = {
      p_site: scope,
      p_reason: reason,
      p_days: days,
      p_operator: s.payload.username || s.name
    };
    if (isUuid) body.p_user = target; else body.p_username = target;
    const { status, data } = await rpc('ban_account', body, s);
    if (status !== 200 || !data || data.ok !== true) {
      showToast((data && (data.msg || data.message)) || ('提交失败（HTTP ' + status + '）'));
      return;
    }
    showToast((data.msg || '已封禁') + ' · ' + (data.username || target));
    $('#adTarget').value = '';
    $('#adReason').value = '';
    $('#adDays').value = '';
    await loadBans(s, false);
  } catch (err) {
    showToast('网络异常，稍后再试');
  } finally {
    btn.disabled = false;
    btn.textContent = '提交封禁';
  }
}

/* ---------- 解封 ---------- */
async function doUnban(btn, s) {
  const id = btn.dataset.id, username = btn.dataset.username, site = btn.dataset.site || SITE;
  if (!window.confirm('确认解除对 ' + (username || id) + ' 在「' + (site === '*' ? '全局' : site) + '」的封禁？')) return;
  btn.disabled = true;
  try {
    const row = bans.find(x => String(x.id) === String(id));
    const body = { p_site: site, p_operator: s.payload.username || s.name };
    if (row && row.user_id) body.p_user = row.user_id; else body.p_username = username;
    const { status, data } = await rpc('unban_account', body, s);
    if (status !== 200 || !data || data.ok !== true) {
      showToast((data && (data.msg || data.message)) || ('解封失败（HTTP ' + status + '）'));
      btn.disabled = false;
      return;
    }
    showToast((data.msg || '已解封') + ' · ' + (username || ''));
    await loadBans(s, false);
  } catch (err) {
    showToast('网络异常，稍后再试');
    btn.disabled = false;
  }
}

/* ---------- 启动 ---------- */
async function boot() {
  // 登录回跳：先把一次性 ticket 换成 JWT，再判定管理员权限
  try { if (window.__fsTicketReady) await window.__fsTicketReady; } catch (e) {}

  const y = $('#footYear');
  if (y) y.textContent = String(new Date().getFullYear());
  const s = session();
  if (!s) { renderGate('login'); return; }

  let probe;
  try {
    probe = await loadBans(s, true);
  } catch (e) { renderGate('error', '连不上管理接口：' + (e && e.message ? e.message : '网络异常')); return; }

  const d = probe.data;
  if (probe.status === 401 || (d && d.ok === false && /无权限|权限/.test(String(d.msg || '')))) {
    renderGate('denied'); return;
  }
  if (probe.status !== 200 || !d || d.ok !== true) {
    renderGate('error', (d && (d.msg || d.message)) || ('HTTP ' + probe.status)); return;
  }

  renderShell(s);
  bans = Array.isArray(d.list) ? d.list : [];
  renderBans();
  loadStats(s);

  $('#adBanForm').addEventListener('submit', e => submitBan(e, s));
  $('#adRefresh').addEventListener('click', async () => {
    const btn = $('#adRefresh');
    btn.disabled = true; btn.textContent = '加载中…';
    await Promise.all([loadBans(s, false), loadStats(s)]);
    btn.disabled = false; btn.textContent = '刷新';
  });
  $('#adBanBox').addEventListener('click', e => {
    const t = e.target;
    const btn = t && t.closest ? t.closest('.ad-unban') : null;
    if (btn) doUnban(btn, s);
  });
}

boot();
