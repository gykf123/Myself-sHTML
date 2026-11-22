/* ============================================================
   FeSui 全站速达导航（site-nav）
   ------------------------------------------------------------
   纯静态站没有构建步骤，38 个页面骨架各不相同（主站 SPA、
   user/ 子页骨架、tool/ 工具页内联样式、MC 子站……），逐页手补
   顶栏链接既易漏又难维护。这里用一个零依赖脚本统一注入：

     · 自带样式（.fs-nav-* 前缀），不依赖任何页面的 CSS 变量；
     · 根相对路径 /xxx/，任意目录深度都指向同一个地方；
     · 已有侧栏导航的页面（`.site-link`，目前是个人主页 `/home/`）自动跳过，
       不重复、不叠加；根路径 `/` 是门户首页、没有侧栏，需要保留悬浮导航；
     · 只做导航，不 fetch、不写 localStorage、不碰业务 DOM；
   · 默认收起，右下角一枚小按钮，点开才展开面板；
   · 图标用内联 SVG（stroke 描边），不用 emoji —— 缺 emoji 字体的
     老内核 WebView / 部分 Linux 会把 emoji 渲染成方框豆腐块。

   全 ES5、DOM API 创建、零 innerHTML 注入面。
   ============================================================ */
(function () {
  'use strict';

  // 图标路径统一 24×24 viewBox，stroke 描边、currentColor 跟随主题。
  // 放在数据表里而不是拼 innerHTML，保持「零注入面」这条约束。
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    home:    'M3 10.8 12 3.5l9 7.3V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    person:  'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 21a7.5 7.5 0 0 1 15 0',
    tools:   'M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M3 13h18M10 13v2h4v-2',
    chat:    'M20 15a3 3 0 0 1-3 3H9l-5 3V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z',
    profile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 12a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 12 12zM5.8 20a6.4 6.4 0 0 1 12.4 0',
    chart:   'M4 20h16M7 16v-5M12 16V6M17 16v-8',
    pulse:   'M3 12h4l2.5-6 4 12 2.5-6H21',
    bot:     'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM12 4v4M9 14h.01M15 14h.01M9 17h6',
    news:    'M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM18 8h1a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2M8 8h7M8 12h7M8 16h4',
    extern:  'M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6'
  };

  function iconNode(key) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'i');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[key] || ICONS.extern);
    svg.appendChild(path);
    return svg;
  }

  // 首页（主站）有自己的侧栏「站点功能」分组，无需重复注入。
  // 检测必须放在 boot()（DOMContentLoaded 之后）：本脚本在 <head> 同步执行时
  // 侧栏还没解析，此刻 querySelector 一定返回 null，会误判成「不是主站」。
  var LINKS = [
    { name: '首页',       icon: 'home',    href: '/',          match: '' },
    // 个人主页已从 / 搬到 /home/；根 / 现在是站点门户首页，两者要分开列
    { name: '个人主页',   icon: 'person',  href: '/home/',     match: '/home' },
    { name: '项目档案',   icon: 'open',    href: '/projects/', match: '/projects' },
    { name: '工具箱大厅', icon: 'tools',   href: '/tool/',     match: '/tool' },
    { name: '聊天室',     icon: 'chat',    href: '/chat/',     match: '/chat' },
    { name: '个人中心',   icon: 'profile', href: '/user/',     match: '/user' },
    { name: '访问统计',   icon: 'chart',   href: '/stats/',    match: '/stats' },
    { name: '服务状态',   icon: 'pulse',   href: '/status/',   match: '/status' },
    { name: 'Bot 唤醒台', icon: 'bot',     href: '/reopenai/', match: '/reopenai' },
    { name: '博客 / 公告', icon: 'news',   href: '/blog/',     match: '/blog' },
    { name: 'GitHub',     icon: 'extern', href: 'https://github.com/gykf123',
      match: null, external: true }
  ];

  var CSS = [
    '.fs-nav-root{position:fixed;right:16px;bottom:16px;z-index:9000;',
      'font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",',
      '"Microsoft YaHei",sans-serif;text-align:left;',
      // 滚动中淡出：手机上这根球会压住表单控件（下拉框箭头、复选框），
      // 用户滚动找控件时先让开，停手 900ms 再回来。
      'transition:opacity .22s ease}',
    '.fs-nav-root.fs-nav-away{opacity:0;pointer-events:none}',
    '.fs-nav-root [hidden]{display:none!important}',
    '.fs-nav-toggle{width:46px;height:46px;border-radius:50%;cursor:pointer;',
      'border:1px solid var(--fsn-border);background:var(--fsn-bg);',
      'color:var(--fsn-text);font-size:19px;line-height:1;',
      'box-shadow:0 6px 20px rgba(0,0,0,.22);',
      'transition:transform .18s ease,border-color .18s ease}',
    '.fs-nav-toggle:hover{transform:translateY(-2px);border-color:var(--fsn-accent)}',
    '.fs-nav-toggle:focus-visible,.fs-nav-link:focus-visible{',
      'outline:2px solid var(--fsn-accent);outline-offset:2px}',
    '.fs-nav-toggle[aria-expanded="true"]{border-color:var(--fsn-accent);',
      'color:var(--fsn-accent)}',
    '.fs-nav-panel{position:absolute;right:0;bottom:58px;width:196px;',
      'max-height:420px;max-height:min(70vh,420px);overflow-y:auto;padding:10px;',
      'border-radius:14px;border:1px solid var(--fsn-border);',
      'background:var(--fsn-bg);color:var(--fsn-text);',
      'box-shadow:0 12px 36px rgba(0,0,0,.28);',
      'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}',
    '.fs-nav-title{padding:2px 8px 8px;font-size:11px;font-weight:700;',
      'letter-spacing:1px;color:var(--fsn-dim)}',
    '.fs-nav-link{display:flex;align-items:center;gap:9px;padding:8px 9px;',
      'border-radius:9px;text-decoration:none;color:var(--fsn-text);',
      'font-size:13.5px;font-weight:600;',
      'transition:background .16s ease,color .16s ease}',
    '.fs-nav-link:hover{background:var(--fsn-hover);color:var(--fsn-accent)}',
    '.fs-nav-link[aria-current="page"]{background:var(--fsn-active);',
      'color:var(--fsn-accent)}',
    // SVG 描边图标：fill:none + currentColor，深浅主题都能自动跟随
    '.fs-nav-link .i{flex:none;width:16px;height:16px;fill:none;',
      'stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}',
    '.fs-nav-link .g{flex:none;margin-left:auto;font-size:11px;opacity:.5}',
    '@media (prefers-reduced-motion:reduce){',
      '.fs-nav-toggle,.fs-nav-link{transition:none!important}',
      '.fs-nav-toggle:hover{transform:none}}',
    '@media (max-width:520px){',
      // 手机上球会正好落在表单控件右侧，缩小 + 降不透明度，尽量少挡东西
      '.fs-nav-root{right:10px;bottom:10px}',
      '.fs-nav-toggle{width:40px;height:40px;font-size:17px;opacity:.74;',
        'box-shadow:0 4px 14px rgba(0,0,0,.2)}',
      '.fs-nav-toggle:active{opacity:1}',
      '.fs-nav-panel{bottom:50px;width:184px}}',
    // 矮屏（横屏手机 / 小窗）：按钮再缩一圈，少挡住页面底部内容
    '@media (max-height:560px){',
      '.fs-nav-root{right:10px;bottom:10px}',
      '.fs-nav-toggle{width:38px;height:38px;font-size:16px}',
      '.fs-nav-panel{bottom:50px}}'
  ].join('');

  var DARK = [
    '--fsn-bg:rgba(22,27,34,.95);--fsn-border:rgba(255,255,255,.14);',
    '--fsn-text:#e6edf3;--fsn-dim:#8b949e;--fsn-accent:#58a6ff;',
    '--fsn-hover:rgba(255,255,255,.07);--fsn-active:rgba(88,166,255,.16);'
  ].join('');
  var LIGHT = [
    '--fsn-bg:rgba(255,255,255,.97);--fsn-border:rgba(0,0,0,.13);',
    '--fsn-text:#1f2328;--fsn-dim:#6b7280;--fsn-accent:#0969da;',
    '--fsn-hover:rgba(0,0,0,.05);--fsn-active:rgba(9,105,218,.11);'
  ].join('');

  function isDark() {
    var t = '';
    try { t = localStorage.getItem('theme') || ''; } catch (e) {}
    if (t === 'glass') return true;
    if (t === 'standard') return false;
    try {
      return !!(window.matchMedia &&
                window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) { return true; }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function currentPath() {
    var p = location.pathname || '/';
    return p.charAt(p.length - 1) === '/' ? p : p;
  }

  function boot() {
    if (!document.body || document.getElementById('fsNavRoot')) return;
    // 个人主页 /home/ 自带侧栏「站点功能」分组（.site-link），跳过避免两套导航。
    // 注意别写成「主站首页」：根 / 现在是门户首页、没有侧栏，反而需要这套导航。
    if (document.querySelector && document.querySelector('.site-link')) return;

    var style = document.createElement('style');
    style.id = 'fsNavStyle';
    style.textContent = '.fs-nav-root{' + (isDark() ? DARK : LIGHT) + '}' + CSS;
    document.head.appendChild(style);

    var root = el('div', 'fs-nav-root');
    root.id = 'fsNavRoot';
    root.setAttribute('data-fs-nav', '1');

    var btn = el('button', 'fs-nav-toggle');
    btn.type = 'button';
    btn.textContent = '☰';
    btn.setAttribute('aria-label', '打开站点导航');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'fsNavPanel');

    var panel = el('nav', 'fs-nav-panel');
    panel.id = 'fsNavPanel';
    panel.hidden = true;
    panel.setAttribute('aria-label', '站点导航');
    panel.appendChild(el('div', 'fs-nav-title', '站点导航'));

    var path = currentPath();
    LINKS.forEach(function (item) {
      var a = el('a', 'fs-nav-link');
      a.href = item.href;
      a.appendChild(iconNode(item.icon));
      a.appendChild(el('span', null, item.name));
      if (item.external) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.appendChild(el('span', 'g', '↗'));
      } else if (item.match && path.indexOf(item.match) === 0) {
        // 无匹配项（如 /admin/、/404.html）就谁都不高亮，别误导成「当前在首页」
        a.setAttribute('aria-current', 'page');
      }
      panel.appendChild(a);
    });

    function setOpen(on) {
      panel.hidden = !on;
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? '关闭站点导航' : '打开站点导航');
      btn.textContent = on ? '✕' : '☰';
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(panel.hidden);
    });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); }
    });

    root.appendChild(panel);
    root.appendChild(btn);
    document.body.appendChild(root);

    /* 滚动淡出：只在触屏 / 窄屏上启用（桌面有鼠标，且右侧通常留白够）。
       滚动时整根球淡到不可见且不接收点击，停手 900ms 后回来。
       面板打开时不淡出，否则用户点了菜单又被自己藏起来。 */
    var awayTimer = null;
    var media = window.matchMedia ? window.matchMedia('(max-width:520px),(pointer:coarse)') : null;
    function navAway() {
      if (!media || !media.matches) return;
      if (!panel.hidden) return;
      root.classList.add('fs-nav-away');
      if (awayTimer) clearTimeout(awayTimer);
      awayTimer = setTimeout(function () {
        awayTimer = null;
        if (panel.hidden) root.classList.remove('fs-nav-away');
      }, 900);
    }
    window.addEventListener('scroll', navAway, { passive: true, capture: true });
    // 点开菜单时立刻恢复可见
    btn.addEventListener('click', function () {
      if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
      root.classList.remove('fs-nav-away');
    });

    /* 停手之后仍可能正好压在控件上（最典型：390px 下颜色量化下拉框的箭头）。
       静止时探一下球心附近有什么，压到可交互控件就顺着右侧边缘往上挪，
       挪到不遮挡的空档。找不到空档就退回原位（宁可挡，也不要乱飞）。 */
    var liftTimer = null;
    var BASE_BOTTOM = 0; // 记录初始 bottom，避免反复累加
    var INTERACTIVE = 'input,select,textarea,button,a[href],[role="button"],.tk-btn,.v2f-radio,[contenteditable="true"]';

    function blockingAt(cx, bottom) {
      var size = btn.getBoundingClientRect().width || 40;
      var top = window.innerHeight - bottom - size;
      var left = cx - size / 2, right = cx + size / 2;
      // 光靠 elementsFromPoint 会漏：控件被卡片背景盖住时中心点探到的不是它。
      // 直接对可视区里的可交互控件做矩形相交，几何上叠了就算挡。
      var cands = document.querySelectorAll(INTERACTIVE);
      for (var i = 0; i < cands.length; i++) {
        var el = cands[i];
        var rc = el.getBoundingClientRect();
        if (rc.width < 2 || rc.height < 2) continue;
        if (rc.bottom < 0 || rc.top > window.innerHeight) continue;
        if (rc.right < left || rc.left > right) continue;
        if (rc.bottom < top || rc.top > top + size) continue;
        // 只算真正可点的（hidden / display:none 的 getBoundingClientRect 是 0，已排除）
        return el;
      }
      return null;
    }
    function liftIfBlocking() {
      if (!media || !media.matches) return;
      if (!panel.hidden) return;
      if (root.classList.contains('fs-nav-away')) return;
      var r = btn.getBoundingClientRect();
      if (!r.width) return;
      if (!BASE_BOTTOM) BASE_BOTTOM = parseFloat(getComputedStyle(root).bottom) || 10;
      var cx = r.left + r.width / 2;
      // 先把用户手动挪过的位置清掉，重新算
      root.style.bottom = '';
      if (!blockingAt(cx, BASE_BOTTOM)) return;
      // 顺着右侧往上找空档，每 12px 试一次
      var maxLift = window.innerHeight - r.width - 16;
      for (var b = BASE_BOTTOM + 12; b <= maxLift; b += 12) {
        if (!blockingAt(cx, b)) {
          root.style.bottom = b + 'px';
          return;
        }
      }
      // 实在找不到：保持原位
    }
    function scheduleLift() {
      if (liftTimer) clearTimeout(liftTimer);
      liftTimer = setTimeout(liftIfBlocking, 420);
    }
    window.addEventListener('scroll', scheduleLift, { passive: true, capture: true });
    window.addEventListener('resize', scheduleLift);
    window.addEventListener('load', liftIfBlocking);
    scheduleLift();
  }

  /* ============================================================
     跨站链接确认守卫（全站生效，2026-11-15 上线）
     ------------------------------------------------------------
     需求：所有跨站（外域）链接跳转前弹窗确认，避免误触离站。
     实现：document 捕获阶段拦截所有 <a href> 的点击，目标域与当前
     域不同（且是 http/https）就 preventDefault，弹玻璃风确认模态，
     用户确认后才用 window.open(..., 'noopener,noreferrer') 打开。
     豁免：链接位于 [data-ext-confirm="off"] 容器内则直接放行
     （供「新版/旧版选择」这类本身就是确认步骤的交互复用）。
     对外 API：window.FeSuiLinkGuard.open(url, opts)
       - opts.skip = true 时跳过确认直接打开（站内地址自动跳过）。
       - 供 script.js 的彩蛋 / 自定义跳转等 window.open 调用点统一走确认。
     ============================================================ */
  var guardModal = null;
  var guardTarget = '';
  var guardLastFocus = null;

  function guardStyles() {
    if (document.getElementById('flgStyle')) return;
    var dark = isDark();
    var vars = dark
      ? '--flg-bg:rgba(22,27,34,.96);--flg-border:rgba(255,255,255,.16);'
      + '--flg-text:#e6edf3;--flg-dim:#9aa4b2;--flg-accent:#58a6ff;'
      + '--flg-hover:rgba(255,255,255,.08);--flg-veil:rgba(0,0,0,.55);'
      + '--flg-chip:rgba(88,166,255,.14);'
      + '--flg-ok:#3fb950;--flg-ok-hover:#46c458;'
      + '--flg-shadow:0 18px 48px rgba(0,0,0,.45)'
      : '--flg-bg:rgba(255,255,255,.98);--flg-border:rgba(0,0,0,.14);'
      + '--flg-text:#1f2328;--flg-dim:#57606a;--flg-accent:#0969da;'
      + '--flg-hover:rgba(0,0,0,.06);--flg-veil:rgba(0,0,0,.45);'
      + '--flg-chip:rgba(9,105,218,.1);'
      + '--flg-ok:#1a7f37;--flg-ok-hover:#1c8437;'
      + '--flg-shadow:0 18px 48px rgba(0,0,0,.25)';
    var css = [
      '.flg-root{' + vars + ';font:14px/1.6 -apple-system,BlinkMacSystemFont,',
        '"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}',
      // 兼容老内核 WebView（微信/QQ 内置浏览器不支持 inset 简写，遮罩会缩成
      // 零尺寸、确认模态隐形，守卫看起来“点了没反应”），显式写四边偏移
      '.flg-veil{position:fixed;top:0;left:0;right:0;bottom:0;z-index:9500;background:var(--flg-veil);',
        'display:flex;align-items:center;justify-content:center;padding:20px;',
        'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}',
      '.flg-modal{width:100%;max-width:420px;border-radius:16px;padding:22px 22px 18px;',
        'border:1px solid var(--flg-border);background:var(--flg-bg);',
        'color:var(--flg-text);box-shadow:var(--flg-shadow);',
        'animation:flgIn .18s ease}',
      '@keyframes flgIn{from{opacity:0;transform:translateY(10px) scale(.98)}',
        'to{opacity:1;transform:none}}',
      '.flg-title{margin:0 0 10px;font-size:16px;font-weight:700}',
      '.flg-host{display:inline-block;max-width:100%;padding:3px 10px;margin:0 0 10px;',
        'border-radius:999px;font-size:13px;font-weight:600;word-break:break-all;',
        'color:var(--flg-accent);background:var(--flg-chip)}',
      '.flg-text{margin:0 0 16px;color:var(--flg-dim);font-size:13px;word-break:break-all}',
      '.flg-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}',
      '.flg-btn{padding:8px 16px;border-radius:10px;font-size:13.5px;font-weight:600;',
        'cursor:pointer;border:1px solid var(--flg-border);background:transparent;',
        'color:var(--flg-text);transition:background .15s ease,border-color .15s ease}',
      '.flg-btn:hover{background:var(--flg-hover)}',
      '.flg-btn:focus-visible{outline:2px solid var(--flg-accent);outline-offset:2px}',
      '.flg-btn-ok{border-color:transparent;background:var(--flg-ok);color:#fff}',
      '.flg-btn-ok:hover{background:var(--flg-ok-hover)}',
      '@media (prefers-reduced-motion:reduce){.flg-modal{animation:none}}'
    ].join('');
    var style = document.createElement('style');
    style.id = 'flgStyle';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // 用临时 <a> 打开：target=_blank + rel=noopener noreferrer，既避弹窗拦截，
  // 也不把 opener 暴露给目标站。注意不能靠 window.open 返回值做兜底 ——
  // 带 noopener 时规范要求返回 null，误判会导致当前页被一起导航走。
  function guardOpenReal(url) {
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    a.setAttribute('data-ext-confirm', 'off');   // 合成点击不再触发守卫，避免死循环
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function guardShowModal(url) {
    guardStyles();
    guardCloseModal();
    guardTarget = url;
    guardLastFocus = document.activeElement;
    var host = '';
    try { host = new URL(url).hostname; } catch (e) { host = url; }

    var veil = el('div', 'flg-root flg-veil');
    veil.id = 'flgVeil';
    veil.setAttribute('data-ext-confirm', 'off');
    var modal = el('div', 'flg-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', '即将离开本站');

    var t = el('p', 'flg-title', '即将离开本站');
    var chip = el('span', 'flg-host', host);
    var desc = el('p', 'flg-text',
      '你即将访问外部站点，内容不受本站控制。确认要继续吗？目标地址：' + url);
    var acts = el('div', 'flg-actions');
    var cancel = el('button', 'flg-btn', '留在本站');
    cancel.type = 'button';
    var ok = el('button', 'flg-btn flg-btn-ok', '继续访问');
    ok.type = 'button';

    cancel.addEventListener('click', guardCloseModal);
    ok.addEventListener('click', function () {
      guardCloseModal();
      guardOpenReal(guardTarget);
    });
    veil.addEventListener('click', function (e) {
      if (e.target === veil) guardCloseModal();
    });

    acts.appendChild(cancel);
    acts.appendChild(ok);
    modal.appendChild(t);
    modal.appendChild(chip);
    modal.appendChild(desc);
    modal.appendChild(acts);
    veil.appendChild(modal);
    document.body.appendChild(veil);
    guardModal = veil;
    document.addEventListener('keydown', guardEsc, true);
    ok.focus();
  }

  function guardEsc(e) {
    if (e.key === 'Escape' && guardModal) {
      e.stopPropagation();
      guardCloseModal();
    }
  }

  function guardCloseModal() {
    if (!guardModal) return;
    var v = guardModal;
    guardModal = null;
    document.removeEventListener('keydown', guardEsc, true);
    v.remove();
    if (guardLastFocus && guardLastFocus.focus) {
      try { guardLastFocus.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function guardIsExternal(url) {
    try {
      var u = new URL(url, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      return u.hostname !== location.hostname;
    } catch (e) { return false; }
  }

  // 捕获阶段拦截：先于页面自身监听器执行，拦下就 preventDefault
  document.addEventListener('click', function (e) {
    if (guardModal) return;               // 模态内的按钮自己处理
    if (e.defaultPrevented) return;
    var node = e.target;
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute('data-ext-confirm') === 'off') return;
      node = node.parentNode;
    }
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;
    if (!guardIsExternal(href)) return;
    e.preventDefault();
    e.stopPropagation();
    var abs;
    try { abs = new URL(href, location.href).href; } catch (err) { return; }
    guardShowModal(abs);
  }, true);

  window.FeSuiLinkGuard = {
    open: function (url, opts) {
      opts = opts || {};
      if (!guardIsExternal(url) || opts.skip) { guardOpenReal(url); return; }
      guardShowModal(url);
    },
    isExternal: guardIsExternal
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
