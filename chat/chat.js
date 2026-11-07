/* ============================================================
   聊天室（chat/）页面逻辑
   - 公共大厅：读 = REST 公开读 public.fs_chat_messages；
     写 = Edge Function fs-chat(action=send)
   - 私聊：读写全走 fs-chat(dm_send / dm_thread / dm_conversations)，
     表 fs_chat_dm 不开放前端权限，只有双方可见
   - 登录态：localStorage['fe_token']（与主站 / user/ 同源）
   - 点昵称 → ../user/?uid=xxx 看公开名片；点「✉️ 私聊」直接开会话
   - 封禁：visit.js 派发 fs:banned 事件 / 写操作返回 403 banned 时，
     展示原因并停用发言区（服务端亦有拦截，前端只是提示）
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
function clearToken() { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} }
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
function isLogged() {
  const t = getToken(), p = t ? parseJwt(t) : null;
  return !!(p && !tokenExpired(p));
}
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
function banText(d) {
  const reason = d && d.reason ? '：' + String(d.reason) : '';
  const until = (d && !d.permanent && d.until) ? '（至 ' + String(d.until).slice(0, 10) + '）' : '';
  return '账号已被封禁' + reason + until + '，发言功能已停用';
}

/* ---------- 全局状态 ---------- */
let banned = window.__fsBanned || null;
let currentTab = 'public';
let backendReady = false;   // 公共大厅表是否可读
let messages = [];
let pollTimer = null;
let sending = false;

let dmReady = false;
let conversations = [];
let activePeer = null;      // { uid, name, avatar }
let dmMessages = [];
let dmSending = false;

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

/* ---------- 函数调用（需要登录的 action 统一入口） ---------- */
async function callFn(action, body) {
  const token = getToken();
  const payload = token ? parseJwt(token) : null;
  if (!payload || tokenExpired(payload)) throw new Error('登录已过期，请重新登录');
  const res = await fetch(FUNCTIONS_BASE + '/fs-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify(Object.assign({ action }, body || {}))
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    clearToken();
    throw new Error((data && data.error) || '登录已过期，请重新登录');
  }
  if (res.status === 403 && data && data.banned) {
    banned = data; window.__fsBanned = data;
    renderComposer(); renderDmComposer();
    throw new Error((data && data.error) || '账号已被封禁');
  }
  if (!res.ok || !data || !data.ok) {
    throw new Error((data && data.error) || ('请求失败（HTTP ' + res.status + '）'));
  }
  return data;
}

/* ================= 公共大厅 ================= */
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
    const nameHtml = m.user_id
      ? '<a class="chat-name" href="../user/?uid=' + encodeURIComponent(m.user_id) + '" title="查看 TA 的资料">' + escapeHtml(name) + '</a>'
      : '<span class="chat-name">' + escapeHtml(name) + '</span>';
    const dmBtn = (m.user_id && myUid && m.user_id !== myUid && !m._pending && !m._failed)
      ? '<button class="chat-dm-btn" type="button" data-dm-uid="' + escapeHtml(m.user_id) +
        '" data-dm-name="' + escapeHtml(name) + '">✉️ 私聊</button>'
      : '';
    return '<div class="chat-msg' + (own ? ' own' : '') + (m._pending ? ' pending' : '') + (m._failed ? ' failed' : '') + '" data-mid="' + escapeHtml(String(m.id)) + '">' +
      avatarHtml +
      '<div class="chat-body">' +
        '<div class="chat-meta">' + nameHtml + dmBtn +
          '<span class="chat-time">' + escapeHtml(fmtTime(m.created_at)) + '</span>' +
          (m._failed ? '<span style="color:#ff7a7a">发送失败</span>' : '') +
        '</div>' +
        '<div class="chat-bubble">' + escapeHtml(m.content) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  list.querySelectorAll('.chat-dm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isLogged()) { showToast('登录后才能发起私聊'); return; }
      activePeer = { uid: btn.dataset.dmUid, name: btn.dataset.dmName || '用户', avatar: null };
      switchTab('dm');
    });
  });
  list.scrollTop = list.scrollHeight;
}

async function fetchMessages(silent) {
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/' + TABLE +
      '?select=id,user_id,author_name,author_avatar,content,created_at&order=created_at.asc&limit=100', {
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) {
      backendReady = false;
      if (!silent) {
        setConn('warn', '后端待部署 · 只可查看页面');
        renderMessages(); renderComposer();
      }
      return;
    }
    backendReady = true;
    const local = messages.filter(m => m._pending || m._failed);
    const server = data.map(r => ({
      id: Number(r.id), user_id: r.user_id, author_name: r.author_name,
      author_avatar: r.author_avatar, content: r.content, created_at: r.created_at
    }));
    messages = server.concat(local).sort((a, b) => (a.id || 0) - (b.id || 0));
    renderMessages();
    // 轮询（silent）也要更新计数：否则后台已渲染出第 4 条，状态栏还停在「3 条消息」
    if (currentTab === 'public') {
      setConn('ok', '● 已连接 · <b>' + server.length + '</b> 条消息' + (isLogged() ? '' : ' · 未登录'));
    }
  } catch (e) {
    if (!silent && currentTab === 'public') {
      backendReady = false;
      setConn('err', '连接失败，稍后重试');
      renderMessages();
    }
  }
}

function renderComposer() {
  const box = $('#chatComposer');
  if (!box) return;
  if (banned) {
    box.innerHTML = '<div class="chat-login-row"><p>⛔ ' + escapeHtml(banText(banned)) + '</p></div>';
    return;
  }
  if (!backendReady) {
    box.innerHTML = '<div class="chat-login-row"><p>后端部署完成后，这里就能发言了。</p>' +
      '<a class="act-btn" href="../">返回主页</a></div>';
    return;
  }
  if (!isLogged()) {
    box.innerHTML =
      '<div class="chat-login-row">' +
        '<p>登录后即可在聊天室发言。</p>' +
        '<a class="act-btn primary" href="' + loginHref() + '">登录 / 注册</a>' +
      '</div>' +
      '<p class="chat-compose-tip">不登录也能浏览全部消息。点消息里的昵称可以看 TA 的公开资料。</p>';
    return;
  }
  const payload = parseJwt(getToken());
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
      clearToken();
      showToast((data && data.error) || '登录已过期，请重新登录');
      messages = messages.filter(m => m.id !== tempId);
      renderMessages(); renderComposer(); renderDmComposer();
      return;
    }
    if (res.status === 403 && data && data.banned) {
      banned = data; window.__fsBanned = data;
      showToast((data && data.error) || '账号已被封禁');
      messages = messages.filter(m => m.id !== tempId);
      renderMessages(); renderComposer(); renderDmComposer();
      return;
    }
    if (!res.ok || !data || !data.ok) {
      throw new Error((data && data.error) || ('发送失败（HTTP ' + res.status + '）'));
    }
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

/* ================= 私聊 ================= */
function updateBadge() {
  const el = $('#dmBadge');
  if (!el) return;
  const n = conversations.reduce((a, c) => a + (Number(c.unread) || 0), 0);
  el.textContent = String(n);
  el.hidden = n === 0;
}

function renderConvList() {
  const el = $('#dmConvList');
  if (!el) return;
  if (!isLogged()) {
    el.innerHTML = '<div class="chat-empty">登录后才能查看私聊 💬</div>';
    return;
  }
  if (!conversations.length) {
    el.innerHTML = '<div class="chat-empty">还没有会话，输入用户名发起第一句吧</div>';
    return;
  }
  el.innerHTML = conversations.map(c => {
    const on = activePeer && activePeer.uid === c.peer_uid;
    return '<button class="dm-conv' + (on ? ' active' : '') + '" type="button" data-peer="' +
      escapeHtml(c.peer_uid) + '" data-name="' + escapeHtml(c.peer_name) + '">' +
      '<div class="dm-conv-top">' +
        '<span class="dm-conv-name">' + escapeHtml(c.peer_name) + '</span>' +
        '<span class="dm-conv-time">' + escapeHtml(fmtTime(c.last_at)) + '</span>' +
      '</div>' +
      '<div class="dm-conv-last">' +
        (Number(c.unread) > 0 ? '<span class="dm-conv-unread">' + Number(c.unread) + '</span>' : '') +
        (c.last_mine ? '我: ' : '') + escapeHtml(c.last_content) +
      '</div>' +
    '</button>';
  }).join('');
  el.querySelectorAll('.dm-conv').forEach(btn => {
    btn.addEventListener('click', () => openDm(btn.dataset.peer, btn.dataset.name));
  });
}

async function loadConversations(silent) {
  if (!isLogged()) { conversations = []; renderConvList(); updateBadge(); return; }
  try {
    const d = await callFn('dm_conversations', {});
    conversations = Array.isArray(d.list) ? d.list : [];
    dmReady = true;
  } catch (e) {
    if (!silent) showToast(e.message || '会话加载失败');
    conversations = [];
  }
  renderConvList();
  updateBadge();
}

function renderDmHead() {
  const el = $('#dmHead');
  if (!el) return;
  if (!activePeer) {
    el.textContent = '从左侧选一个会话，或输入用户名发起私聊';
    return;
  }
  el.innerHTML = '与 <b>' + escapeHtml(activePeer.name) + '</b> 的私聊 · 仅你们双方可见 · ' +
    '<a href="../user/?uid=' + encodeURIComponent(activePeer.uid) + '">看 TA 的资料</a>';
}

function renderDmMessages() {
  const el = $('#dmList');
  if (!el) return;
  if (!activePeer) {
    el.innerHTML = '<div class="chat-empty">👈 从左侧选一个会话开始</div>';
    return;
  }
  if (!dmMessages.length) {
    el.innerHTML = '<div class="chat-empty">还没有消息，打个招呼吧 👋</div>';
    return;
  }
  el.innerHTML = dmMessages.map(m => {
    const own = !!m.mine;
    const who = own ? '我' : (activePeer.name || '用户');
    return '<div class="chat-msg' + (own ? ' own' : '') + (m._pending ? ' pending' : '') +
      (m._failed ? ' failed' : '') + '" data-dmid="' + escapeHtml(String(m.id)) + '">' +
      '<div class="chat-avatar chat-avatar-fallback" aria-hidden="true">' +
        escapeHtml((who || 'U').trim().charAt(0).toUpperCase()) + '</div>' +
      '<div class="chat-body">' +
        '<div class="chat-meta"><span class="chat-name">' + escapeHtml(who) + '</span>' +
          '<span class="chat-time">' + escapeHtml(fmtTime(m.created_at)) + '</span>' +
          (m._failed ? '<span style="color:#ff7a7a">发送失败</span>' : '') +
        '</div>' +
        '<div class="chat-bubble">' + escapeHtml(m.content) + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function renderDmComposer() {
  const el = $('#dmComposer');
  if (!el) return;
  if (banned) {
    el.innerHTML = '<p class="dm-login-tip">⛔ ' + escapeHtml(banText(banned)) + '</p>';
    return;
  }
  if (!isLogged()) {
    el.innerHTML = '<p class="dm-login-tip">登录后即可收发私聊 · <a href="' + loginHref() + '">登录 / 注册</a></p>';
    return;
  }
  if (!activePeer) {
    el.innerHTML = '<p class="dm-login-tip">从左侧选一个会话，或在上方输入对方用户名发起私聊。</p>';
    return;
  }
  el.innerHTML =
    '<div class="chat-compose-row">' +
      '<textarea id="dmInput" class="chat-input" maxlength="' + MAX_LEN + '" rows="2" placeholder="给 ' +
        escapeHtml(activePeer.name) + ' 发消息…（Enter 发送）" aria-label="私聊内容"></textarea>' +
      '<button id="dmSend" class="act-btn primary chat-send" type="button">发送</button>' +
    '</div>' +
    '<p class="chat-compose-tip">私聊仅你们双方可见 · 最长 ' + MAX_LEN + ' 字</p>' +
    '<div class="chat-count"><span id="dmCount">0</span> / ' + MAX_LEN + '</div>';
  const input = $('#dmInput'), btn = $('#dmSend'), count = $('#dmCount');
  if (input) {
    input.addEventListener('input', () => { if (count) count.textContent = String(input.value.length); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDm(); }
    });
  }
  if (btn) btn.addEventListener('click', sendDm);
}

async function fetchDmThread(silent) {
  if (!activePeer || !isLogged()) { renderDmMessages(); return; }
  try {
    const d = await callFn('dm_thread', { peer_uid: activePeer.uid, limit: 50 });
    if (d.peer) activePeer = d.peer;
    dmMessages = Array.isArray(d.messages) ? d.messages : [];
    dmReady = true;
    renderDmHead();
  } catch (e) {
    if (!silent) showToast(e.message || '私聊加载失败');
  }
  renderDmMessages();
  // 打开会话会把对方发来的消息标记为已读，顺手刷新会话列表的未读数
  if (!silent) loadConversations(true);
}

async function openDm(uid, name) {
  activePeer = { uid, name: name || '用户', avatar: null };
  renderDmHead(); renderConvList(); renderDmComposer();
  await fetchDmThread(false);
}

async function startDm() {
  const input = $('#dmPeerInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) { showToast('请输入对方用户名'); return; }
  if (!isLogged()) { showToast('请先登录后发起私聊'); return; }
  try {
    const d = await callFn('dm_thread', { peer_username: name, limit: 50 });
    input.value = '';
    activePeer = d.peer || { uid: '', name, avatar: null };
    dmMessages = Array.isArray(d.messages) ? d.messages : [];
    renderDmHead(); renderDmMessages(); renderDmComposer();
    loadConversations(true);
    showToast('已打开与 ' + activePeer.name + ' 的私聊');
  } catch (e) {
    showToast(e.message || '找不到这个用户');
  }
}

async function sendDm() {
  const input = $('#dmInput'), btn = $('#dmSend');
  if (!input || !btn || dmSending || !activePeer) return;
  const content = input.value.trim();
  if (!content) { showToast('消息不能为空'); return; }
  if (content.length > MAX_LEN) { showToast('消息最长 ' + MAX_LEN + ' 字'); return; }
  if (!isLogged()) { showToast('登录已过期，请重新登录'); renderDmComposer(); return; }

  dmSending = true;
  btn.disabled = true;
  btn.textContent = '发送中…';
  input.value = '';
  const c = $('#dmCount'); if (c) c.textContent = '0';

  const tempId = -Date.now();
  dmMessages.push({ id: tempId, content, created_at: new Date().toISOString(), mine: true, _pending: true });
  renderDmMessages();

  try {
    await callFn('dm_send', { to_uid: activePeer.uid, content });
    dmMessages = dmMessages.filter(m => m.id !== tempId);
    await fetchDmThread(true);
    loadConversations(true);
    input.focus();
  } catch (e) {
    const m = dmMessages.find(x => x.id === tempId);
    if (m) { m._pending = false; m._failed = true; }
    renderDmMessages();
    showToast(e.message || '发送失败，请稍后再试');
    input.value = content;
    const c2 = $('#dmCount'); if (c2) c2.textContent = String(content.length);
  } finally {
    dmSending = false;
    const b = $('#dmSend');
    if (b) { b.disabled = false; b.textContent = '发送'; }
  }
}

/* ================= Tab 切换 ================= */
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.chat-tab').forEach(b => {
    const on = b.dataset.chatTab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const pub = $('#viewPublic'), dm = $('#viewDm');
  if (pub) pub.hidden = tab !== 'public';
  if (dm) dm.hidden = tab !== 'dm';

  if (tab === 'dm') {
    setConn('', '✉️ 私聊模式');
    if (isLogged()) {
      loadConversations(false);
      if (activePeer) fetchDmThread(false);
    }
    renderDmHead(); renderDmComposer(); renderDmMessages(); renderConvList();
  } else {
    fetchMessages(false);
    renderComposer();
  }
}

/* ---------- 启动 ---------- */
(async function init() {
  // 登录回跳：先把一次性 ticket 换成 JWT，再渲染登录态
  try { if (window.__fsTicketReady) await window.__fsTicketReady; } catch (e) {}

  const y = $('#footYear');
  if (y) y.textContent = new Date().getFullYear();

  if (window.__fsBanned) banned = window.__fsBanned;
  window.addEventListener('fs:banned', (e) => {
    banned = e.detail || banned;
    renderComposer(); renderDmComposer();
  });

  document.querySelectorAll('.chat-tab').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.chatTab)));
  const startBtn = $('#dmStart');
  if (startBtn) startBtn.addEventListener('click', startDm);
  const peerInput = $('#dmPeerInput');
  if (peerInput) peerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); startDm(); }
  });

  renderComposer();
  renderDmHead(); renderDmMessages(); renderDmComposer(); renderConvList();
  await fetchMessages(false);
  renderComposer();

  const refresh = $('#chatRefresh');
  if (refresh) refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    if (currentTab === 'public') {
      await fetchMessages(false);
    } else {
      await loadConversations(false);
      if (activePeer) await fetchDmThread(false);
    }
    refresh.disabled = false;
  });

  pollTimer = setInterval(() => {
    if (currentTab === 'public') {
      if (backendReady) fetchMessages(true);
    } else if (isLogged()) {
      loadConversations(true);
      if (activePeer) fetchDmThread(true);
    }
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (currentTab === 'public') { if (backendReady) fetchMessages(true); }
    else if (isLogged()) { loadConversations(true); if (activePeer) fetchDmThread(true); }
  });
})();
