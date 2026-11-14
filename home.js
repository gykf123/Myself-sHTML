/* ============================================================
   站点首页动效与导航过渡
   · 进场：纯 CSS（home.css 的 .hm-reveal / .hm-title / .hm-curtain），
     这里只负责给卡片按顺序注入 --d 错峰延迟；JS 不跑也不会白屏。
   · 离场：拦截「站内整页导航」，先播 300ms 淡出 + 顶部进度条，再跳转。
     外链 / 新标签 / 修饰键 / 下载 / 纯 hash / 跨域一律不拦。
   · 尊重 prefers-reduced-motion，且兼容 bfcache 返回。
   ============================================================ */
(function () {
  'use strict';

  var reduce = false;
  try {
    reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { reduce = false; }

  var LEAVE_MS = 320;
  var leaving = false;

  /* ---------- 进场：卡片错峰 ---------- */
  function stageCards() {
    try {
      var groups = [
        { sel: '.hm-grid:not(.hm-grid--mini) .hm-card', base: 0.24, step: 0.055 },
        { sel: '.hm-grid--mini .hm-card', base: 0.34, step: 0.055 },
      ];
      groups.forEach(function (g) {
        var cards = document.querySelectorAll(g.sel);
        for (var i = 0; i < cards.length; i++) {
          cards[i].style.setProperty('--d', (g.base + i * g.step).toFixed(3) + 's');
        }
      });
    } catch (e) { /* 动画增强，失败不影响页面 */ }
  }

  /* ---------- 追光：鼠标位置写进 CSS 变量 ---------- */
  function bindGlow() {
    if (reduce || !window.matchMedia || !window.matchMedia('(hover: hover)').matches) return;
    try {
      document.addEventListener('pointermove', function (e) {
        var card = e.target && e.target.closest ? e.target.closest('.hm-card') : null;
        if (!card) return;
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
        card.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
      }, { passive: true });
    } catch (e) { /* 增强项 */ }
  }

  /* ---------- 是否需要离场过渡（纯函数，便于验收直接调用） ---------- */
  function shouldTransition(a, ev) {
    if (!a || !a.getAttribute) return false;
    if (!ev) ev = {};
    if (ev.defaultPrevented) return false;
    if ((ev.button || 0) !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return false;
    if (a.hasAttribute('download')) return false;
    if (a.dataset && a.dataset.noTransition !== undefined) return false;
    var target = (a.getAttribute('target') || '').toLowerCase();
    if (target && target !== '_self') return false;
    var href = (a.getAttribute('href') || '').trim();
    if (!href || href.charAt(0) === '#') return false;
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) return false;
    var u;
    try { u = new URL(href, location.href); } catch (e) { return false; }
    if (u.origin !== location.origin) return false;
    // 同页 hash 跳转不值得整页淡出
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return false;
    return u.href !== location.href;
  }

  function clearLeaving() {
    leaving = false;
    document.documentElement.classList.remove('hm-leaving');
  }

  function bindLeave() {
    // 捕获阶段：右下角全站速达导航是动态注入的，事件委托到这里一样生效
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!shouldTransition(a, e)) return;
      var href = a.getAttribute('href');
      e.preventDefault();
      if (reduce) { location.href = href; return; }
      if (leaving) return;
      leaving = true;
      document.documentElement.classList.add('hm-leaving');
      window.setTimeout(function () { location.href = href; }, LEAVE_MS);
      // 兜底：若跳转因故没发生，别把页面永久锁在淡出态
      window.setTimeout(function () {
        if (leaving && document.visibilityState !== 'hidden') clearLeaving();
      }, LEAVE_MS + 1200);
    }, true);

    // 浏览器「后退」命中 bfcache 时页面会带着 hm-leaving 回来，必须复位
    window.addEventListener('pageshow', function (e) { if (e.persisted) clearLeaving(); });
  }

  function init() {
    stageCards();
    bindGlow();
    bindLeave();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // 验收钩子：只读，不参与页面逻辑
  window.__hmNav = { shouldTransition: shouldTransition, clearLeaving: clearLeaving, reduce: reduce };
})();
