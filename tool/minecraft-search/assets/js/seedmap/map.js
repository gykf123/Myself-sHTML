/* ==========================================================================
   map.js — 种子地图引擎（主线程）
   --------------------------------------------------------------------------
   · 通过 cubiomes-worker 计算群系瓦片，拼成可平移缩放的画布
   · 叠加结构 / 矿石 / 出生点标记
   · 所有坐标以「方块」为单位；cubiomes 侧以「格」为单位（1 格 = 4 方块）
   ========================================================================== */

export const TILE_BLOCKS = 512;                     // 每个瓦片覆盖的方块边长
export const TILE_GRID = TILE_BLOCKS / 4;           // 每个瓦片的格数（128）
export const ZOOM_LEVELS = [1, 2, 4];               // 每像素方块数（缩放级别）

export class SeedMap {
  constructor(container, opts = {}) {
    this.el = container;
    this.worker = new Worker('cubiomes-worker.js');
    this.msgId = 0;
    this.pending = new Map();
    this.tiles = new Map();            // key → {canvas, ready}
    this.tileQueue = [];
    this.inflight = 0;
    this.maxInflight = 4;

    this.state = {
      core: opts.core || 'vendor',
      edition: 'java', version: '1.21.4', dimension: 'overworld',
      largeBiomes: false, y: 64, seed: null,
    };
    this.view = { cx: 0, cz: 0, zoom: 1 };   // 屏幕中心对应的方块坐标 / 缩放
    this.markers = [];                        // {x,z,type,label,color}
    this.ready = false;

    this._build();
    this._bindEvents();
    this.worker.onmessage = e => this._onMessage(e.data);
  }

  /* ---------------------------------------------------------------- 通信 */
  _send(type, payload = {}, transfer) {
    const id = ++this.msgId;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.worker.postMessage({ id, type, ...payload }, transfer || []);
    });
  }
  _onMessage(d) {
    const p = this.pending.get(d.id);
    if (!p) return;
    this.pending.delete(d.id);
    if (d.type === 'error') p.rej(new Error(d.message));
    else p.res(d);
  }

  async init(cfg = {}) {
    Object.assign(this.state, cfg);
    this.tiles.clear(); this.tileQueue.length = 0;
    await this._send('init', {
      core: this.state.core, edition: this.state.edition, version: this.state.version,
      dimension: this.state.dimension, largeBiomes: this.state.largeBiomes,
    });
    this.ready = true;
  }
  async setSeed(seed) {
    this.state.seed = seed;
    this.tiles.clear(); this.tileQueue.length = 0;
    await this._send('seed', { seed: typeof seed === 'bigint' ? seed : BigInt(seed) });
    this.schedule();
  }
  async setY(y) { this.state.y = y; this.tiles.clear(); this.schedule(); }

  async getSpawn() { const r = await this._send('spawn'); return r.spawn; }
  async getBiomeAt(x, z, y) { const r = await this._send('biomeAt', { x, z, y: y ?? this.state.y }); return r; }
  async findStructures(structure, x0, z0, x1, z1, limit = 500, checkTerrain = false) {
    const r = await this._send('structures', { structure, x0, z0, x1, z1, limit, checkTerrain });
    const pts = [];
    for (let i = 0; i + 1 < r.points.length; i += 2) pts.push({ x: r.points[i], z: r.points[i + 1] });
    return pts;
  }
  async biomeList() { const r = await this._send('biomeList'); return r.list; }

  /* ---------------------------------------------------------------- DOM */
  _build() {
    this.el.classList.add('map-shell');
    this.el.innerHTML = `
      <canvas class="map-canvas"></canvas>
      <div class="map-overlay" style="pointer-events:none">
        <div class="map-legend hidden"></div>
        <div class="map-status"></div>
      </div>
      <div class="map-hud">
        <button class="iconbtn" data-act="in" title="+">＋</button>
        <button class="iconbtn" data-act="out" title="−">−</button>
        <button class="iconbtn" data-act="home" title="⌂">⌂</button>
      </div>`;
    this.canvas = this.el.querySelector('.map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.status = this.el.querySelector('.map-status');
    this.legend = this.el.querySelector('.map-legend');
    this._resize();
    this._ro = new ResizeObserver(() => { this._resize(); this.schedule(); });
    this._ro.observe(this.el);
  }

  _resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = Math.max(120, Math.floor(r.width));
    this.h = Math.max(160, Math.floor(r.height));
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _bindEvents() {
    let dragging = false, lastX = 0, lastZ = 0;
    const c = this.canvas;
    c.addEventListener('pointerdown', e => {
      dragging = true; c.setPointerCapture(e.pointerId);
      lastX = e.clientX; lastZ = e.clientY;
    });
    c.addEventListener('pointermove', e => {
      const rect = c.getBoundingClientRect();
      this.hover = this.screenToBlock(e.clientX - rect.left, e.clientY - rect.top);
      if (dragging) {
        this.view.cx -= (e.clientX - lastX) * this.view.zoom * (this.canvas.width / this.w) / (this.canvas.width / this.w);
        this.view.cz -= (e.clientY - lastZ) * this.view.zoom;
        lastX = e.clientX; lastZ = e.clientY;
        this.schedule();
      } else this._updateStatus();
    });
    const up = () => { dragging = false; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoomBy(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
    c.addEventListener('click', e => {
      const rect = c.getBoundingClientRect();
      const b = this.screenToBlock(e.clientX - rect.left, e.clientY - rect.top);
      const hit = this.markers.find(m => this.blockToScreen(m.x, m.z).some((v, i) => Math.abs(v - [e.clientX - rect.left, e.clientY - rect.top][i]) < 9));
      if (hit && this.onMarkerClick) this.onMarkerClick(hit);
      else if (this.onMapClick) this.onMapClick(b);
    });
    this.el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'in') this.zoomBy(-1);
      else if (a === 'out') this.zoomBy(1);
      else { this.view.cx = 0; this.view.cz = 0; this.view.zoom = 1; this.schedule(); }
    }));
  }

  zoomBy(dir) {
    const i = ZOOM_LEVELS.indexOf(this.view.zoom);
    const ni = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, (i < 0 ? 0 : i) + dir));
    this.view.zoom = ZOOM_LEVELS[ni];
    this.schedule();
  }

  /* ------------------------------------------------------------ 坐标换算 */
  blockToScreen(bx, bz) {
    return [
      this.w / 2 + (bx - this.view.cx) / this.view.zoom,
      this.h / 2 + (bz - this.view.cz) / this.view.zoom,
    ];
  }
  screenToBlock(px, pz) {
    return {
      x: Math.round(this.view.cx + (px - this.w / 2) * this.view.zoom),
      z: Math.round(this.view.cz + (pz - this.h / 2) * this.view.zoom),
    };
  }

  /* ------------------------------------------------------------ 渲染调度 */
  schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
  }

  _visibleTiles() {
    const halfW = this.w / 2 * this.view.zoom, halfH = this.h / 2 * this.view.zoom;
    const x0 = this.view.cx - halfW, z0 = this.view.cz - halfH;
    const x1 = this.view.cx + halfW, z1 = this.view.cz + halfH;
    const tx0 = Math.floor(x0 / TILE_BLOCKS), tx1 = Math.floor(x1 / TILE_BLOCKS);
    const tz0 = Math.floor(z0 / TILE_BLOCKS), tz1 = Math.floor(z1 / TILE_BLOCKS);
    const out = [];
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) out.push([tx, tz]);
    return out;
  }
  _tileKey(tx, tz) {
    const s = this.state;
    return `${s.core}|${s.edition}|${s.version}|${s.dimension}|${s.largeBiomes ? 1 : 0}|${s.seed}|${s.y}|${tx}|${tz}`;
  }

  _draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, this.w, this.h);
    if (!this.ready || this.state.seed == null) {
      this._placeholder(this.state.seed == null ? '输入种子以生成地图' : '加载中…');
      return;
    }
    const vis = this._visibleTiles();
    let pending = 0;
    for (const [tx, tz] of vis) {
      const key = this._tileKey(tx, tz);
      const t = this.tiles.get(key);
      const [sx, sy] = this.blockToScreen(tx * TILE_BLOCKS, tz * TILE_BLOCKS);
      const size = TILE_BLOCKS / this.view.zoom;
      if (t && t.ready) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(t.canvas, sx, sy, size, size);
      } else {
        pending++;
        ctx.fillStyle = '#12161d';
        ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(size) + 1, Math.ceil(size) + 1);
        if (!t) this._requestTile(tx, tz, key);
      }
    }
    this._drawMarkers();
    this._pruneCache();
    if (pending && !this._hudPending) { /* 占用提示由状态栏体现 */ }
  }

  _placeholder(text) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, this.w / 2, this.h / 2);
    ctx.textAlign = 'left';
  }

  _requestTile(tx, tz, key) {
    this.tileQueue.push({ tx, tz, key });
    this._pump();
  }
  async _pump() {
    while (this.inflight < this.maxInflight && this.tileQueue.length) {
      const job = this.tileQueue.shift();
      if (this.tiles.has(job.key)) continue;
      this.tiles.set(job.key, { ready: false });
      this.inflight++;
      const gx = job.tx * TILE_GRID, gz = job.tz * TILE_GRID;
      this._send('tile', { x: gx, z: gz, size: TILE_GRID, y: this.state.y })
        .then(async r => {
          const cv = document.createElement('canvas');
          cv.width = r.size; cv.height = r.size;
          const c2 = cv.getContext('2d');
          c2.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.size, r.size), 0, 0);
          this.tiles.set(job.key, { canvas: cv, ready: true });
          this.schedule();
        })
        .catch(err => { this.tiles.delete(job.key); console.warn('瓦片失败', err); })
        .finally(() => { this.inflight--; this._pump(); });
    }
  }
  _pruneCache() {
    if (this.tiles.size <= 420) return;
    const vis = new Set(this._visibleTiles().map(([a, b]) => this._tileKey(a, b)));
    for (const k of this.tiles.keys()) {
      if (this.tiles.size <= 320) break;
      if (!vis.has(k)) this.tiles.delete(k);
    }
  }

  /* ------------------------------------------------------------ 标记 */
  setMarkers(list) { this.markers = list || []; this.schedule(); }
  addMarkers(list) { this.markers.push(...(list || [])); this.schedule(); }

  _drawMarkers() {
    const ctx = this.ctx;
    for (const m of this.markers) {
      const [px, py] = this.blockToScreen(m.x, m.z);
      if (px < -30 || py < -30 || px > this.w + 30 || py > this.h + 30) continue;
      const color = m.color || '#ffd43b';
      ctx.beginPath();
      ctx.arc(px, py, m.big ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,.65)';
      ctx.stroke();
      if (m.label) {
        ctx.font = '11px system-ui, sans-serif';
        const tw = ctx.measureText(m.label).width;
        ctx.fillStyle = 'rgba(0,0,0,.72)';
        ctx.fillRect(px + 8, py - 8, tw + 8, 16);
        ctx.fillStyle = '#fff';
        ctx.fillText(m.label, px + 12, py + 4);
      }
    }
    // 出生点十字
    if (this.spawn) {
      const [px, py] = this.blockToScreen(this.spawn.x, this.spawn.z);
      ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px - 8, py); ctx.lineTo(px + 8, py);
      ctx.moveTo(px, py - 8); ctx.lineTo(px, py + 8);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.stroke();
    }
  }

  setLegend(items) {
    if (!items || !items.length) { this.legend.classList.add('hidden'); return; }
    this.legend.classList.remove('hidden');
    this.legend.innerHTML = items.map(i =>
      `<div class="lg"><span class="sw" style="background:${i.color}"></span>${escapeHtml(i.label)}</div>`).join('');
  }

  _updateStatus() {
    if (!this.hover) return;
    const { x, z } = this.hover;
    this.status.textContent = `X ${x}  Z ${z}  ·  ${this.view.zoom} px/块  ·  格 ${Math.round(x / 4)} ${Math.round(z / 4)}`;
    if (this.onHover) this.onHover(this.hover);
  }

  destroy() { this._ro.disconnect(); this.worker.terminate(); }

  /** 导出当前视图为 PNG dataURL */
  toDataURL() {
    const cv = document.createElement('canvas');
    cv.width = this.w; cv.height = this.h;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#0a0c10'; c2.fillRect(0, 0, this.w, this.h);
    c2.drawImage(this.canvas, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png');
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

/* ------------------------------------------------ 结构 / 矿石 数据集 */
export const STRUCTURE_GROUPS = [
  {
    label: { zh: '村庄与营地', en: 'Villages & camps' },
    items: [
      { id: 'village', color: '#e8b339', dim: 'overworld' },
      { id: 'pillager_outpost', color: '#a0713c', dim: 'overworld' },
      { id: 'swamp_hut', color: '#4f7942', dim: 'overworld' },
      { id: 'igloo', color: '#9ad5f0', dim: 'overworld' },
    ],
  },
  {
    label: { zh: '神殿与遗迹', en: 'Temples & ruins' },
    items: [
      { id: 'desert_pyramid', color: '#e3c878' , dim: 'overworld' },
      { id: 'jungle_temple', color: '#2f9e44', dim: 'overworld' },
      { id: 'ocean_ruin', color: '#4dabf7', dim: 'overworld' },
      { id: 'ruined_portal', color: '#9775fa', dim: 'overworld' },
      { id: 'trail_ruins', color: '#c98a5b', dim: 'overworld' },
    ],
  },
  {
    label: { zh: '要塞与地牢', en: 'Strongholds & dungeons' },
    items: [
      { id: 'ancient_city', color: '#424750', dim: 'overworld' },
      { id: 'woodland_mansion', color: '#7a4b2a', dim: 'overworld' },
      { id: 'trial_chambers', color: '#c0a2e8', dim: 'overworld' },
      { id: 'mineshaft', color: '#8a7358', dim: 'overworld' },
      { id: 'amethyst_geode', color: '#b47ae8', dim: 'overworld' },
      { id: 'desert_well', color: '#dcbf7f', dim: 'overworld' },
    ],
  },
  {
    label: { zh: '海洋与宝藏', en: 'Ocean & treasure' },
    items: [
      { id: 'ocean_monument', color: '#22b8cf', dim: 'overworld' },
      { id: 'shipwreck', color: '#a98467', dim: 'overworld' },
      { id: 'buried_treasure', color: '#f59f00', dim: 'overworld' },
    ],
  },
  {
    label: { zh: '下界', en: 'Nether' },
    items: [
      { id: 'nether_fortress', color: '#b02a2a', dim: 'nether' },
      { id: 'bastion_remnant', color: '#6d4c41', dim: 'nether' },
      { id: 'ruined_portal_nether', color: '#9775fa', dim: 'nether' },
    ],
  },
  {
    label: { zh: '末地', en: 'The End' },
    items: [
      { id: 'end_city', color: '#b197fc', dim: 'end' },
    ],
  },
];

export const ALL_STRUCTURES = STRUCTURE_GROUPS.flatMap(g => g.items);
export const STRUCTURE_META = Object.fromEntries(ALL_STRUCTURES.map(s => [s.id, s]));

/* 矿物：由「结构/特征」组合近似表达，标注各自定位精度 */
export const ORES = [
  { id: 'diamond', ores: ['diamond_ore', 'deepslate_diamond_ore'], color: '#4dd0e1', y: { java: '-64 – 16', bedrock: '-64 – 15' }, accuracy: 'exact' },
  { id: 'ancient_debris', ores: ['ancient_debris'], color: '#8d6e63', y: { java: '8 – 119', bedrock: '8 – 119' }, accuracy: 'exact', dim: 'nether' },
  { id: 'iron', ores: ['iron_ore', 'deepslate_iron_ore'], color: '#d8a07a', y: { java: '-64 – 320', bedrock: '-64 – 320' }, accuracy: 'exact' },
  { id: 'gold', ores: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'], color: '#ffd43b', y: { java: '-64 – 32', bedrock: '-64 – 30' }, accuracy: 'exact' },
  { id: 'redstone', ores: ['redstone_ore', 'deepslate_redstone_ore'], color: '#e03131', y: { java: '-64 – 15', bedrock: '-64 – 15' }, accuracy: 'exact' },
  { id: 'copper', ores: ['copper_ore', 'deepslate_copper_ore'], color: '#e8935c', y: { java: '-16 – 112', bedrock: '-16 – 112' }, accuracy: 'exact' },
  { id: 'lapis', ores: ['lapis_ore', 'deepslate_lapis_ore'], color: '#3b5bdb', y: { java: '-64 – 64', bedrock: '-64 – 64' }, accuracy: 'exact' },
  { id: 'coal', ores: ['coal_ore', 'deepslate_coal_ore'], color: '#495057', y: { java: '0 – 320', bedrock: '0 – 320' }, accuracy: 'exact' },
  { id: 'emerald', ores: ['emerald_ore', 'deepslate_emerald_ore'], color: '#2f9e44', y: { java: '-16 – 320', bedrock: '-16 – 320' }, accuracy: 'exact' },
];
