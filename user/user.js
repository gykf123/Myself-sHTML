/* ============================================================
   个人中心（user/）页面逻辑
   - 登录态来源：localStorage['fe_token']（JWT，HS256，7 天有效）
   - 登录回跳：login 页优先携带一次性 ticket（?ticket=，120 秒），
     本页负责 redeem 兑换为 JWT 后落库并清理 URL 参数
   - 数据源：JWT payload（账号快照）+ Edge Function account（详细资料代理读）
             + guestbook 表（按 user_id 查「我的留言」）
   - 账号绑定：GitHub OAuth（完整流程，secret 只在 Edge Function 侧）+ QQ 号
   ============================================================ */
'use strict';

/* ---------- 配置（与主站 / login 页同一 Supabase 项目） ---------- */
const SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
const ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
const FUNCTIONS_BASE = SUPABASE_URL + '/functions/v1';
const AUTH_KEY = 'fe_token';

// GitHub OAuth App 的 Client ID（公开信息，可安全内嵌于前端授权 URL）。
// 部署 OAuth App 后把 Client ID 填到这里；留空时「关联 GitHub」按钮呈未配置态。
const GH_CLIENT_ID = 'Ov23liK00mp7JPFFJ8PX';

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

/* ---------- Edge Function account（带本站 JWT） ---------- */
async function accountCall(action, extra = {}) {
  const res = await fetch(FUNCTIONS_BASE + '/account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + getToken()
    },
    body: JSON.stringify({ action, ...extra })
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

    /* 账号绑定（GitHub OAuth + QQ，异步填充） */
    '<section class="user-card" id="bindCard" hidden>' +
      '<h2><span class="card-ico" aria-hidden="true">🔗</span>账号绑定</h2>' +
      '<div id="bindBox"><div class="user-loading" style="padding:18px 0">加载中…</div></div>' +
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

  // 异步加载账号详情、绑定关系与我的留言
  loadAccountDetail(uid);
  loadMyWall(uid);

  // GitHub 关联成功跳回（github-callback.html → ./?linked=github）
  try {
    if (new URLSearchParams(location.search).get('linked') === 'github') {
      const u = new URL(location.href);
      u.searchParams.delete('linked');
      history.replaceState(null, '', u.pathname + u.search);
      showToast('GitHub 关联成功');
    }
  } catch (e) {}
}

/* ---------- 轻提示（绑定操作反馈） ---------- */
let toastTimer = null;
function showToast(text) {
  let el = $('#userToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'userToast';
    el.className = 'user-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- users 表详情填充（account 函数代理读，失败降级 anon 直读） ---------- */
async function loadAccountDetail(uid) {
  let row = null;
  // 主路径：Edge Function（users 表 GRANT 收紧后的唯一通道，含绑定字段）
  try {
    const { ok, data } = await accountCall('profile');
    if (ok && data && data.profile) row = data.profile;
  } catch (e) {}
  // 降级：函数未部署时回退 anon 直读——只用基础字段
  // （github_* / qq 列在 account-bind.sql 执行前不存在，带上会导致整笔查询 400）
  if (!row) {
    try {
      // 注意：不带 reason（线上库已对该列做 anon 列级收紧，带上整笔 401）、
      // 不带 github_*（account-bind.sql 未执行时列不存在，带上整笔 400）；
      // 函数上线后统一走 account 函数主路径，此降级仅为过渡。
      const fields = 'id,username,nickname,role,status,created_at,avatar_url,bio,active_value,last_login_date';
      const { ok, data } = await sbGet('/rest/v1/users?select=' + fields + '&id=eq.' + encodeURIComponent(uid) + '&limit=1');
      if (ok && Array.isArray(data) && data.length) row = data[0];
    } catch (e) {}
  }
  const set = (id, text, dim) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.classList.toggle('dim', !!dim); }
  };
  set('regTime', row && row.created_at ? fmtDateTime(row.created_at) : '—', true);
  set('lastLogin', row && row.last_login_date ? fmtDateTime(row.last_login_date) : '暂无记录', true);
  set('activeVal', row && typeof row.active_value === 'number' ? String(row.active_value) : '—', true);
  set('bioText', row && (row.bio || row.reason) ? (row.bio || row.reason) : '这个人很懒，什么都没写。', !(row && (row.bio || row.reason)));
  renderBindCard(row);
}

/* ---------- 账号绑定卡（GitHub + QQ，两区解耦） ---------- */
/* 说明：GitHub 关联依赖 Edge Function account（含 secret 交换）；QQ 绑定不依赖它——
   QQ 号保存走 PATCH REST（RLS 兜底只能改自己行），绑定码走 qq-bind 函数（已部署）。
   所以 account 未上线时，QQ 区照常可用，只有 GitHub 区显示暂不可用。 */
function renderBindCard(row) {
  const card = $('#bindCard'), box = $('#bindBox');
  if (!card || !box) return;
  card.hidden = false;

  // account 函数是否可用（row 来自 account profile 时含 github_id 字段；降级直读则不含）
  const accountReady = !!(row && 'github_id' in row);
  const ghLinked = !!(row && row.github_id);
  const qq = row && ('qq' in row) && row.qq ? String(row.qq) : '';

  const ghRow = !accountReady
    ? '<div class="bind-row">' +
        '<div class="bind-info">' +
          '<span class="bind-avatar bind-avatar-fallback" aria-hidden="true">GH</span>' +
          '<div class="bind-text"><b>GitHub</b><span class="dim">关联服务暂未部署（Edge Function account 未上线），QQ 绑定不受影响</span></div>' +
        '</div>' +
      '</div>'
    : ghLinked
    ? '<div class="bind-row">' +
        '<div class="bind-info">' +
          (row.github_avatar_url
            ? '<img class="bind-avatar" src="' + escapeHtml(row.github_avatar_url) + '" alt="" referrerpolicy="no-referrer" />'
            : '<span class="bind-avatar bind-avatar-fallback" aria-hidden="true">GH</span>') +
          '<div class="bind-text"><b>GitHub</b><span class="dim">@' + escapeHtml(row.github_login || '') +
            (row.github_linked_at ? ' · ' + fmtRelative(row.github_linked_at) + '绑定' : '') + '</span></div>' +
        '</div>' +
        '<button class="act-btn small danger" id="ghUnlink" type="button">解除绑定</button>' +
      '</div>'
    : '<div class="bind-row">' +
        '<div class="bind-info">' +
          '<span class="bind-avatar bind-avatar-fallback" aria-hidden="true">GH</span>' +
          '<div class="bind-text"><b>GitHub</b><span class="dim">未关联' +
            (GH_CLIENT_ID ? '' : ' · 服务端未配置 OAuth App') + '</span></div>' +
        '</div>' +
        '<button class="act-btn small primary" id="ghLink" type="button"' + (GH_CLIENT_ID ? '' : ' disabled title="管理员尚未配置 GitHub OAuth App"') + '>关联 GitHub</button>' +
      '</div>';

  const qqRow =
    '<div class="bind-row bind-qq">' +
      '<div class="bind-info">' +
        '<span class="bind-avatar bind-avatar-fallback" aria-hidden="true">Q</span>' +
        '<div class="bind-text"><b>QQ</b><span class="dim" id="qqState">' + (qq ? '已绑定 ' + escapeHtml(qq) : '未绑定') + '</span></div>' +
      '</div>' +
      '<div class="bind-edit">' +
        '<input id="qqInput" class="bind-input" type="text" inputmode="numeric" maxlength="12" placeholder="' + (qq ? '更换 QQ 号' : '输入 QQ 号') + '" />' +
        '<button class="act-btn small" id="qqSave" type="button">保存</button>' +
        '<button class="act-btn small ghost" id="qqCodeBtn" type="button">生成 QQ 绑定码</button>' +
      '</div>' +
    '</div>';

  box.innerHTML =
    '<div class="bind-list">' + ghRow + qqRow + '</div>' +
    '<p class="bind-tip">QQ 绑定流程：填好 QQ 号保存 → 点「生成 QQ 绑定码」→ 把 8 位码发给 QQ 机器人（/绑定 &lt;绑定码&gt;），两边号码一致即绑定成功。GitHub 关联使用官方 OAuth 授权，本站只读取你的公开资料（ID / 登录名 / 头像），不会获取任何仓库权限。</p>';

  const ghLink = $('#ghLink');
  if (ghLink) ghLink.addEventListener('click', linkGithub);
  const ghUnlink = $('#ghUnlink');
  if (ghUnlink) ghUnlink.addEventListener('click', async () => {
    ghUnlink.disabled = true;
    ghUnlink.textContent = '解绑中…';
    const { ok, data } = await accountCall('unlink');
    if (ok && data && data.success) {
      showToast('已解除 GitHub 绑定');
      const fresh = await fetchProfile();
      if (fresh) renderBindCard(fresh);
      else showToast('解绑成功，但资料刷新失败，请手动刷新页面');
    } else {
      showToast((data && data.error) || '解绑失败，请稍后再试');
      ghUnlink.disabled = false;
      ghUnlink.textContent = '解除绑定';
    }
  });

  // QQ 保存：PATCH 直连（RLS 限制只能改自己行的 qq 列）
  const qqSave = $('#qqSave');
  if (qqSave) qqSave.addEventListener('click', saveQQ);
  // 生成绑定码：qq-bind 函数 action=create
  const qqCodeBtn = $('#qqCodeBtn');
  if (qqCodeBtn) qqCodeBtn.addEventListener('click', genQQCode);

  // 降级路径的 row 不含 qq 列（单独查一次，失败不影响其他展示）
  if (row && !('qq' in row)) {
    (async () => {
      try {
        const payload = parseJwt(getToken());
        if (!payload || !payload.sub) return;
        const { ok, data } = await sbGet('/rest/v1/users?select=qq&id=eq.' + encodeURIComponent(payload.sub) + '&limit=1');
        if (ok && Array.isArray(data) && data.length && data[0].qq) updateQQDisplay(String(data[0].qq));
      } catch (e) {}
    })();
  }
}

/* 刷新 QQ 行文案与输入框 placeholder */
function updateQQDisplay(qqVal) {
  const state = $('#qqState'), input = $('#qqInput');
  if (state) state.textContent = qqVal ? '已绑定 ' + qqVal : '未绑定';
  if (input) input.placeholder = qqVal ? '更换 QQ 号' : '输入 QQ 号';
}

/* 保存 QQ 号：PATCH users?id=eq.{JWT.sub}（uid 只信 JWT，不信任何前端自造值） */
async function saveQQ() {
  const input = $('#qqInput'), btn = $('#qqSave');
  if (!input || !btn) return;
  const qqVal = input.value.trim();
  if (qqVal && !/^[0-9]{5,12}$/.test(qqVal)) { showToast('QQ 号格式不正确（5-12 位纯数字）'); return; }
  const payload = parseJwt(getToken());
  if (!payload || !payload.sub) { handleAuthLost('登录态异常，请重新登录'); return; }
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/users?id=eq.' + encodeURIComponent(payload.sub), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + getToken(),
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ qq: qqVal || null })
    });
    if (res.status === 401) { handleAuthLost('登录已过期，请重新登录'); return; }
    if (res.status === 204) {
      showToast(qqVal ? 'QQ 已更新' : 'QQ 已清除');
      updateQQDisplay(qqVal);
      input.value = '';
      return;
    }
    const data = await res.json().catch(() => null);
    if (data && data.code === '23514') { showToast('QQ 号格式不正确（5-12 位纯数字）'); return; }
    showToast((data && data.message) || '保存失败，请稍后再试');
  } catch (e) {
    showToast('网络异常，请稍后再试');
  } finally {
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

/* 生成 QQ 绑定码：POST functions/v1/qq-bind {action:'create'} → 8 位码 + 10 分钟有效期 */
async function genQQCode() {
  const btn = $('#qqCodeBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = '生成中…';
  try {
    const res = await fetch(FUNCTIONS_BASE + '/qq-bind', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + getToken()
      },
      body: JSON.stringify({ action: 'create' })
    });
    if (res.status === 401) {
      const data = await res.json().catch(() => null);
      handleAuthLost((data && data.msg) || '登录已过期，请重新登录');
      return;
    }
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok && data.code) {
      openQQCodeModal(String(data.code), Number(data.expires_in) || 600);
    } else {
      showToast((data && data.msg) || '生成失败，请稍后再试');
    }
  } catch (e) {
    showToast('网络异常，请稍后再试');
  } finally {
    btn.disabled = false;
    btn.textContent = '生成 QQ 绑定码';
  }
}

/* ---------- QQ 绑定码弹窗（8 位码 + 倒计时 + 一键复制） ---------- */
let qqCodeTimer = null;
function closeQQCodeModal() {
  if (qqCodeTimer) { clearInterval(qqCodeTimer); qqCodeTimer = null; }
  const m = $('#qqCodeModal');
  if (m) m.remove();
}
function openQQCodeModal(code, expiresIn) {
  closeQQCodeModal();
  const wrap = document.createElement('div');
  wrap.className = 'qq-modal-mask';
  wrap.id = 'qqCodeModal';
  wrap.innerHTML =
    '<div class="qq-modal" role="dialog" aria-modal="true" aria-label="QQ 绑定码">' +
      '<h3>QQ 绑定码</h3>' +
      '<div class="qq-code" id="qqCodeText">' + escapeHtml(code) + '</div>' +
      '<div class="qq-modal-actions">' +
        '<button class="act-btn small primary" id="qqCodeCopy" type="button">复制绑定码</button>' +
      '</div>' +
      '<p class="qq-code-timer">有效期倒计时 <b id="qqCodeTimer">--:--</b></p>' +
      '<p class="qq-code-tip">把这个 8 位绑定码发给 QQ 机器人（/绑定 &lt;绑定码&gt;），两边 QQ 号一致即绑定成功。</p>' +
      '<div class="qq-modal-actions">' +
        '<button class="act-btn small" id="qqCodeClose" type="button">关闭</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);

  $('#qqCodeCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); showToast('已复制到剪贴板'); }
    catch (e) { showToast('复制失败，请手动选择复制'); }
  });
  $('#qqCodeClose').addEventListener('click', closeQQCodeModal);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeQQCodeModal(); });

  const deadline = Date.now() + expiresIn * 1000;
  const tick = () => {
    const el = $('#qqCodeTimer');
    if (!el) { if (qqCodeTimer) { clearInterval(qqCodeTimer); qqCodeTimer = null; } return; }
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    el.textContent = mm + ':' + ss;
    if (left <= 0) {
      if (qqCodeTimer) { clearInterval(qqCodeTimer); qqCodeTimer = null; }
      const codeEl = $('#qqCodeText');
      if (codeEl) { codeEl.textContent = '已过期'; codeEl.classList.add('expired'); }
      showToast('绑定码已过期，请重新生成');
    }
  };
  tick();
  qqCodeTimer = setInterval(tick, 1000);
}

/* 登录态失效统一处理：清 token + 回未登录引导态 */
function handleAuthLost(msg) {
  clearToken();
  if (msg) showToast(msg);
  renderGuide(false);
}

async function fetchProfile() {
  try {
    const { ok, data } = await accountCall('profile');
    if (ok && data && data.profile) return data.profile;
  } catch (e) {}
  return null;
}

/* ---------- 发起 GitHub OAuth 授权 ---------- */
function linkGithub() {
  if (!GH_CLIENT_ID) { showToast('管理员尚未配置 GitHub OAuth App'); return; }
  // state 防 CSRF：本浏览器会话生成，回调落地页校验一致性
  const state = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
  try { sessionStorage.setItem('gh_oauth_state', state); } catch (e) {}
  const redirect = location.origin + '/user/github-callback.html';
  const url = 'https://github.com/login/oauth/authorize?client_id=' + encodeURIComponent(GH_CLIENT_ID) +
    '&redirect_uri=' + encodeURIComponent(redirect) +
    '&scope=read:user&state=' + encodeURIComponent(state);
  location.href = url;
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
})();
