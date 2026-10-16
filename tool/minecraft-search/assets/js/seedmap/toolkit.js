/* ==========================================================================
   toolkit.js — 地图类工具共享 UI 框架
   种子输入 / 版本与维度切换 / 地图尺寸 / 坐标跳转 / 扫描结果列表
   ========================================================================== */
import { el, $, t, lang, toast, copyText, parseSeed, fmt } from '../core.js';
import { SeedMap, ALL_STRUCTURES, STRUCTURE_META, ORES, STRUCTURE_GROUPS } from './map.js';

export const VERSIONS = ['1.21.4', '1.21.3', '1.21', '1.20', '1.19.4', '1.19', '1.18', '1.17', '1.16'];
export const DIMS = [
  { id: 'overworld', key: 'common.overworld' },
  { id: 'nether', key: 'common.nether' },
  { id: 'end', key: 'common.end' },
];

export function toolbar(host, map, opts = {}) {
  const zh = lang() === 'zh';
  const seedInput = el('input', { type: 'text', id: 'seedInput', placeholder: zh ? '输入种子（数字或文字）' : 'Seed (number or text)', autocomplete: 'off' });
  const verSel = el('select', { id: 'verSel' }, VERSIONS.map(v => el('option', { value: v }, v)));
  verSel.value = '1.21.4';
  const dimSel = el('select', { id: 'dimSel' }, DIMS.map(d => el('option', { value: d.id }, t(d.key))));
  const yInput = el('input', { type: 'number', id: 'yInput', value: '64', min: '-64', max: '320' });
  const coreSel = el('select', { id: 'coreSel' },
    el('option', { value: 'vendor' }, zh ? '内核 A（源站构建）' : 'Core A (vendor build)'),
    el('option', { value: 'oss' }, zh ? '内核 B（开源构建）' : 'Core B (open-source build)'));

  const bar = el('div', { class: 'panel' },
    el('div', { class: 'field-row' },
      el('div', {}, el('label', { class: 'fld' }, t('common.seed')), seedInput),
      el('div', {}, el('label', { class: 'fld' }, t('common.version')), verSel),
      el('div', {}, el('label', { class: 'fld' }, t('common.dimension')), dimSel),
      el('div', {}, el('label', { class: 'fld' }, zh ? 'Y 高度' : 'Y level'), yInput),
      el('div', {}, el('label', { class: 'fld' }, zh ? '计算内核' : 'Compute core'), coreSel),
    ),
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', { class: 'btn primary', id: 'applyBtn' }, zh ? '生成地图' : 'Generate'),
      el('button', { class: 'btn', id: 'randBtn' }, zh ? '随机种子' : 'Random seed'),
      el('button', { class: 'btn', id: 'spawnBtn' }, zh ? '定位出生点' : 'Find spawn'),
      el('span', { class: 'badge n', id: 'seedBadge' }, ''),
    ));
  host.prepend(bar);

  async function apply() {
    const { seed, raw } = parseSeed(seedInput.value || '0');
    const core = coreSel.value;
    try {
      if (core !== map.state.core) { await map.init({ core }); }
      map.init({ edition: 'java', version: verSel.value, dimension: dimSel.value, y: Number(yInput.value) || 64 });
      await map.setSeed(seed);
      $('#seedBadge').textContent = `${t('common.seed')}: ${raw} → ${seed}`;
      if (map.state.dimension === 'overworld') { try { map.spawn = await map.getSpawn(); } catch { map.spawn = null; } }
      else map.spawn = null;
      map.schedule();
      opts.onApply && opts.onApply(seed, raw);
    } catch (e) { toast(e.message); }
  }
  $('#applyBtn').onclick = apply;
  $('#randBtn').onclick = () => {
    seedInput.value = String(Math.floor(Math.random() * 2 ** 48) - 2 ** 47);
    apply();
  };
  $('#spawnBtn').onclick = async () => {
    const s = await map.getSpawn();
    if (s) { map.spawn = s; map.view.cx = s.x; map.view.cz = s.z; map.schedule(); toast(`(${s.x}, ${s.z})`); }
    else toast(zh ? '该版本/维度无出生点' : 'No spawn for this version/dimension');
  };
  verSel.onchange = () => { if (opts.autoApply !== false) apply(); };
  dimSel.onchange = () => { if (opts.autoApply !== false) apply(); };
  yInput.onchange = () => map.setY(Number(yInput.value) || 64);

  apply();
  return { apply, seedInput, verSel, dimSel, yInput, coreSel };
}

/** 结构多选手风琴 */
export function structurePicker(host, onChange) {
  const zh = lang() === 'zh';
  const chosen = new Set();
  const box = el('div', { class: 'stack' });
  for (const g of STRUCTURE_GROUPS) {
    const group = el('div', {},
      el('div', { class: 'fld', style: 'margin:10px 0 4px' }, zh ? g.label.zh : g.label.en),
      el('div', { class: 'chips' }, g.items.map(s => {
        const c = el('button', { class: 'chip', dataset: { id: s.id } },
          el('span', { style: `display:inline-block;width:9px;height:9px;border-radius:2px;background:${s.color};margin-right:6px` }),
          prettyStruct(s.id, zh));
        c.onclick = () => {
          chosen.has(s.id) ? chosen.delete(s.id) : chosen.add(s.id);
          c.classList.toggle('on');
          onChange([...chosen]);
        };
        return c;
      })));
    box.append(group);
  }
  host.append(box);
  return { chosen };
}

export function prettyStruct(id, zh) {
  const M = {
    village: ['村庄', 'Villages'], pillager_outpost: ['掠夺者前哨站', 'Pillager outposts'],
    swamp_hut: ['沼泽小屋', 'Swamp huts'], igloo: ['雪屋', 'Igloos'],
    desert_pyramid: ['沙漠神殿', 'Desert pyramids'], jungle_temple: ['丛林神庙', 'Jungle temples'],
    ocean_ruin: ['海底废墟', 'Ocean ruins'], ruined_portal: ['废弃传送门', 'Ruined portals'],
    trail_ruins: ['试炼遗迹', 'Trail ruins'], ancient_city: ['远古城市', 'Ancient cities'],
    woodland_mansion: ['林地府邸', 'Woodland mansions'], trial_chambers: ['试炼密室', 'Trial chambers'],
    mineshaft: ['废弃矿井', 'Mineshafts'], amethyst_geode: ['紫水晶洞', 'Amethyst geodes'],
    desert_well: ['沙漠水井', 'Desert wells'], ocean_monument: ['海底神殿', 'Ocean monuments'],
    shipwreck: ['沉船', 'Shipwrecks'], buried_treasure: ['埋藏的宝藏', 'Buried treasure'],
    nether_fortress: ['下界要塞', 'Nether fortresses'], bastion_remnant: ['堡垒遗迹', 'Bastion remnants'],
    ruined_portal_nether: ['废弃传送门（下界）', 'Ruined portals (Nether)'],
    end_city: ['末地城', 'End cities'], stronghold: ['要塞', 'Strongholds'],
  };
  const m = M[id] || [id, id];
  return zh ? m[0] : m[1];
}

export function prettyOre(id, zh) {
  const M = {
    diamond: ['钻石', 'Diamond'], ancient_debris: ['远古残骸', 'Ancient debris'], iron: ['铁', 'Iron'],
    gold: ['金', 'Gold'], redstone: ['红石', 'Redstone'], copper: ['铜', 'Copper'],
    lapis: ['青金石', 'Lapis lazuli'], coal: ['煤', 'Coal'], emerald: ['绿宝石', 'Emerald'],
  };
  const m = M[id] || [id, id];
  return zh ? m[0] : m[1];
}

/** 结果列表（坐标表格，可点击跳转/复制） */
export function resultTable(host, map, title) {
  const zh = lang() === 'zh';
  const body = el('tbody');
  const table = el('table', { class: 'tbl' },
    el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'X'), el('th', {}, 'Z'),
      el('th', {}, zh ? '距离' : 'Distance'), el('th', {}, ''))),
    body);
  const wrap = el('div', { class: 'panel' },
    el('div', { class: 'row', style: 'justify-content:space-between' },
      el('h2', { style: 'margin:0' }, title || t('common.results')),
      el('span', { class: 'badge n', id: 'resCount' }, '0')),
    el('div', { class: 'scroll-x', style: 'margin-top:10px;max-height:420px;overflow:auto' }, table));
  host.append(wrap);

  return {
    set(points, originLabel) {
      $('#resCount').textContent = String(points.length);
      body.replaceChildren(...points.slice(0, 400).map((p, i) => {
        const d = Math.round(Math.hypot(p.x, p.z));
        return el('tr', {},
          el('td', { class: 'faint' }, String(i + 1)),
          el('td', { class: 'mono' }, String(p.x)),
          el('td', { class: 'mono' }, String(p.z)),
          el('td', { class: 'mono faint' }, fmt(d)),
          el('td', {},
            el('button', { class: 'btn sm', onclick: () => { map.view.cx = p.x; map.view.cz = p.z; map.schedule(); } }, zh ? '定位' : 'Go'),
            el('button', { class: 'btn sm', style: 'margin-left:6px', onclick: () => copyText(`/tp @s ${p.x} ~ ${p.z}`, t('act.copied')) }, '/tp')));
      }));
      if (!points.length) body.append(el('tr', {}, el('td', { colspan: '5' }, el('div', { class: 'empty' }, zh ? '未找到结果，试试扩大范围或切换版本' : 'No results — widen the area or switch version'))));
    },
  };
}

export function rangePicker(host, onScan) {
  const zh = lang() === 'zh';
  const r = el('input', { type: 'number', value: '2048', min: '256', step: '256', id: 'rangeInput' });
  const btn = el('button', { class: 'btn primary', id: 'scanBtn' }, zh ? '扫描区域' : 'Scan area');
  const box = el('div', { class: 'panel' },
    el('h2', {}, zh ? '扫描范围' : 'Scan area'),
    el('div', { class: 'field-row' },
      el('div', {}, el('label', { class: 'fld' }, zh ? '半径（方块，以 0,0 为中心）' : 'Radius in blocks (around 0,0)'), r)),
    el('div', { class: 'row', style: 'margin-top:10px' }, btn,
      el('span', { class: 'faint', style: 'font-size:.8rem' }, zh ? '范围越大耗时越久' : 'Larger = slower')));
  host.append(box);
  btn.onclick = () => onScan(Number(r.value) || 2048, btn);
  return { btn, r };
}

export function legendFor(ids, kind) {
  const zh = lang() === 'zh';
  return ids.map(id => {
    if (kind === 'ore') { const o = ORES.find(x => x.id === id); return { label: prettyOre(id, zh), color: o ? o.color : '#888' }; }
    const s = STRUCTURE_META[id]; return { label: prettyStruct(id, zh), color: s ? s.color : '#888' };
  });
}

export { SeedMap, ALL_STRUCTURES, STRUCTURE_META, ORES, STRUCTURE_GROUPS };
