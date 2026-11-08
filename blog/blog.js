/* ============================================================
   博客 & 项目公告（blog/）前台逻辑
   - 数据：REST 公开读 fs_posts（只放行 published=true）与 fs_announcements
   - 写：全部由 /admin/ 走 fs-blog / fs-notify，本页零写权限
   - Markdown：自写轻量渲染器，所有文本先 escapeHtml 再拼标签，
     链接只允许 http/https 与站内相对路径，杜绝 XSS / javascript:
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://yowwyasttkywyqgseuqz.supabase.co';
const ANON_KEY = 'sb_publishable_j4rpi2ejPTMGxo79uaaX3g_kQYrinS4';
const REST = SUPABASE_URL + '/rest/v1';
const $ = (s, r = document) => r.querySelector(s);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function fmtDate(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  } catch (e) { return ''; }
}
function fmtDateTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return fmtDate(iso) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  } catch (e) { return ''; }
}

/* 链接白名单：只放行 http/https 与站内相对路径；挡 javascript:/data:/协议相对地址 */
function safeHref(raw) {
  try {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^(javascript|data|vbscript|file|blob):/i.test(s)) return '';
    if (/^\/\//.test(s)) return '';               // 协议相对地址，防开放重定向
    if (/^https?:\/\//i.test(s)) {
      const p = new URL(s, location.href);
      return (p.protocol === 'http:' || p.protocol === 'https:') ? p.href : '';
    }
    if (/^(\/|\.\/|\.\.\/|#|\?)/.test(s)) return s;
    if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/|$)/i.test(s) && s.indexOf(':') < 0) return 'https://' + s;
    return '';
  } catch (e) { return ''; }
}

/* 行内 Markdown：输入先整体转义，再做替换，替换产物只含受控标签 */
function inlineMd(text) {
  let s = escapeHtml(text);
  const codes = [];
  // 用转义写法 \u0001 占位（源码里绝不能出现字面控制字符）
  s = s.replace(/`([^`]+)`/g, (m, c) => {
    codes.push('<code class="md-code">' + c + '</code>');
    return '\u0001' + (codes.length - 1) + '\u0001';
  });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const h = safeHref(url);
    return h ? '<img class="md-img" src="' + escapeHtml(h) + '" alt="' + alt + '" loading="lazy" referrerpolicy="no-referrer" />' : alt;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const h = safeHref(url);
    if (!h) return label;
    const ext = /^https?:\/\//i.test(h);
    return '<a href="' + escapeHtml(h) + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + label + '</a>';
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => codes[Number(i)] || '');
  return s;
}

/* ---------- GFM 表格辅助 ----------
   单元格永远经 inlineMd()（先 escapeHtml 再拼受控标签），
   对齐值只映射白名单 class，绝不把用户输入拼进属性或事件。 */
function tableCells(line) {
  let s = String(line || '').trim();
  if (s.charAt(0) === '|') s = s.slice(1);
  if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
  // 占位符用转义写法，源码里不出现字面控制字符
  s = s.replace(/\\\|/g, '\u0002');
  return s.split('|').map(c => c.replace(/\u0002/g, '|').trim());
}
function tableSep(line) {
  const raw = String(line || '');
  if (raw.indexOf('|') < 0) return null;
  const cells = tableCells(raw);
  if (!cells.length || cells.some(c => !/^:?-{1,}:?$/.test(c))) return null;
  return cells.map(c => {
    const l = c.charAt(0) === ':', r = c.charAt(c.length - 1) === ':';
    return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
  });
}
function renderTable(head, aligns, rows) {
  const n = aligns.length;
  const cls = a => a ? ' class="md-align-' + a + '"' : '';
  let h = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
  for (let j = 0; j < n; j++) {
    h += '<th' + cls(aligns[j]) + '>' + inlineMd(head[j] || '') + '</th>';
  }
  h += '</tr></thead><tbody>';
  for (const row of rows) {
    h += '<tr>';
    for (let j = 0; j < n; j++) {
      h += '<td' + cls(aligns[j]) + '>' + inlineMd(row[j] || '') + '</td>';
    }
    h += '</tr>';
  }
  return h + '</tbody></table></div>';
}

/* 块级 Markdown：标题 / 段落 / 列表 / 引用 / 代码块 / 表格 / 分割线 */
function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], listType = '', i = 0;
  function flushPara() {
    if (para.length) { out.push('<p>' + inlineMd(para.join(' ')) + '</p>'); para = []; }
  }
  function flushList() {
    if (listType) { out.push('</' + listType + '>'); listType = ''; }
  }
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara(); flushList();
      const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre class="md-pre"><code>' + escapeHtml(buf.join('\n')) + '</code></pre>');
      continue;
    }
    if (/^\s*$/.test(line)) { flushPara(); flushList(); i++; continue; }

    /* 表格：表头行 + 紧随的分隔行（| --- | :---: | ---: |），列数必须一致 */
    if (i + 1 < lines.length && String(line).indexOf('|') >= 0) {
      const aligns = tableSep(lines[i + 1]);
      const head = tableCells(line);
      if (aligns && head.length === aligns.length) {
        flushPara(); flushList();
        i += 2;
        const rows = [];
        while (i < lines.length) {
          const ln = lines[i];
          if (/^\s*$/.test(ln) || String(ln).indexOf('|') < 0) break;
          rows.push(tableCells(ln));
          i++;
        }
        out.push(renderTable(head, aligns, rows));
        continue;
      }
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      const lv = h[1].length;
      out.push('<h' + lv + '>' + inlineMd(h[2]) + '</h' + lv + '>');
      i++; continue;
    }
    if (/^\s*([-*_]\s*){3,}$/.test(line)) { flushPara(); flushList(); out.push('<hr />'); i++; continue; }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { flushPara(); flushList(); out.push('<blockquote class="md-quote">' + inlineMd(q[1]) + '</blockquote>'); i++; continue; }
    const li = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const type = /^\d/.test(li[1]) ? 'ol' : 'ul';
      if (listType !== type) { flushList(); out.push('<' + type + '>'); listType = type; }
      out.push('<li>' + inlineMd(li[2]) + '</li>');
      i++; continue;
    }
    flushList();
    para.push(line);
    i++;
  }
  flushPara(); flushList();
  return out.join('\n');
}

async function restGet(path) {
  const res = await fetch(REST + path, {
    headers: { 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + ANON_KEY }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data)) throw new Error('HTTP ' + res.status);
  return data;
}

function renderError(box, msg) {
  if (box) box.innerHTML = '<div class="blog-empty">' + escapeHtml(msg) + '</div>';
}

/* ---------- 项目公告 ---------- */
async function loadAnnouncements() {
  const box = $('#annList');
  if (!box) return;
  try {
    const list = await restGet('/fs_announcements' +
      '?select=id,title,body,created_at,mailed_count&order=created_at.desc&limit=10');
    if (!list.length) {
      box.innerHTML = '<div class="blog-empty">暂时还没有公告，等管理员发第一条 📭</div>';
      return;
    }
    box.innerHTML = list.map(a =>
      '<article class="blog-ann">' +
        '<div class="blog-ann-top"><b>' + escapeHtml(a.title) + '</b>' +
          '<time>' + escapeHtml(fmtDateTime(a.created_at)) + '</time></div>' +
        '<div class="blog-ann-body">' + escapeHtml(a.body).replace(/\n/g, '<br />') + '</div>' +
        '<div class="blog-ann-foot">' + (Number(a.mailed_count) > 0
          ? '📧 已同步邮件给 ' + Number(a.mailed_count) + ' 位订阅用户'
          : '📭 站内公告') + '</div>' +
      '</article>').join('');
  } catch (e) { renderError(box, '公告暂时读不到，稍后再试'); }
}

/* ---------- 文章列表 ---------- */
async function loadPosts() {
  const box = $('#postList'), count = $('#postCount');
  if (!box) return;
  try {
    const list = await restGet('/fs_posts' +
      '?select=id,slug,title,summary,created_at&published=eq.true&order=created_at.desc&limit=100');
    if (count) count.textContent = list.length + ' 篇';
    if (!list.length) {
      box.innerHTML = '<div class="blog-empty">还没有已发布的文章，稍后再来看看 ✍️</div>';
      return;
    }
    box.innerHTML = list.map(p => {
      const href = './?p=' + encodeURIComponent(p.slug);
      return '<article class="blog-post">' +
        '<div class="blog-post-top">' +
          '<a class="blog-post-title" href="' + href + '">' + escapeHtml(p.title) + '</a>' +
          '<time>' + escapeHtml(fmtDate(p.created_at)) + '</time>' +
        '</div>' +
        (p.summary ? '<p class="blog-post-sum">' + escapeHtml(p.summary) + '</p>' : '') +
        '<a class="blog-post-more" href="' + href + '">阅读全文 →</a>' +
      '</article>';
    }).join('');
  } catch (e) { renderError(box, '文章暂时读不到，稍后再试'); }
}

/* ---------- 文章详情 ---------- */
async function loadPost(slug) {
  const box = $('#postView');
  if (!box) return;
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
    box.innerHTML = '<div class="blog-empty">文章地址不合法</div>';
    return;
  }
  try {
    const list = await restGet('/fs_posts' +
      '?select=id,slug,title,summary,content,created_at,updated_at' +
      '&slug=eq.' + encodeURIComponent(slug) + '&published=eq.true&limit=1');
    if (!list.length) {
      box.innerHTML = '<div class="blog-empty">这篇文章不存在，或者还没发布</div>';
      return;
    }
    const p = list[0];
    document.title = p.title + ' · 博客 · FeSui';
    box.innerHTML =
      '<h1 class="blog-post-h1">' + escapeHtml(p.title) + '</h1>' +
      '<div class="blog-meta">发布于 ' + escapeHtml(fmtDateTime(p.created_at)) +
        (p.updated_at && p.updated_at !== p.created_at
          ? ' · 更新于 ' + escapeHtml(fmtDateTime(p.updated_at)) : '') +
        ' · <code>/blog/?p=' + escapeHtml(p.slug) + '</code></div>' +
      (p.summary ? '<p class="blog-post-summary">' + escapeHtml(p.summary) + '</p>' : '') +
      '<div class="md-body">' + renderMarkdown(p.content) + '</div>';
  } catch (e) { renderError(box, '文章暂时读不到，稍后再试'); }
}

/* ---------- 启动 ---------- */
(async function init() {
  const y = $('#footYear');
  if (y) y.textContent = new Date().getFullYear();
  const slug = new URLSearchParams(location.search).get('p') || '';
  await Promise.all([loadAnnouncements(), loadPosts()]);
  if (slug) {
    const listCard = $('#listCard'), postCard = $('#postCard');
    if (listCard) listCard.hidden = true;
    if (postCard) postCard.hidden = false;
    await loadPost(slug);
  }
})();
