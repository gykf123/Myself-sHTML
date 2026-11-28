/* ============================================================
   小小沙盒在线版 · 联机门禁（sandbox-gate.js）
   ------------------------------------------------------------
   原则：单人模式免登录、零请求；只有「联机」才要求登录 + 1 积分解锁。
   解锁状态由服务端 RPC 说了算（fs_sandbox_status / fs_sandbox_unlock），
   前端只展示，不用 localStorage 缓存「已解锁」这种可被伪造的状态。

   登录回跳走共享 auth-ticket.js：?ticket= 一次性兑换成 localStorage['fe_token']，
   本脚本 await window.__fsTicketReady 后再渲染，避免「登录成功却显示未登录」。
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
  var ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
  var AUTH_KEY = 'fe_token';

  var gate = document.getElementById('netGate');
  var titleEl = document.getElementById('gateTitle');
  var subEl = document.getElementById('gateSub');
  var btn = document.getElementById('gateBtn');
  if (!gate || !titleEl || !subEl || !btn) return;

  var 联机按钮 = ['netWanHost', 'netWanJoin', 'netHost', 'netJoinBtn']
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);

  var 状态 = null;      // {logged, unlocked, balance, cost}
  var 检查中 = true;
  var 提示 = '正在检查联机权限…';

  function token() { try { return localStorage.getItem(AUTH_KEY) || ''; } catch (e) { return ''; } }

  function 设按钮(文本, 禁用) {
    btn.textContent = 文本;
    btn.disabled = !!禁用;
  }

  function 锁按钮(锁) {
    联机按钮.forEach(function (b) { b.disabled = !!锁; });
  }

  function 渲染() {
    gate.classList.remove('locked', 'ready');
    if (检查中) {
      gate.classList.add('locked');
      设按钮('请稍候', true);
      锁按钮(true);
      提示 = '正在检查联机权限…';
      return;
    }
    if (!状态 || !状态.logged) {
      gate.classList.add('locked');
      titleEl.textContent = '联机需要先登录';
      subEl.textContent = '单人模式不受影响，登录后用 1 积分解锁联机';
      设按钮('登录', false);
      锁按钮(true);
      提示 = '联机需要先登录';
      return;
    }
    if (状态.unlocked) {
      gate.classList.add('ready');
      titleEl.textContent = '已解锁联机';
      subEl.textContent = '余额 ' + 状态.balance + ' · 可以创建或加入房间';
      设按钮('已解锁', true);
      锁按钮(false);
      提示 = '';
      return;
    }
    // 已登录、未解锁
    gate.classList.add('locked');
    var 够 = Number(状态.balance) >= Number(状态.cost);
    titleEl.textContent = 够 ? '花 1 积分解锁联机' : '积分不足，无法解锁联机';
    subEl.textContent = '当前余额 ' + 状态.balance + ' · 解锁后永久有效，不再重复扣费';
    设按钮(够 ? '解锁联机' : '去赚积分', false);
    锁按钮(true);
    提示 = 够 ? '' : '联机需要 1 积分，当前余额不足';
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

  function 登录地址() {
    var back = location.origin + location.pathname;
    return '/login/index.html?brand=FeSui&home=' + encodeURIComponent(location.origin + '/') +
      '&redirect=' + encodeURIComponent(back);
  }

  function 查状态() {
    检查中 = true;
    渲染();
    if (!token()) {
      检查中 = false;
      状态 = null;
      渲染();
      return Promise.resolve(null);
    }
    return rpc('fs_sandbox_status', {}).then(function (res) {
      检查中 = false;
      if (res.ok && res.data && res.data.ok === true) {
        状态 = {
          logged: res.data.logged === true,
          unlocked: res.data.unlocked === true,
          balance: res.data.balance,
          cost: res.data.cost
        };
      } else {
        状态 = null;
        提示 = '联机权限检查失败，请稍后重试';
      }
      渲染();
      return 状态;
    });
  }

  function 解锁() {
    if (!状态 || 状态.unlocked) return;
    if (Number(状态.balance) < Number(状态.cost)) {
      location.href = '/user/';
      return;
    }
    设按钮('解锁中…', true);
    rpc('fs_sandbox_unlock', {}).then(function (res) {
      var d = res.data;
      if (res.ok && d && d.ok === true && d.unlocked === true) {
        状态.unlocked = true;
        状态.balance = d.balance;
        渲染();
        try { window.dispatchEvent(new CustomEvent('fs:sandbox-unlocked')); } catch (e) { }
      } else {
        var m = d && d.reason === 'insufficient' ? '积分不足，解锁失败' : '解锁失败，请稍后重试';
        titleEl.textContent = m;
        subEl.textContent = d && d.balance != null ? ('当前余额 ' + d.balance) : '请重试';
        设按钮('重试', false);
      }
    });
  }

  btn.addEventListener('click', function () {
    if (检查中) return;
    if (!状态 || !状态.logged) { location.href = 登录地址(); return; }
    if (状态.unlocked) return;
    解锁();
  });

  // 暴露给 game.js 做联机前的硬校验
  window.__sandboxGate = {
    ok: function () { return !检查中 && !!状态 && 状态.logged && 状态.unlocked === true; },
    tip: function () { return 提示 || '联机需要先登录并用 1 积分解锁'; },
    refresh: 查状态,
    openPanel: function () {
      var net = document.getElementById('net');
      if (net) net.classList.remove('hide');
    },
    state: function () { return 状态; }
  };

  // 等登录票据兑换完成，再查状态（子页漏接 ticket 是本站历史坑）
  var ready = window.__fsTicketReady;
  if (ready && typeof ready.then === 'function') ready.then(查状态);
  else 查状态();

  // 其他标签页登录/登出后同步
  window.addEventListener('fs:login', function () { 查状态(); });
})();
