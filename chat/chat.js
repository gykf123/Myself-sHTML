/* ============================================================
   聊天室（chat/）页面逻辑
   - 读消息：REST 公开读 public.fs_chat_messages（带 fs_ 前缀，
     与线上已有的 chat_messages / messages 等表完全隔离）
   - 发消息：Edge Function fs-chat（action=send，服务端验 JWT、
     user_id 只信 sub、限流、敏感词过滤）
   - 登录态：localStorage['fe_token']（与主站 / user/ 同源）
   - 点昵称 → ../user/?uid=xxx 看他人公开名片
   - 后端尚未部署时给出明确提示，不假装有数据、不回退去读别的表
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
const ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
const FUNCTIONS_BASE = SUPABASE_URL + '/functions/v1';
const AUTH_KEY = 'fe_token';
const TABLE = 'fs_chat_messages';
const POLL_MS = 8000;
const MAX_LEN = 500;

const $ = (sel, root = document) => root.querySelector(sel);

function getToken() { try { return localStorage.getItem(AUTH_KEY) || ''; } catch (e) { return ''; } }
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function safeImgUrl(u) {
  try {
    const s = String(u || '').trim();
    if (!s) return '';
    const p = new URL(s, location.href);
    return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '';
  } catch (e) { return ''; }
}
function parseJwt(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const p = JSON.parse(decodeURIComponent(escape(atob(b64))));
    return (p && typeof p === 'object') ? p : null;
  } catch (e) { return null; }
}
function tokenExpired(p) { return !!(p && p.exp && p.exp * 1000 <= Date.now()); }
function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  } catch (e) { return ''; }
}
function loginHref() {
  const back = location.origin + location.pathname;
  return '../login/index.html?brand=FeSui&home=' +
    encodeURIComponent(location.origin + '/') +
    '&redirect=' + encodeURIComponent(back);
}

/* ---------- 轻量提示 ---------- */
let toastTimer = null;
function showToast(text) {
  let el = $('#chatToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chatToast';
    el.className = 'user-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- 状态行 ---------- */
function setConn(cls, html) {
  const el = $('#chatConn');
  if (!el) return;
  el.className = 'chat-conn' + (cls ? ' ' + cls : '');
  el.innerHTML = html;
}

/* ---------- 消息渲染 ---------- */
let messages = [];        // 已渲染的消息（按 id 升序）
let lastId = 0;
let backendReady = false; // 表是否可读
let pollTimer = null;

function renderMessages() {
  const list = $('#chatList');
  if (!list) return;
  if (!backendReady) {
    list.innerHTML =
      '<div class="chat-empty">聊天后端还没准备好 🛠️<br>' +
      '需要管理员在 Supabase 执行 <code>fs-chat.sql</code> 并部署 <code>fs-chat</code> 函数。<br>' +
      '部署完成后刷新本页就能看到消息了。</div>';
    return;
  }
  if (!messages.length) {
    list.innerHTML = '<div class="chat-empty">大厅还冷清着，来发第一句吧 👋</div>';
    return;
  }
  const myUid = (() => { const p = parseJwt(getToken()); return p && p.sub ? p.sub : ''; })();
  list.innerHTML = messages.map(m => {
    const own = myUid && m.user_id === myUid;
    const name = m.author_name || '匿名';
    const avatar = safeImgUrl(m.author_avatar);
    const initial = (name || 'U').trim().charAt(0).toUpperCase();
    const avatarHtml = avatar
      ? '<img class="chat-avatar" src="' + escapeHtml(avatar) + '" alt="" referrerpolicy="no-referrer" />'
      : '<div class="chat-avatar chat-avatar-fallback" aria-hidden="true">' + escapeHtml(initial) + '</div>';
    // 有 user_id 才做资料跳转链接；用 uid 入口（user/ 会解析成 username）
    const nameHtml = m.user_id
      ? '<a class="chat-name" href="../user/?uid=' + encodeURIComponent(m.user_id) + '" title="查看 TA 的资料">' + escapeHtml(name) + '</a>'
      : '<span class="chat-name">' + escapeHtml(name) + '</span>';
    return '<div class="chat-msg' + (own ? ' own' : '') + (m._pending ? ' pending' : '') + (m._failed ? ' failed' : '') + '" data-mid="' + escapeHtml(String(m.id)) + '">' +
      avatarHtml +
      '<div class="chat-body">' +
        '<div class="chat-meta">' + nameHtml +
          '<span class="chat-time">' + escapeHtml(fmtTime(m.created_at)) + '</span>' +
          (m._failed ? '<span style="color:#ff7a7a">发送失败</span>' : '') +
        '</div>' +
        '<div class="chat-bubble">' + escapeHtml(m.content) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  list.scrollTop = list.scrollHeight;
}

/* ---------- 拉取消息（REST 公开读，增量合并） ---------- */
async function fetchMessages(silent) {
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/' + TABLE +
      '?select=id,user_id,author_name,author_avatar,content,created_at&order=created_at.asc&limit=100', {
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) {
      // PGRST205 = 表不存在 → 后端尚未部署，保持明确提示
      backendReady = false;
      if (!silent) {
        setConn('warn', '后端待部署 · 只可查看页面');
        renderMessages();
        renderComposer();
      }
      return;
    }
    backendReady = true;
    // 保留本地乐观/失败消息，合并服务端数据
    const local = messages.filter(m => m._pending || m._failed);
    const server = data.map(r => ({
      id: Number(r.id), user_id: r.user_id, author_name: r.author_name,
      author_avatar: r.author_avatar, content: r.content, created_at: r.created_at
    }));
    const maxId = server.reduce((a, b) => Math.max(a, b.id), 0);
    lastId = Math.max(lastId, maxId);
    messages = server.concat(local);
    messages.sort((a, b) => (a.id || 0) - (b.id || 0));
    renderMessages();
    if (!silent) {
      const p = parseJwt(getToken());
      setConn('ok', '● 已连接 · <b>' + server.length + '</b> 条消息' + (p ? '' : ' · 未登录'));
    }
  } catch (e) {
    if (!silent) {
      backendReady = false;
      setConn('err', '连接失败，稍后重试');
      renderMessages();
    }
  }
}

/* ---------- 输入区（登录 / 未登录 / 后端未部署 三态） ---------- */
function renderComposer() {
  const box = $('#chatComposer');
  if (!box) return;
  const token = getToken();
  const payload = token ? parseJwt(token) : null;
  const logged = !!(payload && !tokenExpired(payload));

  if (!backendReady) {
    box.innerHTML = '<div class="chat-login-row"><p>后端部署完成后，这里就能发言了。</p>' +
      '<a class="act-btn" href="../">返回主页</a></div>';
    return;
  }
  if (!logged) {
    box.innerHTML =
      '<div class="chat-login-row">' +
        '<p>登录后即可在聊天室发言。</p>' +
        '<a class="act-btn primary" href="' + loginHref() + '">登录 / 注册</a>' +
      '</div>' +
      '<p class="chat-compose-tip">不登录也能浏览全部消息。点消息里的昵称可以看 TA 的公开资料。</p>';
    return;
  }
  const name = payload.nickname || payload.username || '我';
  box.innerHTML =
    '<div class="chat-compose-row">' +
      '<textarea id="chatInput" class="chat-input" maxlength="' + MAX_LEN + '" rows="2" placeholder="说点什么…（Enter 发送，Shift+Enter 换行）" aria-label="消息内容"></textarea>' +
      '<button id="chatSend" class="act-btn primary chat-send" type="button">发送</button>' +
    '</div>' +
    '<p class="chat-compose-tip">以 <b>' + escapeHtml(name) + '</b> 的身份发言 · 消息公开可见，别发敏感信息 · 最长 ' + MAX_LEN + ' 字</p>' +
    '<div class="chat-count"><span id="chatCount">0</span> / ' + MAX_LEN + '</div>';

  const input = $('#chatInput'), btn = $('#chatSend'), count = $('#chatCount');
  if (input) {
    input.addEventListener('input', () => { if (count) count.textContent = String(input.value.length); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
  }
  if (btn) btn.addEventListener('click', sendMessage);
}

/* ---------- 发送消息（走 fs-chat 函数） ---------- */
let sending = false;
async function sendMessage() {
  const input = $('#chatInput'), btn = $('#chatSend');
  if (!input || !btn || sending) return;
  const content = input.value.trim();
  if (!content) { showToast('消息不能为空'); return; }
  if (content.length > MAX_LEN) { showToast('消息最长 ' + MAX_LEN + ' 字'); return; }

  const token = getToken();
  const payload = parseJwt(token);
  if (!payload || tokenExpired(payload)) { showToast('登录已过期，请重新登录'); renderComposer(); return; }

  sending = true;
  btn.disabled = true;
  btn.textContent = '发送中…';
  input.value = '';
  const c = $('#chatCount'); if (c) c.textContent = '0';

  // 乐观插入（临时负 id，避免与服务端 id 冲突）
  const tempId = -Date.now();
  messages.push({
    id: tempId, user_id: payload.sub || '',
    author_name: payload.nickname || payload.username || '我',
    author_avatar: payload.avatar_url || '', content,
    created_at: new Date().toISOString(), _pending: true
  });
  renderMessages();

  try {
    const res = await fetch(FUNCTIONS_BASE + '/fs-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ action: 'send', content })
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      showToast((data && data.error) || '登录已过期，请重新登录');
      try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
      messages = messages.filter(m => m.id !== tempId);
      renderMessages();
      renderComposer();
      return;
    }
    if (!res.ok || !data || !data.ok) {
      throw new Error((data && data.error) || ('发送失败（HTTP ' + res.status + '）'));
    }
    // 成功后由一次静默拉取把乐观消息换成服务端真实消息
    messages = messages.filter(m => m.id !== tempId);
    await fetchMessages(true);
    input.focus();
  } catch (e) {
    const m = messages.find(x => x.id === tempId);
    if (m) { m._pending = false; m._failed = true; }
    renderMessages();
    showToast(e.message || '发送失败，请稍后再试');
    input.value = content;
    const c2 = $('#chatCount'); if (c2) c2.textContent = String(content.length);
  } finally {
    sending = false;
    const b = $('#chatSend');
    if (b) { b.disabled = false; b.textContent = '发送'; }
  }
}

/* ---------- 启动 ---------- */
(async function init() {
  const y = $('#footYear');
  if (y) y.textContent = new Date().getFullYear();

  renderComposer();
  await fetchMessages(false);
  renderComposer();

  const refresh = $('#chatRefresh');
  if (refresh) refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    await fetchMessages(false);
    refresh.disabled = false;
  });

  // 定时轮询；后端未就绪时不重复刷屏，但保留定时器以便部署后自动恢复
  pollTimer = setInterval(() => { if (backendReady) fetchMessages(true); }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && backendReady) fetchMessages(true);
  });
})();
