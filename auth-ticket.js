/* ============================================================
   登录回跳兜底（子页面共用，零依赖）
   - login 页登录成功后 URL 只带一次性 ticket（2 分钟、兑换即作废），
     主站 script.js 与 user/user.js 自带 redeem 逻辑；
     chat/、admin/ 此前没有，导致「登录成功却显示未登录」。
   - 本脚本统一负责：清 URL 参数 → redeem → 写 localStorage['fe_token']
   - 暴露 window.__fsTicketReady（Promise）：页面渲染前 await 即可拿到登录态；
     同时派发 fs:login 事件，供不 await 的页面自行刷新界面
   - 兼容 login 页换票接口异常时的旧降级路径 ?token=
   - 主站 / user/ 不要引入本脚本，避免重复消费同一张 ticket
   - 全程静默失败，兑换不到就保持未登录态，不阻塞页面
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
  var ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
  var AUTH_KEY = 'fe_token';

  function cleanUrl() {
    try {
      var u = new URL(location.href);
      u.searchParams.delete('ticket');
      u.searchParams.delete('token');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (e) {}
  }

  function save(token, notify) {
    try { localStorage.setItem(AUTH_KEY, token); } catch (e) { return false; }
    if (notify) {
      try { window.dispatchEvent(new CustomEvent('fs:login', { detail: { token: token } })); } catch (e) {}
    }
    return true;
  }

  window.__fsTicketReady = (async function () {
    var qs;
    try { qs = new URLSearchParams(location.search); } catch (e) { return false; }
    var ticket = qs.get('ticket');
    var legacy = qs.get('token');
    if (!ticket && !legacy) return false;

    // 先清参：ticket 一次性，刷新或后退时不能重复兑换，也不让票据留在历史里
    cleanUrl();
    if (!ticket) return save(legacy, true);

    try {
      var r = await fetch(SUPABASE_URL + '/functions/v1/auth-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
        body: JSON.stringify({ action: 'redeem', ticket: ticket })
      });
      var d = await r.json().catch(function () { return null; });
      if (r.ok && d && d.token) return save(d.token, true);
    } catch (e) {}
    return false;
  })();
})();
