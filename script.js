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
    { name: '数据可视化', desc: '用原生 Canvas / SVG 讲故事', tags: ['Chart', '待补充'], href: '#' }
  ],
  // 工具箱树（由数组配置驱动渲染）
  toolTree: [
    {
      name: '我的世界',
      children: [
        { name: '基岩版', children: [
          { name: '矿石查找器', href: '#', note: '链接待补充' }
        ]}
      ]
    }
  ]
};

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- 渲染格言 ---------- */
function renderMottos() {
  const motto = $('#motto');
  const hero = $('#heroMotto');
  if (motto) motto.textContent = CONFIG.mottos.join(' ');
  if (hero) hero.textContent = CONFIG.mottos[0];
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
    a.innerHTML = `<span class="label">${node.name}</span>${node.note ? `<span class="note">${node.note}</span>` : ''}`;
    li.appendChild(a);
  }
  return li;
}
function renderToolTree() {
  const box = $('#toolTree');
  if (!box) return;
  const ul = document.createElement('ul');
  ul.className = 'tree-root';
  CONFIG.toolTree.forEach(n => ul.appendChild(renderTreeNode(n)));
  box.appendChild(ul);
}

/* ---------- 分类 accordion 展开/收起 ---------- */
function bindCats() {
  document.querySelectorAll('.cat-title').forEach(btn => {
    const cat = btn.closest('.cat');
    btn.addEventListener('click', () => {
      const open = cat.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  });
}

/* ---------- 侧栏折叠（窄条 + localStorage 持久化） ---------- */
function bindCollapse() {
  const sb = $('#sidebar');
  const btn = $('#collapseBtn');
  if (localStorage.getItem('sidebar-collapsed') === '1') sb.classList.add('collapsed');
  btn.addEventListener('click', () => {
    const collapsed = sb.classList.toggle('collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
  });
}

/* ---------- 主题切换（Standard / Liquid Glass + localStorage） ---------- */
function bindTheme() {
  const btn = $('#themeBtn');
  const saved = localStorage.getItem('theme') || 'standard';
  applyTheme(saved);
  btn.addEventListener('click', () => {
    const next = document.body.classList.contains('theme-glass') ? 'standard' : 'glass';
    applyTheme(next);
    localStorage.setItem('theme', next);
  });
}
function applyTheme(t) {
  document.body.classList.toggle('theme-glass', t === 'glass');
}

/* ---------- 移动端抽屉 + 遮罩 ---------- */
function bindMobile() {
  const sb = $('#sidebar');
  const menu = $('#menuBtn');
  const overlay = $('#overlay');
  const open = () => { sb.classList.add('open-drawer'); overlay.hidden = false; menu.setAttribute('aria-expanded', 'true'); };
  const close = () => { sb.classList.remove('open-drawer'); overlay.hidden = true; menu.setAttribute('aria-expanded', 'false'); };
  menu.addEventListener('click', open);
  overlay.addEventListener('click', close);
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
  bindCats();
  bindCollapse();
  bindTheme();
  bindMobile();
  hideLoader();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
