'use strict';

/* ============================================================
   个人主页交互脚本（原生 ES6+，零依赖）
   配置数据集中在 CONFIG，后续增删改在此处即可。
   ============================================================ */

const CONFIG = {
  // 个人格言（1-3 句，中文为主，契合「极客 + MC 玩家」双身份）
  mottos: [
    '在红石电路与代码逻辑的交界，我既是建筑师，也是工程师。',
    '不执拗，也不将就——每一座方块、每一行代码，都该有它的道理。',
    '世界是开放的沙盒，而我乐此不疲地编辑它。'
  ],
  // 项目导航卡片；href 缺失或 '#' 时标记为「规划中」（视觉有意，而非损坏态）
  lastUpdated: '2026-10-16',
  projects: [
    { name: '红石自动化实验室', desc: '基于 Minecraft 红石与真实电路原理的自动化演示', tags: ['Minecraft'] },
    { name: '终端工具箱', desc: '一组零依赖的命令行小工具', tags: ['CLI'] },
    { name: '静态站点生成器', desc: '纯前端、无构建步骤的极简建站方案', tags: ['Web'] },
    { name: '数据可视化', desc: '用原生 Canvas / SVG 讲故事', tags: ['Chart'] },
    { name: 'FKD 服务器主页', desc: 'FKD 游戏服务器官方网站', tags: ['Minecraft', '服务器'], href: 'https://FKD.是.gay', target: '_blank' }
  ],
  // 工具箱（卡片式，由数组配置驱动渲染；repo 为源码浏览地址）
  tools: [
    {
      icon: '⛏️', name: '矿石查找器',
      desc: '基岩版矿石分布预测：输入种子号，可视化各高度层的矿物概率。',
      href: './tool/ore-finder.html',
      repo: 'https://github.com/gykf123/Myself-sHTML/blob/main/tool/ore-finder.html'
    },
    {
      icon: '🧭', name: 'MC 搜索',
      desc: 'minecraftsearch.com 功能复刻：种子 / 矿石 / 结构 / 群系查找等 9 款工具，Java + 基岩双版，WASM 本地运行。',
      href: './tool/minecraft-search/index.html',
      repo: 'https://github.com/gykf123/Myself-sHTML/tree/main/tool/minecraft-search'
    }
  ],
  // 友链（大卡片，参考 blym.top 的友链网格样式；favicon 取站点自身，加载失败回退为站点首字）
  friendLinks: [
    { name: '白鹿原嚒', url: 'https://blym.top/', desc: '技术博客与开源项目分享，Minecraft 玩家的自留地。', favicon: 'https://blym.top/favicon.ico' },
    { name: 'MCJS', url: 'https://mcjs.link', desc: '网页版 Minecraft 最佳中文版，无需下载即可在浏览器里游玩。', favicon: 'https://mcjs.link/favicon.ico' }
  ],
  // 彩蛋按钮预设链接：点击随机跳转（"精神污染"/鬼畜整活向，链接均来自权威来源真实存在）
  eggLinks: [
    { title: '🧊 冰冰冰 500 小时纯享版', url: 'https://www.bilibili.com/video/BV1a6ho6cEan/' },
    { title: '💀 彩色骷髅跳舞 原版', url: 'https://www.bilibili.com/video/BV17vywBVEwu/' },
    { title: '😵‍💫 只剩下抽象了', url: 'https://www.bilibili.com/video/BV1M3o5BhEw7/' },
    { title: '🤣 倒霉否哥系列', url: 'https://www.bilibili.com/video/BV1kuzkB9EBE/' },
    { title: '🎤 念诗之王（改革春风吹满地）', url: 'https://www.bilibili.com/video/av19390801/' },
    { title: '🎙️ 雷总摇起来 Are you OK（循环向）', url: 'https://www.bilibili.com/video/av2271112/' },
    { title: '🍢 面筋哥×波澜哥 烤面筋融化你的心', url: 'https://www.bilibili.com/video/av21061574/' },
    { title: '🕺 全明星 双♂人♂舞', url: 'https://www.bilibili.com/video/av2648921/' },
    { title: '🐷 全英雄联盟最骚的骚猪', url: 'https://www.bilibili.com/video/av4606803/' },
    { title: '🐰 我是 papi 酱（电音单曲）', url: 'https://www.bilibili.com/video/av4033926/' },
    { title: '🎺 全明星 Rap 黑喂狗', url: 'https://www.bilibili.com/video/av3327562/' },
    { title: '⚡蒋出没⚡', url: 'https://www.bilibili.com/video/BV1sP9MBcEbT/' },
    { title: '⚡粉  刷  蒋⚡', url: 'https://www.bilibili.com/video/BV1pucHzSEbH/' }
  ],
  // Supabase 配置（留言墙后端；ANON_KEY 为 publishable，可公开内联）
  supabase: {
    url: 'https://yowwyasttkywyqgseuqz.supabase.co',
    anonKey: 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4',
    table: 'guestbook'
  }
};

// 各视图的标题与副标题（随导航切换）
const VIEW_META = {
  info:  { title: '个人信息', sub: '极客与 Minecraft 玩家之间，我是 FeSui。' },
  proj:  { title: '项目导航', sub: '正在搭建与维护中的一些作品。' },
  tools: { title: '工具箱',   sub: '自用小工具，按需取用。' },
  links: { title: '友链',     sub: '与优秀的站点建立连接，共同成长。' },
  wall:  { title: '留言墙',   sub: '留一句话，证明你来过。' }
};

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- 渲染格言 ---------- */
function renderMottos() {
  const m = $('#motto');
  if (m) m.textContent = CONFIG.mottos.join(' ');
}

/* ---------- 渲染项目卡片 ---------- */
function renderProjects() {
  const box = $('#projectList');
  if (!box) return;
  const frag = document.createDocumentFragment();
  CONFIG.projects.forEach(p => {
    const a = document.createElement('a');
    a.className = 'proj-card';
    const isSoon = !p.href || p.href === '#';
    if (isSoon) {
      a.classList.add('is-soon');
      a.setAttribute('aria-disabled', 'true');
      a.href = '#';
      a.addEventListener('click', e => e.preventDefault());
    } else {
      a.href = p.href;
      if (p.target) { a.target = p.target; a.rel = 'noopener noreferrer'; }
    }
    const tags = p.tags.map(t => `<span class="tag">${t}</span>`).join('');
    a.innerHTML = `<h4>${p.name}</h4><p>${p.desc}</p><div class="tags">${tags}</div>`;
    frag.appendChild(a);
  });
  box.appendChild(frag);
}

/* ---------- 渲染友链大卡片 ---------- */
function renderFriendLinks() {
  const box = $('#friendList');
  if (!box) return;
  const frag = document.createDocumentFragment();
  CONFIG.friendLinks.forEach(f => {
    const a = document.createElement('a');
    a.className = 'friend-card glass';
    a.href = f.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    // 站点首字（favicon 加载失败时回退）
    const initial = (f.name || '#').trim().charAt(0);
    const logo = document.createElement('div');
    logo.className = 'friend-logo';
    const img = document.createElement('img');
    img.alt = f.name;
    img.loading = 'lazy';
    img.src = f.favicon || '';
    img.addEventListener('error', () => { img.remove(); logo.textContent = initial; });
    logo.appendChild(img);
    const body = document.createElement('div');
    body.className = 'friend-body';
    const host = (() => { try { return new URL(f.url).hostname; } catch (e) { return f.url; } })();
    body.innerHTML =
      `<h4 class="friend-name">${f.name}<span class="go" aria-hidden="true">↗</span></h4>` +
      `<p class="friend-desc">${f.desc}</p>` +
      `<p class="friend-url">${host}</p>`;
    a.appendChild(logo);
    a.appendChild(body);
    frag.appendChild(a);
  });
  box.appendChild(frag);
}

/* ---------- 渲染工具箱卡片 ---------- */
function renderToolCards() {
  const box = $('#toolCards');
  if (!box) return;
  const frag = document.createDocumentFragment();
  CONFIG.tools.forEach(t => {
    const card = document.createElement('article');
    card.className = 'tool-card glass';
    card.innerHTML =
      '<div class="tool-card-main">' +
        '<span class="tool-card-ico" aria-hidden="true"></span>' +
        '<div class="tool-card-text">' +
          '<h3 class="tool-card-name"></h3>' +
          '<p class="tool-card-desc"></p>' +
        '</div>' +
      '</div>' +
      '<div class="tool-card-actions">' +
        '<a class="tool-btn tool-btn-primary" target="_blank" rel="noopener noreferrer">' +
          '<span class="tool-btn-ico" aria-hidden="true">↗</span>在线跳转</a>' +
        '<a class="tool-btn tool-btn-ghost" target="_blank" rel="noopener noreferrer">' +
          '<span class="tool-btn-ico" aria-hidden="true">📦</span>仓库浏览</a>' +
      '</div>';
    card.querySelector('.tool-card-ico').textContent = t.icon;
    card.querySelector('.tool-card-name').textContent = t.name;
    card.querySelector('.tool-card-desc').textContent = t.desc;
    const btns = card.querySelectorAll('.tool-btn');
    btns[0].href = t.href;
    if (t.repo) btns[1].href = t.repo; else btns[1].hidden = true;
    frag.appendChild(card);
  });
  box.appendChild(frag);
}

/* 切换文本并触发轻量滑入动画（标题/副标题切换时用） */
function swapText(el, text) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
}

/* ---------- 视图切换：侧栏仅导航，主区展示对应内容 ---------- */
function switchView(view) {
  if (!VIEW_META[view]) view = 'info';
  document.querySelectorAll('.nav-item').forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view').forEach(s => { s.hidden = s.dataset.view !== view; });
  const meta = VIEW_META[view];
  swapText($('#viewTitle'), meta.title);
  swapText($('#viewSub'), meta.sub);
  // 进入留言墙视图时渲染输入框并加载留言
  if (view === 'wall') { renderWallComposer(); loadWall(); }
  // 无障碍：切换后把焦点移到视图标题，便于键盘/读屏用户定位
  const title = $('#viewTitle');
  if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
  // 桌面端：点击导航后侧栏收起为窄条；移动端靠抽屉关闭处理
  const sb = $('#sidebar');
  if (sb && window.innerWidth > 767) sb.classList.add('collapsed');
  try { localStorage.setItem('view', view); } catch (e) {}
}

/* ---------- 导航绑定 ---------- */
function bindNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      if (drawerClose) drawerClose();   // 移动端：切换后关闭抽屉
    });
  });
}

/* ---------- 侧栏折叠（窄条 + localStorage 持久化） ---------- */
function bindCollapse() {
  const sb = $('#sidebar');
  const btn = $('#collapseBtn');
  if (!sb || !btn) return;
  if (localStorage.getItem('sidebar-collapsed') === '1') sb.classList.add('collapsed');
  btn.addEventListener('click', () => {
    const collapsed = sb.classList.toggle('collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
  });
}

/* ---------- 主题切换（Standard / Liquid Glass + localStorage） ---------- */
function bindTheme() {
  const saved = localStorage.getItem('theme') || 'glass';
  applyTheme(saved);
  document.querySelectorAll('#themeBtn, #sidebarThemeBtn').forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = document.documentElement.classList.contains('theme-glass') ? 'standard' : 'glass';
      applyTheme(next);
      localStorage.setItem('theme', next);
    });
  });
}
function applyTheme(t) {
  document.documentElement.classList.toggle('theme-glass', t === 'glass');
}

/* ---------- 彩蛋按钮：随机跳转到预设链接 ---------- */
function bindEgg() {
  const btn = $('#eggBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const links = CONFIG.eggLinks || [];
    if (!links.length) {
      btn.textContent = '预设链接待补充…';
      setTimeout(() => {
        btn.innerHTML = '<span class="egg-ico" aria-hidden="true">🎲</span><span class="egg-label">来点惊喜</span>';
      }, 1200);
      return;
    }
    const pick = links[Math.floor(Math.random() * links.length)];
    const url = pick.url || '#';
    btn.disabled = true;
    btn.classList.add('celebrate');
    btn.addEventListener('animationend', () => btn.classList.remove('celebrate'), { once: true });
    btn.innerHTML = '<span class="egg-ico" aria-hidden="true">🎲</span><span class="egg-label">传送中…</span>';
    setTimeout(() => {
      if (url !== '#') window.open(url, '_blank', 'noopener,noreferrer');
      btn.disabled = false;
      btn.innerHTML = '<span class="egg-ico" aria-hidden="true">🎲</span><span class="egg-label">再来一次</span>';
    }, 500);
  });
}

/* ---------- 登录接入（复用 login/index.html 的账号系统） ---------- */
const AUTH_KEY = 'fe_token';
function getToken() { try { return localStorage.getItem(AUTH_KEY) || ''; } catch (e) { return ''; } }

// 解析 JWT payload（不验签，仅读取账号快照；过期由 exp 字段判断）
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

// 解析登录回调 URL 中的 token（login 页跳回时携带 ?token=xxx）
function consumeLoginReturn() {
  try {
    const qs = new URLSearchParams(location.search);
    const t = qs.get('token');
    if (t) {
      localStorage.setItem(AUTH_KEY, t);
      const u = new URL(location.href); u.searchParams.delete('token');
      history.replaceState(null, '', u.pathname + u.search);
    }
    // login 页优先走一次性 ticket 换票（URL 上不落 JWT），此处负责 redeem 兑换
    const ticket = qs.get('ticket');
    if (ticket) {
      const u = new URL(location.href); u.searchParams.delete('ticket');
      history.replaceState(null, '', u.pathname + u.search);
      redeemTicket(ticket);
    }
  } catch (e) {}
}

// 用一次性 ticket 兑换 JWT（对应 login 页 auth-exchange issue 的消费端）
async function redeemTicket(ticket) {
  try {
    const r = await fetch(CONFIG.supabase.url + '/functions/v1/auth-exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': CONFIG.supabase.anonKey },
      body: JSON.stringify({ action: 'redeem', ticket })
    });
    const data = await r.json().catch(() => null);
    if (r.ok && data && data.token) {
      try { localStorage.setItem(AUTH_KEY, data.token); } catch (e) {}
      renderAuth(); renderWallComposer();
    }
  } catch (e) {}
}

function loginHref() {
  const back = location.origin + location.pathname;
  return './login/index.html?brand=FeSui&home=' +
    encodeURIComponent(location.origin + '/') + '&redirect=' + encodeURIComponent(back);
}

// 侧栏登录状态区：未登录显示入口，已登录显示「个人中心 + 退出」
function renderAuth() {
  const box = $('#authArea');
  if (!box) return;
  if (getToken()) {
    box.innerHTML =
      '<div class="auth-in" title="已登录">' +
        '<a class="auth-profile" href="./user/" title="个人中心">' +
          '<span class="ico" aria-hidden="true">🧑‍💻</span>' +
          '<span class="lbl">个人中心</span>' +
        '</a>' +
        '<button id="logoutBtn" class="auth-logout" type="button">退出</button>' +
      '</div>';
    const out = $('#logoutBtn');
    if (out) out.addEventListener('click', () => {
      try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
      renderAuth(); renderWallComposer();
    });
  } else {
    box.innerHTML =
      '<a class="login-link" href="' + loginHref() + '">' +
        '<span class="ico" aria-hidden="true">🔐</span>' +
        '<span class="lbl">登录 / 注册</span>' +
      '</a>';
  }
}

/* ---------- 留言墙（Supabase guestbook 表） ---------- */
async function supabaseReq(path, opts = {}) {
  const { url, anonKey, table } = CONFIG.supabase;
  const headers = {
    'apikey': anonKey,
    'Authorization': 'Bearer ' + anonKey,
    'Content-Type': 'application/json'
  };
  const res = await fetch(url + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, data };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function formatTime(iso) {
  try {
    const d = new Date(iso), now = new Date(), diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  } catch (e) { return ''; }
}

function updateWallBadge(n) {
  const b = $('#wallBadge');
  if (b) b.textContent = '💬 ' + n + ' 条留言';
}

async function loadWall() {
  const list = $('#wallList'), msg = $('#wallMsg');
  if (!list) return;
  list.innerHTML = '<li class="wall-loading">加载中…</li>';
  if (msg) msg.textContent = '';
  const { ok, data } = await supabaseReq(
    `/rest/v1/${CONFIG.supabase.table}?select=*&order=created_at.desc&limit=100`);
  if (!ok) {
    list.innerHTML = '';
    if (msg) msg.textContent = '留言墙尚未开启，等待主人配置数据库。';
    return;
  }
  renderWallList(data || []);
}

function renderWallList(rows) {
  const list = $('#wallList');
  if (!list) return;
  updateWallBadge(rows.length);
  if (!rows.length) {
    list.innerHTML = '<li class="wall-empty">还没有人留言，来当第一个吧。</li>';
    return;
  }
  list.innerHTML = rows.map(r =>
    `<li class="wall-item">
      <div class="wall-meta"><span class="wall-name">${escapeHtml(r.nickname || '匿名访客')}</span><span class="wall-time">${formatTime(r.created_at)}</span></div>
      <p class="wall-text">${escapeHtml(r.content || '')}</p>
    </li>`).join('');
}

// 输入框：未登录显示登录引导，已登录显示表单
function renderWallComposer() {
  const box = $('#wallComposer');
  if (!box) return;
  if (!getToken()) {
    box.innerHTML = '<div class="wall-gate"><span>登录后即可留言。</span><a class="wall-login" href="' + loginHref() + '">去登录 / 注册</a></div>';
    return;
  }
  box.innerHTML =
    '<form id="wallForm" class="wall-form">' +
      '<input id="wallNick" class="wall-input wall-nick" type="text" maxlength="30" placeholder="昵称（默认：匿名访客）" />' +
      '<textarea id="wallContent" class="wall-input wall-content" maxlength="500" rows="3" placeholder="留一句话，证明你来过…" required></textarea>' +
      '<div class="wall-actions">' +
        '<span id="wallCount" class="wall-count">0 / 500</span>' +
        '<button type="submit" class="wall-submit">发布留言</button>' +
      '</div>' +
    '</form>';
  const form = $('#wallForm'), content = $('#wallContent'), count = $('#wallCount');
  if (content) content.addEventListener('input', () => { count.textContent = content.value.length + ' / 500'; });
  if (form) form.addEventListener('submit', e => { e.preventDefault(); submitWall(content.value.trim()); });
}

async function submitWall(content) {
  const msg = $('#wallMsg');
  if (!content) { if (msg) msg.textContent = '留言内容不能为空。'; return; }
  const btn = $('#wallForm .wall-submit');
  if (btn) btn.disabled = true;
  if (msg) msg.textContent = '发布中…';
  const nick = ($('#wallNick').value.trim()) || '匿名访客';
  // 登录态留言关联 user_id（guestbook.user_id），个人中心「我的留言」据此汇总
  const payload = parseJwt(getToken());
  const row = { content, nickname: nick };
  if (payload && payload.sub) row.user_id = payload.sub;
  const { ok, status } = await supabaseReq(
    `/rest/v1/${CONFIG.supabase.table}`,
    { method: 'POST', body: JSON.stringify(row) });
  if (msg) msg.textContent = ok ? '已发布，感谢留言！' : ('发布失败（' + (status || '网络错误') + '），请稍后再试。');
  if (btn) btn.disabled = false;
  if (ok) {
    const c = $('#wallContent'); if (c) c.value = '';
    const n = $('#wallCount'); if (n) n.textContent = '0 / 500';
    await loadWall();
    if (msg) msg.textContent = '已发布，感谢留言！';
  }
}

/* ---------- 移动端抽屉 + 遮罩 ---------- */
let drawerClose = null;
function bindMobile() {
  const sb = $('#sidebar');
  const menu = $('#menuBtn');
  const overlay = $('#overlay');
  if (!sb || !menu || !overlay) return;
  const open = () => {
    sb.classList.add('open-drawer');
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('show'));
    menu.setAttribute('aria-expanded', 'true');
  };
  drawerClose = () => {
    overlay.classList.remove('show');
    sb.classList.remove('open-drawer');
    menu.setAttribute('aria-expanded', 'false');
    setTimeout(() => { overlay.hidden = true; }, 260);
  };
  menu.addEventListener('click', open);
  overlay.addEventListener('click', drawerClose);
}

/* ---------- 加载动画淡出 ---------- */
function hideLoader() {
  const l = $('#loader');
  if (!l) return;
  l.classList.add('done');
  setTimeout(() => l.remove(), 400);
}

/* ---------- 返回顶部（滚动出现，平滑滚动） ---------- */
function bindToTop() {
  const btn = $('#toTop');
  if (!btn) return;
  const onScroll = () => {
    const show = window.scrollY > 320;
    btn.hidden = !show;
    btn.classList.toggle('show', show);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  onScroll();
}

/* ---------- 页脚年份 / 最后更新 ---------- */
function fillFooter() {
  const y = $('#footYear'); if (y) y.textContent = new Date().getFullYear();
  const u = $('#footUpdated'); if (u) u.textContent = CONFIG.lastUpdated || '';
}

/* ---------- 留言墙刷新按钮 ---------- */
function bindWallRefresh() {
  const btn = $('#wallRefresh');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('spin')) return;
    btn.classList.add('spin');
    btn.disabled = true;
    await loadWall();
    btn.disabled = false;
    setTimeout(() => btn.classList.remove('spin'), 600);
  });
}

/* ---------- 侧栏实时时钟 ---------- */
function bindClock() {
  const el = $('#sideClock');
  if (!el) return;
  const p = n => String(n).padStart(2, '0');
  const tick = () => {
    const d = new Date();
    el.innerHTML =
      '<span class="dot" aria-hidden="true"></span>' +
      '<span class="clk">' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '</span>';
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------- 顶部滚动进度条 ---------- */
function bindProgress() {
  const bar = $('#progress');
  if (!bar) return;
  const onScroll = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const r = h > 0 ? Math.min(window.scrollY / h, 1) : 0;
    bar.style.transform = 'scaleX(' + r + ')';
    bar.style.opacity = r > 0.01 ? '1' : '0';
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();
}

/* ---------- 初始化 ---------- */
function init() {
  renderMottos();
  renderProjects();
  renderToolCards();
  renderFriendLinks();
  consumeLoginReturn();
  renderAuth();
  loadWall();
  bindNav();
  bindCollapse();
  bindTheme();
  bindEgg();
  bindMobile();
  bindToTop();
  fillFooter();
  bindWallRefresh();
  bindClock();
  bindProgress();
  // 恢复上次视图（默认个人信息）
  let v = 'info';
  try { v = localStorage.getItem('view') || 'info'; } catch (e) {}
  switchView(v);
  requestAnimationFrame(() => { const c = $('.content'); if (c) c.classList.add('ready'); });
  hideLoader();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
