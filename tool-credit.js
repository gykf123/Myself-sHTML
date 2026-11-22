/* ============================================================
   工具箱 ⇄ 账户（tool-credit）
   ------------------------------------------------------------
   原则（用户反复强调）：**工具永远免登录可用，不要求登录、不锁功能**。
     登录 = 多出来的东西，不是入场券：
       · 用一次 +5 积分（每天最多 3 次，且同一工具同一天只算 1 次）
       · 今日进度 / 余额 / 连用天数直接显示在工具条
       · 大厅按「你常用的 + 全站热门」排序
       · 重任务（几千万格、几百秒视频）不用每次手点确认
     未登录 = 一切照旧：不弹窗、不拦路、不发请求、不加任何 DOM。

   零侵入：工具页的结果区统一是 .tk-result，复制成功 toast 是
   #toast.tk-toast，图像类工具有 a[download]。监听这三类信号即可判断
   「真的产出了结果」，不用改 20 个工具页的内联脚本。

   防误判：
     · 必须发生过用户交互（点击/按键/输入）才算，打开页面不送分；
     · 结果文本要 ≥4 字且不含错误词；
     · 每次页面会话只上报一次；真正的日限在 RPC fs_tool_reward 里。
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
  var ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
  var AUTH_KEY = 'fe_token';

  // 工具页 → 别名（积分记录里存的是别名，大厅卡片是文件路径，要对得上）
  // 大厅卡片的 href → 积分记录里的别名（与 ALIAS 反向，用于本地「最近用过」）
  var ALIAS = {
    'img2func': 'img2func',
    'video2func': 'video2func',
    'imgcompress': 'imgcompress',
    'function': 'function',
    'ore-finder': 'ore-finder',
    'mc-server-status': 'mc-server-status'
  };

  function token() { try { return localStorage.getItem(AUTH_KEY) || ''; } catch (e) { return ''; } }
  function loggedIn() { return !!token(); }

  function localDay() {
    var d = new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function toolId() {
    var p = (location.pathname || '').split('/').pop() || '';
    var base = p.replace(/\.html?$/i, '') || 'tool';
    return ALIAS[base] || base;
  }

  function isHall() {
    return /\/tool\/index\.html?$/i.test(location.pathname) || /\/tool\/$/i.test(location.pathname);
  }

  function isToolPage() {
    return /\/tool\/[^/]+\.html?$/i.test(location.pathname) && !isHall();
  }

  function rpc(name, body) {
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + (token() || ANON_KEY)
      },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        return { ok: r.ok, status: r.status, data: d };
      });
    }).catch(function () { return { ok: false, status: 0, data: null }; });
  }

  /* ------------------------------ toast ------------------------------ */
  var toastTimer = null;
  function toast(text, kind) {
    var el = document.getElementById('fsCreditToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fsCreditToast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.className = 'fsc-toast' + (kind ? ' is-' + kind : '');
    el.textContent = text;
    requestAnimationFrame(function () { el.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2800);
  }

  /* ------------------------------ 上报 ------------------------------ */
  var sent = false;

  // 本地「最近用过」：不登录也能在大厅看到自己常用的工具排在前面。
  // 只存工具别名和次数，不上传、不同步，清缓存即消失。
  var SEEN_KEY = 'fs_tool_seen';
  function readSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function markSeen(t) {
    var m = readSeen();
    m[t] = Math.max(1, Number(m[t] || 0) + 1);
    var keys = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).slice(0, 12);
    var out = {};
    keys.forEach(function (k) { out[k] = m[k]; });
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(out)); } catch (e) {}
  }

  function markSent() {
    sent = true;
    try { sessionStorage.setItem('fs_credit_' + toolId() + '_' + localDay(), '1'); } catch (e) {}
    markSeen(toolId());
    teardown();
  }

  function award(tool) {
    if (sent) return;
    markSent();                // 先记本地（未登录也记），再决定要不要上报
    if (!loggedIn()) return;   // 未登录：不上报、不提示
    rpc('fs_tool_reward', { p_tool: tool }).then(function (res) {
      var d = res.data;
      if (!d || d.ok !== true) return;
      if (d.awarded) {
        var msg = '+5 积分 · 今日 ' + d.used + '/' + d.limit;
        if (d.coupon) msg += ' · 连用 ' + d.streak + ' 天，送 1 张免确认券';
        else if (d.streak > 1) msg += ' · 连用 ' + d.streak + ' 天';
        toast(msg);
      } else if (d.reason === 'same_tool') {
        toast('这个工具今天已经计过分了 · 今日 ' + d.used + '/' + d.limit, 'dim');
      } else if (d.reason === 'daily_limit') {
        toast('今日工具积分已领满 ' + d.limit + '/' + d.limit + '，明天再来', 'dim');
      }
    });
  }

  /* --------------------------- 有效使用检测 --------------------------- */
  var ERR_WORDS = ['✗', '失败', '错误', 'Error', 'error', '请输入', '请选择', '不支持', '未选择', '无法'];
  var PLACEHOLDERS = ['—', '-', '…', '结果', '输出', '加载中'];
  // 结果区：11 个页面用 .tk-result，其余页面的输出容器命名各异
  // （base64 是 #encOut/#decOut，timestamp 是 #tsOut……），用通配兜住，
  // 否则「用了但没计分」会悄悄发生 —— 比不关联更伤。
  var SEL = '.tk-result, #out, #result, #output, #res, #stat, #preview, ' +
    '[id$="Out"], [id$="Output"], [id$="Result"], [id$="out"], [id$="Status"]';
  var SKIP_ID = /(?:^|-)in$|input|note|hint|tip|help|label|placeholder/i;

  function looksValid(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length < 4) return false;
    for (var i = 0; i < ERR_WORDS.length; i++) if (t.indexOf(ERR_WORDS[i]) !== -1) return false;
    for (var j = 0; j < PLACEHOLDERS.length; j++) if (t === PLACEHOLDERS[j]) return false;
    return true;
  }

  var acted = false, obs = null, timer = null, baseline = {}, sweep = null, tool = '';

  function snapshot() {
    var nodes = document.querySelectorAll(SEL);
    baseline = {};
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.id) n.setAttribute('data-fs-credit-seen', String(i));
      baseline[n.id || ('data-fs-credit-seen' in n ? n.getAttribute('data-fs-credit-seen') : i)] = (n.textContent || '').trim();
    }
  }

  function changedText() {
    var nodes = document.querySelectorAll(SEL);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.id) {
        // 无 id 的 .tk-result：可能只是状态行，单独按文本判断
      } else if (SKIP_ID.test(n.id)) {
        continue;   // 跳过输入框 / 提示文案
      }
      var key = n.id || (n.getAttribute('data-fs-credit-seen') || i);
      var now = (n.textContent || '').trim();
      if (looksValid(now) && now !== (baseline[key] || '')) return now;
    }
    return '';
  }

  function check() {
    if (!acted || sent) return;
    if (changedText()) award(tool);
  }

  function teardown() {
    if (obs) { try { obs.disconnect(); } catch (e) {} obs = null; }
    clearTimeout(timer);
    if (sweep) { clearInterval(sweep); sweep = null; }
    document.removeEventListener('pointerdown', onAct, true);
    document.removeEventListener('keydown', onAct, true);
    document.removeEventListener('input', onAct, true);
  }

  function onAct() { acted = true; }

  function initDetect() {
    var key = 'fs_credit_' + tool + '_' + localDay();
    try { if (sessionStorage.getItem(key)) return; } catch (e) {}

    snapshot();
    ['pointerdown', 'keydown', 'input'].forEach(function (ev) {
      document.addEventListener(ev, onAct, true);
    });

    if (window.MutationObserver) {
      obs = new MutationObserver(function () {
        if (!acted) return;
        clearTimeout(timer);
        timer = setTimeout(check, 500);
      });
      try { obs.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (e) {}
    }

    var seenToast = '', lastHref = '';
    sweep = setInterval(function () {
      if (sent) { clearInterval(sweep); sweep = null; return; }
      // 兜底 1：复制成功
      var t = document.getElementById('toast');
      if (t && t.classList.contains('show')) {
        var txt = (t.textContent || '').trim();
        if (txt && txt !== seenToast) {
          seenToast = txt;
          if (acted && /已复制|复制成功|copied/i.test(txt)) award(tool);
        }
      }
      // 兜底 2：下载链接生成 blob / data
      var a = document.querySelector('a[download]');
      if (a) {
        var href = a.getAttribute('href') || '';
        if (href === lastHref) { /* 同一下载 */ }
        else if (/^(blob:|data:)/i.test(href)) {
          lastHref = href;
          if (acted) award(tool);
        }
      }
    }, 900);
  }

  /* ------------------------- 重任务免费用量 ------------------------- */
  // 粗略估算「这次任务的规模」，只用于判断要不要提示一句，不参与计分。
  function estimateCost() {
    try {
      var n = document.querySelectorAll('textarea, input[type="text"], input[type="number"]');
      if (tool === 'video2func') {
        var f = document.getElementById('v2fFile');
        var who = f && f.files && f.files[0] ? f.files[0].size : 0;
        return Math.round(who * 1.2);
      }
      if (tool === 'imgcompress' || tool === 'img2func') {
        var inp = document.getElementById('icFiles') || document.getElementById('i2fFile');
        var total = 0;
        if (inp && inp.files) for (var k = 0; k < inp.files.length; k++) total += inp.files[k].size;
        return total;
      }
      var size = 0;
      for (var i = 0; i < n.length; i++) size = Math.max(size, (n[i].value || '').length);
      return size;
    } catch (e) { return 0; }
  }

  // 同步问一次服务端：这次任务要不要提示。用同步 XHR 是因为必须在
  // click 事件里当场决定「拦不拦」，异步已经晚了。请求很小、且只在
  // 估算超阈值时发生，不会拖慢日常使用。
  function needConfirm(cost) {
    try {
      var x = new XMLHttpRequest();
      x.open('POST', SUPABASE_URL + '/rest/v1/rpc/fs_tool_confirm', false);
      x.setRequestHeader('Content-Type', 'application/json');
      x.setRequestHeader('apikey', ANON_KEY);
      x.setRequestHeader('Authorization', 'Bearer ' + (token() || ANON_KEY));
      x.send(JSON.stringify({ p_tool: tool, p_cost: cost }));
      var d = JSON.parse(x.responseText || '{}');
      return d && d.ok === true && d.need === true ? d : null;
    } catch (e) { return null; }
  }

  // 拦在「算之前」：捕获阶段拦所有按钮，估出来太大就先问一句。
  // 用户点取消就 stopPropagation，工具逻辑一行不用改。
  function guardHeavy() {
    var lastAsked = 0;
    document.addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el !== document.body) {
        if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /^(submit|button)$/i.test(el.type))) {
          var cost = estimateCost();
          if (cost < 2000000) return;              // 小任务完全不打扰
          if (Date.now() - lastAsked < 4000) return; // 连点不反复问
          var d = needConfirm(cost);
          if (!d) return;                          // 不需要确认 → 直接跑
          lastAsked = Date.now();
          var msg = '这次任务比较大，处理时可能卡住页面几秒。确定继续？';
          if (d.coupons > 0) msg += '\n（你有 ' + d.coupons + ' 张免确认券）';
          if (!window.confirm(msg)) {
            ev.preventDefault();
            ev.stopPropagation();
          }
          return;
        }
        el = el.parentElement;
      }
    }, true);
  }

  /* ---------------------------- 工具条 ---------------------------- */
  // 未登录：什么都不加。工具页保持「打开—用—关掉」的零负担。
  // 登录：页面上方出现一条细条，显示今日进度 / 余额 / 连用天数，可折叠。
  function renderBar() {
    if (!loggedIn()) return;
    var host = document.querySelector('.tk-wrap, .tk-main, main') || document.body;
    var bar = document.createElement('div');
    bar.id = 'tcBar';
    bar.className = 'fsc-bar';
    bar.innerHTML =
      '<span class="fsc-bar-dot" aria-hidden="true"></span>' +
      '<span class="fsc-bar-main">今日 <b id="tcUsed">…</b>/3 · 余额 <b id="tcBal">…</b></span>' +
      '<span class="fsc-bar-streak" id="tcStreak"></span>' +
      '<a class="fsc-bar-link" href="/user/">签到 / 明细 →</a>' +
      '<button type="button" class="fsc-bar-x" id="tcHide" aria-label="本页隐藏这条提示">×</button>';
    if (host.firstChild) host.insertBefore(bar, host.firstChild); else host.appendChild(bar);

    var hide = document.getElementById('tcHide');
    if (hide) hide.addEventListener('click', function () { bar.remove(); });

    rpc('fs_member_overview').then(function (res) {
      var d = res.data;
      var usedEl = document.getElementById('tcUsed');
      var balEl = document.getElementById('tcBal');
      var stEl = document.getElementById('tcStreak');
      if (!d || d.ok !== true) {
        if (usedEl) usedEl.textContent = '—';
        if (balEl) balEl.textContent = '—';
        return;
      }
      if (usedEl) usedEl.textContent = d.tool.used;
      if (balEl) balEl.textContent = d.balance;
      if (stEl && d.sign && d.sign.streak > 1) stEl.textContent = '连登 ' + d.sign.streak + ' 天';
    });
  }

  /* --------------------------- 大厅个性化 --------------------------- */
  // 匿名：按「全站 30 天热度」排一次；登录：自己的常用再往前排。
  // 排序只在用户没动手筛选时生效，一旦点了分类或搜索就交还给原逻辑。
  function personalizeHall() {
    var grid = document.querySelector('.工具网格');
    if (!grid) return;
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.工具卡'));
    if (!cards.length) return;

    var order = function (map, mine) {
      cards.forEach(function (c, i) {
        var href = c.getAttribute('href') || '';
        var base = (href.split('?')[0].split('/').pop() || '').replace(/\.html?$/i, '');
        var key = ALIAS[base] || base;
        var hot = Number((map && map[key]) || 0);
        var own = Number((mine && mine[key]) || 0);
        c.dataset.fscRank = String((own ? 10000 + own * 100 : 0) + hot * 10);
        c.dataset.fscIdx = String(i);
      });
      var sorted = cards.slice().sort(function (a, b) {
        var d = Number(b.dataset.fscRank) - Number(a.dataset.fscRank);
        return d !== 0 ? d : Number(a.dataset.fscIdx) - Number(b.dataset.fscIdx);
      });
      sorted.forEach(function (c) { grid.insertBefore(c, grid.querySelector('.占位卡') || null); });
    };

    // 本地记录先排（匿名也有），登录后叠加服务端记录（跨设备）
    var local = readSeen();
    rpc('fs_tools_usage_public').then(function (res) {
      var pub = (res.data && res.data.tools) || {};
      if (!loggedIn()) { order(pub, local); return; }
      rpc('fs_tool_mine').then(function (m) {
        var mine = {};
        for (var k in local) mine[k] = local[k];
        var recent = (m.data && m.data.recent) || [];
        for (var i = 0; i < recent.length; i++) {
          mine[recent[i].tool] = Math.max(Number(mine[recent[i].tool] || 0), recent[i].uses);
        }
        order(pub, mine);
      });
    });
  }

  /* ------------------------------ 启动 ------------------------------ */
  function boot() {
    if (isHall()) {
      renderBar();
      personalizeHall();
      return;
    }
    if (!isToolPage()) return;
    tool = toolId();
    initDetect();              // 只做本地记录，不联网；登录后才上报积分
    if (!loggedIn()) return;   // 未登录：不加 DOM、不发请求、不弹提示
    renderBar();
    if (['video2func', 'imgcompress', 'img2func', 'function', 'ore-finder'].indexOf(tool) !== -1) {
      guardHeavy();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.FS_CREDIT = { award: award, tool: toolId, personalize: personalizeHall };
})();
