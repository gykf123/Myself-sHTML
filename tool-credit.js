/* ============================================================
   工具积分（tool-credit）
   ------------------------------------------------------------
   规则：登录用户「用一次工具」+5 积分，每天最多 3 次（15 分）。
         工具本身永远免登录可用，未登录时本脚本不初始化、不打扰。

   为什么零侵入：
     工具页的结果区统一是 .tk-result（17 个页面），复制成功的
     toast 是 #toast.tk-toast，图像类工具有 a[download]。监听这
     三类信号就能覆盖绝大多数「真的产出了结果」的场景，不用逐个
     改工具页的内联脚本。

   防误判：
     · 必须发生过用户交互（点击/按键/输入）才算，打开页面不送分；
     · 结果文本要 ≥4 字且不含错误词；
     · 每次页面会话只上报一次（sessionStorage 按 tool+日期去重），
       连点复制不会重复领；
     · 真正的日限在后端 RPC fs_tool_reward 里，前端绕过也没用。
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
  var ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
  var AUTH_KEY = 'fe_token';

  function token() { try { return localStorage.getItem(AUTH_KEY) || ''; } catch (e) { return ''; } }

  function localDay() {
    var d = new Date();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function toolId() {
    var p = (location.pathname || '').split('/').pop() || '';
    return p.replace(/\.html?$/i, '') || 'tool';
  }

  function isToolPage() {
    return /\/tool\/[^/]+\.html?$/i.test(location.pathname) && !/\/tool\/index\.html?$/i.test(location.pathname);
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

  /* ------------------------------ 小 toast ------------------------------ */
  var toastTimer = null;
  function toast(text) {
    var el = document.getElementById('fsCreditToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'fsCreditToast';
      el.setAttribute('role', 'status');
      el.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:9999',
        'padding:10px 14px', 'border-radius:10px', 'font-size:13px', 'line-height:1.4',
        'background:var(--card-bg,#1c2330)', 'color:var(--text,#e6edf3)',
        'border:1px solid var(--border,#2a3441)', 'box-shadow:0 8px 24px -10px rgba(0,0,0,.5)',
        'opacity:0', 'transform:translateY(8px)', 'transition:opacity .2s,transform .2s',
        'pointer-events:none', 'max-width:min(78vw,320px)'
      ].join(';');
      document.body.appendChild(el);
    }
    el.textContent = text;
    requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; }, 2600);
  }

  /* ------------------------------ 上报 ------------------------------ */
  var sent = false;

  function award(tool) {
    if (sent) return;
    sent = true;
    try { sessionStorage.setItem('fs_credit_' + tool + '_' + localDay(), '1'); } catch (e) {}
    teardown();

    rpc('fs_tool_reward', { p_tool: tool }).then(function (res) {
      var d = res.data;
      if (!d || d.ok !== true) return;
      if (d.awarded) {
        var left = Math.max(0, (d.limit || 3) - (d.used || 0));
        toast('+5 积分 · 今日 ' + d.used + '/' + d.limit + (left ? '' : '，明天再来'));
      } else if (d.reason === 'daily_limit') {
        toast('今日工具积分已领满 3/3，明天再来');
      }
    });
  }

  /* --------------------------- 有效使用检测 --------------------------- */
  var ERR_WORDS = ['✗', '失败', '错误', 'Error', 'error', '请输入', '请选择', '不支持', '未选择', '无法'];
  var PLACEHOLDERS = ['—', '-', '…', '结果', '输出', '加载中'];

  function looksValid(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length < 4) return false;
    for (var i = 0; i < ERR_WORDS.length; i++) if (t.indexOf(ERR_WORDS[i]) !== -1) return false;
    for (var j = 0; j < PLACEHOLDERS.length; j++) if (t === PLACEHOLDERS[j]) return false;
    return true;
  }

  var acted = false, obs = null, timer = null, baseline = {}, tool = '';

  function snapshot() {
    var nodes = document.querySelectorAll('.tk-result, #out, #result, #output, #res, #stat, #preview');
    baseline = {};
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.id) n.setAttribute('data-fs-credit-seen', String(i));
      baseline[n.id || ('data-fs-credit-seen' in n ? n.getAttribute('data-fs-credit-seen') : i)] = (n.textContent || '').trim();
    }
  }

  function changedText() {
    var nodes = document.querySelectorAll('.tk-result, #out, #result, #output, #res, #stat, #preview');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
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
      try {
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      } catch (e) {}
    }

    // 兜底：复制成功（toast 出现「已复制」）或下载链接生成 blob
    var seenToast = '';
    setInterval(function () {
      if (sent) return;
      var t = document.getElementById('toast');
      if (t && t.classList.contains('show')) {
        var txt = (t.textContent || '').trim();
        if (txt && txt !== seenToast) {
          seenToast = txt;
          if (/已复制|复制成功|copied/i.test(txt)) award(tool);
        }
      }
    }, 700);

    var lastHref = '';
    setInterval(function () {
      if (sent) return;
      var a = document.querySelector('a[download]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (/^(blob:|data:)/i.test(href) && href !== lastHref) {
        lastHref = href;
        award(tool);
      }
    }, 1200);
  }

  /* ---------------------------- 大厅进度条 ---------------------------- */
  function renderBar() {
    var host = document.querySelector('.工具条');
    if (!host) return;
    var bar = document.createElement('div');
    bar.id = 'tcBar';
    bar.style.cssText = [
      'display:flex', 'align-items:center', 'gap:8px', 'flex-wrap:wrap',
      'font-size:12.5px', 'padding:9px 12px', 'border-radius:10px',
      'background:var(--面板,#161b22)', 'border:1px solid var(--边线,#2a3441)',
      'color:var(--暗淡,#8b949e)'
    ].join(';');
    host.parentNode.insertBefore(bar, host);

    var tok = token();
    if (!tok) {
      bar.innerHTML = '<span>登录后每次使用工具 <b style="color:var(--高亮,#58a6ff)">+5 积分</b>，每天 3 次；工具免登录照常可用。</span>' +
        '<a href="/login/index.html?brand=FeSui&home=' + encodeURIComponent(location.origin + '/') +
        '&redirect=' + encodeURIComponent(location.origin + '/tool/') +
        '" style="margin-left:auto;color:var(--高亮,#58a6ff);text-decoration:none;font-weight:600">登录 / 注册</a>';
      return;
    }

    bar.innerHTML = '<span>今日工具积分 <b id="tcUsed" style="color:var(--高亮,#58a6ff)">…</b> · 余额 <b id="tcBal">…</b></span>' +
      '<a href="/user/" style="margin-left:auto;color:var(--高亮,#58a6ff);text-decoration:none;font-weight:600">去签到 →</a>';

    rpc('fs_member_overview').then(function (res) {
      var d = res.data;
      var usedEl = document.getElementById('tcUsed');
      var balEl = document.getElementById('tcBal');
      if (!d || d.ok !== true) {
        if (usedEl) usedEl.textContent = '—';
        if (balEl) balEl.textContent = '—';
        return;
      }
      if (usedEl) usedEl.textContent = d.tool.used + '/' + d.tool.limit;
      if (balEl) balEl.textContent = d.balance;
    });
  }

  /* ------------------------------ 启动 ------------------------------ */
  function boot() {
    if (document.body && document.body.classList.contains('tk-page')) { /* 预留 */ }
    if (/\/tool\/index\.html?$/i.test(location.pathname) || /\/tool\/$/i.test(location.pathname)) {
      renderBar();
      return;
    }
    if (!isToolPage()) return;
    if (!token()) return;   // 未登录：不监听、不提示，保持「免登录可用」
    tool = toolId();
    initDetect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.FS_CREDIT = { award: award, tool: toolId };
})();
