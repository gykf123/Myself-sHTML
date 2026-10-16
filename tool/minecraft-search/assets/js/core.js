/* ==========================================================================
   core.js — 共享运行时：i18n / 主题 / 布局 / 搜索 / 数据加载 / 工具函数
   无框架、无依赖，全部以 ES Module 提供。
   ========================================================================== */

/* 子目录部署适配：本站整体挂在宿主站子目录下（如 /tool/minecraft-search/），
   以本文件位置（assets/js/）上跳两级得到子站根，站内链接统一走相对解析，
   与页面所在深度无关。 */
const _SITE_ROOT = new URL('../../', import.meta.url);
const rel = p => new URL(String(p).replace(/^\//, ''), _SITE_ROOT).href;

export const SITE = {
  name: { zh: 'Minecraft 搜索', en: 'Minecraft Search' },
  tagline: {
    zh: '查找任意 Minecraft 物品、生物、方块或生物群系',
    en: 'Find any Minecraft item, mob, block or biome',
  },
  // 版本口径（与算法内核支持的版本对齐）
  versions: {
    java: ['1.21', '1.20', '1.19', '1.18', '1.17', '1.16'],
    bedrock: ['1.21', '1.20', '1.19', '1.18', '1.17', '1.16'],
  },
};

/* ------------------------------------------------------------------ i18n */
const DICT = {
  zh: {
    'nav.home': '首页', 'nav.tools': '工具', 'nav.items': '参考库', 'nav.seeds': '精选种子',
    'nav.blocks': '方块', 'nav.mobs': '生物', 'nav.biomes': '群系', 'nav.enchant': '附魔',
    'act.search': '搜索物品、方块、生物、群系…', 'act.theme': '切换主题', 'act.lang': '切换语言',
    'act.copy': '复制', 'act.copied': '已复制', 'act.reset': '重置', 'act.retry': '重试',
    'act.open': '打开', 'act.close': '关闭', 'act.share': '分享', 'act.fullscreen': '全屏',
    'common.loading': '加载中…', 'common.noResults': '没有匹配结果', 'common.all': '全部',
    'common.edition': '版本类型', 'common.java': 'Java 版', 'common.bedrock': '基岩版',
    'common.version': '游戏版本', 'common.seed': '种子', 'common.dimension': '维度',
    'common.overworld': '主世界', 'common.nether': '下界', 'common.end': '末地',
    'common.coords': '坐标', 'common.copySeed': '复制种子', 'common.results': '结果',
    'common.name': '名称', 'common.id': 'ID', 'common.stack': '堆叠', 'common.category': '分类',
    'common.hardness': '硬度', 'common.resistance': '爆炸抗性', 'common.light': '亮度',
    'common.durability': '耐久', 'common.optional': '可选', 'common.none': '无',
    'common.yes': '是', 'common.no': '否', 'common.unknown': '未知',
    'common.enter': '输入', 'common.generate': '生成', 'common.output': '输出', 'common.preview': '预览',
    'common.english': '英文', 'common.chinese': '中文', 'common.step': '步骤', 'common.total': '总计',
    'tool.seedFinder': '种子查找器', 'tool.oreFinder': '矿石查找器', 'tool.structureFinder': '结构查找器',
    'tool.biomeFinder': '群系查找器', 'tool.enchantment': '附魔规划器', 'tool.command': '命令生成器',
    'tool.crafting': '合成计算器', 'tool.text': '文本工作室', 'tool.seedMap': '种子地图',
    'tool.seedFinder.d': '按结构或群系条件筛选，选择一个版本，复制符合条件的种子。',
    'tool.oreFinder.d': '在种子地图上标记钻石、远古残骸、铁、金等矿石，并显示各自的生成精度。',
    'tool.structureFinder.d': '定位要塞、村庄、林地府邸、远古城市等结构，每个结构都标注了定位精度。',
    'tool.biomeFinder.d': '高亮种子中的任意群系，从樱花树林到深暗之域，点击即可获得坐标。',
    'tool.enchantment.d': '找出用铁砧合并附魔书与装备最省经验值的顺序。',
    'tool.command.d': '为 Java 版与基岩版生成可直接粘贴的 /give 与 /summon 命令。',
    'tool.crafting.d': '计算合成任意物品所需的原材料、熔炼步骤与堆叠数量。',
    'tool.text.d': '生成 Minecraft 颜色代码、十六进制渐变与告示牌文本，五种复制格式。',
    'hub.toolsTitle': '工具',
    'hub.columns': '参考库',
    'items.howObtain': '如何获得', 'items.use': '用途',
    'map.hint': '拖拽平移，滚轮缩放。点击标记查看坐标。',
    'map.locating': '正在计算…', 'map.markers': '标记', 'map.biomesShown': '显示的群系',
    'map.zoomIn': '放大', 'map.zoomOut': '缩小', 'map.resetView': '重置视图',
    'footer.data': '数据来源', 'footer.about': '关于', 'footer.legal': '声明',
  },
  en: {
    'nav.home': 'Home', 'nav.tools': 'Tools', 'nav.items': 'Reference', 'nav.seeds': 'Best Seeds',
    'nav.blocks': 'Blocks', 'nav.mobs': 'Mobs', 'nav.biomes': 'Biomes', 'nav.enchant': 'Enchantments',
    'act.search': 'Search items, blocks, mobs, biomes…', 'act.theme': 'Toggle theme', 'act.lang': 'Switch language',
    'act.copy': 'Copy', 'act.copied': 'Copied', 'act.reset': 'Reset', 'act.retry': 'Retry',
    'act.open': 'Open', 'act.close': 'Close', 'act.share': 'Share', 'act.fullscreen': 'Fullscreen',
    'common.loading': 'Loading…', 'common.noResults': 'No matches', 'common.all': 'All',
    'common.edition': 'Edition', 'common.java': 'Java Edition', 'common.bedrock': 'Bedrock Edition',
    'common.version': 'Game version', 'common.seed': 'Seed', 'common.dimension': 'Dimension',
    'common.overworld': 'Overworld', 'common.nether': 'Nether', 'common.end': 'The End',
    'common.coords': 'Coordinates', 'common.copySeed': 'Copy seed', 'common.results': 'Results',
    'common.name': 'Name', 'common.id': 'ID', 'common.stack': 'Stack', 'common.category': 'Category',
    'common.hardness': 'Hardness', 'common.resistance': 'Blast resistance', 'common.light': 'Light',
    'common.durability': 'Durability', 'common.optional': 'Optional', 'common.none': 'None',
    'common.yes': 'Yes', 'common.no': 'No', 'common.unknown': 'Unknown',
    'common.enter': 'Input', 'common.generate': 'Generate', 'common.output': 'Output', 'common.preview': 'Preview',
    'common.english': 'English', 'common.chinese': 'Chinese', 'common.step': 'Step', 'common.total': 'Total',
    'tool.seedFinder': 'Seed Finder', 'tool.oreFinder': 'Ore Finder', 'tool.structureFinder': 'Structure Finder',
    'tool.biomeFinder': 'Biome Finder', 'tool.enchantment': 'Enchantment Tool', 'tool.command': 'Command Generator',
    'tool.crafting': 'Crafting Calculator', 'tool.text': 'Text Studio', 'tool.seedMap': 'Seed Map',
    'tool.seedFinder.d': 'Pick structures or biomes as criteria, choose your edition, and copy a matching seed.',
    'tool.oreFinder.d': 'Mark diamonds, ancient debris, iron, gold and more on your seed, with per-ore accuracy.',
    'tool.structureFinder.d': 'Locate strongholds, villages, mansions, ancient cities and more — each with its accuracy.',
    'tool.biomeFinder.d': 'Highlight any biome on your seed — every patch at once, from cherry groves to the deep dark.',
    'tool.enchantment.d': 'Find the cheapest anvil order to combine your books and gear for the least XP.',
    'tool.command.d': 'Build ready-to-paste /give and /summon commands for Java and Bedrock Edition.',
    'tool.crafting.d': 'Calculate the raw materials, smelting steps and stack counts needed to craft any item.',
    'tool.text.d': 'Generate Minecraft color codes, hex gradients and sign text — five copy formats.',
    'hub.toolsTitle': 'Tools',
    'hub.columns': 'Reference',
    'items.howObtain': 'How to obtain', 'items.use': 'Usage',
    'map.hint': 'Drag to pan, scroll to zoom. Click a marker for coordinates.',
    'map.locating': 'Computing…', 'map.markers': 'Markers', 'map.biomesShown': 'Biomes shown',
    'map.zoomIn': 'Zoom in', 'map.zoomOut': 'Zoom out', 'map.resetView': 'Reset view',
    'footer.data': 'Data sources', 'footer.about': 'About', 'footer.legal': 'Legal',
  },
};

let _lang = null;
export function lang() {
  if (_lang) return _lang;
  const q = new URLSearchParams(location.search).get('lang');
  const saved = localStorage.getItem('ms.lang');
  const nav = (navigator.language || 'zh').toLowerCase();
  _lang = q || saved || (nav.startsWith('zh') ? 'zh' : 'en');
  return _lang;
}
export function setLang(l) {
  _lang = l;
  localStorage.setItem('ms.lang', l);
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
  location.reload();
}
export function t(key, vars) {
  const d = DICT[lang()] || DICT.zh;
  let s = d[key] ?? DICT.zh[key] ?? key;
  if (vars) for (const k in vars) s = s.replaceAll('{' + k + '}', vars[k]);
  return s;
}
/** 双语文案字段取值：{zh,en} → 当前语言 */
export function L(o, fallback = '') {
  if (o == null) return fallback;
  if (typeof o === 'string') return o;
  return o[lang()] ?? o.en ?? o.zh ?? fallback;
}

/* --------------------------------------------------------------- 主题 */
export function initTheme() {
  const saved = localStorage.getItem('ms.theme');
  const sys = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = saved || sys;
}
export function toggleTheme() {
  const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = cur;
  localStorage.setItem('ms.theme', cur);
}

/* --------------------------------------------------------------- 工具 */
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export function toast(msg) {
  let box = $('.toast');
  if (!box) { box = el('div', { class: 'toast' }); document.body.append(box); }
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => box.classList.remove('show'), 1900);
}

export async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text; document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  toast((label || t('act.copied')) + ' ✓');
}

const _cache = new Map();
export async function fetchJSON(url) {
  if (_cache.has(url)) return _cache.get(url);
  const p = fetch(url).then(r => { if (!r.ok) throw new Error(url + ' → ' + r.status); return r.json(); });
  _cache.set(url, p);
  return p;
}

export const fmt = n => (n == null || Number.isNaN(n)) ? '—' : new Intl.NumberFormat(lang() === 'zh' ? 'zh-CN' : 'en-US').format(n);

/** 种子解析：支持十进制与带符号整数溢出（Minecraft 使用 int64 截断为 uint32 的字符串形式） */
export function parseSeed(raw) {
  const s = String(raw || '').trim();
  if (!s) return { seed: 0n, raw: '' };
  if (/^-?\d+$/.test(s)) return { seed: BigInt(s), raw: s };
  // 文本种子 → Java String.hashCode()
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return { seed: BigInt(h), raw: s };
}

/* ------------------------------------------------------- 站点数据（参考库） */
export const DB = {
  _p: {},
  load(kind) {
    if (!this._p[kind]) this._p[kind] = fetchJSON(rel(`/assets/data/${kind}.json`));
    return this._p[kind];
  },
  items: () => DB.load('items'),
  blocks: () => DB.load('blocks'),
  entities: () => DB.load('entities'),
  biomes: () => DB.load('biomes'),
  enchantments: () => DB.load('enchantments'),
  recipes: () => DB.load('recipes'),
  async all() {
    const [items, blocks, entities, biomes, enchantments] = await Promise.all(
      ['items', 'blocks', 'entities', 'biomes', 'enchantments'].map(k => DB.load(k)));
    return { items, blocks, entities, biomes, enchantments };
  },
};

/* 图标：远程为主，失败降级为文字色块 */
export function iconURL(kind, name) {
  const dir = kind === 'items' ? 'items' : kind === 'blocks' ? 'blocks' : kind === 'entities' ? 'entities' : 'items';
  return `https://minecraft-api.vercel.app/images/${dir}/${name}.png`;
}
export function iconNode(kind, rec, size = 34) {
  const wrap = el('span', { class: 'avatar', style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px` });
  wrap.textContent = (L(rec.en, rec.name) || rec.name || '?').slice(0, 1).toUpperCase();
  const img = el('img', {
    src: iconURL(kind, rec.name), alt: '', width: size, height: size,
    loading: 'lazy', style: 'display:none',
    onload: () => { img.style.display = ''; wrap.textContent = ''; wrap.style.background = 'transparent'; },
    onerror: () => img.remove(),
  });
  wrap.append(img);
  return wrap;
}

/* --------------------------------------------------------------- 布局 */
export const TOOLS = [
  { slug: 'seed-finder', icon: '🌱', name: 'tool.seedFinder', desc: 'tool.seedFinder.d' },
  { slug: 'ore-finder', icon: '💎', name: 'tool.oreFinder', desc: 'tool.oreFinder.d' },
  { slug: 'structure-finder', icon: '🏛️', name: 'tool.structureFinder', desc: 'tool.structureFinder.d' },
  { slug: 'biome-finder', icon: '🌍', name: 'tool.biomeFinder', desc: 'tool.biomeFinder.d' },
  { slug: 'enchantment-planner', icon: '✨', name: 'tool.enchantment', desc: 'tool.enchantment.d' },
  { slug: 'command-generator', icon: '⌨️', name: 'tool.command', desc: 'tool.command.d' },
  { slug: 'crafting-calculator', icon: '🛠️', name: 'tool.crafting', desc: 'tool.crafting.d' },
  { slug: 'text-studio', icon: '🎨', name: 'tool.text', desc: 'tool.text.d' },
];
export const REF_CATEGORIES = [
  { slug: 'items/tools', kind: 'items', cat: 'tools' },
  { slug: 'items/weapons', kind: 'items', cat: 'weapons' },
  { slug: 'items/equipments', kind: 'items', cat: 'equipments' },
  { slug: 'items/food', kind: 'items', cat: 'food' },
  { slug: 'items/potions', kind: 'items', cat: 'potions' },
  { slug: 'items/resources', kind: 'items', cat: 'resources' },
  { slug: 'items/seeds', kind: 'items', cat: 'seeds' },
  { slug: 'items/misc', kind: 'items', cat: 'misc' },
  { slug: 'blocks', kind: 'blocks' },
  { slug: 'mobs', kind: 'entities' },
  { slug: 'biomes', kind: 'biomes' },
  { slug: 'enchantments', kind: 'enchantments' },
];

export function renderHeader(active = '') {
  const nav = [
    { href: rel('/'), key: 'nav.home', id: 'home' },
    { href: rel('/tools/'), key: 'nav.tools', id: 'tools' },
    { href: rel('/items/'), key: 'nav.items', id: 'items' },
    { href: rel('/best-seeds.html'), key: 'nav.seeds', id: 'seeds' },
  ];
  const header = el('header', { class: 'site-header' },
    el('div', { class: 'wrap header-inner' },
      el('a', { class: 'brand', href: rel('/') }, el('span', { class: 'cube' }), el('span', {}, `${L(SITE.name)}`)),
      el('nav', { class: 'nav' }, nav.map(x =>
        el('a', { href: x.href, class: x.id === active ? 'active' : '' }, t(x.key)))),
      el('div', { class: 'searchbar' },
        el('span', { class: 'ico' }, '🔍'),
        el('input', { type: 'search', id: 'gsearch', placeholder: t('act.search'), autocomplete: 'off' }),
        el('div', { class: 'suggest hidden', id: 'gsuggest' })),
      el('div', { class: 'header-actions' },
        el('button', { class: 'iconbtn', title: t('act.theme'), onclick: toggleTheme }, document.documentElement.dataset.theme === 'dark' ? '☀' : '☾'),
        el('button', { class: 'iconbtn langbtn', title: t('act.lang'), onclick: () => setLang(lang() === 'zh' ? 'en' : 'zh') }, lang() === 'zh' ? '中' : 'EN')),
    ));
  document.body.prepend(header);
  initGlobalSearch();
  return header;
}

export function renderFooter() {
  const f = el('footer', { class: 'site-footer' },
    el('div', { class: 'wrap' },
      el('div', { class: 'footer-cols' },
        el('div', {},
          el('h4', {}, t('footer.about')),
          el('p', { class: 'faint', style: 'font-size:.83rem' }, `${L(SITE.tagline)}`)),
        el('div', {},
          el('h4', {}, t('hub.toolsTitle')),
          el('ul', {}, TOOLS.slice(0, 5).map(x => el('li', {}, el('a', { href: rel(`/tools/${x.slug}.html`) }, t(x.name)))))),
        el('div', {},
          el('h4', {}, t('hub.columns')),
          el('ul', {}, REF_CATEGORIES.slice(0, 6).map(c =>
            el('li', {}, el('a', { href: rel(`/items/?c=${c.slug}`) }, t('common.category')))))),
        el('div', {},
          el('h4', {}, t('footer.data')),
          el('ul', {},
            el('li', {}, el('a', { href: 'https://minecraft.wiki', target: '_blank', rel: 'noopener' }, 'minecraft.wiki')),
            el('li', {}, el('a', { href: 'https://github.com/Cubitect/cubiomes', target: '_blank', rel: 'noopener' }, 'cubiomes (MIT)')),
            el('li', {}, el('a', { href: 'https://github.com/PrismarineJS/minecraft-data', target: '_blank', rel: 'noopener' }, 'minecraft-data')))),
      ),
      el('p', { class: 'faint', style: 'margin-top:24px;font-size:.8rem' },
        lang() === 'zh'
          ? '本站为技术复刻项目，非官方站点，与 Mojang / Microsoft 无关联。Minecraft 是 Mojang Studios 的商标。'
          : 'Technical reproduction project. Not affiliated with Mojang / Microsoft. Minecraft is a trademark of Mojang Studios.')));
  document.body.append(f);
  return f;
}

/* --------------------------------------------------- 全局搜索（物品/方块/生物/群系） */
let _INDEX = null;
export async function buildIndex() {
  if (_INDEX) return _INDEX;
  const { items, blocks, entities, biomes, enchantments } = await DB.all();
  const mk = (kind, arr, extra = () => ({})) => arr.map(r => ({
    kind, name: r.name, id: r.id,
    en: r.en, zh: r.zh, ...extra(r),
  }));
  _INDEX = [
    ...mk('items', items, r => ({ cat: r.cat })),
    ...mk('blocks', blocks),
    ...mk('entities', entities, r => ({ cat: r.cat })),
    ...mk('biomes', biomes),
    ...mk('enchantments', enchantments),
  ];
  return _INDEX;
}
export function score(q, rec) {
  const s = q.toLowerCase();
  const en = (rec.en || '').toLowerCase(), zh = rec.zh || '', nm = rec.name || '';
  if (nm === s || en === s || zh === q) return 100;
  if (nm.startsWith(s) || en.startsWith(s) || zh.startsWith(q)) return 80;
  if (nm.includes(s) || en.includes(s) || zh.includes(q)) return 55;
  return 0;
}
function itemHref(r) {
  if (r.kind === 'items') return `/items/detail.html?type=items&id=${encodeURIComponent(r.name)}`;
  if (r.kind === 'blocks') return `/items/detail.html?type=blocks&id=${encodeURIComponent(r.name)}`;
  if (r.kind === 'entities') return `/items/detail.html?type=entities&id=${encodeURIComponent(r.name)}`;
  if (r.kind === 'biomes') return `/items/detail.html?type=biomes&id=${encodeURIComponent(r.name)}`;
  return `/items/detail.html?type=enchantments&id=${encodeURIComponent(r.name)}`;
}
export function initGlobalSearch() {
  const input = $('#gsearch'), box = $('#gsuggest');
  if (!input) return;
  let idx = [], sel = -1;
  const close = () => { box.classList.add('hidden'); sel = -1; };
  const run = async q => {
    idx = await buildIndex();
    const hits = idx.map(r => ({ r, s: score(q, r) })).filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || L(a.r.en).localeCompare(L(b.r.en))).slice(0, 24).map(x => x.r);
    if (!hits.length) { box.innerHTML = `<div class="empty" style="padding:16px">${t('common.noResults')}</div>`; box.classList.remove('hidden'); return; }
    box.replaceChildren(...hits.map(r => el('a', { href: itemHref(r) },
      iconNode(r.kind, r, 26),
      el('span', {}, L(r.en, r.name)),
      el('span', { class: 'cat' }, r.kind))));
    box.classList.remove('hidden');
  };
  input.addEventListener('input', () => { const q = input.value.trim(); q ? run(q) : close(); });
  input.addEventListener('focus', () => { if (input.value.trim()) run(input.value.trim()); });
  input.addEventListener('keydown', e => {
    const links = $$('a', box);
    if (e.key === 'Escape') return close();
    if (!links.length) return;
    if (e.key === 'ArrowDown') { sel = (sel + 1) % links.length; }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + links.length) % links.length; }
    else if (e.key === 'Enter') { (links[sel] || links[0]).click(); return; }
    else return;
    e.preventDefault();
    links.forEach((a, i) => a.classList.toggle('sel', i === sel));
    links[sel].scrollIntoView({ block: 'nearest' });
  });
  document.addEventListener('click', e => { if (!e.target.closest('.searchbar')) close(); });
}

/* --------------------------------------------------- 页面初始化助手 */
export function boot({ active = '', title }) {
  initTheme();
  document.documentElement.lang = lang() === 'zh' ? 'zh-CN' : 'en';
  renderHeader(active);
  renderFooter();
  if (title) document.title = `${title} — ${L(SITE.name)}`;
}
