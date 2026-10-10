'use strict';

/* ============================================================
   个人主页交互脚本（原生 ES6+，零依赖）
   配置数据集中在 CONFIG，后续增删改在此处即可。
   ============================================================ */

const CONFIG = {
  // 个人格言（1-3 句，中文为主，契合「极客 + MC 玩家」双身份）
  mottos: [
    '在红石电路与代码逻辑的交界，我既是建筑师，也是工程师。',
    '不执拗，也不将就——每一座方块、每一行代码，都该有它的道理。',
    '世界是开放的沙盒，而我乐此不疲地编辑它。'
  ],
  // 项目导航占位卡片（统一标注「待补充」）
  projects: [
    { name: '红石自动化实验室', desc: '基于 Minecraft 红石与真实电路原理的自动化演示', tags: ['Minecraft', '待补充'], href: '#' },
    { name: '终端工具箱', desc: '一组零依赖的命令行小工具', tags: ['CLI', '待补充'], href: '#' },
    { name: '静态站点生成器', desc: '纯前端、无构建步骤的极简建站方案', tags: ['Web', '待补充'], href: '#' },
    { name: '数据可视化', desc: '用原生 Canvas / SVG 讲故事', tags: ['Chart', '待补充'], href: '#' },
    { name: 'FKD 服务器主页', desc: 'FKD 游戏服务器官方网站', tags: ['Minecraft', '服务器'], href: 'https://FKD.是.gay', target: '_blank' }
  ],
  // 工具箱树（由数组配置驱动渲染）
  toolTree: [
    {
      name: '我的世界',
      children: [
        { name: '基岩版', children: [
          { name: '矿石查找器', href: './tools/ore-finder.html', target: '_blank', note: '基岩版矿石分布预测' }
        ]}
      ]
    }
  ],
  // 彩蛋按钮预设链接（待补充；空数组时按钮会提示）
  eggLinks: [
    // { title: '示例站点', url: 'https://example.com' }
  ]
};

// 各视图的标题与副标题（随导航切换）
const VIEW_META = {
  info:  { title: '个人信息', sub: '极客与 Minecraft 玩家之间，我是 FeSui。' },
  proj:  { title: '项目导航', sub: '正在搭建与维护中的一些作品。' },
  tools: { title: '工具箱',   sub: '自用小工具，按需取用。' }
};

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- 渲染格言 ---------- */
function renderMottos() {
  const m = $('#motto');
  if (m) m.textContent = CONFIG.mottos.join(' ');
}

/* ---------- 渲染项目卡片 ---------- */
function renderProjects() {
  const box = $('#projectList');
  if (!box) return;
  const frag = document.createDocumentFragment();
  CONFIG.projects.forEach(p => {
    const a = document.createElement('a');
    a.className = 'proj-card';
    a.href = p.href;
    if (p.target) { a.target = p.target; a.rel = 'noopener noreferrer'; }
    const tags = p.tags.map(t => `<span class="tag">${t}</span>`).join('');
    a.innerHTML = `<h4>${p.name}</h4><p>${p.desc}</p><div class="tags">${tags}</div>`;
    frag.appendChild(a);
  });
  box.appendChild(frag);
}

/* ---------- 渲染工具箱树 ---------- */
function renderTreeNode(node) {
  const li = document.createElement('li');
  li.className = 'tree-item';
  if (node.children && node.children.length) {
    const btn = document.createElement('button');
    btn.className = 'tree-folder';
    btn.type = 'button';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `<span class="arrow">▸</span><span class="label">${node.name}</span>`;
    const ul = document.createElement('ul');
    ul.className = 'tree-children';
    ul.hidden = true;
    node.children.forEach(c => ul.appendChild(renderTreeNode(c)));
    btn.addEventListener('click', () => {
      const open = ul.hidden;
      ul.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    li.appendChild(btn);
    li.appendChild(ul);
  } else {
    const a = document.createElement('a');
    a.className = 'tree-leaf';
    a.href = node.href || '#';
    if (node.target) { a.target = node.target; a.rel = 'noopener'; }
    a.innerHTML = `<span class="label">${node.name}</span>${node.note ? `<span class="note">${node.note}</span>` : ''}`;
    li.appendChild(a);
  }
  return li;
}
function renderToolTree() {
  const box = $('#toolTree');
  if (!box) return;
  const ul = document.createDocumentFragment();
  const root = document.createElement('ul');
  root.className = 'tree-root';
  CONFIG.toolTree.forEach(n => root.appendChild(renderTreeNode(n)));
  ul.appendChild(root);
  box.appendChild(ul);
}

/* ---------- 视图切换：侧栏仅导航，主区展示对应内容 ---------- */
function switchView(view) {
  if (!VIEW_META[view]) view = 'info';
  document.querySelectorAll('.nav-item').forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('.view').forEach(s => { s.hidden = s.dataset.view !== view; });
  const meta = VIEW_META[view];
  const t = $('#viewTitle'); if (t) t.textContent = meta.title;
  const s = $('#viewSub');   if (s) s.textContent = meta.sub;
  // 桌面端：点击导航后侧栏收起为窄条；移动端靠抽屉关闭处理
  const sb = $('#sidebar');
  if (sb && window.innerWidth > 767) sb.classList.add('collapsed');
  try { localStorage.setItem('view', view); } catch (e) {}
}

/* ---------- 导航绑定 ---------- */
function bindNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.view);
      if (drawerClose) drawerClose();   // 移动端：切换后关闭抽屉
    });
  });
}

/* ---------- 侧栏折叠（窄条 + localStorage 持久化） ---------- */
function bindCollapse() {
  const sb = $('#sidebar');
  const btn = $('#collapseBtn');
  if (!sb || !btn) return;
  if (localStorage.getItem('sidebar-collapsed') === '1') sb.classList.add('collapsed');
  btn.addEventListener('click', () => {
    const collapsed = sb.classList.toggle('collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
  });
}

/* ---------- 主题切换（Standard / Liquid Glass + localStorage） ---------- */
function bindTheme() {
  const saved = localStorage.getItem('theme') || 'standard';
  applyTheme(saved);
  document.querySelectorAll('#themeBtn, #sidebarThemeBtn').forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const next = document.body.classList.contains('theme-glass') ? 'standard' : 'glass';
      applyTheme(next);
      localStorage.setItem('theme', next);
    });
  });
}
function applyTheme(t) {
  document.body.classList.toggle('theme-glass', t === 'glass');
}

/* ---------- 彩蛋按钮：随机跳转到预设链接 ---------- */
function bindEgg() {
  const btn = $('#eggBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const links = CONFIG.eggLinks || [];
    if (!links.length) {
      btn.textContent = '预设链接待补充…';
      setTimeout(() => {
        btn.innerHTML = '<span class="egg-ico" aria-hidden="true">🎲</span><span class="egg-label">来点惊喜</span>';
      }, 1200);
      return;
    }
    const pick = links[Math.floor(Math.random() * links.length)];
    const url = pick.url || '#';
    btn.disabled = true;
    btn.innerHTML = '<span class="egg-ico" aria-hidden="true">🎲</span><span class="egg-label">传送中…</span>';
    setTimeout(() => {
      if (url !== '#') window.open(url, '_blank', 'noopener,noreferrer');
      btn.disabled = false;
      btn.innerHTML = '<span class="egg-ico" aria-hidden="true">🎲</span><span class="egg-label">再来一次</span>';
    }, 500);
  });
}

/* ---------- 移动端抽屉 + 遮罩 ---------- */
let drawerClose = null;
function bindMobile() {
  const sb = $('#sidebar');
  const menu = $('#menuBtn');
  const overlay = $('#overlay');
  if (!sb || !menu || !overlay) return;
  const open = () => { sb.classList.add('open-drawer'); overlay.hidden = false; menu.setAttribute('aria-expanded', 'true'); };
  drawerClose = () => { sb.classList.remove('open-drawer'); overlay.hidden = true; menu.setAttribute('aria-expanded', 'false'); };
  menu.addEventListener('click', open);
  overlay.addEventListener('click', drawerClose);
}

/* ---------- 加载动画淡出 ---------- */
function hideLoader() {
  const l = $('#loader');
  if (!l) return;
  l.classList.add('done');
  setTimeout(() => l.remove(), 400);
}

/* ---------- 初始化 ---------- */
function init() {
  renderMottos();
  renderProjects();
  renderToolTree();
  bindNav();
  bindCollapse();
  bindTheme();
  bindEgg();
  bindMobile();
  // 恢复上次视图（默认个人信息）
  let v = 'info';
  try { v = localStorage.getItem('view') || 'info'; } catch (e) {}
  switchView(v);
  hideLoader();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
