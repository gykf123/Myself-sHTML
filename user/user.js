/* ============================================================
   个人中心（user/）页面逻辑
   - 登录态来源：localStorage['fe_token']（JWT，HS256，7 天有效）
   - 登录回跳：login 页优先携带一次性 ticket（?ticket=，120 秒），
     本页负责 redeem 兑换为 JWT 后落库并清理 URL 参数
   - 数据源：JWT payload（账号快照）+ Supabase users 表（详细资料）
             + guestbook 表（按 user_id 查「我的留言」）
   ============================================================ */
'use strict';

/* ---------- 配置（与主站 / login 页同一 Supabase 项目） ---------- */
const SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
const ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
const FUNCTIONS_BASE = SUPABASE_URL + '/functions/v1';
const AUTH_KEY = 'fe_token';

const $ = (sel, root = document) => root.querySelector(sel);

function getToken() { try { return localStorage.getItem(AUTH_KEY) || ''; } catch (e) { return ''; } }
function setToken(t) { try { localStorage.setItem(AUTH_KEY, t); } catch (e) {} }
function clearToken() { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 主题：与主站同步（localStorage.theme → html.theme-glass） ---------- */
(function initTheme() {
  let t = 'glass';
  try { t = localStorage.getItem('theme') || 'glass'; } catch (e) {}
  document.documentElement.classList.toggle('theme-glass', t === 'glass');
})();

/* ---------- JWT 解析（不验签，仅读取 payload 展示；过期由 exp 判断） ---------- */
function parseJwt(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return (payload && typeof payload === 'object') ? payload : null;
  } catch (e) { return null; }
}

function tokenExpired(payload) {
  if (!payload || !payload.exp) return false;
  return payload.exp * 1000 <= Date.now();
}

/* ---------- 登录回跳：兑换一次性 ticket ---------- */
async function consumeTicket() {
  let ticket = null;
  try { ticket = new URLSearchParams(location.search).get('ticket'); } catch (e) { return false; }
  if (!ticket) return false;
  // 先清参，避免刷新重复兑换（ticket 一次性，重复兑换必然失败）
  try {
    const u = new URL(location.href);
    u.searchParams.delete('ticket');
    history.replaceState(null, '', u.pathname + u.search);
  } catch (e) {}
  try {
    const r = await fetch(FUNCTIONS_BASE + '/auth-exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: JSON.stringify({ action: 'redeem', ticket })
    });
    const data = await r.json().catch(() => null);
    if (r.ok && data && data.token) { setToken(data.token); return true; }
  } catch (e) {}
  return false;
}

/* ---------- 登录入口（带 redirect 回本页） ---------- */
function loginHref() {
  const back = location.origin + location.pathname;
  return '../login/index.html?brand=FeSui&home=' +
    encodeURIComponent(location.origin + '/') +
    '&redirect=' + encodeURIComponent(back);
}

/* ---------- Supabase REST ---------- */
async function sbGet(path) {
  const res = await fetch(SUPABASE_URL + path, {
    headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

/* ---------- 时间格式化 ---------- */
function fmtDateTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  } catch (e) { return '—'; }
}
function fmtRelative(iso) {
  try {
    const d = new Date(iso), now = new Date(), diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 2592000) return Math.floor(diff / 86400) + ' 天前';
    return fmtDateTime(iso);
  } catch (e) { return '—'; }
}

/* ---------- 渲染：未登录 / 已过期引导 ---------- */
function renderGuide(expired) {
  $('#userMain').innerHTML =
    '<section class="user-card guide-card">' +
      '<div class="guide-ico" aria-hidden="true">' + (expired ? '⏰' : '🔐') + '</div>' +
      '<h1>' + (expired ? '登录已过期' : '尚未登录') + '</h1>' +
      '<p>' + (expired
        ? '当前登录态已超过 7 天有效期，请重新登录后查看个人中心。'
        : '个人中心需要登录后访问。登录即可查看账号资料、登录会话与我的留言。') + '</p>' +
      '<div class="guide-actions">' +
        '<a class="act-btn primary" href="' + loginHref() + '">登录 / 注册</a>' +
        '<a class="act-btn" href="../">返回主页</a>' +
      '</div>' +
    '</section>';
}

/* ---------- 渲染：已登录资料 ---------- */
async function renderProfile(payload) {
  const main = $('#userMain');
  const uid = payload.sub || '';
  const username = payload.username || '';
  const displayName = payload.nickname || username || '用户';
  const initial = (displayName || 'U').trim().charAt(0).toUpperCase();
  const role = payload.app_role || payload.role || 'user';
  const status = payload.status || 'approved';
  const avatar = payload.avatar_url || '';

  const roleBadge = role === 'admin'
    ? '<span class="badge badge-admin">管理员</span>'
    : '<span class="badge">用户</span>';
  const statusBadge = status === 'approved'
    ? '<span class="badge badge-ok">账号正常</span>'
    : '<span class="badge badge-warn">' + escapeHtml(status) + '</span>';

  // 会话有效期（iat → exp，默认 7 天）
  const nowMs = Date.now();
  const iatMs = payload.iat ? payload.iat * 1000 : nowMs;
  const expMs = payload.exp ? payload.exp * 1000 : iatMs + 7 * 86400000;
  const total = Math.max(expMs - iatMs, 1);
  const leftPct = Math.max(0, Math.min(100, Math.round((expMs - nowMs) / total * 100)));
  const leftDays = Math.max(0, Math.floor((expMs - nowMs) / 86400000));
  const leftHours = Math.max(0, Math.floor((expMs - nowMs) / 3600000) % 24);
  const leftText = (expMs - nowMs) <= 0 ? '已过期'
    : (leftDays > 0 ? leftDays + ' 天 ' + leftHours + ' 小时' : leftHours + ' 小时');

  main.innerHTML =
    /* 资料卡 */
    '<section class="user-card">' +
      '<div class="profile-head">' +
        (avatar
          ? '<img class="profile-avatar" src="' + escapeHtml(avatar) + '" alt="头像" referrerpolicy="no-referrer" />'
          : '<div class="profile-avatar" aria-hidden="true">' + escapeHtml(initial) + '</div>') +
        '<div class="profile-id">' +
          '<h1 class="profile-name">' + escapeHtml(displayName) +
            '<span class="profile-at">@' + escapeHtml(username) + '</span></h1>' +
          '<div class="profile-badges">' + roleBadge + statusBadge +
            '<span class="badge">UID ' + escapeHtml(String(uid).slice(0, 8)) + '…</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</section>' +

    /* 账号资料（JWT + users 表合并，异步填充） */
    '<section class="user-card">' +
      '<h2><span class="card-ico" aria-hidden="true">🪪</span>账号资料</h2>' +
      '<div class="info-grid" id="infoGrid">' +
        '<div class="info-item"><div class="k">用户名</div><div class="v">' + escapeHtml(username) + '</div></div>' +
        '<div class="info-item"><div class="k">昵称</div><div class="v' + (payload.nickname ? '' : ' dim') + '">' + escapeHtml(payload.nickname || '未设置') + '</div></div>' +
        '<div class="info-item"><div class="k">用户 ID</div><div class="v uid-row"><code id="uidText">' + escapeHtml(uid) + '</code><button class="copy-btn" id="copyUid" type="button">复制</button></div></div>' +
        '<div class="info-item"><div class="k">注册时间</div><div class="v dim" id="regTime">加载中…</div></div>' +
        '<div class="info-item"><div class="k">最近登录</div><div class="v dim" id="lastLogin">加载中…</div></div>' +
        '<div class="info-item"><div class="k">活跃值</div><div class="v dim" id="activeVal">加载中…</div></div>' +
        '<div class="info-item" style="grid-column:1/-1"><div class="k">个人简介</div><div class="v dim" id="bioText">加载中…</div></div>' +
      '</div>' +
    '</section>' +

    /* 登录会话 */
    '<section class="user-card">' +
      '<h2><span class="card-ico" aria-hidden="true">🔑</span>登录会话</h2>' +
      '<div class="session-meta"><span>签发于 ' + fmtDateTime(new Date(iatMs)) + '</span><span>有效期至 ' + fmtDateTime(new Date(expMs)) + '</span></div>' +
      '<div class="session-bar"><i id="sessionFill"></i></div>' +
      '<p class="session-tip' + (leftPct <= 15 ? ' warn' : '') + '">本次登录还剩 <b>' + leftText + '</b>（剩余 ' + leftPct + '%），过期后需重新登录。</p>' +
    '</section>' +

    /* 我的留言 */
    '<section class="user-card">' +
      '<h2><span class="card-ico" aria-hidden="true">💬</span>我的留言 <span class="badge" id="mywallCount">…</span></h2>' +
      '<div id="mywallBox"><div class="user-loading" style="padding:18px 0">加载中…</div></div>' +
    '</section>' +

    /* 操作 */
    '<section class="user-card">' +
      '<h2><span class="card-ico" aria-hidden="true">⚙️</span>账号操作</h2>' +
      '<div class="user-actions">' +
        '<a class="act-btn" href="../#wall">去留言墙</a>' +
        '<a class="act-btn" href="../">返回主页</a>' +
        '<button class="act-btn danger" id="logoutBtn" type="button">退出登录</button>' +
      '</div>' +
    '</section>';

  // 会话进度条动画
  requestAnimationFrame(() => { const f = $('#sessionFill'); if (f) f.style.width = leftPct + '%'; });

  // 复制 UID
  const copyBtn = $('#copyUid');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(uid);
      copyBtn.textContent = '已复制';
      copyBtn.classList.add('copied');
    } catch (e) {
      copyBtn.textContent = '失败';
    }
    setTimeout(() => { copyBtn.textContent = '复制'; copyBtn.classList.remove('copied'); }, 1600);
  });

  // 退出登录
  const logout = $('#logoutBtn');
  if (logout) logout.addEventListener('click', () => {
    clearToken();
    renderGuide(false);
  });

  // 异步加载账号详情与我的留言
  loadAccountDetail(uid);
  loadMyWall(uid);
}

/* ---------- users 表详情填充（只取非敏感字段） ---------- */
async function loadAccountDetail(uid) {
  const fields = 'id,username,nickname,role,status,created_at,avatar_url,bio,reason,active_value,last_login_date';
  let row = null;
  try {
    const { ok, data } = await sbGet('/rest/v1/users?select=' + fields + '&id=eq.' + encodeURIComponent(uid) + '&limit=1');
    if (ok && Array.isArray(data) && data.length) row = data[0];
  } catch (e) {}
  const set = (id, text, dim) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.classList.toggle('dim', !!dim); }
  };
  set('regTime', row && row.created_at ? fmtDateTime(row.created_at) : '—', true);
  set('lastLogin', row && row.last_login_date ? fmtDateTime(row.last_login_date) : '暂无记录', true);
  set('activeVal', row && typeof row.active_value === 'number' ? String(row.active_value) : '—', true);
  set('bioText', row && (row.bio || row.reason) ? (row.bio || row.reason) : '这个人很懒，什么都没写。', !(row && (row.bio || row.reason)));
}

/* ---------- 我的留言（guestbook 按 user_id 过滤） ---------- */
async function loadMyWall(uid) {
  const box = $('#mywallBox'), count = $('#mywallCount');
  let rows = [];
  try {
    const { ok, data } = await sbGet(
      '/rest/v1/guestbook?select=id,nickname,content,created_at&user_id=eq.' + encodeURIComponent(uid) + '&order=created_at.desc&limit=50');
    if (ok && Array.isArray(data)) rows = data;
  } catch (e) {}
  if (count) count.textContent = rows.length + ' 条';
  if (!box) return;
  if (!rows.length) {
    box.innerHTML = '<div class="mywall-empty">还没有关联到本账号的留言。<br>去 <a href="../#wall">留言墙</a> 登录后发一条，就会出现在这里。</div>';
    return;
  }
  box.innerHTML = '<ul class="mywall-list">' + rows.map(r =>
    '<li class="mywall-item">' +
      '<div class="mw-meta"><span>' + escapeHtml(r.nickname || '匿名访客') + '</span><span>' + fmtRelative(r.created_at) + '</span></div>' +
      '<p class="mw-text">' + escapeHtml(r.content || '') + '</p>' +
    '</li>').join('') + '</ul>';
}

/* ---------- 启动 ---------- */
(async function init() {
  const y = $('#footYear');
  if (y) y.textContent = new Date().getFullYear();

  const exchanged = await consumeTicket();
  const token = getToken();
  const payload = token ? parseJwt(token) : null;

  if (!payload) { renderGuide(false); return; }
  if (tokenExpired(payload)) { clearToken(); renderGuide(true); return; }
  renderProfile(payload);
  if (exchanged) { /* ticket 兑换成功，登录态已就绪 */ }
})();
