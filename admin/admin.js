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

    /* 给 AI 的指令：后台下发 → 每 12 小时定时取件执行 → 回执写回这里 */
    '<section class="user-card ad-agent-card">' +
      '<div class="ad-card-head"><h2><span class="card-ico" aria-hidden="true">🤖</span>给 AI 的指令</h2>' +
        '<div class="ad-head-actions">' +
          '<span class="ad-agent-badge" id="adAgentNext">下次检查 …</span>' +
          '<button class="act-btn small" id="adAgentRefresh" type="button">刷新</button>' +
        '</div></div>' +
      '<p class="ad-note">写下你想让我做的事，我会 <b>每 12 小时自动来取一次</b> 并完成；执行进度和结果都写回下面，完成后另发项目公告 + 留言板汇报。指令是纯文本，<b>不要写密码 / 密钥</b>。</p>' +
      '<div class="ad-agent-state" id="adAgentState">正在检查执行器状态…</div>' +
      '<form class="ad-form" id="adAgentForm" autocomplete="off">' +
        '<div class="ad-field full">' +
          '<label class="ad-label" for="adAgentBody">指令内容（1–4000 字）</label>' +
          '<textarea class="ad-input ad-textarea ad-agent-input" id="adAgentBody" rows="3" maxlength="4000" required placeholder="例如：把首页标语改成…… / 检查线上博客页并汇报"></textarea>' +
        '</div>' +
        '<div class="ad-field">' +
          '<label class="ad-label" for="adAgentPriority">优先级</label>' +
          '<select class="ad-input" id="adAgentPriority">' +
            '<option value="normal">普通</option>' +
            '<option value="high">紧急（优先取件）</option>' +
          '</select>' +
        '</div>' +
        '<div class="ad-form-actions">' +
          '<button class="act-btn primary" id="adAgentSubmit" type="submit">提交指令</button>' +
          '<span class="ad-hint" id="adAgentHint"></span>' +
        '</div>' +
      '</form>' +
      '<div class="ad-list ad-agent-list" id="adAgentBox"><div class="user-loading">加载中…</div></div>' +
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
    '</section>' +

    /* 项目公告：站内展示 + 按当前通道发邮件（默认 Resend 直发，可切回队列） */
    '<section class="user-card">' +
      '<div class="ad-card-head"><h2><span class="card-ico" aria-hidden="true">📢</span>项目公告</h2>' +
        '<button class="act-btn small" id="adAnnRefresh" type="button">刷新</button></div>' +
      '<p class="ad-note">发布后立刻在博客页（主站「博客 / 公告」入口）可见；<b>只有公告会发邮件</b>——按当前通道发给已订阅用户（默认 Resend 直接发出，不经过队列）。写博客文章不会触发任何邮件。</p>' +
      '<div class="ad-status" id="adMailStatus">正在检查邮件通道…</div>' +
      '<div class="ad-status" id="adQueueStats">队列统计加载中…</div>' +
      '<div class="ad-mail-test">' +
        '<input class="ad-input" id="adTestEmail" type="email" maxlength="254" placeholder="收件邮箱（先填自己的）" aria-label="测试邮件收件地址" />' +
        '<button class="act-btn small" id="adTestMailBtn" type="button">发送测试邮件</button>' +
        '<span class="ad-hint" id="adTestMailHint"></span>' +
      '</div>' +
      '<form class="ad-form" id="adAnnForm" autocomplete="off">' +
        '<div class="ad-field">' +
          '<label class="ad-label" for="adAnnTitle">标题</label>' +
          '<input class="ad-input" id="adAnnTitle" type="text" maxlength="120" required placeholder="例如：v2.0 上线" />' +
        '</div>' +
        '<div class="ad-field">' +
          '<label class="ad-label" for="adAnnBody">正文（纯文本，换行会保留）</label>' +
          '<textarea class="ad-input ad-textarea" id="adAnnBody" rows="4" maxlength="5000" required placeholder="这次更新了什么…"></textarea>' +
        '</div>' +
        '<div class="ad-form-actions">' +
          '<button class="act-btn primary" id="adAnnSubmit" type="submit">发布公告</button>' +
          '<span class="ad-hint" id="adAnnHint"></span>' +
        '</div>' +
      '</form>' +
      '<div class="ad-list" id="adAnnBox"><div class="user-loading">加载中…</div></div>' +
    '</section>' +

    /* 博客文章：管理端可写，前台 /blog/ 只读已发布文章 */
    '<section class="user-card">' +
      '<div class="ad-card-head"><h2><span class="card-ico" aria-hidden="true">✍️</span>博客文章</h2>' +
        '<div class="ad-head-actions">' +
          '<a class="act-btn small" href="../blog/" target="_blank" rel="noopener noreferrer">查看前台 ↗</a>' +
          '<button class="act-btn small" id="adPostNew" type="button">新建</button>' +
        '</div></div>' +
      '<p class="ad-note">草稿只在这里可见；勾选「立即发布」后才会出现在 <code>/blog/</code>。<b>文章只在站内展示，不会发邮件</b>；要通知订阅用户请用上面的「项目公告」。正文支持 Markdown：标题、列表、粗体、代码块、<b>表格</b>（<code>| 列 | 列 |</code> 下一行写 <code>| --- | --- |</code>，用 <code>:---:</code> 居中、<code>---:</code> 右对齐；表头与分隔行列数要一致）。</p>' +
      '<form class="ad-form" id="adPostForm" autocomplete="off">' +
        '<input type="hidden" id="adPostId" />' +
        '<div class="ad-field">' +
          '<label class="ad-label" for="adPostSlug">slug（URL 片段，小写字母/数字/连字符）</label>' +
          '<input class="ad-input" id="adPostSlug" type="text" maxlength="80" required placeholder="my-first-post" />' +
        '</div>' +
        '<div class="ad-field">' +
          '<label class="ad-label" for="adPostTitle">标题</label>' +
          '<input class="ad-input" id="adPostTitle" type="text" maxlength="120" required placeholder="文章标题" />' +
        '</div>' +
        '<div class="ad-field">' +
          '<label class="ad-label" for="adPostSummary">摘要（列表页显示）</label>' +
          '<input class="ad-input" id="adPostSummary" type="text" maxlength="300" placeholder="一句话概括" />' +
        '</div>' +
        '<div class="ad-field">' +
          '<label class="ad-label" for="adPostContent">正文（Markdown）</label>' +
          '<textarea class="ad-input ad-textarea ad-post-content" id="adPostContent" rows="10" required placeholder="# 标题&#10;&#10;正文…"></textarea>' +
        '</div>' +
        '<div class="ad-field ad-check">' +
          '<label><input type="checkbox" id="adPostPublished" /> 立即发布</label>' +
        '</div>' +
        '<div class="ad-form-actions">' +
          '<button class="act-btn primary" id="adPostSubmit" type="submit">保存文章</button>' +
          '<button class="act-btn small ghost" id="adPostCancel" type="button">取消编辑</button>' +
          '<span class="ad-hint" id="adPostHint"></span>' +
        '</div>' +
      '</form>' +
      '<div class="ad-list" id="adPostBox"><div class="user-loading">加载中…</div></div>' +
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

/* ================= 内容管理：项目公告 / 博客文章 / 邮件通道 =================
   后端：fs-notify（公告 + 订阅群发）、fs-blog（文章写）、REST 公开读。
   所有写操作只带当前管理员自己的 JWT，服务端再验 users.role='admin'；
   前端不放 service_role，也不留任何绕过路径。
   ====================================================================== */
async function contentCall(fn, action, extra, s) {
  const res = await fetch(SUPABASE_URL + '/functions/v1/' + fn, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.token
    },
    body: JSON.stringify(Object.assign({ action: action }, extra || {}))
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data: data || {} };
}

/* ---------- 给 AI 的指令（fs-agent 函数） ----------------------------------
   后台只负责下发 / 查看 / 撤回；真正的「取件执行」由项目自动化任务
   每 12 小时跑一次，用独立低权限密钥调用同一函数。
   ------------------------------------------------------------------------ */
const AGENT_STATUS = {
  pending:   ['待处理', 'wait'],
  claimed:   ['执行中', 'site'],
  done:      ['已完成', 'pub'],
  failed:    ['失败',   'on'],
  cancelled: ['已撤回', 'off'],
};

function agentCall(action, extra, s) {
  return contentCall('fs-agent', action, extra, s);
}

function agentStatusTag(status) {
  const m = AGENT_STATUS[status] || AGENT_STATUS.pending;
  return '<span class="ad-pill ' + m[1] + '">' + m[0] + '</span>';
}

function renderAgentStats(d) {
  const box = $('#adAgentState');
  const next = $('#adAgentNext');
  if (!box) return;
  const c = (d && d.counts) || {};
  const w = d && d.worker;
  const healthy = !!(w && w.last_seen && !w.last_error);
  box.className = 'ad-agent-state ' + (healthy ? 'ok' : 'wait');
  box.innerHTML =
    '待处理 <b>' + Number(c.pending || 0) + '</b> · 执行中 <b>' + Number(c.claimed || 0) +
    '</b> · 已完成 <b>' + Number(c.done || 0) + '</b> · 失败 <b>' + Number(c.failed || 0) + '</b>' +
    '<br />执行器：' + (w && w.last_seen
      ? ('上次检查 ' + escapeHtml(fmtDateTime(w.last_seen)) + ' · 累计运行 ' + Number(w.runs || 0) + ' 次' +
         (w.last_error ? ' · 上次异常：' + escapeHtml(w.last_error) : ' · 状态正常'))
      : '尚未运行过，等首次自动检查') +
    '<br />周期：每 12 小时' + (d && d.next_at ? ' · 预计下次 ' + escapeHtml(fmtDateTime(d.next_at)) : '');
  if (next) next.textContent = d && d.next_at
    ? '下次 ' + fmtDateTime(d.next_at) : '待首次检查';
}

function renderAgentTasks(list) {
  const box = $('#adAgentBox');
  if (!box) return;
  if (!list || !list.length) {
    box.innerHTML = '<div class="ad-empty">还没有指令。在上面写下要我做的事，我每 12 小时会来取一次。</div>';
    return;
  }
  box.innerHTML = list.map(t => {
    const when = t.finished_at || t.claimed_at || t.created_at;
    const result = t.result ? escapeHtml(t.result) : '';
    const err = t.last_error ? escapeHtml(t.last_error) : '';
    return '<div class="ad-item ad-agent-item st-' + escapeHtml(t.status) + '">' +
      '<div class="ad-item-top">' +
        '<b>' + agentStatusTag(t.status) +
          (t.priority === 'high' ? ' <span class="ad-pill on">紧急</span>' : '') +
          ' <span class="ad-agent-id">#' + Number(t.id) + '</span></b>' +
        '<time>' + escapeHtml(fmtDateTime(when)) + '</time>' +
      '</div>' +
      '<div class="ad-item-body">' + escapeHtml(t.body) + '</div>' +
      (result ? '<div class="ad-agent-result"><b>执行回执</b>' + result + '</div>' : '') +
      (err ? '<div class="ad-agent-error"><b>失败原因</b>' + err + '</div>' : '') +
      '<div class="ad-item-foot">' +
        '提交人 ' + escapeHtml(t.created_by_name || '管理员') +
        ' · 取件 ' + Number(t.attempts || 0) + ' 次' +
        (t.finished_at ? ' · 完成于 ' + escapeHtml(fmtDateTime(t.finished_at)) : '') +
        (t.status === 'claimed' ? ' · 正在执行，请稍候' : '') +
      '</div>' +
      (t.status === 'pending'
        ? '<div class="ad-item-actions"><button class="act-btn small ghost ad-agent-cancel" data-id="' +
          Number(t.id) + '" type="button">撤回指令</button></div>'
        : '') +
    '</div>';
  }).join('');
}

async function loadAgent(s) {
  const [st, li] = await Promise.all([
    agentCall('stats', {}, s),
    agentCall('list', {}, s),
  ]);
  if (st.status === 200 && st.data && st.data.ok) renderAgentStats(st.data);
  else {
    const box = $('#adAgentState');
    if (box) {
      box.className = 'ad-agent-state wait';
      box.textContent = '状态读取失败：' + ((st.data && st.data.error) || ('HTTP ' + st.status));
    }
  }
  const box = $('#adAgentBox');
  if (!box) return;
  if (li.status !== 200 || !li.data || !li.data.ok) {
    box.innerHTML = '<div class="ad-err">' +
      escapeHtml((li.data && li.data.error) || ('HTTP ' + li.status)) + '</div>';
    return;
  }
  renderAgentTasks(li.data.list);
}

async function submitAgentTask(e, s) {
  e.preventDefault();
  const ta = $('#adAgentBody'), pri = $('#adAgentPriority');
  const hint = $('#adAgentHint'), btn = $('#adAgentSubmit');
  const body = ta ? String(ta.value || '').trim() : '';
  if (!body) { if (hint) hint.textContent = '指令内容不能为空'; return; }
  if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
  if (hint) hint.textContent = '';
  try {
    const r = await agentCall('create', { body, priority: pri ? pri.value : 'normal' }, s);
    if (r.status === 200 && r.data && r.data.ok) {
      if (ta) ta.value = '';
      if (hint) hint.textContent = '已提交，等我来取件。';
      showToast('指令已提交，会自动执行并写回结果');
      await loadAgent(s);
    } else if (hint) {
      hint.textContent = (r.data && (r.data.error || r.data.msg)) || ('提交失败 HTTP ' + r.status);
    }
  } catch (err) {
    if (hint) hint.textContent = '网络异常：' + (err && err.message ? err.message : '未知错误');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '提交指令'; }
  }
}

async function cancelAgentTask(id, s) {
  if (!confirm('确定撤回这条指令吗？撤回后我不会再执行它。')) return;
  try {
    const r = await agentCall('cancel', { id }, s);
    showToast(r.status === 200 && r.data && r.data.ok
      ? '指令已撤回' : ((r.data && r.data.error) || '撤回失败'));
  } catch (err) { showToast('网络异常，撤回失败'); }
  await loadAgent(s);
}

let mailConfigured = false;
let mailProvider = '';
let mailReady = false;

async function loadMailStatus() {
  const el = $('#adMailStatus');
  if (!el) return;
  try {
    const res = await fetch(SUPABASE_URL + '/functions/v1/fs-notify', {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mail_status' })
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d || d.ok !== true) throw new Error('HTTP ' + res.status);
    mailConfigured = !!d.configured;
    mailProvider = String(d.provider || '');
    mailReady = !!d.ready;
    const label = String(d.label || '邮件通道');
    if (!mailConfigured) {
      el.className = 'ad-status wait';
      el.textContent = '⏳ 邮件通道待开通 · 现在就能发布公告（站内可见），暂不发信';
    } else if (mailProvider === 'queue' && !mailReady) {
      el.className = 'ad-status wait';
      el.textContent = '⏳ ' + label + ' 代码已就绪，但发信任务还没跑过 · 去 GitHub → Actions →「发送公告邮件队列」点 Run workflow 手动触发一次';
    } else {
      el.className = 'ad-status ok';
      el.textContent = '✅ ' + label +
        (d.from ? '（发件地址：' + String(d.from) + '）' : '') +
        (d.last_seen ? ' · 最后运行 ' + fmtDateTime(d.last_seen) : '') +
        (mailProvider === 'resend' ? ' · 公告发布后立即直发' : ' · 公告会加入队列自动发送');
    }
  } catch (e) {
    el.className = 'ad-status wait';
    el.textContent = '⚠️ 暂时读不到邮件通道状态，公告仍可正常发布（站内可见）';
  }
}

/* 队列统计：待发 / 已送达 / 失败，只走管理员接口。
   Resend 直发时不经过队列，这一栏只作为历史记录，不能让人误以为新公告卡在队列里。 */
async function loadQueueStats(s) {
  const el = $('#adQueueStats');
  if (!el) return;
  try {
    const { status, data } = await contentCall('fs-notify', 'mail_queue_stats', {}, s);
    if (status !== 200 || data.ok !== true) throw new Error('HTTP ' + status);
    el.className = 'ad-status ' + (Number(data.failed) > 0 ? 'wait' : '');
    el.textContent = '📮 队列：待发 ' + (Number(data.pending) || 0) +
      ' · 已送达 ' + (Number(data.sent) || 0) +
      ' · 失败 ' + (Number(data.failed) || 0) + '（失败 5 次后停止重试）' +
      (mailProvider === 'resend' ? ' · 当前为 Resend 直发，以上仅为历史记录' : '');
  } catch (e) {
    el.textContent = '📮 队列统计暂时读不到，公告仍可正常发布';
  }
}

/* 测试邮件：Resend 直发时当场发出；队列模式下入队并唤醒 worker */
async function sendTestMail(s) {
  const input = $('#adTestEmail'), btn = $('#adTestMailBtn'), hint = $('#adTestMailHint');
  if (!input || !btn) return;
  const email = String(input.value || '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (hint) hint.textContent = '邮箱格式不正确';
    showToast('邮箱格式不正确');
    return;
  }
  btn.disabled = true; btn.textContent = '发送中…';
  if (hint) hint.textContent = '';
  try {
    const { status, data } = await contentCall('fs-notify', 'mail_test', { email }, s);
    if (status !== 200 || data.ok !== true) {
      const msg = data.error || ('发送失败（HTTP ' + status + '）');
      if (hint) hint.textContent = msg;
      showToast(msg);
      return;
    }
    if (hint) hint.textContent = data.note || (mailProvider === 'resend' ? '测试邮件已发出' : '已加入队列');
    showToast(mailProvider === 'resend' ? '测试邮件已直接发出' : '测试邮件已加入队列');
    await loadQueueStats(s);
  } catch (e) {
    if (hint) hint.textContent = '网络异常，请稍后再试';
    showToast('网络异常，请稍后再试');
  } finally {
    btn.disabled = false; btn.textContent = mailProvider === 'resend' ? '发送测试邮件' : '加入测试邮件';
  }
}

async function loadAnnouncements() {
  const box = $('#adAnnBox');
  if (!box) return;
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/fs_announcements' +
      '?select=id,title,body,created_at,mailed_count,mailed_at&order=created_at.desc&limit=20', {
      headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(data)) {
      box.innerHTML = '<div class="ad-err">读取失败（HTTP ' + res.status + '）</div>'; return;
    }
    if (!data.length) { box.innerHTML = '<div class="ad-empty">还没有公告，发第一条吧 📢</div>'; return; }
    box.innerHTML = data.map(a =>
      '<article class="ad-item">' +
        '<div class="ad-item-top"><b>' + escapeHtml(a.title) + '</b>' +
          '<time>' + escapeHtml(fmtDateTime(a.created_at)) + '</time></div>' +
        '<div class="ad-item-body">' + escapeHtml(a.body).replace(/\n/g, '<br>') + '</div>' +
        '<div class="ad-item-foot">' + (Number(a.mailed_count) > 0
          ? '📧 已送达 ' + Number(a.mailed_count) + ' 位订阅用户'
          : (mailProvider === 'queue' ? '📮 站内公告 · 邮件由队列发送'
             : '📭 站内公告' + (mailConfigured ? '' : '（邮件通道待开通）'))) + '</div>' +
      '</article>').join('');
  } catch (e) {
    box.innerHTML = '<div class="ad-err">网络异常，稍后再试</div>';
  }
}

async function submitAnnouncement(e, s) {
  e.preventDefault();
  const title = ($('#adAnnTitle').value || '').trim();
  const body = ($('#adAnnBody').value || '').trim();
  const hint = $('#adAnnHint'), btn = $('#adAnnSubmit');
  if (!title || !body) { showToast('标题和正文都要填'); return; }
  const mailHint = !mailConfigured ? '仅站内发布（邮件通道待开通）'
    : mailProvider === 'queue' ? '将加入邮件队列，由 GitHub Actions 定时发送'
    : mailProvider === 'resend' ? '将通过 Resend 立即直接发给已订阅用户'
    : '将同时群发给已订阅用户';
  if (!window.confirm('确认发布公告？\n标题：' + title + '\n' + mailHint)) return;
  btn.disabled = true; btn.textContent = '发布中…';
  if (hint) hint.textContent = '';
  try {
    const { status, data } = await contentCall('fs-notify', 'announce', { title, body }, s);
    if (status !== 200 || data.ok !== true) {
      const msg = data.error || ('发布失败（HTTP ' + status + '）');
      if (hint) hint.textContent = msg;
      showToast(msg);
      return;
    }
    $('#adAnnTitle').value = '';
    $('#adAnnBody').value = '';
    if (hint) hint.textContent = data.note ||
      ('已发布 · 群发 ' + (Number(data.mailed) || 0) + ' 封 · 入队 ' + (Number(data.queued) || 0) + ' 封');
    showToast('公告已发布');
    await loadAnnouncements();
    await loadQueueStats(s);
  } catch (err) {
    showToast('网络异常，请稍后再试');
  } finally {
    btn.disabled = false; btn.textContent = '发布公告';
  }
}

async function loadPosts(s) {
  const box = $('#adPostBox');
  if (!box) return;
  try {
    const { status, data } = await contentCall('fs-blog', 'post_list', {}, s);
    if (status === 401) { box.innerHTML = '<div class="ad-err">登录态已过期，请重新登录</div>'; return; }
    if (status !== 200 || data.ok !== true) {
      box.innerHTML = '<div class="ad-err">' + escapeHtml(data.error || ('读取失败（HTTP ' + status + '）')) + '</div>';
      return;
    }
    const posts = Array.isArray(data.posts) ? data.posts : [];
    if (!posts.length) { box.innerHTML = '<div class="ad-empty">还没有文章，点「新建」写第一篇 ✍️</div>'; return; }
    box.innerHTML = posts.map(p =>
      '<article class="ad-item">' +
        '<div class="ad-item-top"><b>' + escapeHtml(p.title) + '</b>' +
          '<span class="ad-pill ' + (p.published ? 'pub' : 'off') + '">' +
            (p.published ? '已发布' : '草稿') + '</span></div>' +
        '<div class="ad-item-body">' + escapeHtml(p.summary || '（无摘要）') + '</div>' +
        '<div class="ad-item-foot"><code>/blog/?p=' + escapeHtml(p.slug) + '</code> · ' +
          escapeHtml(fmtDateTime(p.created_at)) + '</div>' +
        '<div class="ad-item-actions">' +
          '<button class="act-btn small ad-post-edit" type="button" data-id="' + escapeHtml(String(p.id)) + '">编辑</button>' +
          (p.published
            ? '<a class="act-btn small" href="../blog/?p=' + encodeURIComponent(p.slug) +
              '" target="_blank" rel="noopener noreferrer">查看 ↗</a>'
            : '') +
          '<button class="act-btn small ghost ad-post-del" type="button" data-id="' +
            escapeHtml(String(p.id)) + '" data-title="' + escapeHtml(p.title) + '">删除</button>' +
        '</div>' +
      '</article>').join('');
  } catch (e) {
    box.innerHTML = '<div class="ad-err">网络异常，稍后再试</div>';
  }
}

async function submitPost(e, s) {
  e.preventDefault();
  const id = ($('#adPostId').value || '').trim();
  const slug = ($('#adPostSlug').value || '').trim().toLowerCase();
  const title = ($('#adPostTitle').value || '').trim();
  const summary = ($('#adPostSummary').value || '').trim();
  const content = $('#adPostContent').value || '';
  const published = !!$('#adPostPublished').checked;
  const hint = $('#adPostHint'), btn = $('#adPostSubmit');
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) { showToast('slug 只允许小写字母 / 数字 / 连字符'); return; }
  if (!title || !content) { showToast('标题和正文都要填'); return; }
  const extra = { slug, title, summary, content, published };
  if (id) extra.id = Number(id);
  btn.disabled = true; btn.textContent = '保存中…';
  if (hint) hint.textContent = '';
  try {
    const { status, data } = await contentCall('fs-blog', 'post_save', extra, s);
    if (status !== 200 || data.ok !== true) {
      const msg = data.error || ('保存失败（HTTP ' + status + '）');
      if (hint) hint.textContent = msg;
      showToast(msg);
      return;
    }
    showToast(id ? '文章已更新' : '文章已创建');
    resetPostForm();
    await loadPosts(s);
  } catch (err) {
    showToast('网络异常，请稍后再试');
  } finally {
    btn.disabled = false; btn.textContent = '保存文章';
  }
}

async function editPost(id, s) {
  try {
    const { status, data } = await contentCall('fs-blog', 'post_get', { id: Number(id) }, s);
    if (status !== 200 || data.ok !== true || !data.post) { showToast(data.error || '读取失败'); return; }
    const p = data.post;
    $('#adPostId').value = String(p.id);
    $('#adPostSlug').value = p.slug || '';
    $('#adPostTitle').value = p.title || '';
    $('#adPostSummary').value = p.summary || '';
    $('#adPostContent').value = p.content || '';
    $('#adPostPublished').checked = !!p.published;
    $('#adPostSubmit').textContent = '更新文章';
    const hint = $('#adPostHint');
    if (hint) hint.textContent = '正在编辑 #' + p.id;
    $('#adPostSlug').focus();
    $('#adPostForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { showToast('网络异常，请稍后再试'); }
}

async function deletePost(id, title, s) {
  if (!window.confirm('确认删除文章「' + (title || id) + '」？删除后无法恢复。')) return;
  try {
    const { status, data } = await contentCall('fs-blog', 'post_delete', { id: Number(id) }, s);
    if (status !== 200 || data.ok !== true) { showToast(data.error || '删除失败'); return; }
    showToast('已删除');
    await loadPosts(s);
  } catch (e) { showToast('网络异常，请稍后再试'); }
}

function resetPostForm() {
  const form = $('#adPostForm');
  if (form) form.reset();
  const id = $('#adPostId'); if (id) id.value = '';
  const btn = $('#adPostSubmit'); if (btn) btn.textContent = '保存文章';
  const hint = $('#adPostHint'); if (hint) hint.textContent = '';
}

function bindContentEvents(s) {
  const agentForm = $('#adAgentForm');
  if (agentForm) agentForm.addEventListener('submit', e => submitAgentTask(e, s));
  const agentRefresh = $('#adAgentRefresh');
  if (agentRefresh) agentRefresh.addEventListener('click', () => loadAgent(s));
  const agentBox = $('#adAgentBox');
  if (agentBox) agentBox.addEventListener('click', e => {
    const t = e.target;
    const btn = t && t.closest ? t.closest('.ad-agent-cancel') : null;
    if (btn) cancelAgentTask(Number(btn.dataset.id), s);
  });
  const annForm = $('#adAnnForm');
  if (annForm) annForm.addEventListener('submit', e => submitAnnouncement(e, s));
  const annRefresh = $('#adAnnRefresh');
  if (annRefresh) annRefresh.addEventListener('click', () => { loadAnnouncements(); loadQueueStats(s); });
  const testMailBtn = $('#adTestMailBtn');
  if (testMailBtn) testMailBtn.addEventListener('click', () => sendTestMail(s));
  const postForm = $('#adPostForm');
  if (postForm) postForm.addEventListener('submit', e => submitPost(e, s));
  const newBtn = $('#adPostNew'), cancelBtn = $('#adPostCancel');
  if (newBtn) newBtn.addEventListener('click', resetPostForm);
  if (cancelBtn) cancelBtn.addEventListener('click', resetPostForm);
  const list = $('#adPostBox');
  if (list) list.addEventListener('click', e => {
    const t = e.target;
    const btn = t && t.closest ? t.closest('button[data-id]') : null;
    if (!btn) return;
    if (btn.classList.contains('ad-post-edit')) editPost(btn.dataset.id, s);
    else if (btn.classList.contains('ad-post-del')) deletePost(btn.dataset.id, btn.dataset.title, s);
  });
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
    await Promise.all([loadBans(s, false), loadStats(s), loadAnnouncements(), loadPosts(s), loadQueueStats(s), loadAgent(s)]);
    btn.disabled = false; btn.textContent = '刷新';
  });
  $('#adBanBox').addEventListener('click', e => {
    const t = e.target;
    const btn = t && t.closest ? t.closest('.ad-unban') : null;
    if (btn) doUnban(btn, s);
  });

  // 项目公告 / 博客文章 / 邮件通道状态
  bindContentEvents(s);
  loadMailStatus();
  loadQueueStats(s);
  loadAnnouncements();
  loadPosts(s);
  loadAgent(s);
}

boot();
