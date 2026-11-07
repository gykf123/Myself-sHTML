/* ============================================================
   FeSui 网络韧性层（net-guard）
   ------------------------------------------------------------
   背景：境外 Supabase 节点在国内偶发不可达。站外已有反代
   https://api.fkd.xn--0iv.gay ，放行 /rest/v1/ /functions/v1/
   /storage/v1/object/ /auth/v1/（auth 下另有敏感子路径拦截）。

   本层接管 window.fetch，只处理发往本项目 Supabase 的请求：
     1) 启动竞速探测各端点，谁先 200 用谁，结果持久化，跨页面复用；
     2) 当前端点不支持该路径时自动回退官方域，行为与没装兜底时一致；
     3) 只在「网络层连接失败」时换端点重试，且严格限制在只读请求；
     4) 写操作一律不重试：一次性 ticket、发消息、封禁、访问上报等
        重试会造成重复消费或重复副作用；
     5) 拿到任何 HTTP 响应（含 401/403/404）立即返回，不重试。

   与 FKD 站 net-guard 的区别（那两份不能直接拷过来）：
     · 不自动跳 diag.html —— fesui 没有这个页面，会跳到 404；
     · 不缓存任何响应到 localStorage —— 聊天室消息、统计数字会看到过期数据；
     · localStorage 键前缀 fs_，避免与另一站点语义混淆；
     · 重试白名单按 fesui 实际端点细化，而不是「所有 POST 都不重试」。

   配置（需在业务脚本之前，可选）：
     window.FS_NET_ENDPOINTS = ['https://主域', 'https://反代'];
     localStorage.setItem('fs_net_endpoints', JSON.stringify([...]));
   调试：FS_NET.active() / .endpoints() / .stats() / .probe() / .setEndpoints()

   全 ES5，零依赖，同步加载于 </head> 之前，确保最先接管 fetch。
   ============================================================ */
(function () {
  'use strict';

  var PRIMARY = 'https://yowwyasttkywyqgseuqz.supabase.co';
  var PROXY = 'https://api.fkd.xn--0iv.gay';
  var ANON = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';

  var TIMEOUT_GET = 10000;
  var TIMEOUT_WRITE = 20000;   // 与 login 页 callFn 的 20s 超时对齐
  var PROBE_TIMEOUT = 8000;    // 反代首次 TLS 冷启动可达 3s+，别设太短
  var PROBE_COOL_MS = 30 * 60 * 1000;
  var PROBE_PATH = '/rest/v1/users?select=id&limit=1';

  var LS_ACTIVE = 'fs_net_active';
  var LS_ENDPOINTS = 'fs_net_endpoints';
  var LS_PROBE_AT = 'fs_net_probe_at';

  /* 反代侧路径白名单，与 proxy-core.js 保持一致 */
  var ALLOW_PATH = ['/rest/v1/', '/functions/v1/', '/storage/v1/object/', '/auth/v1/'];
  var AUTH_DENY = [
    '/auth/v1/admin/', '/auth/v1/invite', '/auth/v1/recover',
    '/auth/v1/otp', '/auth/v1/magiclink', '/auth/v1/resend'
  ];

  /* 网络层失败时允许重试的 POST：纯校验 / 纯只读，绝不能有副作用。
     auth-exchange（含 redeem 一次性票）、wall-post、qq-bind、account、
     record_visit、ban_account、unban_account 等一律不在列。 */
  var RETRY_POST = ['/functions/v1/login', '/functions/v1/profile'];
  var RETRY_RPC = [
    '/rest/v1/rpc/fs_visit_stats_public', '/rest/v1/rpc/my_visit_history',
    '/rest/v1/rpc/list_account_bans', '/rest/v1/rpc/site_visit_stats',
    '/rest/v1/rpc/is_account_banned'
  ];
  var FS_CHAT_READ = /"action"\s*:\s*"(list|thread|conversations|dm_thread|dm_conversations)"/;

  var _raw = window.fetch.bind(window);
  var endpoints = readEndpoints();
  var activeEp = readActive();
  var fails = {};
  var statsBuf = [];

  /* ------------------------------ 配置 ------------------------------ */
  function norm(u) {
    if (typeof u !== 'string') return '';
    u = u.trim().replace(/\/+$/, '');
    return /^https:\/\//i.test(u) ? u : '';
  }

  function readEndpoints() {
    var list = null;
    try {
      if (Object.prototype.toString.call(window.FS_NET_ENDPOINTS) === '[object Array]') {
        list = window.FS_NET_ENDPOINTS.slice();
      }
    } catch (e) {}
    if (!list) {
      try {
        var s = localStorage.getItem(LS_ENDPOINTS);
        if (s) list = JSON.parse(s);
      } catch (e) {}
    }
    if (Object.prototype.toString.call(list) !== '[object Array]' || !list.length) {
      list = [PRIMARY, PROXY];
    }
    var out = [], i, n;
    for (i = 0; i < list.length; i++) {
      n = norm(list[i]);
      if (n && out.indexOf(n) === -1) out.push(n);
    }
    if (!out.length) out = [PRIMARY, PROXY];
    if (out.indexOf(PRIMARY) === -1) out.push(PRIMARY); // 官方域永远作为兜底
    return out;
  }

  function readActive() {
    try {
      var s = localStorage.getItem(LS_ACTIVE);
      if (s && endpoints.indexOf(s) !== -1) return s;
    } catch (e) {}
    return endpoints[0];
  }

  function saveActive(ep) {
    activeEp = ep;
    try { localStorage.setItem(LS_ACTIVE, ep); } catch (e) {}
  }

  function currentEp() {
    return endpoints.indexOf(activeEp) !== -1 ? activeEp : endpoints[0];
  }

  function isOurRequest(url) {
    if (url.indexOf(PRIMARY) === 0) return true;
    for (var i = 0; i < endpoints.length; i++) {
      if (url.indexOf(endpoints[i]) === 0) return true;
    }
    return false;
  }

  function pathOf(url) {
    var i;
    for (i = 0; i < endpoints.length; i++) {
      if (url.indexOf(endpoints[i]) === 0) return url.slice(endpoints[i].length) || '/';
    }
    if (url.indexOf(PRIMARY) === 0) return url.slice(PRIMARY.length) || '/';
    return url;
  }

  function epCanServe(ep, path) {
    if (ep === PRIMARY) return true;
    var ok = false, i;
    for (i = 0; i < ALLOW_PATH.length; i++) {
      if (path.indexOf(ALLOW_PATH[i]) === 0) { ok = true; break; }
    }
    if (!ok) return false;
    for (i = 0; i < AUTH_DENY.length; i++) {
      if (path.indexOf(AUTH_DENY[i]) === 0) return false;
    }
    return true;
  }

  function rewrite(url, ep) {
    var p = pathOf(url);
    return epCanServe(ep, p) ? ep + p : null;
  }

  function endpointFor(url) {
    var ep = currentEp();
    return epCanServe(ep, pathOf(url)) ? ep : PRIMARY;
  }

  function switchEndpoint() {
    if (endpoints.length < 2) return false;
    var start = endpoints.indexOf(currentEp());
    var best = -1, bestFails = 1e9, i, idx, f;
    for (i = 1; i <= endpoints.length; i++) {
      idx = (start + i) % endpoints.length;
      if (idx === start) continue;
      f = fails[endpoints[idx]] || 0;
      if (f < bestFails) { bestFails = f; best = idx; }
    }
    if (best < 0) return false;
    saveActive(endpoints[best]);
    return true;
  }

  function markOk(ep) { fails[ep] = 0; }
  function markFail(ep) { fails[ep] = (fails[ep] || 0) + 1; }

  /* ---------------------------- 超时组合 ----------------------------
     不覆盖调用方自带 signal 的语义：任一触发即 abort，但用 fired 标记
     区分「我们自己超时」与「连接层失败」——前者可能已送达，不能重试。 */
  function withTimeout(init, isRequest, input, ms) {
    var ctrl = new AbortController();
    var state = { fired: false };
    var timer = setTimeout(function () { state.fired = true; ctrl.abort(); }, ms);
    var ext = (init && init.signal) || (isRequest && input && input.signal);
    if (ext) {
      if (ext.aborted) ctrl.abort();
      else {
        try { ext.addEventListener('abort', function () { ctrl.abort(); }, { once: true }); }
        catch (e) {}
      }
    }
    return {
      signal: ctrl.signal,
      state: state,
      cleanup: function () { clearTimeout(timer); }
    };
  }

  function callerAborted(init, isRequest, input) {
    var s = (init && init.signal) || (isRequest && input && input.signal);
    return !!(s && s.aborted);
  }

  function record(ep, ms, ok, status, method, url) {
    try {
      statsBuf.push({ t: Date.now(), ep: ep, ms: ms, ok: !!ok,
                      status: status || 0, method: method, url: url });
      if (statsBuf.length > 100) statsBuf.shift();
    } catch (e) {}
  }

  /* --------------------------- 重试资格 ---------------------------
     GET/HEAD/OPTIONS 无 body → 幂等；
     POST 仅白名单路径（含只读 RPC 与 fs-chat 的只读 action）可重试。 */
  function retryablePost(path, init, isRequest, input) {
    var i;
    for (i = 0; i < RETRY_POST.length; i++) {
      if (path.indexOf(RETRY_POST[i]) === 0) return true;
    }
    for (i = 0; i < RETRY_RPC.length; i++) {
      if (path.indexOf(RETRY_RPC[i]) === 0) return true;
    }
    if (path.indexOf('/functions/v1/fs-chat') === 0) {
      var body = '';
      try {
        body = (init && typeof init.body === 'string') ? init.body
             : (isRequest && input && typeof input.body === 'string') ? input.body : '';
      } catch (e) {}
      return FS_CHAT_READ.test(body);
    }
    return false;
  }

  /* ---------------------------- 请求主体 ---------------------------- */
  function attempt(input, init, ctx, tried) {
    var ep = endpointFor(ctx.url);
    var target = rewrite(ctx.url, ep) || ctx.url;
    var t = withTimeout(init, ctx.isRequest, input,
                        ctx.method === 'GET' ? TIMEOUT_GET : TIMEOUT_WRITE);
    var t0 = Date.now();
    var call;
    try {
      if (ctx.isRequest) {
        call = _raw(new Request(target, input), { signal: t.signal });
      } else {
        var merged = {};
        if (init) {
          for (var k in init) {
            if (Object.prototype.hasOwnProperty.call(init, k)) merged[k] = init[k];
          }
        }
        merged.signal = t.signal;
        call = _raw(target, merged);
      }
    } catch (e) {
      t.cleanup();
      return Promise.reject(e);
    }

    return call.then(function (res) {
      t.cleanup();
      record(ep, Date.now() - t0, res.ok, res.status, ctx.method, ctx.url);
      if (res.status >= 500) markFail(ep); else markOk(ep);

      // 拿到响应就说明链路通：4xx（密码错、无权限等）绝不重试。
      // 只有 5xx 且属只读请求，才换端点再试一次。
      if (res.status >= 500 && ctx.retryable && endpoints.length > 1 && tried < 1) {
        if (switchEndpoint()) return attempt(input, init, ctx, tried + 1);
      }
      return res;
    }).catch(function (err) {
      t.cleanup();
      record(ep, Date.now() - t0, false, 0, ctx.method, ctx.url);
      markFail(ep);
      var aborted = callerAborted(init, ctx.isRequest, input);

      // 无论能否重试，都把活跃端点切走，让「下一次」请求走好路。
      if (!aborted && endpoints.length > 1) switchEndpoint();

      // 超时（可能已送达服务端）与写操作一律不重试，避免重复副作用。
      if (!aborted && !t.state.fired && ctx.retryable &&
          endpoints.length > 1 && tried < 1) {
        return attempt(input, init, ctx, tried + 1);
      }
      throw err;
    });
  }

  /* --------------------------- fetch 包装 --------------------------- */
  window.fetch = function (input, init) {
    var isRequest = (typeof input !== 'string') && !!(input && input.url);
    var url = isRequest ? input.url : (typeof input === 'string' ? input : '');
    if (!url || !isOurRequest(url)) return _raw(input, init);

    var method = 'GET';
    try {
      if (init && init.method) method = String(init.method).toUpperCase();
      else if (isRequest && input.method) method = String(input.method).toUpperCase();
    } catch (e) {}

    var hasBody = false;
    try {
      hasBody = (!!(init && init.body != null)) ||
                (isRequest && !!(input.body != null));
    } catch (e) {}

    var path = pathOf(url);
    var idempotent = (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') && !hasBody;
    var retryable = idempotent ||
      (method === 'POST' && retryablePost(path, init, isRequest, input));

    return attempt(input, init, {
      url: url, method: method, isRequest: isRequest, retryable: retryable
    }, 0);
  };

  /* --------------------------- 端点竞速 ---------------------------
     用 _raw 直连避免递归包装；只带 apikey 做匿名读，不携带用户 token。
     30 分钟内不重复探测，避免 38 个页面每开一页都发探针。 */
  function probe(force) {
    if (endpoints.length < 2) return;
    try {
      var last = parseInt(localStorage.getItem(LS_PROBE_AT) || '0', 10) || 0;
      if (!force && Date.now() - last < PROBE_COOL_MS) return;
      localStorage.setItem(LS_PROBE_AT, String(Date.now()));
    } catch (e) {}

    var winner = false;
    endpoints.forEach(function (ep) {
      var ctrl = new AbortController();
      var to = setTimeout(function () { ctrl.abort(); }, PROBE_TIMEOUT);
      var t0 = Date.now();
      try {
        _raw(ep + PROBE_PATH, {
          method: 'GET', headers: { 'apikey': ANON }, signal: ctrl.signal
        }).then(function (r) {
          clearTimeout(to);
          record(ep, Date.now() - t0, r.ok, r.status, 'PROBE', 'probe');
          if (r.ok && !winner) { winner = true; markOk(ep); saveActive(ep); }
          else if (r.status >= 500) markFail(ep);
          else markOk(ep);
        }).catch(function () {
          clearTimeout(to);
          // 探针超时不等于端点坏了（反代冷启动常见），交给真实请求裁决。
          record(ep, Date.now() - t0, false, 0, 'PROBE', 'probe');
        });
      } catch (e) { clearTimeout(to); }
    });
  }

  /* --------------------------- 对外接口 --------------------------- */
  window.FS_NET = {
    version: '1.0',
    endpoints: function () { return endpoints.slice(); },
    active: function () { return currentEp(); },
    stats: function () { return statsBuf.slice(); },
    primary: PRIMARY,
    probe: function () { probe(true); },
    setEndpoints: function (list) {
      try { localStorage.setItem(LS_ENDPOINTS, JSON.stringify(list)); } catch (e) {}
      endpoints = readEndpoints();
      activeEp = readActive();
      probe(true);
      return endpoints.slice();
    },
    reset: function () {
      try {
        localStorage.removeItem(LS_ACTIVE);
        localStorage.removeItem(LS_PROBE_AT);
      } catch (e) {}
      activeEp = endpoints[0];
      probe(true);
    }
  };

  // 脚本加载即发起竞速，不延迟到 load：chat/ / admin/ 的换票请求会立刻发出。
  probe(false);
})();
