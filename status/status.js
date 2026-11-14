/* ============================================================
   服务状态（status/）页面逻辑
   - 只读：GET /functions/v1/fs-status（公开只读代理，前端不持有任何监控密钥）
   - 不写库、不改配置；接口异常时明确降级，绝不假装「一切正常」
   - 全 ES5 兼容写法，所有插值 escapeHtml，URL 协议白名单
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
  var ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
  var API = SUPABASE_URL + '/functions/v1/fs-status';
  var REFRESH_MS = 60000;

  var $ = function (id) { return document.getElementById(id); };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function safeHref(u) {
    var s = String(u || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }

  function fmtTime(ts) {
    var d = new Date(Number(ts) * 1000);
    if (isNaN(d.getTime())) return '—';
    try {
      return d.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      });
    } catch (e) { return d.toLocaleString(); }
  }

  function fmtIso(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    try {
      return d.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit',
        second: '2-digit', hour12: false
      });
    } catch (e) { return d.toLocaleString(); }
  }

  function pct(v) {
    if (v == null || !isFinite(Number(v))) return '—';
    return Number(v).toFixed(2) + '%';
  }

  function ms(v) {
    if (v == null || !isFinite(Number(v))) return '—';
    return Math.round(Number(v)) + ' ms';
  }

  // UptimeRobot 的 interval 单位是「秒」，不是分钟
  function intervalText(v) {
    var n = Number(v);
    if (!(n > 0)) return '—';
    if (n < 60) return n + ' 秒';
    if (n < 3600) return Math.round(n / 60) + ' 分钟';
    return (n / 3600).toFixed(1) + ' 小时';
  }

  function renderOverview(d) {
    var sum = d.summary || {};
    var total = Number(sum.total || (d.services || []).length || 0);
    var up = Number(sum.up || 0);
    var issues = Number(sum.issues || 0);
    var allOk = !!sum.all_ok && !d.partial;
    var box = $('stsOverview');
    if (!box) return;

    box.innerHTML =
      '<div class="sts-ov-card' + (allOk ? '' : ' is-bad') + '">' +
        '<div class="sts-ov-label">整体状态</div>' +
        '<div class="sts-ov-value ' + (allOk ? 'is-good' : '') + '">' +
          (allOk ? '全部正常' : (d.partial && !issues ? '部分未知' : '需关注')) +
        '</div>' +
      '</div>' +
      '<div class="sts-ov-card">' +
        '<div class="sts-ov-label">在线服务</div>' +
        '<div class="sts-ov-value">' + up + ' / ' + total + '</div>' +
      '</div>' +
      '<div class="sts-ov-card' + (issues ? ' is-bad' : '') + '">' +
        '<div class="sts-ov-label">异常 / 需关注</div>' +
        '<div class="sts-ov-value">' + issues + '</div>' +
      '</div>' +
      '<div class="sts-ov-card">' +
        '<div class="sts-ov-label">数据生成于</div>' +
        '<div class="sts-ov-value">' + esc(fmtIso(d.generated_at)) + '</div>' +
      '</div>';
  }

  function renderBars(s) {
    var rts = (s && s.response_times) || [];
    if (!rts.length) return '<div class="sts-bars-empty">暂无响应时间样本</div>';
    var max = 1, i;
    for (i = 0; i < rts.length; i++) {
      max = Math.max(max, Number(rts[i].ms) || 0);
    }
    var down = s.state === 'down' || s.state === 'seems_down';
    var h = '';
    for (i = 0; i < rts.length; i++) {
      var v = Number(rts[i].ms) || 0;
      var pctH = Math.max(8, Math.round(v / max * 100));
      h += '<span class="sts-bar' + (down ? ' is-down' : '') + '" style="height:' + pctH + '%" ' +
           'title="' + esc(fmtTime(rts[i].t)) + ' · ' + esc(ms(v)) + '"></span>';
    }
    return '<div class="sts-bars">' + h + '</div>';
  }

  function renderEvents(s) {
    var evs = (s && s.events) || [];
    var h = '<div class="sts-events-title">近期事件</div>';
    if (!evs.length) return h + '<div class="sts-bars-empty">近期没有故障记录</div>';
    for (var i = 0; i < Math.min(evs.length, 3); i++) {
      var e = evs[i];
      var type = String(e.type_text || '事件');
      var isDown = Number(e.type) === 1;
      h += '<div class="sts-event">' +
             '<span class="sts-event-time">' + esc(fmtTime(e.t)) + '</span>' +
             '<span class="sts-event-type' + (isDown ? ' is-down' : '') + '">' + esc(type) + '</span>' +
             (e.reason ? '<span>' + esc(e.reason) + '</span>' : '') +
           '</div>';
    }
    return h;
  }

  function renderService(s) {
    var state = String(s.state || 'unknown');
    var text = String(s.status_text || '未知');
    var label = String(s.label || s.name || '服务');
    var name = String(s.name || '');
    var href = safeHref(s.url);
    var urlText = name || String(s.url || '');
    var up = s.uptime || {};

    var urlHtml = href
      ? '<a class="sts-svc-url" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' +
          esc(urlText) + ' ↗</a>'
      : '<span class="sts-svc-url">' + esc(urlText) + '</span>';

    var errHtml = s.error
      ? '<div class="sts-svc-error">' + esc(s.error) + '</div>'
      : '';

    // 字段缺失（接口部分失败）时，指标显示占位而不是编造 0
    var hasData = s.status != null && s.uptime_all != null;
    var metrics = hasData
      ? '<div class="sts-metrics">' +
          '<div class="sts-metric"><span class="sts-metric-label">全天可用率</span><span class="sts-metric-value">' + esc(pct(s.uptime_all)) + '</span></div>' +
          '<div class="sts-metric"><span class="sts-metric-label">近 7 天</span><span class="sts-metric-value">' + esc(pct(up.d7)) + '</span></div>' +
          '<div class="sts-metric"><span class="sts-metric-label">平均响应</span><span class="sts-metric-value">' + esc(ms(s.avg_ms)) + '</span></div>' +
          '<div class="sts-metric"><span class="sts-metric-label">探测间隔</span><span class="sts-metric-value">' + esc(intervalText(s.interval)) + '</span></div>' +
        '</div>'
      : '';

    return '<article class="sts-svc" data-state="' + esc(state) + '">' +
      '<div class="sts-svc-head">' +
        '<div class="sts-svc-title">' +
          '<span class="sts-svc-label">' + esc(label) + '</span>' + urlHtml +
        '</div>' +
        '<span class="sts-badge" data-state="' + esc(state) + '">' + esc(text) + '</span>' +
      '</div>' +
      metrics + errHtml +
      (hasData ? '<div class="sts-spark"><div class="sts-spark-head">最近响应时间 · 均值 <b>' + esc(ms(s.avg_ms)) + '</b></div>' + renderBars(s) + '</div>' : '') +
      (hasData ? '<div class="sts-events">' + renderEvents(s) + '</div>' : '') +
    '</article>';
  }

  function renderError(msg) {
    var box = $('stsServices');
    if (!box) return;
    box.innerHTML = '<div class="sts-error">' +
      '<p class="sts-error-title">状态服务暂不可用</p>' +
      '<p class="sts-error-detail">没能取到监控数据，这里不会显示假的状态。可以稍后重试，或稍等几分钟再看。</p>' +
      '<p class="sts-error-detail">原因：' + esc(msg) + '</p>' +
      '<button class="act-btn small" id="stsRetry" type="button">重试</button>' +
      '</div>';
    var btn = $('stsRetry');
    if (btn) btn.addEventListener('click', load);
    var ov = $('stsOverview');
    if (ov) ov.innerHTML = '';
    var up = $('stsUpdated');
    if (up) up.textContent = '加载失败';
  }

  var loading = false;
  function load() {
    if (loading) return;
    loading = true;
    var btn = $('stsRefresh');
    if (btn) { btn.disabled = true; btn.textContent = '刷新中…'; }
    var up = $('stsUpdated');
    if (up) up.textContent = '正在获取状态…';

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
    var opts = { headers: { 'apikey': ANON_KEY } };
    if (ctrl) opts.signal = ctrl.signal;

    fetch(API, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      clearTimeout(timer);
      if (!d || d.ok !== true) throw new Error((d && d.error) || '返回数据格式异常');
      renderOverview(d);
      var box = $('stsServices');
      var list = (d.services || []);
      if (box) {
        box.innerHTML = list.length
          ? list.map(renderService).join('')
          : '<div class="sts-bars-empty">监控接口没有返回任何服务</div>';
      }
      if (up) {
        up.textContent = '更新于 ' + fmtIso(d.generated_at) +
          (d.partial ? ' · 部分服务数据缺失' : ' · 北京时间');
      }
    }).catch(function (e) {
      clearTimeout(timer);
      renderError(e && e.name === 'AbortError' ? '请求超时' : String((e && e.message) || e));
    }).then(function () {
      // 兼容不支持 finally 的老浏览器
      loading = false;
      var b = $('stsRefresh');
      if (b) { b.disabled = false; b.textContent = '刷新'; }
    });
  }

  function boot() {
    var y = $('footYear');
    if (y) y.textContent = String(new Date().getFullYear());
    var b = $('stsRefresh');
    if (b) b.addEventListener('click', load);
    load();
    setInterval(function () {
      if (!document.hidden) load();
    }, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
