/* ============================================================
   fs-icons.js — 孤立装饰 emoji → 统一线条 SVG

   背景：缺 emoji 字体的 WebView 会把彩色 emoji 渲染成方框「豆腐块」，
   全站（博客 / 状态 / 统计 / 聊天 / 工具箱 / 个人主页 / 动态渲染内容）
   都有这个观感问题。逐页改 HTML 覆盖不到接口返回后生成的节点，所以
   做一次运行时替换。

   设计约束：
   · 纯 ES5 + DOM API，零 innerHTML 注入面（createElementNS + replaceChild）；
   · 只替换「孤立」emoji：前后是空白或文本节点边界。用户句子中间的 emoji
     （如「太棒了🎉」）保持原样，不破坏内容；
   · 同时覆盖 HTML 静态节点与 XHR 返回后动态渲染的节点（MutationObserver，
     自身替换前先 disconnect，避免递归）；
   · 幂等：生成的 svg 带 data-fs-ico，重复扫描不会二次处理；
   · 尊重不了「用户在留言里只发一个 emoji」的极少数情形——这类孤立字符
     会套用通用图标，换取全站视觉一致，取舍记录见 REMIND.md。
   ============================================================ */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  /* 20 个语义图标（24×24 stroke，currentColor 跟随深浅主题） */
  var ICON = {
    _default: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M12 12h.01'],
    file:     ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
    doc:      ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5'],
    news:     ['M4 5h13a1 1 0 0 1 1 1v13H5a1 1 0 0 1-1-1V5z', 'M18 9h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2', 'M7 9h7', 'M7 13h7', 'M7 17h4'],
    clipboard:['M9 3h6v3H9z', 'M7 5h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M9 12h6', 'M9 16h4'],
    folder:   ['M3 6h6l2 2h10v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6z'],
    edit:     ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z'],
    chart:    ['M3 3v18h18', 'M7 15l4-4 3 3 5-6'],
    bars:     ['M4 20V11', 'M10 20V4', 'M16 20v-6', 'M22 20H2'],
    calendar: ['M3 5h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M2 10h20', 'M8 3v4', 'M16 3v4'],
    clock:    ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
    mail:     ['M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M3 6l9 7 9-7'],
    chat:     ['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z'],
    mega:     ['M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z', 'M10 8l8-4v16l-8-4', 'M18 8a3 3 0 0 1 0 8'],
    signal:   ['M12 20v-2', 'M8.5 16.2a5 5 0 0 1 7 0', 'M5.5 12.6a9 9 0 0 1 13 0', 'M2.5 9a13 13 0 0 1 19 0', 'M12 20h.01'],
    link:     ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7'],
    tool:     ['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4z'],
    gear:     ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M12 2l1.2 2.3 2.5-.5.7 2.5 2.3 1.2-1 2.3 1 2.3-2.3 1.2-.7 2.5-2.5-.5L12 22l-1.2-2.3-2.5.5-.7-2.5L6.3 16.5l1-2.3-1-2.3 2.3-1.2.7-2.5 2.5.5z'],
    search:   ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.35-4.35'],
    key:      ['M14 7a4 4 0 1 1-3.2 6.4L3 21l3 0 2-2 0-2 2-2 2 0 1.6-1.6A4 4 0 0 1 14 7z', 'M15.5 8.5h.01'],
    lock:     ['M5 11h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z', 'M8 11V7a4 4 0 0 1 8 0v4'],
    refresh:  ['M20 11a8 8 0 1 0-2.3 6.3', 'M20 4v7h-7'],
    user:     ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    bot:      ['M12 2a3 3 0 0 0-3 3v1H7a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3h-2V5a3 3 0 0 0-3-3z', 'M9 12h.01', 'M15 12h.01', 'M9 16h6'],
    home:     ['M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
    globe:    ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M2 12h20', 'M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z'],
    plant:    ['M12 22v-8', 'M12 14c0-4 3-7 8-7 0 5-3 8-8 8', 'M12 14c0-3-2-6-7-6 0 4 3 6 7 6'],
    palette:  ['M12 22a10 10 0 0 1 0-20c5.5 0 10 3.6 10 8 0 2.5-2 4-4.5 4H16a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 22z', 'M7.5 11h.01', 'M10 7.5h.01', 'M14.5 7.5h.01', 'M17.5 10h.01'],
    target:   ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
    spark:    ['M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z', 'M19 17l.6 1.9L21.5 19.5l-1.9.6L19 22l-.6-1.9-1.9-.6 1.9-.6z'],
    image:    ['M3 3h18a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M21 15l-5-5L5 21'],
    monitor:  ['M2 4h20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M8 21h8', 'M12 18v3'],
    dice:     ['M4 4h16v16H4z', 'M8 8h.01', 'M16 8h.01', 'M12 12h.01', 'M8 16h.01', 'M16 16h.01'],
    game:     ['M6 8h12a4 4 0 0 1 4 4v3a4 4 0 0 1-6.8 2.8L14 17h-4l-1.2.8A4 4 0 0 1 2 15v-3a4 4 0 0 1 4-4z', 'M7 12h3', 'M8.5 10.5v3', 'M16 12h.01', 'M18 14h.01'],
    eye:      ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    heart:    ['M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-6.6 1.1-1a5.5 5.5 0 0 0 0-7.8z', 'M4 12h4l2-3 3 6 2-3h5'],
    shield:   ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
    menu:     ['M3 6h18', 'M3 12h18', 'M3 18h18'],
    arrowR:   ['M5 12h14', 'M13 6l6 6-6 6'],
    arrowL:   ['M19 12H5', 'M11 18l-6-6 6-6'],
    box:      ['M3 7l9-4 9 4v10l-9 4-9-4z', 'M3 7l9 4 9-4', 'M12 11v10'],
    text:     ['M4 6h16', 'M4 10h11', 'M4 14h16', 'M4 18h8']
  };

  /* emoji → 语义图标。未收录的孤立彩色 emoji 走 _default，保证零豆腐块 */
  var MAP = {
    '📰':'news','📄':'file','📃':'file','📜':'clipboard','📋':'clipboard','📁':'folder','📂':'folder',
    '📝':'edit','✍':'edit','📐':'ruler','📏':'ruler','📊':'bars','📈':'chart','📉':'chart',
    '📅':'calendar','📆':'calendar','📮':'mail','📤':'box','📥':'box','📧':'mail','📭':'mail',
    '💬':'chat','📢':'mega','✉':'mail','📡':'signal','🔗':'link','🔀':'refresh',
    '🧰':'tool','🛠':'tool','🔧':'tool','⚙':'gear','⛏':'tool','🔨':'tool',
    '🔑':'key','🔐':'lock','🔒':'lock','🔓':'lock','🔍':'search','🔎':'search',
    '🔁':'refresh','🔄':'refresh','➡':'arrowR','⬅':'arrowL','👈':'arrowL',
    '🤖':'bot','👤':'user','🧑':'user','💻':'monitor','🖥':'monitor','🏠':'home',
    '🎨':'palette','🎯':'target','🌱':'plant','🌍':'globe','🧭':'globe','🌎':'globe',
    '🎲':'dice','🎉':'spark','✨':'spark','⚡':'spark','🩺':'heart','🕐':'clock','⏱':'clock',
    '👁':'eye','🙈':'eye','😵':'_default','🎮':'game','🔡':'text','🔢':'text',
    '🖌':'edit','🖍':'edit','🗣':'chat','🟦':'image','📦':'box','📖':'doc',
    '☰':'menu','🛡':'shield','🚫':'_default','📍':'_default','🎙':'_default','🎤':'_default',
    '🎵':'_default','🎺':'_default','🍢':'_default','🐰':'_default','🐷':'_default',
    '💀':'_default','💫':'spark','🛒':'_default','🪪':'_default','🌧':'_default','👣':'_default',
    '👋':'_default','🧊':'box','🕺':'user','🤣':'_default','🎊':'spark','🔎':'search',
    '🧑‍💻':'user','👍':'_default','🙏':'_default','🔥':'spark','💡':'spark'
  };
  /* ruler 没有单独定义，复用 doc */
  ICON.ruler = ICON.edit;

  /* 基础尺寸自带，任何页面（包括不引 fs-skin.css 的门户首页）都能正确显示 */
  var css = '.fs-ico{width:1em;height:1em;display:inline-block;vertical-align:-.14em;flex:none;' +
            'fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}';
  function injectStyle() {
    try {
      var s = document.createElement('style');
      s.setAttribute('data-fs-icons', '1');
      s.appendChild(document.createTextNode(css));
      document.head.appendChild(s);
    } catch (e) {}
  }

  /* 键按长度降序，优先匹配 ZWJ 组合（如 🧑‍💻）；FE0F 变体选择符做成可选后缀 */
  var keys = [];
  for (var k in MAP) { if (Object.prototype.hasOwnProperty.call(MAP, k)) keys.push(k); }
  keys.sort(function (a, b) { return b.length - a.length; });
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var rxParts = keys.map(function (k) { return esc(k) + '\\uFE0F?'; });
  /* 兜底：任意未收录的孤立彩色 emoji（高代理区 U+1F000–U+1FAFF） */
  rxParts.push('[\\uD83C-\\uDBFF][\\uDC00-\\uDFFF](?:\\u200D[\\uD83C-\\uDBFF][\\uDC00-\\uDFFF])*\\uFE0F?');
  var RX = new RegExp('(?:' + rxParts.join('|') + ')', 'g');

  function keyOf(raw) {
    var clean = raw.replace(/\uFE0F/g, '');
    if (Object.prototype.hasOwnProperty.call(MAP, clean)) return MAP[clean];
    return '_default';
  }

  function makeSvg(key) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'fs-ico');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('data-fs-ico', key);
    var paths = ICON[key] || ICON._default;
    for (var i = 0; i < paths.length; i++) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', paths[i]);
      svg.appendChild(p);
    }
    return svg;
  }

  var SKIP = { SCRIPT:1, STYLE:1, TEXTAREA:1, INPUT:1, SELECT:1, OPTION:1,
               TITLE:1, NOSCRIPT:1, SVG:1, IFRAME:1, PRE:1, CODE:1, CANVAS:1 };
  /* 用户生成内容不替换：昵称 / 留言 / 聊天正文里用户自己写的 emoji 应当保留原样 */
  var SKIP_CLASS = /(^|\s)(chat-body|chat-msg|chat-name|wall-msg|wall-item|mywall-item|md-body|post-body|user-nick|nickname)(\s|$)/;
  function skip(node) {
    var p = node.parentNode;
    while (p && p !== document.body) {
      if (SKIP[p.nodeName]) return true;
      if (p.nodeType === 1 && p.getAttribute) {
        if (p.getAttribute('data-fs-icons-skip') !== null) return true;
        var cls = p.className;
        if (typeof cls === 'string' && SKIP_CLASS.test(cls)) return true;
      }
      p = p.parentNode;
    }
    return false;
  }
  function isSpace(ch) { return ch === undefined || ch === '' || /[\s\u00A0]/.test(ch); }

  function convertNode(node) {
    var text = node.nodeValue;
    if (!text) return false;
    RX.lastIndex = 0;
    var m, last = 0, frag = null, changed = false;
    while ((m = RX.exec(text)) !== null) {
      var i = m.index, raw = m[0];
      /* 只处理「孤立」：前后是空白或文本节点边界，且不落在句子中间 */
      if (!isSpace(text.charAt(i - 1)) || !isSpace(text.charAt(i + raw.length))) continue;
      if (!frag) frag = document.createDocumentFragment();
      if (i > last) frag.appendChild(document.createTextNode(text.slice(last, i)));
      frag.appendChild(makeSvg(keyOf(raw)));
      last = i + raw.length;
      changed = true;
    }
    if (!changed) return false;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    try { node.parentNode.replaceChild(frag, node); } catch (e) { return false; }
    return true;
  }

  function scan() {
    if (!document.body) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var nodes = [], n;
    /* 先收集再替换：避免一边遍历一边改树导致 walker 失效 */
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.length && !skip(n)) nodes.push(n);
    }
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parentNode) convertNode(nodes[i]);
    }
  }

  function boot() {
    injectStyle();
    scan();
    window.setTimeout(scan, 900);   /* 接口返回后渲染的内容 */
    window.setTimeout(scan, 2400);
    if (!window.MutationObserver) return;
    var ob, timer;
    ob = new window.MutationObserver(function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        /* 断开期间替换 DOM，避免自身插入节点再次触发观察器 */
        ob.disconnect();
        try { scan(); } catch (e) {}
        try { ob.observe(document.body, { childList: true, subtree: true }); } catch (e2) {}
      }, 220);
    });
    try { ob.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
