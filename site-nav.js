/* ============================================================
   FeSui 全站速达导航（site-nav）
   ------------------------------------------------------------
   纯静态站没有构建步骤，38 个页面骨架各不相同（主站 SPA、
   user/ 子页骨架、tool/ 工具页内联样式、MC 子站……），逐页手补
   顶栏链接既易漏又难维护。这里用一个零依赖脚本统一注入：

     · 自带样式（.fs-nav-* 前缀），不依赖任何页面的 CSS 变量；
     · 根相对路径 /xxx/，任意目录深度都指向同一个地方；
     · 主站首页已有完整侧栏导航，脚本检测到 .site-link 就自动跳过，
       不重复、不叠加；
     · 只做导航，不 fetch、不写 localStorage、不碰业务 DOM；
     · 默认收起，右下角一枚小按钮，点开才展开面板。

   全 ES5、DOM API 创建、零 innerHTML 注入面。
   ============================================================ */
(function () {
  'use strict';

  // 首页（主站）有自己的侧栏「站点功能」分组，无需重复注入。
  // 检测必须放在 boot()（DOMContentLoaded 之后）：本脚本在 <head> 同步执行时
  // 侧栏还没解析，此刻 querySelector 一定返回 null，会误判成「不是主站」。
  var LINKS = [
    { name: '首页',       icon: '🏠', href: '/',          match: '' },
    { name: '工具箱大厅', icon: '🧰', href: '/tool/',     match: '/tool' },
    { name: '聊天室',     icon: '💬', href: '/chat/',     match: '/chat' },
    { name: '个人中心',   icon: '🧑‍💻', href: '/user/',     match: '/user' },
    { name: '访问统计',   icon: '📊', href: '/stats/',    match: '/stats' },
    { name: 'Bot 唤醒台', icon: '🤖', href: '/reopenai/', match: '/reopenai' },
    { name: 'GitHub',     icon: '🐙', href: 'https://github.com/gykf123',
      match: null, external: true }
  ];

  var CSS = [
    '.fs-nav-root{position:fixed;right:16px;bottom:16px;z-index:9000;',
      'font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",',
      '"Microsoft YaHei",sans-serif;text-align:left}',
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
      'max-height:min(70vh,420px);overflow-y:auto;padding:10px;',
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
    '.fs-nav-link .i{flex:none;font-size:16px;line-height:1}',
    '.fs-nav-link .g{flex:none;margin-left:auto;font-size:11px;opacity:.5}',
    '@media (prefers-reduced-motion:reduce){',
      '.fs-nav-toggle,.fs-nav-link{transition:none!important}',
      '.fs-nav-toggle:hover{transform:none}}',
    '@media (max-width:520px){',
      '.fs-nav-root{right:12px;bottom:12px}',
      '.fs-nav-panel{bottom:56px;width:184px}}'
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
    // 主站首页已有侧栏「站点功能」分组，跳过，避免出现两套导航
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
      a.appendChild(el('span', 'i', item.icon));
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
