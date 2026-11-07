/* ============================================================
   站点级共享脚本：访问上报 + 登录态封禁提示（零依赖）
   - 每个页面加载上报一次 record_visit（游客也能上报）；
     主站 SPA 的 [data-view] 视图切换与 hashchange 再各计一次
   - 登录用户带上本站 JWT：PostgREST 会把它解析成 auth.uid()，
     这样 unique_users 才有意义；token 失效时自动降级匿名补报
   - 已登录用户顺带查一次 is_account_banned(p_site='fesui')；
     命中则显示顶部横幅并派发 fs:banned 事件（聊天页据此禁用发言）
   - 全程静默失败，绝不阻塞页面渲染；数据只写聚合用字段
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
  var ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
  var SITE = 'fesui';
  var AUTH_KEY = 'fe_token';
  var lastPath = '', lastAt = 0;

  function tokenInfo() {
    try {
      var t = localStorage.getItem(AUTH_KEY);
      if (!t) return null;
      var parts = t.split('.');
      if (parts.length !== 3) return null;
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var p = JSON.parse(decodeURIComponent(escape(atob(b64))));
      if (!p || !p.sub || !p.exp || p.exp * 1000 <= Date.now()) return null;
      return { token: t, sub: p.sub };
    } catch (e) { return null; }
  }

  function rpc(name, body, token) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 4000) : null;
    var opts = {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (token || ANON_KEY)
      },
      body: JSON.stringify(body),
      keepalive: true
    };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, opts)
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .catch(function () { return null; })
      .then(function (d) { if (timer) clearTimeout(timer); return d; });
  }

  function currentPath() { return location.pathname + (location.hash || ''); }

  function report(path) {
    var now = Date.now();
    if (path === lastPath && now - lastAt < 3000) return;
    lastPath = path; lastAt = now;
    var info = tokenInfo();
    rpc('record_visit', { p_site: SITE, p_path: path }, info && info.token)
      .then(function (d) {
        // token 失效导致上报失败时，用匿名身份补报一次，保证这次访问不丢
        if ((!d || d.ok !== true) && info) {
          rpc('record_visit', { p_site: SITE, p_path: path }, null);
        }
      });
  }

  function showBanner(d) {
    if (document.getElementById('fsBanBanner')) return;
    var el = document.createElement('div');
    el.id = 'fsBanBanner';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;'
      + 'padding:10px 44px 10px 14px;text-align:center;font-size:14px;line-height:1.5;'
      + 'background:rgba(178,38,38,.94);color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.25);';
    var reason = d.reason ? '：' + String(d.reason) : '';
    var until = (!d.permanent && d.until) ? '（至 ' + String(d.until).slice(0, 10) + '）' : '';
    el.appendChild(document.createTextNode('账号已被封禁' + reason + until + '，发言功能已停用。'));
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭提示');
    close.style.cssText = 'position:absolute;right:8px;top:4px;background:transparent;'
      + 'border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1;';
    close.onclick = function () { if (el.parentNode) el.parentNode.removeChild(el); };
    el.appendChild(close);
    (document.body || document.documentElement).appendChild(el);
  }

  function checkBan() {
    var info = tokenInfo();
    if (!info) return;
    rpc('is_account_banned', { p_user: info.sub, p_site: SITE }, info.token)
      .then(function (d) {
        if (!d || d.banned !== true) return;
        window.__fsBanned = d;
        showBanner(d);
        try { window.dispatchEvent(new CustomEvent('fs:banned', { detail: d })); } catch (e) {}
      });
  }

  function start() {
    report(currentPath());
    checkBan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.addEventListener('hashchange', function () { report(currentPath()); });
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('[data-view]')) {
      setTimeout(function () { report(currentPath()); }, 60);
    }
  }, true);
})();
