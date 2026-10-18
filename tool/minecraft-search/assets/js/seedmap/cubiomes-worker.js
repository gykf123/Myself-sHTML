/* ==========================================================================
   cubiomes-worker.js — 世界生成计算 Worker
   --------------------------------------------------------------------------
   在 Web Worker 中加载 cubiomes 编译的 WASM，负责所有重计算：
     · 群系网格（用于地图瓦片着色）
     · 结构 / 矿物定位
     · 出生点
   两条内核可切换：
     vendor —— 与 minecraftsearch.com 一致的构建（wasm/vendor/*）
     oss    —— 由本仓库基于开源 cubiomes 自行编译的构建（wasm/oss/*）

   已逆向确认的导出契约：
     init_generator(mcVersion:int, flags:int)         flags 位 0 = 巨型群系
     apply_seed(seed:int64, dimension:int)            0 主世界 / -1 下界 / 1 末地
     generate_biome_range_at_y(scale,x,y,z,sx,sz)
       —— 实测语义：x/z 的单位是 (scale/4) 个方块；取 scale=16 时即 4 方块/格
     get_biome_data_pointer() / get_biome_data_size() 结果读 Int32Array
     get_biome_name(id)                               群系 ID → 名称
     find_structures_in_area(t,x0,z0,x1,z1,limit,checkTerrain)
     get_structure_results_count() / _pointer()       结果读 [x,z] 坐标对
     get_spawn() / get_spawn_result_pointer()         [x,z,…]
   ========================================================================== */

const CORE_URL = {
  // 本脚本位于 assets/js/seedmap/，importScripts 相对本脚本解析；
  // 上三级（seedmap → js → assets → 子站根）到达站点根下的 wasm/
  vendor: '../../../wasm/vendor/cubiomes.js',
  oss: '../../../wasm/oss/cubiomes.js',
};

/* cubiomes 的 MCVersion 枚举 —— 由站内 JAVA_MC_VERSION_MAP 逆向而来 */
const MC_VERSION = {
  '1.16': 20, '1.17': 21, '1.18': 22, '1.19': 23, '1.19.4': 24,
  '1.20': 25, '1.21': 26, '1.21.3': 27, '1.21.4': 28, '1.21.5': 29,
};
const DIMENSION = { overworld: 0, nether: -1, end: 1 };

/** 结构类型编号（该构建的 StructureType 枚举，= 上游枚举 + 1） */
const STRUCTURE_TYPE = {
  desert_pyramid: 1, jungle_temple: 2, swamp_hut: 3, igloo: 4, village: 5,
  ocean_ruin: 6, shipwreck: 7, ocean_monument: 8, woodland_mansion: 9,
  pillager_outpost: 10, ruined_portal: 11, ruined_portal_nether: 12,
  ancient_city: 13, buried_treasure: 14, mineshaft: 15, desert_well: 16,
  amethyst_geode: 17, nether_fortress: 18, bastion_remnant: 19, end_city: 20,
  trail_ruins: 23, trial_chambers: 24,
};

let MOD = null;           // 已加载的 wasm 模块
let STATE = { core: null, mc: 28, dim: 0, flags: 0, seed: null };
const biomeNameCache = new Map();
const biomeColorCache = new Map();

function loadScript(url) {
  return new Promise((resolve, reject) => {
    try { self.importScripts(url); resolve(); }
    catch (e) { reject(new Error('内核脚本加载失败：' + url)); }
  });
}

let loadedCore = null;   // 已注入脚本的内核名（importScripts 会覆盖全局 CubiomesModule）

async function ensureModule(core) {
  if (MOD && STATE.core === core) return MOD;
  const url = CORE_URL[core] || CORE_URL.vendor;
  if (loadedCore !== core) {
    self.CubiomesModule = undefined;      // 先清掉上一个内核的全局导出，再注入新的
    await loadScript(url);
    loadedCore = core;
  }
  if (!self.CubiomesModule) throw new Error('内核对像未导出：' + url);
  const dir = url.slice(0, url.lastIndexOf('/') + 1);
  MOD = await self.CubiomesModule({ locateFile: n => dir + String(n).split('/').pop() });
  STATE.core = core;
  return MOD;
}

const call = (name, ret, argTypes, args) => MOD.ccall(name, ret, argTypes, args);
const c0 = name => call(name, 'number', [], []);

function initGen({ edition, version, dimension, largeBiomes }) {
  const mc = MC_VERSION[version] ?? 28;
  const dim = DIMENSION[dimension] ?? 0;
  const flags = largeBiomes ? 1 : 0;
  // 维度变体：下界 / 末地需要对应变体内核（vendor 构建内支持）
  call('init_generator', 'number', ['number', 'number'], [mc, flags]);
  STATE.mc = mc; STATE.dim = dim; STATE.flags = flags;
  STATE.edition = edition; STATE.version = version;
  // 注意：不清 STATE.seed。init_generator 会重置生成器（含种子），
  // 因此 init 后若已有种子必须重新 applySeed 重放（见下方 init case）。
}

function applySeed(seed) {
  const s = typeof seed === 'bigint' ? seed : BigInt(seed);
  call('apply_seed', 'number', ['bigint', 'number'], [s, STATE.dim]);
  STATE.seed = s;
  biomeNameCache.clear();
}

/** 读取一片群系网格：[格坐标起点] + [格数]，返回 Int32Array
 *  采样 scale 取 16 —— 已实测：该构建中 x/z 的单位是 scale/4 个方块，
 *  因此 scale=16 时 1 格 = 4 方块，正好是地图瓦片的最小精度。 */
const SAMPLE_SCALE = 16;
function biomeGrid(x, y, z, sx, sz) {
  const r = call('generate_biome_range_at_y', 'number',
    ['number', 'number', 'number', 'number', 'number', 'number'], [SAMPLE_SCALE, x, y, z, sx, sz]);
  if (r < 0) return null;
  const ptr = c0('get_biome_data_pointer');
  const size = c0('get_biome_data_size');
  if (ptr <= 0 || size < sx * sz) return null;
  return new Int32Array(MOD.HEAP32.buffer, ptr, sx * sz).slice();
}

function biomeName(id) {
  if (biomeNameCache.has(id)) return biomeNameCache.get(id);
  let n = null;
  try { n = call('get_biome_name', 'string', ['number'], [id]); } catch { n = null; }
  biomeNameCache.set(id, n || ('biome_' + id));
  return biomeNameCache.get(id);
}

/* ------------------------------------------------------------------ 调色板 */
/* 以 MC 官方地图色为基准的群系色（cubiomes 群系 ID 体系） */
const BIOME_COLORS = {
  0: '#000070', 1: '#8db360', 2: '#fa9418', 3: '#606060', 4: '#056621', 5: '#0b6659',
  6: '#07f9b2', 7: '#0000ff', 8: '#8080ff', 9: '#8080ff', 10: '#9090a0', 11: '#a0a0ff',
  12: '#ffffff', 13: '#a0a0a0', 14: '#ff00ff', 15: '#a000ff', 16: '#fade55', 17: '#d94515',
  18: '#507b36', 19: '#3a5f2b', 20: '#808080', 21: '#537b09', 22: '#2c4205', 23: '#628b17',
  24: '#000030', 25: '#a2a284', 26: '#faf0c0', 27: '#307444', 28: '#1f5f32', 29: '#40511a',
  30: '#31554a', 31: '#243f36', 32: '#596651', 33: '#545f3e', 34: '#507b09', 35: '#6b8e23',
  36: '#7f0000', 37: '#600000', 38: '#a0b0ff', 39: '#a0b0ff', 40: '#3a3a8f', 41: '#3a3a8f',
  42: '#2f2f2f', 43: '#2f2f2f', 44: '#2f2f2f', 45: '#2f2f2f', 46: '#2f2f2f', 47: '#2f2f2f',
  48: '#2f2f2f', 49: '#2f2f2f', 50: '#2f2f2f', 127: '#00607a', 129: '#466c31', 130: '#5e7236',
  131: '#3c5c2b', 132: '#2b462b', 133: '#2b6357', 134: '#2b6357', 140: '#a0b0ff', 141: '#a0b0ff',
  155: '#2b462b', 156: '#2b462b', 157: '#3f5258', 158: '#3f5258', 160: '#456d47', 161: '#456d47',
  162: '#3e6a3e', 163: '#3e6a3e', 164: '#2a4636', 165: '#2a4636', 166: '#a0b0ff', 167: '#a0b0ff',
  168: '#2f2f2f', 169: '#2f2f2f', 170: '#3a5f2b', 171: '#3a5f2b', 172: '#4a6b39', 173: '#4a6b39',
  174: '#4a6b39', 175: '#101014', 176: '#3b3b3b', 177: '#1a1a1a',
};
const FALLBACK_COLORS = ['#7cae7a', '#a9b665', '#c2a34a', '#5f9ea0', '#8f9f5f', '#4f7942', '#94a89b', '#b08b6b'];
function biomeColor(id) {
  if (biomeColorCache.has(id)) return biomeColorCache.get(id);
  let c = BIOME_COLORS[id];
  if (!c) c = FALLBACK_COLORS[(id * 2654435761) % FALLBACK_COLORS.length];
  biomeColorCache.set(id, c);
  return c;
}

/* ------------------------------------------------------------------ 消息 */
self.onmessage = async ev => {
  const msg = ev.data;
  const id = msg.id;
  try {
    switch (msg.type) {
      case 'init': {
        await ensureModule(msg.core || 'vendor');
        initGen(msg);
        // init_generator 重置了生成器种子：若此前已设置过种子，重新重放，
        // 避免「先 setSeed 后 init」的竞态把种子丢掉（ore-finder 曾踩中）
        if (STATE.seed !== null) applySeed(STATE.seed);
        post({ id, type: 'ready', core: STATE.core, mc: STATE.mc });
        break;
      }
      case 'seed': {
        ensureReady();
        applySeed(msg.seed);
        post({ id, type: 'ok' });
        break;
      }
      case 'tile': {
        ensureReady();
        const t0 = performance.now();
        const { x, z, size, y = 64 } = msg;   // x/z/size 均为「格坐标」单位
        const grid = biomeGrid(x, y, z, size, size);
        if (!grid) throw new Error('群系网格生成失败');
        // 转 RGBA
        const rgba = new Uint8ClampedArray(size * size * 4);
        for (let i = 0; i < grid.length; i++) {
          const c = biomeColor(grid[i]);
          const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
          rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
        }
        post({ id, type: 'tile', size, rgba, ms: performance.now() - t0 }, [rgba.buffer]);
        break;
      }
      case 'grid': {                          // 原始群系 ID 网格（供群系查找器使用）
        ensureReady();
        const { x, z, size, y = 64 } = msg;
        const grid = biomeGrid(x, y, z, size, size);
        if (!grid) throw new Error('群系网格生成失败');
        post({ id, type: 'grid', size, grid }, [grid.buffer]);
        break;
      }
      case 'biomeAt': {
        ensureReady();
        const g = biomeGrid(Math.floor(msg.x / 4), msg.y ?? 64, Math.floor(msg.z / 4), 1, 1);
        post({ id, type: 'biomeAt', biome: g ? g[0] : null, name: g ? biomeName(g[0]) : null });
        break;
      }
      case 'structures': {
        ensureReady();
        const type = typeof msg.structure === 'string' ? STRUCTURE_TYPE[msg.structure] : msg.structure;
        const limit = Math.max(1, Math.min(msg.limit || 4000, 20000));
        const r = call('find_structures_in_area', 'number',
          ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
          [type, msg.x0, msg.z0, msg.x1, msg.z1, limit, msg.checkTerrain ? 1 : 0]);
        let pts = [];
        if (r > 0) {
          const cnt = c0('get_structure_results_count');
          const ptr = c0('get_structure_results_pointer');
          const n = Math.max(0, Math.min(r, cnt, limit));
          if (ptr > 0 && n > 0) pts = Array.from(new Int32Array(MOD.HEAP32.buffer, ptr, n * 2).slice());
        }
        post({ id, type: 'structures', points: pts });
        break;
      }
      case 'spawn': {
        ensureReady();
        const ok = c0('get_spawn');
        const ptr = c0('get_spawn_result_pointer');
        let out = null;
        if (ok && ptr > 0) { const a = new Int32Array(MOD.HEAP32.buffer, ptr, 2); out = { x: a[0], z: a[1] }; }
        post({ id, type: 'spawn', spawn: out });
        break;
      }
      case 'biomeList': {
        ensureReady();
        const list = [];
        for (let i = 0; i < 256; i++) {
          const n = biomeName(i);
          if (n && !n.startsWith('biome_')) list.push({ id: i, name: n, color: biomeColor(i) });
        }
        post({ id, type: 'biomeList', list });
        break;
      }
      default: throw new Error('未知指令：' + msg.type);
    }
  } catch (e) {
    post({ id, type: 'error', message: String(e && e.message || e) });
  }
};

function ensureReady() { if (!MOD) throw new Error('内核尚未初始化'); }
function post(m, transfer) { self.postMessage(m, transfer || []); }
