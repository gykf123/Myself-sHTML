/* ============================================================
   个人中心（user/）页面逻辑
   - 登录态来源：localStorage['fe_token']（JWT，HS256，7 天有效）
   - 登录回跳：login 页优先携带一次性 ticket（?ticket=，120 秒），
     本页负责 redeem 兑换为 JWT 后落库并清理 URL 参数；
     换票接口异常时的 ?token= 降级通道同样兼容
   - 数据源：JWT payload（账号快照）+ Edge Function account（详细资料代理读）
             + guestbook 表（按 user_id 查「我的留言」）
   - 账号绑定：GitHub OAuth（完整流程，secret 只在 Edge Function 侧）+ QQ 号
   - 两种视图：
       · 不带参数 或 ?me=1        → 自己的完整中心（需登录，含私密区块）
       · ?username=xxx / ?uid=xxx → 他人公开名片（只读，无需登录，
         走已部署的 profile 函数；不含会话/绑定/我的留言/退出登录）
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

/* ---------- 登录回跳：兑换一次性 ticket（兼容 ?token= 降级） ---------- */
async function consumeTicket() {
  let ticket = null, legacy = null;
  try {
    const qs = new URLSearchParams(location.search);
    ticket = qs.get('ticket');
    legacy = qs.get('token');
  } catch (e) { return false; }
  if (!ticket && !legacy) return false;
  // 先清参，避免刷新重复兑换（ticket 一次性，重复兑换必然失败）
  try {
    const u = new URL(location.href);
    u.searchParams.delete('ticket');
    u.searchParams.delete('token');
    history.replaceState(null, '', u.pathname + u.search);
  } catch (e) {}
  // login 页换票接口异常时会退回旧通道：URL 直接带 JWT，落库即可
  if (!ticket) { setToken(legacy); return true; }
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

    /* 我的访问记录（只查自己，服务端按 auth.uid() 过滤） */
    '<section class="user-card">' +
      '<h2><span class="card-ico" aria-hidden="true">👣</span>我的访问记录 <span class="badge" id="myvisitCount">…</span></h2>' +
      '<p class="visit-tip">只记录你登录后的站点访问路径，数据保留 30 天。</p>' +
      '<div id="myvisitBox"><div class="user-loading" style="padding:18px 0">加载中…</div></div>' +
      '<div class="visit-actions"><button class="act-btn small" id="myvisitMore" type="button" hidden>查看更多</button></div>' +
    '</section>' +

    /* 操作 */
    '<section class="user-card">' +
      '<h2><span class="card-ico" aria-hidden="true">⚙️</span>账号操作</h2>' +
      '<div class="user-actions">' +
        (payload.app_role === 'admin' || payload.role === 'admin'
          ? '<a class="act-btn" href="../admin/">管理后台</a>' : '') +
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

  // 异步加载账号详情、绑定关系、我的留言与我的访问记录
  loadAccountDetail(uid);
  loadMyWall(uid);
  loadMyVisits(20);

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
            (row.github_linked_at ? ' · ' + fmtRelative(row.github_linked_at) + '绑定' : '') +
            ' · 已可在登录页一键登录</span></div>' +
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

  /* 邮箱 / 公告订阅：一个账号可绑多个邮箱，逐条独立订阅 / 退订 / 解绑。
     与项目公告共用 fs_email_subscriptions 一张表；邮件通道未配置时仍可登记，
     只是不发信也不发验证码（如实提示，不假装已送达）。 */
  const mailRow =
    '<div class="bind-row bind-mail">' +
      '<div class="bind-info">' +
        '<span class="bind-avatar bind-avatar-fallback" aria-hidden="true">@</span>' +
        '<div class="bind-text"><b>邮箱 / 公告订阅</b><span class="dim" id="mailState">加载中…</span></div>' +
      '</div>' +
      '<div class="mail-editor">' +
        '<div class="mail-list" id="mailList"></div>' +
        '<div class="mail-add">' +
          '<input id="mailInput" class="bind-input" type="email" maxlength="254" placeholder="添加邮箱…" autocomplete="email" />' +
          '<button class="act-btn small" id="mailSave" type="button">添加</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  box.innerHTML =
    '<div class="bind-list">' + ghRow + qqRow + mailRow + '</div>' +
    '<p class="bind-tip">QQ 绑定流程：填好 QQ 号保存 → 点「生成 QQ 绑定码」→ 把 8 位码发给 QQ 机器人（/绑定 &lt;绑定码&gt;），两边号码一致即绑定成功。GitHub 关联使用官方 OAuth 授权，本站只读取你的公开资料（ID / 登录名 / 头像），不会获取任何仓库权限；<b>关联后即可在登录页点「通过 GitHub 登录」一键进入</b>。一个账号最多绑定 5 个邮箱，每条都可单独订阅或退订项目公告；邮箱不会出现在任何公开页面。</p>';

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

  // 邮箱 / 公告订阅：列表内每行按钮走事件委托（列表会随增删整体重绘）
  const mailSave = $('#mailSave');
  if (mailSave) mailSave.addEventListener('click', saveEmail);
  const mailList = $('#mailList');
  if (mailList) mailList.addEventListener('click', onMailItemAction);
  loadMailState();

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

/* ---------- 邮箱绑定 / 项目公告订阅（fs-notify） ----------
   与公告群发共用 fs_email_subscriptions；该表前端零权限，只走函数。
   邮件通道未配置（provider=none）时仍可登记 / 退订，只是不发信、不发验证码，
   前端用 configured=false 如实提示，不假装「已订阅成功」。
   当前默认 provider=resend：公告由 Resend 直接发出；显式切回 queue 时才入队
   交给 GitHub Actions 发送（自发自收实测会被静默丢弃，故不再作为默认）。 */
async function notifyCall(action, extra) {
  const res = await fetch(FUNCTIONS_BASE + '/fs-notify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + getToken()
    },
    body: JSON.stringify(Object.assign({ action: action }, extra || {}))
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok && !!(data && data.ok), status: res.status, data: data || {} };
}

let mailStateCache = { emails: [], max: 5, configured: false, provider: '', ready: false };

function renderMailState(d) {
  let list = Array.isArray(d.emails) ? d.emails.slice() : [];
  // 兼容还没更新的旧后端：只返回单邮箱字段时，构造一条等价记录
  if (!list.length && d.bound && d.email) {
    list = [{ email: d.email, subscribed: !!d.subscribed, verified: !!d.verified }];
  }
  mailStateCache = {
    emails: list,
    max: Number(d.max) || 5,
    configured: !!d.configured,
    provider: String(d.provider || ''),
    ready: !!d.ready,
  };
  const st = $('#mailState'), box = $('#mailList');
  const input = $('#mailInput'), addBtn = $('#mailSave');
  if (!st || !box) return;
  const channel = !d.configured ? ' · 邮件通道待开通（当前仅登记，暂不发信）'
    : d.provider === 'queue' && !d.ready ? ' · 公告会加入邮件队列（发信任务尚未首次运行）'
    : d.provider === 'queue' ? ' · 公告会由邮件队列发送'
    : d.provider === 'resend' ? ' · 公告由 Resend 直接发送'
    : '';
  const subCount = list.filter(x => x.subscribed).length;
  st.textContent = list.length
    ? ('已绑定 ' + list.length + '/' + mailStateCache.max + ' 个 · ' + subCount + ' 个订阅中' + channel)
    : ('未绑定 · 绑定后可接收项目公告' + channel);

  // 到上限就关掉添加入口，并给出明确原因，别让用户白点
  const full = list.length >= mailStateCache.max;
  if (input) {
    input.disabled = full;
    input.placeholder = full ? '已达上限，请先解绑一个' : '添加邮箱…';
  }
  if (addBtn) {
    addBtn.dataset.full = full ? '1' : '';  // 供 saveEmail 的 finally 恢复正确状态
    addBtn.disabled = full;
    addBtn.textContent = full ? '已达上限' : '添加';
  }

  if (!list.length) {
    box.innerHTML = '<div class="mail-empty">还没有绑定邮箱。添加后默认订阅项目公告，可随时单独退订或解绑。</div>';
    return;
  }
  // 邮箱来自服务端，仍一律转义后再拼 HTML（防存储型 XSS）
  box.innerHTML = list.map(function (e) {
    const addr = String(e.email || '');
    const safe = escapeHtml(addr);
    const on = !!e.subscribed;
    return '<div class="mail-item">' +
      '<span class="mail-addr" title="' + safe + '">' + safe + '</span>' +
      '<span class="mail-badge' + (on ? ' on' : ' off') + '">' +
        (on ? (e.verified ? '已订阅 · 已验证' : '已订阅') : '已退订') + '</span>' +
      '<span class="mail-actions">' +
        '<button class="act-btn small ghost" type="button" data-act="toggle" data-email="' + safe + '">' +
          (on ? '退订' : '订阅') + '</button>' +
        '<button class="act-btn small ghost" type="button" data-act="remove" data-email="' + safe + '">解绑</button>' +
      '</span>' +
    '</div>';
  }).join('');
}

async function loadMailState() {
  const st = $('#mailState');
  if (!st) return;
  try {
    const r = await notifyCall('email_get');
    if (!r.ok) { st.textContent = '邮箱功能暂时不可用'; return; }
    renderMailState(r.data);
  } catch (e) { st.textContent = '邮箱功能暂时不可用'; }
}

async function saveEmail() {
  const input = $('#mailInput'), btn = $('#mailSave');
  if (!input || !btn || btn.disabled) return;
  const email = input.value.trim();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('邮箱格式不正确'); return;
  }
  btn.disabled = true; btn.textContent = '添加中…';
  try {
    const r = await notifyCall('email_bind', { email: email });
    if (!r.ok) { showToast(r.data.error || '添加失败'); return; }
    input.value = '';
    showToast('邮箱已添加' + (r.data.configured ? '，已订阅项目公告' : '，待邮件通道开通后生效'));
    await loadMailState();
  } catch (e) { showToast('网络异常，请稍后再试'); }
  finally {
    // loadMailState 可能刚把按钮置为「已达上限」，别在这里无条件覆盖回去
    const full = btn.dataset.full === '1';
    btn.disabled = full;
    btn.textContent = full ? '已达上限' : '添加';
  }
}

/* 列表内「订阅 / 退订 / 解绑」统一走事件委托：列表会整体重绘，不能逐个绑事件 */
async function onMailItemAction(ev) {
  const btn = ev.target && ev.target.closest ? ev.target.closest('button[data-act]') : null;
  if (!btn || btn.disabled) return;
  const email = btn.dataset.email || '';
  const act = btn.dataset.act;
  if (!email || (act !== 'toggle' && act !== 'remove')) return;
  if (act === 'remove' && !window.confirm('解绑 ' + email + ' 后会退出公告订阅列表，确定吗？')) return;

  btn.disabled = true;
  try {
    let r;
    if (act === 'toggle') {
      const cur = mailStateCache.emails.find(x => x.email === email);
      r = (cur && !cur.subscribed)
        ? await notifyCall('email_bind', { email: email })
        : await notifyCall('email_unsubscribe', { email: email });
    } else {
      r = await notifyCall('email_remove', { email: email });
    }
    if (!r.ok) { showToast(r.data.error || '操作失败'); btn.disabled = false; return; }
    showToast(act === 'remove' ? '邮箱已解绑' : '订阅状态已更新');
    await loadMailState();
  } catch (e) { showToast('网络异常，请稍后再试'); }
  finally { btn.disabled = false; }
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

/* ---------- 发起 GitHub OAuth 授权（关联模式） ----------
   state 带 link: 前缀：登录页发起的是 login:，两者共用同一个
   /user/github-callback.html 回调地址（GitHub OAuth App 只需登记这一个 URL），
   落地页按前缀分流。无前缀的旧 state 一律按关联处理，兼容缓存中的旧页面。 */
function linkGithub() {
  if (!GH_CLIENT_ID) { showToast('管理员尚未配置 GitHub OAuth App'); return; }
  // state 防 CSRF：本浏览器会话生成，回调落地页校验一致性
  const nonce = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
  const state = 'link:' + nonce;
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

/* ---------- 我的访问记录（my_visit_history，只查自己） ---------- */
/* 身份完全由服务端按 auth.uid() 决定，前端不传 user_id；
   业务错误走 HTTP 200 + {ok:false,msg}，必须看 ok 字段 */
async function loadMyVisits(limit) {
  const box = $('#myvisitBox'), count = $('#myvisitCount'), more = $('#myvisitMore');
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 200);
  let list = [], errMsg = '';
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/my_visit_history', {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken()
      },
      body: JSON.stringify({ p_site: 'fesui', p_limit: cap })
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d || d.ok !== true) errMsg = (d && (d.msg || d.message)) || ('请求失败（HTTP ' + res.status + '）');
    else list = Array.isArray(d.list) ? d.list : [];
  } catch (e) { errMsg = '网络异常，稍后再试'; }

  if (count) count.textContent = errMsg ? '—' : (list.length + (list.length >= cap ? '+' : '') + ' 条');
  if (!box) return;
  if (errMsg) {
    box.textContent = '';
    const p = document.createElement('div');
    p.className = 'mywall-empty';
    p.textContent = errMsg;
    box.appendChild(p);
  } else if (!list.length) {
    box.textContent = '';
    const p = document.createElement('div');
    p.className = 'mywall-empty';
    p.textContent = '还没有访问记录，逛逛站点再回来看看。';
    box.appendChild(p);
  } else {
    box.textContent = '';
    const wrap = document.createElement('div');
    wrap.className = 'visit-list';
    list.forEach(r => {
      const row = document.createElement('div');
      row.className = 'visit-item';
      const path = document.createElement('span');
      path.className = 'visit-path';
      path.textContent = String((r && r.path) || '(未记录)');
      path.title = path.textContent;
      const time = document.createElement('span');
      time.className = 'visit-time';
      time.textContent = fmtRelative(r && r.visited_at);
      time.title = fmtDateTime(r && r.visited_at);
      row.appendChild(path);
      row.appendChild(time);
      wrap.appendChild(row);
    });
    box.appendChild(wrap);
  }
  if (more) {
    more.hidden = !!errMsg || list.length < cap || cap >= 200;
    more.onclick = () => loadMyVisits(cap + 20);
  }
}

/* ============================================================
   他人公开名片（只读视图，无需登录）
   - 入口：?username=xxx 或 ?uid=xxx（聊天室点昵称跳过来）
   - 数据源：已部署的 Edge Function profile（GET，公开只读）
   - 严格只展示公开字段，绝不含会话 / 绑定 / 我的留言 / 退出登录
   ============================================================ */
function safeImgUrl(u) {
  // 头像只放行 http/https，挡掉 javascript: / data: 等协议
  try {
    const s = String(u || '').trim();
    if (!s) return '';
    const parsed = new URL(s, location.href);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : '';
  } catch (e) { return ''; }
}

function renderPublicLoading() {
  $('#userMain').innerHTML = '<div class="user-loading">正在加载资料…</div>';
}

function renderPublicError(title, msg, showBack) {
  $('#userMain').innerHTML =
    '<section class="user-card guide-card">' +
      '<div class="guide-ico" aria-hidden="true">' + (title === '用户不存在' ? '🔍' : '🌧️') + '</div>' +
      '<h1>' + escapeHtml(title) + '</h1>' +
      '<p>' + escapeHtml(msg) + '</p>' +
      '<div class="guide-actions">' +
        '<a class="act-btn" href="./">我的个人中心</a>' +
        '<a class="act-btn" href="../chat/">去聊天室</a>' +
        (showBack ? '<a class="act-btn" href="../">返回主页</a>' : '') +
      '</div>' +
    '</section>';
}

function pubBadge(role, status) {
  const roleBadge = role === 'admin'
    ? '<span class="badge badge-admin">管理员</span>'
    : '<span class="badge">用户</span>';
  const statusBadge = status === 'approved'
    ? '<span class="badge badge-ok">账号正常</span>'
    : '<span class="badge badge-warn">' + escapeHtml(status || '未知') + '</span>';
  return roleBadge + statusBadge;
}

/* 最近动态列表（发言 / 文章 / 交易），统一做转义与空态 */
function pubList(rows, kind) {
  if (!Array.isArray(rows) || !rows.length) {
    return '<p class="pub-empty">暂时还没有' + kind + '。</p>';
  }
  const items = rows.slice(0, 8).map(r => {
    let main = '';
    let sub = '';
    if (kind === '文章') {
      main = r.title || '（无标题）';
      sub = r.created_at || r.date ? fmtRelative(r.created_at || r.date) : '';
    } else if (kind === '交易') {
      main = (r.item_name || '物品') + (r.price ? ' · ' + r.price : '');
      sub = r.created_at ? fmtRelative(r.created_at) : '';
    } else {
      main = r.content || '';
      sub = r.created_at ? fmtRelative(r.created_at) : '';
    }
    return '<li class="pub-item">' +
      '<p class="pub-item-main">' + escapeHtml(main) + '</p>' +
      (sub ? '<span class="pub-item-sub">' + escapeHtml(sub) + '</span>' : '') +
    '</li>';
  }).join('');
  return '<ul class="pub-list">' + items + '</ul>';
}

async function renderPublicProfile(username) {
  const main = $('#userMain');
  let data = null;
  try {
    const res = await fetch(FUNCTIONS_BASE + '/profile?username=' + encodeURIComponent(username), {
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    });
    data = await res.json().catch(() => null);
    if (res.status === 404 || (data && data.success === false)) {
      renderPublicError('用户不存在', '没有找到 @' + username + ' 这个账号，检查一下链接是不是打错了。', true);
      return;
    }
    if (!res.ok || !data || !data.profile) throw new Error('bad response');
  } catch (e) {
    // 降级：profile 函数暂不可用时，用 users 表公开列渲染一张基础名片
    // （users 表 anon 可读基础列，reason/password_hash 已被收紧，绝不带这两列）
    try {
      const fields = 'id,username,nickname,role,status,created_at,avatar_url,bio';
      const { ok, data: rows } = await sbGet('/rest/v1/users?select=' + fields +
        '&username=eq.' + encodeURIComponent(username) + '&limit=1');
      if (!ok || !Array.isArray(rows) || !rows.length) {
        renderPublicError('用户不存在', '没有找到 @' + username + ' 这个账号。', true);
        return;
      }
      const r = rows[0];
      renderPublicCard({
        username: r.username || username,
        nickname: r.nickname,
        avatar_url: r.avatar_url,
        role: r.role, status: r.status,
        bio: r.bio, joined_at: r.created_at
      }, null, [], [], [], true);
      return;
    } catch (e2) {
      renderPublicError('资料加载失败', '暂时读不到这位用户的资料，稍后再来试试。', true);
      return;
    }
  }

  const p = data.profile || {};
  const counts = data.counts || null;
  renderPublicCard(p, counts, data.messages, data.stories, data.trades, false);
}

function renderPublicCard(p, counts, messages, stories, trades, basic) {
  const main = $('#userMain');
  const name = p.nickname || p.username || '用户';
  const uname = p.username || '';
  const avatar = safeImgUrl(p.avatar_url);
  const initial = (name || 'U').trim().charAt(0).toUpperCase();
  const joined = p.joined_at || p.created_at;

  // 顶部导航：他人视图把「个人中心」换成回自己中心的链接
  const nav = $('.user-topnav');
  if (nav) {
    nav.innerHTML =
      '<a href="../">主页</a>' +
      '<a href="../#wall">留言墙</a>' +
      '<a href="../chat/">聊天室</a>' +
      '<a href="./">我的个人中心</a>';
  }

  // 更新 title，方便分享/浏览器标签识别
  try { document.title = escapeHtml(name) + ' · FeSui 用户资料'; } catch (e) {}

  const statCard = counts
    ? '<section class="user-card">' +
        '<h2><span class="card-ico" aria-hidden="true">📊</span>站点活跃</h2>' +
        '<div class="pub-stats">' +
          '<div class="pub-stat"><b>' + escapeHtml(String(counts.messages ?? 0)) + '</b><span>发言</span></div>' +
          '<div class="pub-stat"><b>' + escapeHtml(String(counts.stories ?? 0)) + '</b><span>文章</span></div>' +
          '<div class="pub-stat"><b>' + escapeHtml(String(counts.trades ?? 0)) + '</b><span>交易</span></div>' +
        '</div>' +
      '</section>'
    : '';

  const dynamicCards = !basic
    ? '<section class="user-card">' +
        '<h2><span class="card-ico" aria-hidden="true">💬</span>最近发言</h2>' + pubList(messages, '发言') +
      '</section>' +
      '<section class="user-card">' +
        '<h2><span class="card-ico" aria-hidden="true">📖</span>发表的文章</h2>' + pubList(stories, '文章') +
      '</section>' +
      '<section class="user-card">' +
        '<h2><span class="card-ico" aria-hidden="true">🛒</span>在售物品</h2>' + pubList(trades, '交易') +
      '</section>'
    : '';

  main.innerHTML =
    '<div class="pub-notice">这是 <b>@' + escapeHtml(uname) + '</b> 的公开资料页，仅展示公开信息。</div>' +
    '<section class="user-card">' +
      '<div class="profile-head">' +
        (avatar
          ? '<img class="profile-avatar" src="' + escapeHtml(avatar) + '" alt="头像" referrerpolicy="no-referrer" />'
          : '<div class="profile-avatar" aria-hidden="true">' + escapeHtml(initial) + '</div>') +
        '<div class="profile-id">' +
          '<h1 class="profile-name">' + escapeHtml(name) +
            '<span class="profile-at">@' + escapeHtml(uname) + '</span></h1>' +
          '<div class="profile-badges">' + pubBadge(p.role, p.status) + '</div>' +
        '</div>' +
      '</div>' +
    '</section>' +
    '<section class="user-card">' +
      '<h2><span class="card-ico" aria-hidden="true">🪪</span>公开资料</h2>' +
      '<div class="info-grid">' +
        '<div class="info-item"><div class="k">用户名</div><div class="v">' + escapeHtml(uname) + '</div></div>' +
        '<div class="info-item"><div class="k">加入时间</div><div class="v dim">' +
          (joined ? escapeHtml(fmtDateTime(joined)) : '—') + '</div></div>' +
        '<div class="info-item" style="grid-column:1/-1"><div class="k">个人简介</div>' +
          '<div class="v' + (p.bio ? '' : ' dim') + '">' + escapeHtml(p.bio || '这个人很懒，什么都没写。') + '</div></div>' +
      '</div>' +
    '</section>' +
    statCard +
    dynamicCards +
    '<section class="user-card">' +
      '<h2><span class="card-ico" aria-hidden="true">⚙️</span>操作</h2>' +
      '<div class="user-actions">' +
        '<a class="act-btn primary" href="../chat/">去聊天室聊聊</a>' +
        '<a class="act-btn" href="./">我的个人中心</a>' +
        '<a class="act-btn" href="../">返回主页</a>' +
      '</div>' +
    '</section>';
}

/* ---------- 启动 ---------- */
(async function init() {
  const y = $('#footYear');
  if (y) y.textContent = new Date().getFullYear();

  // 他人名片视图优先：带 ?username= 或 ?uid= 且不是 ?me=1
  let qs = new URLSearchParams(location.search);
  const wantOther = !qs.get('me') && (qs.get('username') || qs.get('uid'));
  if (wantOther) {
    let username = (qs.get('username') || '').trim();
    const uid = (qs.get('uid') || '').trim();
    renderPublicLoading();
    // uid → username：users 表 id/username 匿名可读（仅这两个字段）
    if (!username && uid) {
      try {
        const { ok, data } = await sbGet('/rest/v1/users?select=username&id=eq.' + encodeURIComponent(uid) + '&limit=1');
        if (ok && Array.isArray(data) && data.length) username = data[0].username || '';
      } catch (e) {}
      if (!username) { renderPublicError('用户不存在', '这个用户 ID 没有对应的账号。', true); return; }
    }
    await renderPublicProfile(username);
    return;
  }

  const exchanged = await consumeTicket();
  const token = getToken();
  const payload = token ? parseJwt(token) : null;

  if (!payload) { renderGuide(false); return; }
  if (tokenExpired(payload)) { clearToken(); renderGuide(true); return; }
  renderProfile(payload);
})();
