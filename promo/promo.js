/* FeSui 宣传片交互 — 全 ES5/ES6，零依赖，老内核可降级 */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ---------- 1. 开机自检 ---------- */
  var boot = $('#boot'), bootBar = $('#bootBar'), bootLine = $('#bootLine');
  var bootMsgs = [
    '正在加载互联网最奇怪的角落…',
    '正在把图片切成 539 条函数…',
    '正在叫醒每 12 小时上班的 AI…',
    '正在确认群号 1131835986…',
    '好了，开始吧。'
  ];
  var bootDone = false;
  function endBoot() {
    if (bootDone || !boot) return;
    bootDone = true;
    boot.classList.add('gone');
    document.body.style.overflow = '';
  }
  if (boot) {
    document.body.style.overflow = 'hidden';
    if (reduce) { endBoot(); }
    else {
      var p = 0, i = 0;
      var tick = setInterval(function () {
        p += 6 + Math.random() * 13;
        if (p > 100) p = 100;
        if (bootBar) bootBar.style.width = p + '%';
        var ni = Math.min(bootMsgs.length - 1, Math.floor(p / 22));
        if (ni !== i && bootLine) { i = ni; bootLine.textContent = bootMsgs[i]; }
        if (p >= 100) { clearInterval(tick); setTimeout(endBoot, 380); }
      }, 90);
      setTimeout(endBoot, 3200); // 兜底
      $('#bootSkip') && $('#bootSkip').addEventListener('click', function () { clearInterval(tick); endBoot(); });
      boot.addEventListener('click', endBoot);
    }
  }

  /* ---------- 2. 打字机 ---------- */
  var tw = $('#tw');
  if (tw) {
    var lines = [
      '21 个工具，AI 打工，图片能变成函数。',
      '不恰饭、不弹窗，更新全靠较真。',
      '看完记得加群，群号在下面。'
    ];
    if (reduce) { tw.textContent = lines[0]; }
    else {
      var li = 0, ci = 0, del = false;
      function type() {
        var s = lines[li];
        if (!del) {
          ci++;
          tw.textContent = s.slice(0, ci);
          if (ci >= s.length) { del = true; setTimeout(type, 1900); return; }
          setTimeout(type, 46 + Math.random() * 34);
        } else {
          ci--;
          tw.textContent = s.slice(0, ci);
          if (ci <= 0) { del = false; li = (li + 1) % lines.length; setTimeout(type, 380); return; }
          setTimeout(type, 24);
        }
      }
      setTimeout(type, 600);
    }
  }

  /* ---------- 3. 滚动进度 + 视差倾斜 ---------- */
  var bar = $('#pgBar'), ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var p = h > 0 ? (window.pageYOffset || document.documentElement.scrollTop) / h : 0;
      if (bar) bar.style.width = (p * 100) + '%';
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- 4. 滚动揭示 ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: .12, rootMargin: '0px 0px -8% 0px' });
    for (var i = 0; i < reveals.length; i++) io.observe(reveals[i]);
  } else {
    for (var j = 0; j < reveals.length; j++) reveals[j].classList.add('in');
  }

  /* ---------- 5. 故障字（间歇触发） ---------- */
  var title = $('.hero-title');
  if (title && !reduce) {
    setInterval(function () {
      title.classList.add('glitching');
      setTimeout(function () { title.classList.remove('glitching'); }, 950);
    }, 5200);
  }

  /* ---------- 6. 数字滚动 ---------- */
  var counters = document.querySelectorAll('.counter');
  function runCounter(el) {
    var to = parseFloat(el.getAttribute('data-to')) || 0, dur = 1400;
    if (reduce) { el.textContent = to; return; }
    var st = null;
    function step(ts) {
      if (!st) st = ts;
      var k = Math.min(1, (ts - st) / dur);
      var ease = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(to * ease);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window) {
    var io2 = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { runCounter(e.target); io2.unobserve(e.target); } });
    }, { threshold: .5 });
    for (var c = 0; c < counters.length; c++) io2.observe(counters[c]);
  } else {
    for (var c2 = 0; c2 < counters.length; c2++) runCounter(counters[c2]);
  }

  /* ---------- 7. 鼠标视差倾斜（截图框） ---------- */
  if (!reduce && window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
    var tilts = document.querySelectorAll('.tilt');
    for (var t = 0; t < tilts.length; t++) (function (el) {
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        el.style.transform = 'perspective(1100px) rotateY(' + (x * 5) + 'deg) rotateX(' + (-y * 4) + 'deg) translateY(-3px)';
      });
      el.addEventListener('mouseleave', function () { el.style.transform = ''; });
    })(tilts[t]);
  }

  /* ---------- 8. 磁吸按钮 ---------- */
  if (!reduce && window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
    var mags = document.querySelectorAll('.magnetic');
    for (var m = 0; m < mags.length; m++) (function (el) {
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) * .18, y = (e.clientY - r.top - r.height / 2) * .24;
        el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      });
      el.addEventListener('mouseleave', function () { el.style.transform = ''; });
    })(mags[m]);
  }

  /* ---------- 9. 复制群号 ---------- */
  var copyBtn = $('#copyBtn'), toast = $('#toast'), QQ = '1131835986';
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }
  function doCopy() {
    var ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(QQ).then(function () { showToast('已复制 ' + QQ + '，去 QQ 粘贴就行 ✓'); },
          function () { legacyCopy(); });
      } else legacyCopy();
    } catch (e) { legacyCopy(); }
    function legacyCopy() {
      var ta = document.createElement('textarea');
      ta.value = QQ;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      showToast(ok ? ('已复制 ' + QQ + '，去 QQ 粘贴就行 ✓') : ('群号是 ' + QQ + '，手动复制一下～'));
    }
  }
  copyBtn && copyBtn.addEventListener('click', doCopy);

  /* ---------- 10. 彩蛋：konami ---------- */
  var seq = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'], pos = 0;
  document.addEventListener('keydown', function (e) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === seq[pos]) { pos++; if (pos === seq.length) { pos = 0; easterEgg(); } }
    else pos = k === seq[0] ? 1 : 0;
  });
  function easterEgg() {
    var s = document.createElement('style');
    s.textContent = 'body{filter:hue-rotate(180deg) saturate(1.4)!important;transition:filter .6s}';
    document.head.appendChild(s);
    showToast('彩蛋解锁：世界反过来了 🌈');
    setTimeout(function () { s.remove(); }, 5000);
  }
})();
