/* =========================================================
   方块世界 · 迷你体素沙盒
   纯前端实现：Three.js + 程序化贴图 + 区块网格合并
   ========================================================= */
(function () {
  'use strict';

  var loadingEl = document.getElementById('loading');
  if (typeof THREE === 'undefined') {
    loadingEl.textContent = '加载失败：缺少 three.js';
    return;
  }

  /* ===================== 1. 方块定义与贴图 ===================== */
  var TILE = 16, ATLAS_N = 4, ATLAS = TILE * ATLAS_N;

  var BLOCKS = {
    1: { name: '草方块', top: 0, side: 1, bottom: 2, color: '#5fae37' },
    2: { name: '泥土',   top: 2, side: 2, bottom: 2, color: '#91613a' },
    3: { name: '石头',   top: 3, side: 3, bottom: 3, color: '#8b8b8b' },
    4: { name: '沙子',   top: 4, side: 4, bottom: 4, color: '#e3d49a' },
    5: { name: '原木',   top: 6, side: 5, bottom: 6, color: '#7a5730' },
    6: { name: '树叶',   top: 7, side: 7, bottom: 7, color: '#3f7f2c' },
    7: { name: '木板',   top: 8, side: 8, bottom: 8, color: '#bd9152' },
    8: { name: '砖块',   top: 9, side: 9, bottom: 9, color: '#a8463c' },
    9: { name: '圆石',   top: 10, side: 10, bottom: 10, color: '#7d7d7d' }
  };
  var HOTBAR = [1, 2, 3, 4, 5, 6, 7, 8, 9];

  var atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = atlasCanvas.height = ATLAS;
  var actx = atlasCanvas.getContext('2d');
  actx.imageSmoothingEnabled = false;

  function hashf(x, y, s) {
    var n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function mul(hex, k) {
    var n = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.round(((n >> 16) & 255) * k));
    var g = Math.min(255, Math.round(((n >> 8) & 255) * k));
    var b = Math.min(255, Math.round((n & 255) * k));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function px(tile, x, y, color) {
    actx.fillStyle = color;
    actx.fillRect((tile % ATLAS_N) * TILE + x, ((tile / ATLAS_N) | 0) * TILE + y, 1, 1);
  }
  function tilePixels(tile, fn) {
    for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) px(tile, x, y, fn(x, y));
  }
  // 给方块贴图描一圈淡淡的暗边，让方块之间有轮廓
  function edgeDarken(tile, k) {
    var tx = (tile % ATLAS_N) * TILE, ty = ((tile / ATLAS_N) | 0) * TILE;
    var img = actx.getImageData(tx, ty, TILE, TILE);
    var d = img.data;
    for (var y = 0; y < TILE; y++) {
      for (var x = 0; x < TILE; x++) {
        if (x !== 0 && y !== 0 && x !== TILE - 1 && y !== TILE - 1) continue;
        var i = (y * TILE + x) * 4;
        d[i] = d[i] * k; d[i + 1] = d[i + 1] * k; d[i + 2] = d[i + 2] * k;
      }
    }
    actx.putImageData(img, tx, ty);
  }
  function paintAtlas() {
    // 0 草顶
    tilePixels(0, function (x, y) {
      var patch = hashf(x >> 2, y >> 2, 5) * 0.16;
      var n = hashf(x, y, 3);
      return mul('#5aa832', 0.76 + patch + n * 0.22 + (n > 0.95 ? -0.14 : 0));
    });
    // 1 泥土
    tilePixels(2, function (x, y) {
      var patch = hashf(x >> 2, y >> 2, 9) * 0.14;
      var n = hashf(x, y, 7);
      return mul('#8a5a33', 0.72 + patch + n * 0.26 + (n > 0.93 ? -0.16 : 0));
    });
    // 2 草侧面
    tilePixels(1, function (x, y) {
      var n = hashf(x, y, 11);
      var patch = hashf(x >> 2, y >> 2, 13) * 0.14;
      var edge = 4 + Math.floor(hashf(x, 0, 19) * 4);
      if (y < edge) return mul('#57a336', 0.76 + patch + n * 0.24);
      if (y === edge) return mul('#4a8b2e', 0.8 + n * 0.2);
      return mul('#8a5a33', 0.68 + patch + n * 0.24 + (n > 0.93 ? -0.16 : 0));
    });
    // 3 石头
    tilePixels(3, function (x, y) {
      var n = hashf(x, y, 23);
      var patch = hashf(x >> 2, y >> 2, 29) * 0.18;
      var v = 0.72 + patch + n * 0.26;
      if (hashf(x >> 1, y >> 1, 31) > 0.86) v *= 0.84;
      return mul('#8c8c8c', v);
    });
    // 4 沙子
    tilePixels(4, function (x, y) {
      var patch = hashf(x >> 2, y >> 2, 47) * 0.12;
      var n = hashf(x, y, 41);
      return mul('#e2d495', 0.84 + patch + n * 0.2);
    });
    // 5 原木侧面
    tilePixels(5, function (x, y) {
      var n = hashf(x, y, 53);
      var stripe = (x % 4 === 0) ? 0.78 : 1;
      return mul('#6d4c2c', (0.8 + n * 0.36) * stripe);
    });
    // 6 原木顶面
    tilePixels(6, function (x, y) {
      var dx = x - 7.5, dy = y - 7.5;
      var d = Math.sqrt(dx * dx + dy * dy);
      var ring = (Math.floor(d * 1.15) % 3 === 0) ? 0.86 : 1;
      var n = hashf(x, y, 61);
      var base = d > 7.4 ? '#6d4c2c' : '#a3803f';
      return mul(base, (0.86 + n * 0.24) * ring);
    });
    // 7 树叶
    tilePixels(7, function (x, y) {
      var n = hashf(x, y, 71);
      if (n > 0.86) return mul('#2c5a1e', 0.75);
      return mul('#3d7a29', 0.72 + n * 0.6);
    });
    // 8 木板
    tilePixels(8, function (x, y) {
      var n = hashf(x, y, 83);
      var seam = (y % 5 === 0) ? 0.7 : 1;
      var vseam = (x === 5 || x === 12) ? 0.82 : 1;
      return mul('#b98d4f', (0.84 + n * 0.28) * seam * vseam);
    });
    // 9 砖块
    tilePixels(9, function (x, y) {
      var row = Math.floor(y / 4);
      var off = row % 2 ? 4 : 0;
      var mortar = (y % 4 === 0) || ((x + off) % 8 === 0);
      if (mortar) return mul('#cfc3b0', 0.92 + hashf(x, y, 97) * 0.14);
      return mul('#a8463c', 0.8 + hashf(x, y, 101) * 0.34);
    });
    // 10 圆石
    tilePixels(10, function (x, y) {
      var n = hashf(x >> 1, y >> 1, 113);
      var v = 0.68 + n * 0.5;
      if (hashf(x, y, 127) > 0.9) v *= 0.8;
      return mul('#8a8a8a', v);
    });
  }
  paintAtlas();
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(function (t) { edgeDarken(t, 0.9); });

  var atlasTex = new THREE.CanvasTexture(atlasCanvas);
  atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.minFilter = THREE.NearestFilter;
  atlasTex.generateMipmaps = false;
  atlasTex.flipY = false;
  if (THREE.sRGBEncoding) atlasTex.encoding = THREE.sRGBEncoding;

  /* ===================== 2. 世界数据 ===================== */
  var CH = 16;            // 区块水平尺寸
  var WH = 48;            // 世界高度
  var RD = 4;             // 渲染半径（区块）
  var SEA = 9;

  var chunks = new Map();
  var edits = new Map();  // 玩家改动： "cx,cz" -> Map(index -> id)
  var saveDirty = false;

  function ckey(cx, cz) { return cx + ',' + cz; }

  function vnoise(x, z, s) {
    var xi = Math.floor(x), zi = Math.floor(z);
    var xf = x - xi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    var a = hashf(xi, zi, s), b = hashf(xi + 1, zi, s);
    var c = hashf(xi, zi + 1, s), d = hashf(xi + 1, zi + 1, s);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  function surfaceH(wx, wz) {
    var a = vnoise(wx * 0.013, wz * 0.013, 11);
    var b = vnoise(wx * 0.045, wz * 0.045, 37);
    var c = vnoise(wx * 0.12, wz * 0.12, 71);
    var m = vnoise(wx * 0.0055, wz * 0.0055, 131);
    // 中部压平、边缘起伏 -> 大片草地 + 局部丘陵
    var t = (a - 0.5) * 2;
    var hills = (t < 0 ? -1 : 1) * Math.pow(Math.abs(t), 1.7) * 17;
    var h = 13 + hills + (b - 0.5) * 2.6 + (c - 0.5) * 0.9;
    if (m > 0.60) h += (m - 0.60) * 52;
    return Math.max(3, Math.min(WH - 12, Math.floor(h)));
  }

  function localSet(c, x, y, z, id, onlyAir) {
    if (x < 0 || x >= CH || z < 0 || z >= CH || y < 0 || y >= WH) return;
    var i = x + z * CH + y * CH * CH;
    if (onlyAir && c.data[i]) return;
    c.data[i] = id;
  }

  function genTrees(c) {
    var seed = (Math.imul(c.cx, 73856093) ^ Math.imul(c.cz, 19349663)) >>> 0;
    function rand() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    var count = 1 + Math.floor(rand() * 3);
    for (var i = 0; i < count; i++) {
      var lx = 3 + Math.floor(rand() * (CH - 6));
      var lz = 3 + Math.floor(rand() * (CH - 6));
      var wx = c.cx * CH + lx, wz = c.cz * CH + lz;
      var h = surfaceH(wx, wz);
      if (h <= SEA + 1) continue;
      var th = 4 + Math.floor(rand() * 3);
      if (h + th + 2 >= WH) continue;
      if (rand() < 0.18) continue;
      for (var y = 1; y <= th; y++) localSet(c, lx, h + y, lz, 5);
      var top = h + th;
      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
          for (var dz = -2; dz <= 2; dz++) {
            var r = dx * dx + dy * dy + dz * dz;
            if (r > 5.2) continue;
            if (dy === 2 && Math.abs(dx) + Math.abs(dz) > 1) continue;
            localSet(c, lx + dx, top + dy, lz + dz, 6, true);
          }
        }
      }
    }
  }

  function genChunk(c) {
    var ox = c.cx * CH, oz = c.cz * CH;
    for (var z = 0; z < CH; z++) {
      for (var x = 0; x < CH; x++) {
        var h = surfaceH(ox + x, oz + z);
        var sandy = h <= SEA + 1;
        for (var y = 0; y <= h; y++) {
          var id;
          if (y === h) id = sandy ? 4 : 1;
          else if (y > h - 4) id = sandy ? 4 : 2;
          else id = 3;
          c.data[x + z * CH + y * CH * CH] = id;
        }
      }
    }
    genTrees(c);
    var e = edits.get(ckey(c.cx, c.cz));
    if (e) e.forEach(function (v, idx) { if (idx < c.data.length) c.data[idx] = v; });
    c.dirty = true;
  }

  function ensureChunk(cx, cz) {
    var k = ckey(cx, cz);
    var c = chunks.get(k);
    if (c) return c;
    c = { cx: cx, cz: cz, data: new Uint8Array(CH * CH * WH), mesh: null, dirty: true };
    genChunk(c);
    chunks.set(k, c);
    netApplyChunk(c);
    var nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var n = chunks.get(ckey(cx + nb[i][0], cz + nb[i][1]));
      if (n) n.dirty = true;
    }
    return c;
  }

  function getBlock(x, y, z) {
    if (y < 0) return 3;
    if (y >= WH) return 0;
    var cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    var c = chunks.get(ckey(cx, cz));
    if (!c) return 1;  // 未加载区块当作实心，避免边界穿视
    return c.data[(x - cx * CH) + (z - cz * CH) * CH + y * CH * CH];
  }

  function markDirty(cx, cz) {
    var c = chunks.get(ckey(cx, cz));
    if (c) c.dirty = true;
  }

  function setBlock(x, y, z, id, remote) {
    if (y < 0 || y >= WH) return;
    var cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    var c = chunks.get(ckey(cx, cz));
    if (!c) return;
    var lx = x - cx * CH, lz = z - cz * CH;
    var idx = lx + lz * CH + y * CH * CH;
    if (c.data[idx] === id) return;
    c.data[idx] = id;
    c.dirty = true;
    if (lx === 0) markDirty(cx - 1, cz);
    if (lx === CH - 1) markDirty(cx + 1, cz);
    if (lz === 0) markDirty(cx, cz - 1);
    if (lz === CH - 1) markDirty(cx, cz + 1);
    var e = edits.get(ckey(cx, cz));
    if (!e) { e = new Map(); edits.set(ckey(cx, cz), e); }
    e.set(idx, id);
    saveDirty = true;
    if (!remote) netBlockChanged(x, y, z, id);
  }

  /* ===================== 3. 场景与渲染 ===================== */
  var canvas = document.getElementById('game');
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (err) {
    loadingEl.textContent = '当前设备不支持 WebGL，无法运行';
    return;
  }
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

  var SKY = 0x9fd3ee;
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, RD * CH - 18, RD * CH + 14);

  var camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 400);
  camera.rotation.order = 'YXZ';

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  var dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
  dirLight.position.set(0.6, 1, 0.35);
  scene.add(dirLight);

  var blockMat = new THREE.MeshBasicMaterial({
    map: atlasTex, vertexColors: true, fog: true
  });

  var FACES = [
    { d: [1, 0, 0], s: 0.80, v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
    { d: [-1, 0, 0], s: 0.68, v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
    { d: [0, 1, 0], s: 1.00, v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { d: [0, -1, 0], s: 0.50, v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { d: [0, 0, 1], s: 0.90, v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
    { d: [0, 0, -1], s: 0.62, v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }
  ];
  var TRI = [0, 1, 2, 0, 2, 3];

  function buildMesh(c) {
    var data = c.data, ox = c.cx * CH, oz = c.cz * CH;
    var P = [], U = [], C = [];
    var du = 1 / ATLAS_N;
    for (var y = 0; y < WH; y++) {
      for (var z = 0; z < CH; z++) {
        var rowBase = z * CH + y * CH * CH;
        for (var x = 0; x < CH; x++) {
          var id = data[rowBase + x];
          if (!id) continue;
          var def = BLOCKS[id] || BLOCKS[1];
          var tint = 0.93 + hashf(x + ox * 3, y * 7, z + oz * 3) * 0.14;
          for (var f = 0; f < 6; f++) {
            var F = FACES[f];
            var nx = x + F.d[0], ny = y + F.d[1], nz = z + F.d[2];
            var nb;
            if (nx >= 0 && nx < CH && nz >= 0 && nz < CH && ny >= 0 && ny < WH) {
              nb = data[nx + nz * CH + ny * CH * CH];
            } else {
              nb = getBlock(ox + nx, ny, oz + nz);
            }
            if (nb) continue;
            var tile = F.d[1] > 0 ? def.top : (F.d[1] < 0 ? def.bottom : def.side);
            var u0 = (tile % ATLAS_N) * du, v0 = ((tile / ATLAS_N) | 0) * du;
            var u1 = u0 + du, v1 = v0 + du;
            var sh = F.s * tint;
            for (var t = 0; t < 6; t++) {
              var k = TRI[t];
              var vv = F.v[k];
              P.push(x + vv[0], y + vv[1], z + vv[2]);
              U.push(k === 1 || k === 2 ? u1 : u0, k < 2 ? v1 : v0);
              C.push(sh, sh, sh);
            }
          }
        }
      }
    }
    if (c.mesh) {
      scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    if (P.length) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      g.computeBoundingSphere();
      var mesh = new THREE.Mesh(g, blockMat);
      mesh.position.set(ox, 0, oz);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      c.mesh = mesh;
    }
    c.dirty = false;
  }

  function disposeChunk(c) {
    if (c.mesh) {
      scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
  }

  // 第一人称手臂（视图模型）
  scene.add(camera);
  var armPivot = new THREE.Group();
  var sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.34),
    new THREE.MeshLambertMaterial({ color: 0x2a8f89 }));
  sleeve.position.z = -0.05;
  var hand = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.19, 0.26),
    new THREE.MeshLambertMaterial({ color: 0xdcae86 }));
  hand.position.z = -0.32;
  armPivot.add(sleeve);
  armPivot.add(hand);
  armPivot.position.set(0.74, -0.62, -0.86);
  armPivot.rotation.set(0.04, 0.34, 0.09);
  armPivot.scale.setScalar(0.46);
  camera.add(armPivot);

  // 手持方块：每个方块类型取顶/侧/底三张 tile 做独立纹理，
  // 贴到一个 6 面材质不同的立方体上（比直接切图集 UV 稳，
  // 图集那种做法在这个渲染管线里会整块不显示）
  var tileTexCache = {};
  function tileTex(t) {
    if (tileTexCache[t]) return tileTexCache[t];
    var cv = document.createElement('canvas');
    cv.width = cv.height = TILE;
    var g2 = cv.getContext('2d');
    g2.imageSmoothingEnabled = false;
    g2.drawImage(atlasCanvas, (t % ATLAS_N) * TILE, ((t / ATLAS_N) | 0) * TILE,
      TILE, TILE, 0, 0, TILE, TILE);
    var tx = new THREE.CanvasTexture(cv);
    tx.magFilter = THREE.NearestFilter;
    tx.minFilter = THREE.NearestFilter;
    tx.generateMipmaps = false;
    if (THREE.sRGBEncoding) tx.encoding = THREE.sRGBEncoding;
    tileTexCache[t] = tx;
    return tx;
  }

  var heldMatsCache = {};
  function heldMats(id) {
    if (heldMatsCache[id]) return heldMatsCache[id];
    var def = BLOCKS[id] || BLOCKS[1];
    function mk(tile, k) {
      return new THREE.MeshBasicMaterial({
        map: tileTex(tile), color: new THREE.Color().setScalar(k)
      });
    }
    // BoxGeometry 的面序：+x -x +y -y +z -z，靠亮度差做出立体感
    var mats = [
      mk(def.side, 0.86), mk(def.side, 0.66),
      mk(def.top, 1.0), mk(def.bottom, 0.52),
      mk(def.side, 0.94), mk(def.side, 0.60)
    ];
    heldMatsCache[id] = mats;
    return mats;
  }

  var heldGeo = new THREE.BoxGeometry(1, 1, 1);
  var heldMesh = new THREE.Mesh(heldGeo, heldMats(1));
  heldMesh.scale.setScalar(0.42);
  heldMesh.position.set(0.02, 0.005, -0.44);
  heldMesh.rotation.set(0.06, -0.5, 0.04);
  heldMesh.visible = false;
  armPivot.add(heldMesh);

  // 描边：反面渲染一个略大的深色壳，避免草方块在草地上整块"消失"
  var heldEdge = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 1.05, 1.05),
    new THREE.MeshBasicMaterial({ color: 0x0b1218, side: THREE.BackSide })
  );
  heldMesh.add(heldEdge);

  var heldId = -1;
  function updateHeld() {
    var id = selectedId();
    if (id === heldId) return;
    heldId = id;
    if (!id || !BLOCKS[id]) { heldMesh.visible = false; return; }
    heldMesh.material = heldMats(id);
    heldMesh.visible = true;
  }

  var swingT = 0, walkPhase = 0;
  function swing() { swingT = 1; }

  // 选中方块高亮框
  var hlGeo = new THREE.BoxGeometry(1.006, 1.006, 1.006);
  var hl = new THREE.LineSegments(
    new THREE.EdgesGeometry(hlGeo),
    new THREE.LineBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55 })
  );
  hl.visible = false;
  scene.add(hl);

  // 云
  var clouds = new THREE.Group();
  (function () {
    var cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, fog: false });
    var cg = new THREE.BoxGeometry(1, 1, 1);
    for (var i = 0; i < 26; i++) {
      var m = new THREE.Mesh(cg, cm);
      m.position.set((Math.random() - 0.5) * 420, 62 + Math.random() * 16, (Math.random() - 0.5) * 420);
      m.scale.set(14 + Math.random() * 26, 1.6 + Math.random() * 2, 12 + Math.random() * 22);
      clouds.add(m);
    }
  })();
  scene.add(clouds);

  // 太阳
  var sun = new THREE.Mesh(
    new THREE.CircleGeometry(30, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff8d8, fog: false, transparent: true, opacity: 0.9 })
  );
  sun.position.set(-120, 200, -260);
  scene.add(sun);

  /* ===================== 4. 玩家 ===================== */
  var HALF = 0.3, PHEIGHT = 1.75, EYE = 1.62;
  var GRAV = 28, JUMP = 8.6;
  // 移动速度（格/秒）：原版行走 4.32、疾跑 5.61、潜行 1.30
  // 手机屏幕视野小，整体上调约 1.25 倍，手感更接近 pc 版
  var WALK_SPEED = 5.2, SPRINT_SPEED = 7.2, SNEAK_SPEED = 2.0, FLY_SPEED = 10.0;
  var sprinting = false, sprintHold = 0, walkBob = 0;

  var P = {
    pos: new THREE.Vector3(8, 30, 8),
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0, pitch: 0,
    onGround: false,
    fly: false
  };

  function boxCollides(px, py, pz, half, height) {
    var x0 = Math.floor(px - half), x1 = Math.floor(px + half);
    var y0 = Math.floor(py + 0.001), y1 = Math.floor(py + height - 0.001);
    var z0 = Math.floor(pz - half), z1 = Math.floor(pz + half);
    for (var y = y0; y <= y1; y++) {
      for (var z = z0; z <= z1; z++) {
        for (var x = x0; x <= x1; x++) {
          if (getBlock(x, y, z)) return true;
        }
      }
    }
    return false;
  }
  function playerCollides(px, py, pz) { return boxCollides(px, py, pz, HALF, PHEIGHT); }

  function cameraDir() {
    var cp = Math.cos(P.pitch);
    return new THREE.Vector3(-Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp);
  }

  /* ===================== 5. 输入 ===================== */
  var input = {
    mx: 0, mz: 0, jump: false, sneak: false, mine: false, run: false,
    started: false, lookId: null, stickId: null, lastX: 0, lastY: 0
  };

  /* ===================== 5.1 背包（前 9 格＝快捷栏，与原版一致） ===================== */
  var INV_SIZE = 36, HOTBAR_SIZE = 9, STACK_MAX = 64;
  var inv = [];
  for (var ii = 0; ii < INV_SIZE; ii++) inv.push(null);
  var hotbarIndex = 0;

  var iconCache = {};
  function iconURL(id) {
    if (iconCache[id]) return iconCache[id];
    var cv = document.createElement('canvas');
    cv.width = cv.height = 48;
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    var t = BLOCKS[id].side;
    g.drawImage(atlasCanvas, (t % ATLAS_N) * TILE, ((t / ATLAS_N) | 0) * TILE, TILE, TILE, 0, 0, 48, 48);
    iconCache[id] = cv.toDataURL();
    return iconCache[id];
  }

  function selectedId() { return inv[hotbarIndex] ? inv[hotbarIndex].id : 0; }

  // 先补已有同类堆叠，再放空格子（快捷栏优先，和原版一致）
  function addItem(id, n) {
    if (!id || n <= 0) return false;
    for (var a = 0; a < INV_SIZE && n > 0; a++) {
      var it = inv[a];
      if (it && it.id === id && it.n < STACK_MAX) {
        var c = Math.min(n, STACK_MAX - it.n);
        it.n += c; n -= c;
      }
    }
    for (var b = 0; b < INV_SIZE && n > 0; b++) {
      if (!inv[b]) {
        var c2 = Math.min(n, STACK_MAX);
        inv[b] = { id: id, n: c2 };
        n -= c2;
      }
    }
    return n <= 0;
  }

  function starterKit() {
    for (var a = 0; a < INV_SIZE; a++) inv[a] = null;
    for (var b = 0; b < HOTBAR_SIZE; b++) inv[b] = { id: HOTBAR[b], n: 64 };
    hotbarIndex = 0;
  }

  function bindTouches() {
    var stick = document.getElementById('stick');
    var knob = stick.querySelector('.knob');

    stick.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      input.stickId = t.identifier;
      handleStick(t);
    }, { passive: false });
    stick.addEventListener('touchmove', function (e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === input.stickId) handleStick(e.changedTouches[i]);
      }
    }, { passive: false });
    function endStick(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === input.stickId) {
          input.stickId = null; input.mx = 0; input.mz = 0;
          knob.style.transform = 'translate(0,0)';
        }
      }
    }
    stick.addEventListener('touchend', endStick);
    stick.addEventListener('touchcancel', endStick);

    function handleStick(t) {
      var r = stick.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = t.clientX - cx, dy = t.clientY - cy;
      var max = r.width * 0.34;
      var len = Math.hypot(dx, dy);
      if (len > max) { dx = dx / len * max; dy = dy / len * max; }
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      input.mx = dx / max;
      input.mz = -dy / max;
      if (Math.hypot(input.mx, input.mz) < 0.14) { input.mx = 0; input.mz = 0; }
    }

    // 视角拖动
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      if (!input.started) return;
      if (input.lookId !== null) return;
      var t = e.changedTouches[0];
      input.lookId = t.identifier;
      input.lastX = t.clientX; input.lastY = t.clientY;
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (input.lookId === null) return;
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier !== input.lookId) continue;
        var dx = t.clientX - input.lastX, dy = t.clientY - input.lastY;
        input.lastX = t.clientX; input.lastY = t.clientY;
        P.yaw -= dx * 0.0038;
        P.pitch -= dy * 0.0038;
        clampPitch();
      }
    }, { passive: false });
    function endLook(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === input.lookId) input.lookId = null;
      }
    }
    canvas.addEventListener('touchend', endLook);
    canvas.addEventListener('touchcancel', endLook);
    canvas.addEventListener('mousedown', function (e) {
      // 桌面端调试用：按住鼠标拖动视角
      input.lookId = 'm'; input.lastX = e.clientX; input.lastY = e.clientY;
    });
    canvas.addEventListener('mousemove', function (e) {
      if (input.lookId !== 'm') return;
      P.yaw -= (e.clientX - input.lastX) * 0.0038;
      P.pitch -= (e.clientY - input.lastY) * 0.0038;
      input.lastX = e.clientX; input.lastY = e.clientY;
      clampPitch();
    });
    window.addEventListener('mouseup', function () { if (input.lookId === 'm') input.lookId = null; });

    function holdBtn(id, onDown, onUp) {
      var el = document.getElementById(id);
      el.addEventListener('touchstart', function (e) {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('on'); onDown && onDown();
      }, { passive: false });
      function up(e) {
        if (e) e.preventDefault();
        el.classList.remove('on'); onUp && onUp();
      }
      el.addEventListener('touchend', up);
      el.addEventListener('touchcancel', up);
      // 桌面/鼠标兜底
      el.addEventListener('mousedown', function (e) { e.preventDefault(); el.classList.add('on'); onDown && onDown(); });
      el.addEventListener('mouseup', up);
      window.addEventListener('blur', function () { if (el.classList.contains('on')) up(); });
    }

    holdBtn('btnJump', function () { input.jump = true; }, function () { input.jump = false; });
    holdBtn('btnSneak', function () { input.sneak = true; }, function () { input.sneak = false; });
    holdBtn('btnRun', function () { input.run = true; }, function () { input.run = false; });
    holdBtn('btnPlace', function () { placeBlock(); }, null);
    // 攻击键：按下即挥击，按住不放则持续挖掘方块（和手机版一致）
    holdBtn('btnHit', function () { attack(true); input.mine = true; },
                      function () { input.mine = false; });
  }

  function clampPitch() {
    var lim = Math.PI / 2 - 0.02;
    if (P.pitch > lim) P.pitch = lim;
    if (P.pitch < -lim) P.pitch = -lim;
  }

  /* ===================== 6. 交互：射线 / 挖掘 / 放置 ===================== */
  function raycast(origin, dir, maxD) {
    var x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    var stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
    var tDeltaX = dir.x === 0 ? Infinity : Math.abs(1 / dir.x);
    var tDeltaY = dir.y === 0 ? Infinity : Math.abs(1 / dir.y);
    var tDeltaZ = dir.z === 0 ? Infinity : Math.abs(1 / dir.z);
    var tMaxX = dir.x === 0 ? Infinity : ((dir.x > 0 ? (x + 1 - origin.x) : (origin.x - x)) / Math.abs(dir.x));
    var tMaxY = dir.y === 0 ? Infinity : ((dir.y > 0 ? (y + 1 - origin.y) : (origin.y - y)) / Math.abs(dir.y));
    var tMaxZ = dir.z === 0 ? Infinity : ((dir.z > 0 ? (z + 1 - origin.z) : (origin.z - z)) / Math.abs(dir.z));
    var face = [0, 0, 0], t = 0, guard = 0;
    while (t <= maxD && guard++ < 128) {
      var b = getBlock(x, y, z);
      if (b) return { x: x, y: y, z: z, nx: face[0], ny: face[1], nz: face[2], dist: t, id: b };
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; face = [-stepX, 0, 0];
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; face = [0, -stepY, 0];
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = [0, 0, -stepZ];
      }
    }
    return null;
  }

  var BREAK_TIME = 0.42;
  var mineTimer = 0, mineBar = document.querySelector('#minebar i'), mineBarBox = document.getElementById('minebar');

  function currentHit() {
    return raycast(camera.position, cameraDir(), 6.5);
  }

  function doMine(dt) {
    if (!input.mine) {
      mineTimer = 0;
      if (mineBarBox) mineBarBox.style.opacity = 0;
      return;
    }
    var hit = currentHit();
    if (!hit) {
      mineTimer = 0;
      if (mineBarBox) mineBarBox.style.opacity = 0;
      return;
    }
    mineTimer += dt;
    if (mineBarBox) mineBarBox.style.opacity = 1;
    if (mineBar) mineBar.style.width = Math.min(100, mineTimer / BREAK_TIME * 100) + '%';
    if (mineTimer >= BREAK_TIME) {
      mineTimer = 0;
      var def = BLOCKS[hit.id];
      setBlock(hit.x, hit.y, hit.z, 0);
      spawnParticles(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, def ? def.color : '#888888', 9);
      addItem(hit.id, 1);
      saveDirty = true;
      renderHotbar();
      swing();
      sfx(hit.id === 3 || hit.id === 9 ? 180 : 320, 0.06, 'square', 0.09);
      vibrate(12);
    }
  }

  var placeCooldown = 0;
  function placeBlock() {
    if (placeCooldown > 0) return;
    var slot = inv[hotbarIndex];
    if (!slot || slot.n <= 0) { showTip('快捷栏这一格没有方块'); return; }
    var hit = currentHit();
    if (!hit) return;
    var tx = hit.x + hit.nx, ty = hit.y + hit.ny, tz = hit.z + hit.nz;
    if (ty < 0 || ty >= WH) return;
    if (getBlock(tx, ty, tz)) return;
    // 不能卡在自己身体里
    var px = P.pos.x, py = P.pos.y, pz = P.pos.z;
    if (tx + 1 > px - HALF && tx < px + HALF &&
        ty + 1 > py && ty < py + PHEIGHT &&
        tz + 1 > pz - HALF && tz < pz + HALF) return;
    setBlock(tx, ty, tz, slot.id);
    slot.n--;
    if (slot.n <= 0) inv[hotbarIndex] = null;
    saveDirty = true;
    renderHotbar();
    placeCooldown = 0.18;
    swing();
    sfx(480, 0.05, 'triangle', 0.07);
    vibrate(8);
  }

  /* ===================== 7. 生物（史莱姆） ===================== */
  var mobs = [];
  var mobTimer = 3;

  var mobGeo = new THREE.BoxGeometry(1, 1, 1);
  var eyeGeo = new THREE.BoxGeometry(0.18, 0.18, 0.06);
  var eyeMat = new THREE.MeshBasicMaterial({ color: 0x101a10 });

  function createMob(x, y, z) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(mobGeo, new THREE.MeshLambertMaterial({ color: 0x5fbf3e }));
    body.scale.set(0.82, 0.72, 0.82);
    body.position.y = 0.36;
    g.add(body);
    var eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.19, 0.46, 0.42);
    g.add(eyeL);
    var eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.19, 0.46, 0.42);
    g.add(eyeR);
    var mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), eyeMat);
    mouth.position.set(0, 0.27, 0.42);
    g.add(mouth);
    g.position.set(x, y, z);
    scene.add(g);
    return {
      obj: g, pos: new THREE.Vector3(x, y, z), vy: 0, hp: 3, t: 0, dx: 0, dz: 0,
      half: 0.42, h: 0.78, hurt: 0, onGround: false, stuck: 0, jumpCd: 0, boostT: 0
    };
  }

  function trySpawnMob() {
    if (mobs.length >= 6) return;
    for (var attempt = 0; attempt < 6; attempt++) {
      var a = Math.random() * Math.PI * 2;
      var r = 9 + Math.random() * 14;
      var x = Math.floor(P.pos.x + Math.cos(a) * r);
      var z = Math.floor(P.pos.z + Math.sin(a) * r);
      var cx = Math.floor(x / CH), cz = Math.floor(z / CH);
      if (!chunks.has(ckey(cx, cz))) continue;
      var gy = -1;
      for (var y = WH - 2; y > 1; y--) {
        if (getBlock(x, y, z)) { gy = y; break; }
      }
      if (gy < 1) continue;
      if (getBlock(x, gy + 1, z) || getBlock(x, gy + 2, z)) continue;
      mobs.push(createMob(x + 0.5, gy + 1.02, z + 0.5));
      return;
    }
  }

  function updateMobs(dt) {
    // 客机：怪物由房主统一模拟，本地只做插值渲染
    if (NET.on && !NET.host) { netUpdateMobs(dt); return; }
    mobTimer -= dt;
    if (mobTimer <= 0) {
      mobTimer = 5 + Math.random() * 5;
      if (mobs.length < 6) trySpawnMob();
    }
    for (var i = mobs.length - 1; i >= 0; i--) {
      var m = mobs[i];
      var d2 = (m.pos.x - P.pos.x) * (m.pos.x - P.pos.x) + (m.pos.z - P.pos.z) * (m.pos.z - P.pos.z);
      if (d2 > 52 * 52) {
        scene.remove(m.obj);
        mobs.splice(i, 1);
        continue;
      }
      m.t -= dt;
      if (m.t <= 0) {
        m.t = 1.6 + Math.random() * 2.4;
        if (Math.random() < 0.28) { m.dx = 0; m.dz = 0; }
        else {
          var ang = Math.random() * Math.PI * 2;
          m.dx = Math.cos(ang) * 1.35;
          m.dz = Math.sin(ang) * 1.35;
        }
      }
      // 靠近玩家时追过来
      var dpx = P.pos.x - m.pos.x, dpz = P.pos.z - m.pos.z;
      var dp = Math.hypot(dpx, dpz);
      if (dp < 9 && dp > 0.85) {
        m.dx = (dpx / dp) * 2.05;
        m.dz = (dpz / dp) * 2.05;
      }
      // 贴到身上就撞一下
      if (dp < 1.05 && Math.abs(P.pos.y - m.pos.y) < 1.7) {
        m.atkCd = (m.atkCd || 0) - dt;
        if (m.atkCd <= 0) {
          m.atkCd = 1.3;
          m.vy = 4.2;
          damagePlayer(2, dpx, dpz);
        }
      } else if (m.atkCd > 0) {
        m.atkCd -= dt;
      }

      // 起跳翻越时水平加个助推，不然滞空时间不够挪过 1 格宽的台阶
      var mul = m.boostT > 0 ? 2.2 : 1;
      var bx = m.pos.x, bz = m.pos.z;
      var tx = m.pos.x + m.dx * mul * dt, tz = m.pos.z + m.dz * mul * dt;
      if (!boxCollides(tx, m.pos.y, m.pos.z, m.half, m.h)) m.pos.x = tx;
      if (!boxCollides(m.pos.x, m.pos.y, tz, m.half, m.h)) m.pos.z = tz;
      var moved = Math.hypot(m.pos.x - bx, m.pos.z - bz);
      if (m.boostT > 0) m.boostT = Math.max(0, m.boostT - dt);

      // 被台阶或坑壁挡住就跳（能跨 1 格，正好从玩家挖的坑里爬出来）；
      // 前面是两格以上的墙就绕路，别原地一直撞
      var want = Math.hypot(m.dx, m.dz);
      m.jumpCd = Math.max(0, m.jumpCd - dt);
      if (m.onGround && want > 0.2) {
        if (moved < want * dt * 0.5) m.stuck += dt; else m.stuck = 0;
        if (m.stuck > 0.14) {
          var ux = m.dx / want, uz = m.dz / want;
          var ax = m.pos.x + ux * 0.55, az = m.pos.z + uz * 0.55;
          if (!boxCollides(ax, m.pos.y + 1.04, az, m.half, m.h)) {
            // 抬 1 格就通（台阶、1 格深坑）→ 普通跳，约 1.3 格
            if (m.jumpCd <= 0) {
              m.vy = 8.5;
              m.onGround = false;
              m.jumpCd = 0.45;
              m.boostT = 0.5;
              m.stuck = 0;
            }
          } else if (m.stuck > 0.9 && !boxCollides(ax, m.pos.y + 2.04, az, m.half, m.h)) {
            // 被困在 2 格深的坑里：抬 2 格才通，跳得更高爬出去
            m.vy = 11.6;
            m.onGround = false;
            m.jumpCd = 1.2;
            m.boostT = 0.85;
            m.stuck = 0;
          } else if (m.jumpCd <= 0) {
            // 前面是更高的墙，绕路（不清 stuck，卡死时仍会尝试高跳）
            m.jumpCd = 0.7;
            var ang2 = Math.atan2(m.dz, m.dx) + (Math.random() < 0.5 ? 1.45 : -1.45);
            m.dx = Math.cos(ang2) * 1.9;
            m.dz = Math.sin(ang2) * 1.9;
          }
        }
      }

      m.vy -= GRAV * dt;
      if (m.vy < -40) m.vy = -40;
      var ny = m.pos.y + m.vy * dt;
      if (!boxCollides(m.pos.x, ny, m.pos.z, m.half, m.h)) {
        m.pos.y = ny;
        m.onGround = false;
      } else {
        if (m.vy < 0) { m.pos.y = Math.floor(ny + 0.001) + 1.0; m.onGround = true; }
        m.vy = 0;
      }
      if (m.hurt > 0) {
        m.hurt -= dt;
        m.obj.scale.setScalar(1 + Math.sin(m.hurt * 50) * 0.08);
      } else {
        m.obj.scale.setScalar(1);
      }
      m.obj.position.set(m.pos.x, m.pos.y, m.pos.z);
      m.obj.rotation.y = Math.atan2(P.pos.x - m.pos.x, P.pos.z - m.pos.z);

      // 联机：房主统一判定怪物对远端玩家的伤害
      if (NET.on && NET.host) {
        for (var pk in NET.peers) {
          var pa = NET.peers[pk];
          var gx = pa.pos.x - m.pos.x, gz = pa.pos.z - m.pos.z;
          var gd = Math.hypot(gx, gz);
          var ck = 'c' + pk;
          if (gd < 1.05 && Math.abs(pa.pos.y - m.pos.y) < 1.7) {
            m[ck] = (m[ck] || 0) - dt;
            if (m[ck] <= 0) {
              m[ck] = 1.35;
              m.vy = 4.2;
              netSend({ t: 'hurt', to: +pk, n: 2, dx: gx, dz: gz });
            }
          } else if (m[ck] > 0) m[ck] -= dt;
        }
      }
    }
  }

  function attack(silent) {
    var origin = camera.position.clone();
    var dir = cameraDir();
    var best = null, bestD = 1e9;
    for (var i = 0; i < mobs.length; i++) {
      var m = mobs[i];
      var dx = m.pos.x - origin.x;
      var dy = (m.pos.y + 0.4) - origin.y;
      var dz = m.pos.z - origin.z;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 4.4) continue;
      var dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
      if (dot < 0.66) continue;
      if (d < bestD) { bestD = d; best = m; }
    }
    pulseCrosshair();
    swing();
    if (!best) { if (!silent) sfx(220, 0.05, 'sawtooth', 0.05); return; }
    if (best.remote) {
      // 客机：伤害结算交给房主，本地只放特效
      best.hurt = 0.28;
      best.vy = 5.2;
      spawnParticles(best.pos.x, best.pos.y + 0.45, best.pos.z, '#9ee87a', 8);
      sfx(150, 0.09, 'square', 0.12);
      vibrate(25);
      netSend({ t: 'hit', m: best.nid });
      return;
    }
    best.hp--;
    best.hurt = 0.28;
    best.vy = 5.2;
    best.dx = dir.x * 6;
    best.dz = dir.z * 6;
    best.t = 0.6;
    spawnParticles(best.pos.x, best.pos.y + 0.45, best.pos.z, '#9ee87a', 8);
    sfx(150, 0.09, 'square', 0.12);
    vibrate(25);
    if (best.hp <= 0) {
      spawnParticles(best.pos.x, best.pos.y + 0.4, best.pos.z, '#76cf4f', 16);
      scene.remove(best.obj);
      mobs.splice(mobs.indexOf(best), 1);
      sfx(90, 0.16, 'sawtooth', 0.1);
    }
  }

  var crossEl = document.getElementById('crosshair');
  function pulseCrosshair() {
    crossEl.style.transform = 'scale(1.45)';
    setTimeout(function () { crossEl.style.transform = 'scale(1)'; }, 110);
  }

  /* ===================== 8. 粒子 ===================== */
  var pGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  var pMats = {};
  var particles = [];

  function pMat(color) {
    if (!pMats[color]) pMats[color] = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), fog: true });
    return pMats[color];
  }

  function spawnParticles(x, y, z, color, n) {
    for (var i = 0; i < n; i++) {
      if (particles.length > 150) break;
      var m = new THREE.Mesh(pGeo, pMat(color));
      m.position.set(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6);
      m.scale.setScalar(0.6 + Math.random() * 0.9);
      scene.add(m);
      particles.push({
        m: m,
        vx: (Math.random() - 0.5) * 4,
        vy: Math.random() * 4 + 1.2,
        vz: (Math.random() - 0.5) * 4,
        life: 0.55 + Math.random() * 0.45
      });
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        scene.remove(p.m);
        particles.splice(i, 1);
        continue;
      }
      p.vy -= 22 * dt;
      p.m.position.x += p.vx * dt;
      p.m.position.y += p.vy * dt;
      p.m.position.z += p.vz * dt;
      p.m.rotation.x += dt * 4;
      p.m.rotation.y += dt * 3;
    }
  }

  /* ===================== 9. 音效 ===================== */
  var actxAudio = null;
  function initAudio() {
    if (actxAudio) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actxAudio = new AC();
    } catch (e) { actxAudio = null; }
  }
  function sfx(freq, dur, type, vol) {
    if (!actxAudio) return;
    try {
      if (actxAudio.state === 'suspended') actxAudio.resume();
      var o = actxAudio.createOscillator();
      var g = actxAudio.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, actxAudio.currentTime);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.7), actxAudio.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.08, actxAudio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actxAudio.currentTime + dur);
      o.connect(g); g.connect(actxAudio.destination);
      o.start(); o.stop(actxAudio.currentTime + dur + 0.02);
    } catch (e) { }
  }
  function vibrate(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { } }
  }

  /* ===================== 10. 区块流式加载 ===================== */
  var OFFSETS = (function () {
    var a = [];
    for (var dz = -RD - 1; dz <= RD + 1; dz++) {
      for (var dx = -RD - 1; dx <= RD + 1; dx++) {
        var d = dx * dx + dz * dz;
        if (d <= (RD + 1.6) * (RD + 1.6)) a.push({ dx: dx, dz: dz, d: d });
      }
    }
    a.sort(function (p, q) { return p.d - q.d; });
    return a;
  })();

  function neighborsReady(cx, cz) {
    return chunks.has(ckey(cx + 1, cz)) && chunks.has(ckey(cx - 1, cz)) &&
      chunks.has(ckey(cx, cz + 1)) && chunks.has(ckey(cx, cz - 1));
  }

  function streamChunks(px, pz) {
    var pcx = Math.floor(px / CH), pcz = Math.floor(pz / CH);
    var genBudget = 3, meshBudget = 3;
    for (var i = 0; i < OFFSETS.length; i++) {
      if (genBudget <= 0 && meshBudget <= 0) break;
      var o = OFFSETS[i];
      var cx = pcx + o.dx, cz = pcz + o.dz;
      var c = chunks.get(ckey(cx, cz));
      if (!c) {
        if (genBudget > 0) { ensureChunk(cx, cz); genBudget--; }
        continue;
      }
      if (c.dirty && meshBudget > 0 && o.d <= (RD + 0.5) * (RD + 0.5) && neighborsReady(cx, cz)) {
        buildMesh(c);
        meshBudget--;
      }
    }
    // 卸载
    chunks.forEach(function (c, k) {
      if (Math.abs(c.cx - pcx) > RD + 2 || Math.abs(c.cz - pcz) > RD + 2) {
        disposeChunk(c);
        chunks.delete(k);
      }
    });
  }

  /* ===================== 10.5 生命 / 饥饿 ===================== */
  var MAX_HP = 20, MAX_FOOD = 20;
  var hp = MAX_HP, food = MAX_FOOD;
  var hurtTimer = 0, regenTimer = 0, starveTimer = 0, foodTimer = 0, sprintFoodTimer = 0;
  var dead = false;

  var HEART_SVG = '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="currentColor" stroke="rgba(0,0,0,.45)" stroke-width="1.1" stroke-linejoin="round"/>';
  // 鸡腿：圆润的肉 + 斜着的腿骨
  // 8x8 像素鸡腿：1=肉 2=骨
  var FOOD_PIX = [
    '00111000',
    '01111100',
    '01111110',
    '01111110',
    '00111110',
    '00011100',
    '00011000',
    '00022000'
  ];
  var FOOD_SVG = (function () {
    var meat = '', bone = '';
    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        var c = FOOD_PIX[y].charAt(x);
        if (c === '1') meat += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
        else if (c === '2') bone += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
      }
    }
    return '<g fill="currentColor">' + meat + '</g>' +
           '<g fill="#f7efdc">' + bone + '</g>';
  })();

  var healthRowEl = document.getElementById('healthRow');
  var hungerRowEl = document.getElementById('hungerRow');
  var dmgEl = document.getElementById('dmgflash');

  function pixHTML(cls, inner, vb) {
    var v = vb || '0 0 24 24';
    return '<span class="pix ' + cls + '">' +
      '<svg class="bg" viewBox="' + v + '">' + inner + '</svg>' +
      '<svg class="fg" viewBox="' + v + '">' + inner + '</svg>' +
      '</span>';
  }

  function renderVitals() {
    var h = '', g = '';
    for (var i = 0; i < 10; i++) {
      var v = hp - i * 2;
      h += pixHTML('hp' + (v >= 2 ? '' : v >= 1 ? ' half' : ' empty'), HEART_SVG);
      var f = food - i * 2;
      g += pixHTML('fd' + (f >= 2 ? '' : f >= 1 ? ' half' : ' empty'), FOOD_SVG, '0 0 8 8');
    }
    healthRowEl.innerHTML = h;
    hungerRowEl.innerHTML = g;
    saveDirty = true;   // 生命/饥饿变化也写进存档
  }

  function flashDamage(big) {
    dmgEl.style.opacity = big ? 0.34 : 0.34;
    clearTimeout(dmgEl._t);
    dmgEl._t = setTimeout(function () { dmgEl.style.opacity = 0; }, big ? 700 : 130);
  }

  function damagePlayer(n, kx, kz) {
    if (dead || n <= 0) return;
    if (hurtTimer > 0) return;
    hp = Math.max(0, hp - n);
    hurtTimer = 0.5;
    flashDamage(false);
    sfx(150, 0.13, 'square', 0.14);
    vibrate(50);
    if (kx !== undefined) {
      var l = Math.hypot(kx, kz) || 1;
      P.vel.x += (kx / l) * 7;
      P.vel.z += (kz / l) * 7;
      P.vel.y = Math.max(P.vel.y, 4.5);
      P.onGround = false;
    }
    renderVitals();
    if (hp <= 0) die();
  }

  function die() {
    if (dead) return;
    dead = true;
    hp = 0;
    input.mine = false; input.jump = false; input.run = false;
    input.mx = 0; input.mz = 0;
    sprinting = false;
    flashDamage(true);
    showTip('你死了，正在重生…');
    sfx(90, 0.5, 'sawtooth', 0.16);
    vibrate([60, 60, 120]);
    renderVitals();
    setTimeout(respawn, 1400);
  }

  function respawn() {
    dead = false;
    hp = MAX_HP; food = MAX_FOOD;
    hurtTimer = 0; regenTimer = 0; starveTimer = 0; foodTimer = 0; sprintFoodTimer = 0;
    P.fly = false;
    P.pos.set(8.5, surfaceH(8, 8) + 1.2, 8.5);
    P.vel.set(0, 0, 0);
    for (var i = 0; i < 40; i++) streamChunks(P.pos.x, P.pos.z);
    dropPlayerToGround();
    hurtTimer = 1.2;   // 重生保护，避免落地立刻掉血
    renderVitals();
    showTip('已重生，生命与饥饿已恢复');
  }

  function updateVitals(dt) {
    if (dead) return;
    if (hurtTimer > 0) hurtTimer -= dt;

    // 疾跑消耗饥饿
    if (sprinting && Math.hypot(P.vel.x, P.vel.z) > 1.2) {
      sprintFoodTimer += dt;
      if (sprintFoodTimer > 3.5) { sprintFoodTimer = 0; food = Math.max(0, food - 0.5); renderVitals(); }
    } else sprintFoodTimer = 0;

    // 日常消耗（很慢）
    foodTimer += dt;
    if (foodTimer > 30 && food > 0) { foodTimer = 0; food = Math.max(0, food - 1); renderVitals(); }

    // 吃饱回血
    if (food >= 18 && hp < MAX_HP) {
      regenTimer += dt;
      if (regenTimer > 3.5) {
        regenTimer = 0;
        hp = Math.min(MAX_HP, hp + 1);
        food = Math.max(0, food - 0.6);
        renderVitals();
      }
    } else regenTimer = 0;

    // 饿肚子掉血
    if (food <= 0) {
      starveTimer += dt;
      if (starveTimer > 4) { starveTimer = 0; damagePlayer(1); }
    } else starveTimer = 0;
  }

  /* ===================== 11. 玩家更新 ===================== */
  function moveAxisX(dx) {
    if (!dx) return;
    var nx = P.pos.x + dx;
    if (!playerCollides(nx, P.pos.y, P.pos.z)) { P.pos.x = nx; return; }
    // 走路撞到方块时自动上 1 格台阶（飞行时不自动上台阶）
    if (!P.fly && P.onGround && !playerCollides(nx, P.pos.y + 1.02, P.pos.z) &&
        !playerCollides(P.pos.x, P.pos.y + 1.02, P.pos.z)) {
      P.pos.y += 1.02;
      P.pos.x = nx;
      return;
    }
    P.pos.x = dx > 0 ? Math.floor(nx + HALF) - HALF - 0.001
                     : Math.floor(nx - HALF) + 1 + HALF + 0.001;
    P.vel.x = 0;
  }

  function moveAxisZ(dz) {
    if (!dz) return;
    var nz = P.pos.z + dz;
    if (!playerCollides(P.pos.x, P.pos.y, nz)) { P.pos.z = nz; return; }
    if (!P.fly && P.onGround && !playerCollides(P.pos.x, P.pos.y + 1.02, nz) &&
        !playerCollides(P.pos.x, P.pos.y + 1.02, P.pos.z)) {
      P.pos.y += 1.02;
      P.pos.z = nz;
      return;
    }
    P.pos.z = dz > 0 ? Math.floor(nz + HALF) - HALF - 0.001
                     : Math.floor(nz - HALF) + 1 + HALF + 0.001;
    P.vel.z = 0;
  }

  // 返回 -1 落地、1 顶到天花板、0 未碰撞
  // 一帧的竖直位移可能超过 1 格（下落终速 42 格/秒 × 0.05s ≈ 2.1 格），
  // 一步到位的写法会把玩家直接怼到跨过的那层方块里；头顶有方块时更糟：
  // 头贴着天花板往下掉一点点，碰撞是"头"引起的，却按"落地"取 floor(ny)+1，
  // 反而把人往上顶 1 格，一帧一格地钻进天花板。所以拆成 ≤0.35 格的子步，
  // 每一步都能分清是踩到底还是撞到顶，对齐也只对齐最近的那一面。
  function moveAxisY(dy) {
    if (!dy) return 0;
    var left = dy, guard = 0;
    while (Math.abs(left) > 1e-6 && guard++ < 64) {
      var step = left > 0 ? Math.min(left, 0.35) : Math.max(left, -0.35);
      var ny = P.pos.y + step;
      if (!playerCollides(P.pos.x, ny, P.pos.z)) { P.pos.y = ny; left -= step; continue; }
      if (step > 0) {
        // 顶到天花板：贴到头顶方块底面以下 1mm
        var lock = Math.floor(ny + PHEIGHT) - PHEIGHT - 0.001;
        if (lock > P.pos.y && !playerCollides(P.pos.x, lock, P.pos.z)) P.pos.y = lock;
        else P.pos.y = Math.max(P.pos.y, ny - step);
        P.vel.y = 0;
        return 1;
      }
      // 落地：踩到落点所在方块的上表面
      P.pos.y = Math.floor(ny) + 1;
      P.vel.y = 0;
      return -1;
    }
    return 0;
  }

  // 潜行防坠落：给定位置脚下（AABB 四个角）是否还有方块支撑
  // 站立时 pos.y 就是方块顶面，用 +0.02 容差吸收落地的浮点误差
  function floorAt(px, pz, py) {
    var y = Math.floor(py + 0.02) - 1;
    var x0 = Math.floor(px - HALF + 0.02), x1 = Math.floor(px + HALF - 0.02);
    var z0 = Math.floor(pz - HALF + 0.02), z1 = Math.floor(pz + HALF - 0.02);
    return getBlock(x0, y, z0) !== 0 || getBlock(x1, y, z0) !== 0 ||
           getBlock(x0, y, z1) !== 0 || getBlock(x1, y, z1) !== 0;
  }

  // 贴地判定。落地检测每帧有小到 1mm 的浮点抖动，onGround 会闪断，
  // 潜行保护如果只看 onGround 就会在闪断的那一帧放行、一步步蹭出边缘。
  function standingOnGround() {
    if (P.fly) return false;
    return P.onGround || !playerCollides(P.pos.x, P.pos.y - 0.04, P.pos.z);
  }

  var eyeNow = EYE;

  function updatePlayer(dt) {
    if (dead) return;
    var sneaking = input.sneak && !P.fly;
    var mx = input.mx, mz = input.mz;
    var stickLen = Math.hypot(mx, mz);
    var len = stickLen;
    if (len > 1) { mx /= len; mz /= len; }

    // 疾跑：按疾跑键，或把摇杆推到最前端保持 0.28 秒
    if (!P.fly && !sneaking && food > 6 && (input.run || (input.mz > 0.88 && stickLen > 0.88))) {
      sprintHold += dt;
      if (input.run || sprintHold > 0.28) sprinting = true;
    } else {
      sprintHold = 0;
      if (P.fly || sneaking || food <= 6 || (!input.run && input.mz < 0.45)) sprinting = false;
    }

    var speed = P.fly ? FLY_SPEED
      : (sneaking ? SNEAK_SPEED : (sprinting ? SPRINT_SPEED : WALK_SPEED));

    var wantX, wantY = 0, wantZ;
    if (P.fly) {
      // 飞行：前进方向跟随视角俯仰
      var cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
      var fdx = -Math.sin(P.yaw) * cp, fdz = -Math.cos(P.yaw) * cp;
      var rdx = Math.cos(P.yaw), rdz = -Math.sin(P.yaw);
      wantX = (fdx * mz + rdx * mx) * speed;
      wantZ = (fdz * mz + rdz * mx) * speed;
      wantY = sp * mz * speed;
      if (input.jump) wantY += speed;    // 跳 = 上升
      if (input.sneak) wantY -= speed;   // 潜行 = 下降
    } else {
      var fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
      var rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
      wantX = (fx * mz + rx * mx) * speed;
      wantZ = (fz * mz + rz * mx) * speed;
    }

    var k = Math.min(1, dt * (P.fly ? 12 : 18));
    P.vel.x += (wantX - P.vel.x) * k;
    P.vel.z += (wantZ - P.vel.z) * k;

    if (P.fly) {
      P.vel.y += (wantY - P.vel.y) * k;
      P.onGround = false;
      // 三个轴分别做碰撞，飞行也不会穿墙/穿地板
      moveAxisX(P.vel.x * dt);
      moveAxisZ(P.vel.z * dt);
      moveAxisY(P.vel.y * dt);
    } else {
      var dx = P.vel.x * dt, dz = P.vel.z * dt;
      // 潜行防坠落：分轴判断，哪个方向会踩空就掐掉哪个方向，斜着走仍可沿边缘滑
      if (sneaking && (dx || dz) && stickLen > 0.1 && standingOnGround()) {
        if (!floorAt(P.pos.x + dx, P.pos.z + dz, P.pos.y)) {
          if (dx && !floorAt(P.pos.x + dx, P.pos.z, P.pos.y)) dx = 0;
          if (dz && !floorAt(P.pos.x, P.pos.z + dz, P.pos.y)) dz = 0;
          if (!floorAt(P.pos.x + dx, P.pos.z + dz, P.pos.y)) { dx = 0; dz = 0; }
          if (!dx && !dz) { P.vel.x = 0; P.vel.z = 0; }
        }
      }
      moveAxisX(dx);
      moveAxisZ(dz);

      P.vel.y -= GRAV * dt;
      if (P.vel.y < -42) P.vel.y = -42;
      // 潜行时禁跳：一旦跳起来防坠保护就失效，会直接踩空掉下去
      if (input.jump && P.onGround && !sneaking) { P.vel.y = JUMP; P.onGround = false; }
      var vyBefore = P.vel.y;
      var hitY = moveAxisY(P.vel.y * dt);
      if (hitY < 0) {
        P.onGround = true;
        if (vyBefore < -15) {
          damagePlayer(Math.min(12, Math.round((-vyBefore - 15) / 2.6) + 1));
        }
      }
      else if (P.vel.y < 0) {
        // 落地检测的浮点抖动：脚下 4cm 内有方块就吸回地表，别让 onGround 每几帧闪一次
        if (playerCollides(P.pos.x, P.pos.y - 0.04, P.pos.z)) {
          var snap = Math.ceil(P.pos.y - 0.02);
          // 只有吸附后确实不重叠才吸。头顶有方块时脚下和头上会一起碰，
          // 无脑 ceil 会把人往上顶进天花板，条件放宽只会把 bug 换个地方犯。
          if (!playerCollides(P.pos.x, snap, P.pos.z)) {
            P.pos.y = snap;
            P.onGround = true;
            P.vel.y = 0;
          } else {
            P.onGround = false;
          }
        } else {
          P.onGround = false;
        }
      }
    }

    // 兜底：无论如何都不该停在方块内部（掉帧、被方块埋住、联机时抢着放方块）
    if (playerCollides(P.pos.x, P.pos.y, P.pos.z)) {
      for (var kk = 1; kk <= 8; kk++) {
        var ty = Math.floor(P.pos.y) + kk;
        if (!playerCollides(P.pos.x, ty, P.pos.z)) { P.pos.y = ty; P.vel.y = 0; break; }
      }
    }

    if (P.pos.y < -6) {
      // 掉出世界，拉回出生点
      P.pos.set(8.5, surfaceH(8, 8) + 3, 8.5);
      P.vel.set(0, 0, 0);
    }

    // 潜行压低视角
    var targetEye = (input.sneak && !P.fly) ? EYE - 0.3 : EYE;
    eyeNow += (targetEye - eyeNow) * Math.min(1, dt * 12);

    // 疾跑时视野拉远（原版效果）
    var wantFov = 72 + (sprinting ? 9 : 0);
    if (Math.abs(camera.fov - wantFov) > 0.03) {
      camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 6);
      camera.updateProjectionMatrix();
    }

    // 走路时轻微视角晃动
    if (!P.fly && P.onGround && stickLen > 0.3) {
      walkBob += dt * (sprinting ? 14 : 9.5);
    }
    var bob = (!P.fly && P.onGround && stickLen > 0.3) ? Math.sin(walkBob) * 0.009 : 0;

    camera.position.set(P.pos.x, P.pos.y + eyeNow, P.pos.z);
    camera.rotation.set(P.pitch, P.yaw, bob);
  }

  /* ===================== 12. UI ===================== */
  var hotbarEl = document.getElementById('hotbar');
  var hotnameEl = document.getElementById('hotname');

  var bagEl = document.getElementById('bag');
  var bagGridEl = document.getElementById('bagGrid');
  var bagHotEl = document.getElementById('bagHot');

  function renderHotbar() {
    hotbarEl.innerHTML = '';
    for (var i = 0; i < HOTBAR_SIZE; i++) {
      (function (i) {
        var it = inv[i];
        var slot = document.createElement('div');
        slot.className = 'slot' + (i === hotbarIndex ? ' sel' : '');
        if (it) {
          var img = new Image();
          img.src = iconURL(it.id);
          slot.appendChild(img);
        }
        var b = document.createElement('b');
        b.textContent = (it && it.n > 1) ? it.n : '';
        slot.appendChild(b);
        slot.addEventListener('touchstart', function (e) {
          e.preventDefault(); e.stopPropagation(); selectHotbar(i);
        }, { passive: false });
        slot.addEventListener('click', function () { selectHotbar(i); });
        hotbarEl.appendChild(slot);
      })(i);
    }
  }

  var hotnameTimer = 0;
  function selectHotbar(i) {
    hotbarIndex = i;
    saveDirty = true;
    renderHotbar();
    if (!bagEl.classList.contains('hide')) renderBag();
    var it = inv[i];
    hotnameEl.textContent = it ? BLOCKS[it.id].name + ' ×' + it.n : '空格子';
    hotnameEl.style.opacity = 1;
    clearTimeout(hotnameTimer);
    hotnameTimer = setTimeout(function () { hotnameEl.style.opacity = 0; }, 1200);
  }

  function bagSlotHTML(it, i, isHot) {
    var cls = 'bslot' + (isHot && i === hotbarIndex ? ' sel' : '');
    return '<div class="' + cls + '" data-i="' + i + '">' +
      (it ? '<img src="' + iconURL(it.id) + '"><b>' + (it.n > 1 ? it.n : '') + '</b>' : '') +
      '</div>';
  }

  function renderBag() {
    var h = '';
    for (var i = HOTBAR_SIZE; i < INV_SIZE; i++) h += bagSlotHTML(inv[i], i, false);
    bagGridEl.innerHTML = h;
    var h2 = '';
    for (var j = 0; j < HOTBAR_SIZE; j++) h2 += bagSlotHTML(inv[j], j, true);
    bagHotEl.innerHTML = h2;
  }

  // 点背包格：与当前选中的快捷栏格交换；点快捷栏格：选中
  function bagTap(e) {
    var el = e.target;
    while (el && el !== bagGridEl && el !== bagHotEl) {
      if (el.getAttribute && el.getAttribute('data-i') !== null) break;
      el = el.parentNode;
    }
    if (!el || !el.getAttribute || el.getAttribute('data-i') === null) return;
    var i = parseInt(el.getAttribute('data-i'), 10);
    if (isNaN(i)) return;
    if (i < HOTBAR_SIZE) {
      hotbarIndex = i;
    } else {
      var tmp = inv[hotbarIndex];
      inv[hotbarIndex] = inv[i];
      inv[i] = tmp;
    }
    saveDirty = true;
    renderBag();
    renderHotbar();
    var it = inv[hotbarIndex];
    if (!bagEl.classList.contains('hide')) {
      hotnameEl.textContent = it ? BLOCKS[it.id].name + ' ×' + it.n : '空格子';
    }
  }

  var statsEl = document.getElementById('stats');
  function updateStats(fps) {
    statsEl.textContent = 'FPS ' + fps.toFixed(0) +
      '  X ' + P.pos.x.toFixed(1) + '  Y ' + P.pos.y.toFixed(1) + '  Z ' + P.pos.z.toFixed(1) +
      (P.fly ? '  ✈' : '') + (sprinting ? '  ⚡' : '') + (input.sneak && !P.fly ? '  潜行' : '');
  }

  function showTip(text) {
    var el = document.getElementById('tip');
    el.textContent = text;
    el.style.opacity = 1;
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.opacity = 0; }, 1600);
  }

  // 顶部：保存
  document.getElementById('btnSaveTop').addEventListener('click', function (e) {
    e.stopPropagation();
    saveGame();
    showTip('世界已保存');
  });
  // 背包图标用草方块贴图
  document.getElementById('bagIcon').src = iconURL(1);

  // 背包
  document.getElementById('btnBag').addEventListener('click', function (e) {
    e.stopPropagation();
    input.mine = false; input.jump = false; input.sneak = false; input.run = false; input.mx = 0; input.mz = 0;
    renderBag();
    bagEl.classList.remove('hide');
  });
  document.getElementById('bagClose').addEventListener('click', function () {
    bagEl.classList.add('hide');
  });
  bagGridEl.addEventListener('click', bagTap);
  bagHotEl.addEventListener('click', bagTap);

  // 菜单
  var menuEl = document.getElementById('menu');
  document.getElementById('btnMenu').addEventListener('click', function (e) {
    e.stopPropagation();
    input.mine = false; input.jump = false; input.sneak = false; input.run = false; input.mx = 0; input.mz = 0;
    bagEl.classList.add('hide');
    menuEl.classList.remove('hide');
  });
  document.getElementById('mClose').addEventListener('click', function () {
    menuEl.classList.add('hide');
  });
  var mFlyBtn = document.getElementById('mFly');
  mFlyBtn.addEventListener('click', function () {
    P.fly = !P.fly;
    P.vel.set(0, 0, 0);
    mFlyBtn.textContent = '切换 飞行模式：' + (P.fly ? '开' : '关');
    showTip(P.fly ? '飞行模式开启：跳上升 / 潜行下降' : '飞行模式关闭');
  });
  document.getElementById('mSave').addEventListener('click', function () {
    saveGame();
    showTip('世界已保存');
  });
  // WebView 里 confirm 可能被拦截，改成两步确认
  var resetArmed = 0;
  var resetBtn = document.getElementById('mReset');
  resetBtn.addEventListener('click', function () {
    if (NET.on) { showTip('联机中不能重置世界，请先退出房间'); return; }
    var now = Date.now();
    if (now - resetArmed > 3000) {
      resetArmed = now;
      resetBtn.textContent = '⚠ 再点一次确认重置';
      setTimeout(function () {
        if (Date.now() - resetArmed >= 3000) resetBtn.textContent = '重新生成世界';
      }, 3100);
      return;
    }
    resetArmed = 0;
    resetBtn.textContent = '重新生成世界';
    resetWorld();
    menuEl.classList.add('hide');
    showTip('新的世界已生成');
  });

  /* ===================== 13. 存档 ===================== */
  var SAVE_KEY = 'mcblocks_save_v1';

  function saveGame() {
    try {
      var ed = [];
      edits.forEach(function (m, k) {
        var arr = [];
        m.forEach(function (v, idx) { arr.push(idx, v); });
        ed.push([k, arr]);
      });
      var invData = [];
      for (var i = 0; i < INV_SIZE; i++) invData.push(inv[i] ? [inv[i].id, inv[i].n] : 0);
      var obj = {
        v: 3,
        player: { x: P.pos.x, y: P.pos.y, z: P.pos.z, yaw: P.yaw, pitch: P.pitch },
        edits: ed,
        inv: invData,
        hot: hotbarIndex,
        hp: Math.round(hp * 2) / 2,
        food: Math.round(food * 2) / 2
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(obj));
      saveDirty = false;
    } catch (e) { }
  }

  function loadGame() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.edits) return null;
      edits.clear();
      if (typeof obj.hp === 'number' && obj.hp > 0) hp = Math.min(MAX_HP, obj.hp);
      if (typeof obj.food === 'number') food = Math.max(0, Math.min(MAX_FOOD, obj.food));
      if (obj.inv && obj.inv.length === INV_SIZE) {
        for (var i = 0; i < INV_SIZE; i++) {
          var v = obj.inv[i];
          inv[i] = (v && v[0] && v[1] > 0) ? { id: v[0], n: Math.min(STACK_MAX, v[1]) } : null;
        }
        hotbarIndex = (obj.hot >= 0 && obj.hot < HOTBAR_SIZE) ? obj.hot : 0;
      } else {
        starterKit();
      }
      obj.edits.forEach(function (pair) {
        var m = new Map();
        for (var i = 0; i < pair[1].length; i += 2) m.set(pair[1][i], pair[1][i + 1]);
        edits.set(pair[0], m);
      });
      return obj;
    } catch (e) { return null; }
  }

  function resetWorld() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
    edits.clear();
    chunks.forEach(function (c) { disposeChunk(c); });
    chunks.clear();
    mobs.forEach(function (m) { scene.remove(m.obj); });
    mobs.length = 0;
    P.pos.set(8.5, surfaceH(8, 8) + 3, 8.5);
    P.vel.set(0, 0, 0);
    P.yaw = 0; P.pitch = 0;
    hp = MAX_HP; food = MAX_FOOD; dead = false;
    starterKit();
    renderHotbar();
    renderVitals();
    for (var i = 0; i < 40; i++) streamChunks(P.pos.x, P.pos.z);
    dropPlayerToGround();
  }

  function dropPlayerToGround() {
    var x = Math.floor(P.pos.x), z = Math.floor(P.pos.z);
    for (var y = WH - 2; y > 0; y--) {
      if (getBlock(x, y, z)) { P.pos.y = y + 1.05; break; }
    }
    P.vel.set(0, 0, 0);
  }

  /* ===================== 13.5 联机 ===================== */
  // 架构：主机（房主）跑局域网 WebSocket 服务（Android 端由 Java 提供），
  // 所有人都作为客户端连进来；服务端只做转发 + 保存方块改动，逻辑全在客户端。
  var NET = {
    ws: null, on: false, host: false, myId: 0, myName: '', addr: '', port: 8765,
    peers: {}, stT: 0, mbT: 0, mobSeq: 0, mobNet: new Map(), netEdits: new Map(),
    retry: 0, connT: 0, scanning: null,
    /* 公网中继相关 */
    mode: 'lan',        // lan = 局域网/自托管，wan = 公网中继
    key: '',            // 房主密钥，只有房主有；用来断线后把房间认回来
    room: '',           // 房间码
    relay: '',          // 中继 host，例如 wss://relay.example.com
    lastErr: ''
  };

  var AV_COLORS = [0x2f8f86, 0x8f5a2f, 0x4a6c8f, 0x7a2f5a, 0x8f7a2f, 0x3f7a3f];

  function netPill(txt, on) {
    var el = document.getElementById('netpill');
    if (!el) return;
    if (!txt) { el.classList.add('hide'); return; }
    el.classList.remove('hide');
    el.innerHTML = '<i></i>' + txt;
    el.style.borderColor = on ? 'rgba(142,224,106,.45)' : 'rgba(255,160,120,.45)';
  }

  function netSend(o) {
    if (NET.ws && NET.ws.readyState === 1) {
      try { NET.ws.send(JSON.stringify(o)); } catch (e) { }
    }
  }

  /* ---------- 远端玩家模型 ---------- */
  function makeNameTag(name) {
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 72;
    var g = cv.getContext('2d');
    g.font = 'bold 34px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    var w = Math.min(236, g.measureText(name).width + 34);
    g.fillStyle = 'rgba(8,12,16,.62)';
    var x = (256 - w) / 2, y = 12, h = 46, r = 14;
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
    g.closePath(); g.fill();
    g.fillStyle = '#eaf4ff';
    g.fillText(name, 128, 36);
    var tex = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(1.7, 0.48, 1);
    sp.position.y = 2.12;
    return sp;
  }

  function makeAvatar(id, name) {
    var g = new THREE.Group();
    var c = AV_COLORS[(id - 1) % AV_COLORS.length];
    var mCloth = new THREE.MeshLambertMaterial({ color: c });
    var mSkin = new THREE.MeshLambertMaterial({ color: 0xdcae86 });
    var mPants = new THREE.MeshLambertMaterial({ color: 0x37455c });

    var head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), mSkin);
    head.position.y = 1.52;
    g.add(head);
    // 眼睛朝 -Z（与相机 yaw=0 的朝向一致）
    var eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.02),
      new THREE.MeshBasicMaterial({ color: 0x1a2230 }));
    eye.position.set(-0.1, 1.55, -0.235); g.add(eye);
    var eye2 = eye.clone(); eye2.position.x = 0.1; g.add(eye2);

    var body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.24), mCloth);
    body.position.y = 0.97; g.add(body);

    function limb(w, h, d, mat, x, y) {
      var p = new THREE.Group();
      p.position.set(x, y, 0);
      var mm = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mm.position.y = -h / 2;
      p.add(mm);
      g.add(p);
      return p;
    }
    var armL = limb(0.14, 0.56, 0.16, mCloth, -0.29, 1.24);
    var armR = limb(0.14, 0.56, 0.16, mCloth, 0.29, 1.24);
    var legL = limb(0.17, 0.6, 0.2, mPants, -0.12, 0.66);
    var legR = limb(0.17, 0.6, 0.2, mPants, 0.12, 0.66);

    var tag = makeNameTag(name);
    g.add(tag);

    g.visible = false;
    scene.add(g);

    return {
      id: id, name: name, g: g, tag: tag,
      armL: armL, armR: armR, legL: legL, legR: legR,
      pos: new THREE.Vector3(), tgt: new THREE.Vector3(),
      yaw: 0, tyaw: 0, ph: 0, mv: 0, last: performance.now()
    };
  }

  function netAddPeer(id, name) {
    if (!id || id === NET.myId) return;
    var a = NET.peers[id];
    if (a) {
      if (name && name !== a.name) {
        a.name = name;
        a.g.remove(a.tag);
        a.tag = makeNameTag(name);
        a.g.add(a.tag);
      }
      return;
    }
    NET.peers[id] = makeAvatar(id, name || ('玩家' + id));
    netHudPlayers();
  }

  function netDropPeer(id) {
    var a = NET.peers[id];
    if (!a) return;
    scene.remove(a.g);
    delete NET.peers[id];
    netHudPlayers();
  }

  function netHudPlayers() {
    var n = 1;
    for (var k in NET.peers) n++;
    if (!NET.on) { netPill(''); return; }
    netPill((NET.host ? '房间 ' + NET.addr + ' · ' : '联机 · ') + n + ' 人', true);
    var box = document.getElementById('netPlayers');
    if (box) {
      var h = '<div class="np me">' + netEsc(NET.myName) + (NET.host ? ' · 房主' : '') + '</div>';
      for (var id in NET.peers) h += '<div class="np">' + netEsc(NET.peers[id].name) + '</div>';
      box.innerHTML = h;
    }
    var inf = document.getElementById('mNetInfo');
    if (inf) inf.textContent = '联机中 · ' + n + ' 人' + (NET.host ? '（房间 ' + NET.addr + '）' : '');
  }

  function netEsc(s) {
    return String(s).replace(/[<>&"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c];
    });
  }

  function netUpdateAvatars(dt) {
    for (var id in NET.peers) {
      var a = NET.peers[id];
      if (performance.now() - a.last > 12000) { netDropPeer(id); continue; }
      var k = 1 - Math.exp(-10 * dt);
      a.pos.lerp(a.tgt, k);
      var dy = ((a.tyaw - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      a.yaw += dy * (1 - Math.exp(-9 * dt));
      a.g.position.copy(a.pos);
      a.g.rotation.y = a.yaw;
      a.g.visible = a.pos.lengthSq() > 0;
      if (a.mv) a.ph += dt * 9.5; else a.ph *= Math.pow(0.02, dt);
      var sw = Math.sin(a.ph) * (a.mv ? 0.62 : 0.05);
      a.legL.rotation.x = sw; a.legR.rotation.x = -sw;
      a.armL.rotation.x = -sw * 0.75; a.armR.rotation.x = sw * 0.75;
    }
  }

  /* ---------- 方块同步 ---------- */
  function netApplyBlock(x, y, z, id) {
    NET.netEdits.set(x + ',' + y + ',' + z, id);
    setBlock(x, y, z, id, true);
  }

  function netApplyChunk(c) {
    if (!NET.netEdits.size) return;
    var ox = c.cx * CH, oz = c.cz * CH, hit = false;
    NET.netEdits.forEach(function (id, k) {
      var p = k.split(','), x = +p[0], y = +p[1], z = +p[2];
      if (x < ox || x >= ox + CH || z < oz || z >= oz + CH || y < 0 || y >= WH) return;
      var idx = (x - ox) + (z - oz) * CH + y * CH * CH;
      if (c.data[idx] !== id) { c.data[idx] = id; hit = true; }
    });
    if (hit) c.dirty = true;
  }

  function netBlockChanged(x, y, z, id) {
    if (!NET.on) return;
    netSend({ t: 'blk', x: x, y: y, z: z, id: id });
  }

  /* ---------- 怪物同步 ---------- */
  function netSendMobs() {
    if (!NET.on || !NET.host) return;
    var arr = [];
    for (var i = 0; i < mobs.length; i++) {
      var m = mobs[i];
      if (m.remote) continue;
      if (!m.nid) m.nid = ++NET.mobSeq;
      arr.push([m.nid, +m.pos.x.toFixed(2), +m.pos.y.toFixed(2), +m.pos.z.toFixed(2), m.hp]);
    }
    netSend({ t: 'mb', m: arr });
  }

  function netApplyMobs(list) {
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var e = list[i], nid = e[0];
      seen[nid] = 1;
      var m = NET.mobNet.get(nid);
      if (!m) {
        m = createMob(e[1], e[2], e[3]);
        m.remote = true; m.nid = nid; m.hp = e[4];
        m.tgt = new THREE.Vector3(e[1], e[2], e[3]);
        NET.mobNet.set(nid, m);
        mobs.push(m);
      }
      m.tgt.set(e[1], e[2], e[3]);
      if (e[4] !== m.hp) {
        if (e[4] < m.hp) { m.hurt = 0.28; spawnParticles(m.pos.x, m.pos.y + 0.45, m.pos.z, '#9ee87a', 6); }
        m.hp = e[4];
      }
    }
    NET.mobNet.forEach(function (m, nid) {
      if (seen[nid]) return;
      spawnParticles(m.pos.x, m.pos.y + 0.4, m.pos.z, '#76cf4f', 14);
      scene.remove(m.obj);
      var i = mobs.indexOf(m);
      if (i >= 0) mobs.splice(i, 1);
      NET.mobNet.delete(nid);
    });
  }

  function netUpdateMobs(dt) {
    // 客机：远端怪只做位置插值，AI 全部由房主跑
    NET.mobNet.forEach(function (m) {
      var k = 1 - Math.exp(-9 * dt);
      m.pos.lerp(m.tgt, k);
      m.obj.position.copy(m.pos);
      if (m.hurt > 0) { m.hurt -= dt; m.obj.scale.setScalar(1 + Math.sin(m.hurt * 50) * 0.08); }
      else m.obj.scale.setScalar(1);
      var tx = P.pos.x - m.pos.x, tz = P.pos.z - m.pos.z;
      if (tx * tx + tz * tz < 900) m.obj.rotation.y = Math.atan2(tx, tz);
    });
  }

  /* ---------- 网络消息 ---------- */
  function netHandle(raw) {
    var m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    switch (m.t) {
      case 'w':   // 欢迎包
        NET.myId = m.id;
        NET.host = (m.host === m.id);
        NET.on = true;
        if (m.room) NET.room = m.room;
        (m.players || []).forEach(function (p) {
          if (p.id !== NET.myId) netAddPeer(p.id, p.name);
        });
        (m.edits || []).forEach(function (e) { netApplyBlock(e[0], e[1], e[2], e[3]); });
        netHudPlayers();
        if (NET.host) {
          showTip('房间已创建 · ' + NET.addr);
          var na = document.getElementById('netAddr');
          if (na) na.textContent = NET.addr;
          netShowRoomInfo();
        } else {
          showTip('已加入房间');
          // 错开出生点，避免叠在一起
          P.pos.x += ((NET.myId % 3) - 1) * 1.6;
          P.pos.z += (((NET.myId / 3) | 0) % 3 - 1) * 1.6;
          dropPlayerToGround();
        }
        break;
      case 'host':
        // 中继换了房主（原房主长时间没回来）
        NET.host = (m.id === NET.myId);
        netHudPlayers();
        if (NET.host) showTip('原房主掉线了，现在由你接手房间');
        break;
      case 'err':
        NET.lastErr = m.msg || '联机出错';
        showTip(NET.lastErr);
        netPill(NET.lastErr, false);
        if (NET.mode === 'wan') {
          // 被拒就别傻等了，直接收摊
          setTimeout(function () { netLeave(true); }, 60);
        }
        break;
      case 'pong':
        break;
      case 'j':
        netAddPeer(m.id, m.name);
        showTip((m.name || '玩家') + ' 加入了游戏');
        break;
      case 'l':
        if (NET.peers[m.id]) {
          showTip(NET.peers[m.id].name + ' 离开了');
          netDropPeer(m.id);
        }
        break;
      case 'st':
        if (m.from === NET.myId) break;
        var a = NET.peers[m.from] || (netAddPeer(m.from, m.name), NET.peers[m.from]);
        if (!a) break;
        a.tgt.set(m.x, m.y, m.z);
        if (a.tgt.lengthSq() === 0) a.pos.copy(a.tgt);
        a.tyaw = m.yaw;
        a.mv = m.mv;
        a.last = performance.now();
        break;
      case 'blk':
        if (m.from === NET.myId) break;
        netApplyBlock(m.x, m.y, m.z, m.id);
        break;
      case 'mb':
        if (NET.host) break;
        netApplyMobs(m.m || []);
        break;
      case 'hit':
        if (!NET.host) break;
        var mm = NET.mobNet.get(m.m) || null;
        if (!mm) for (var i = 0; i < mobs.length; i++) if (mobs[i].nid === m.m) { mm = mobs[i]; break; }
        if (mm) { mm.hp--; mm.hurt = 0.28; mm.vy = 5.2; if (mm.hp <= 0) { scene.remove(mm.obj); var ix = mobs.indexOf(mm); if (ix >= 0) mobs.splice(ix, 1); } }
        break;
      case 'hurt':
        if (m.to === NET.myId) {
          damagePlayer(m.n || 2, m.dx, m.dz);
          flashDamage(false);
        }
        break;
      case 'bye':
        showTip('连接已断开');
        netLeave(true);
        break;
    }
  }

  function netConnect(url, name, asHost) {
    NET.myName = name;
    NET.host = !!asHost;
    netPill('连接中…', false);
    try { NET.ws = new WebSocket(url); } catch (e) { showTip('连接失败：' + e.message); netLeave(true); return; }
    NET.ws.onopen = function () {
      NET.retry = 0;
      netSend({ t: 'hi', name: name, host: asHost ? 1 : 0, key: NET.key || '' });
      if (NET.connT) clearInterval(NET.connT);
      NET.connT = setInterval(function () {
        if (!NET.ws || NET.ws.readyState !== 1) return;
        netSend({
          t: 'st', x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2),
          yaw: +P.yaw.toFixed(3), pitch: +P.pitch.toFixed(3),
          mv: (Math.hypot(P.vel.x, P.vel.z) > 0.6 || !P.onGround) ? 1 : 0
        });
      }, 100);
    };
    NET.ws.onmessage = function (ev) { netHandle(ev.data); };
    NET.ws.onerror = function () { netPill('连接不稳定', false); };
    setTimeout(function () {
      if (NET.on) return;
      netPill('连接失败', false);
      showTip(NET.mode === 'wan'
        ? '连不上中继：确认中继地址可访问（公网要用 wss://），房间码没写错'
        : '连不上房间：确认两台设备在同一个 Wi-Fi，或检查房主 IP');
    }, 6000);
    NET.ws.onclose = function () {
      if (NET.ws && NET.on && NET.retry < 3) {
        NET.retry++;
        netPill('重连中 ' + NET.retry + '/3', false);
        setTimeout(function () {
          var u = url;
          try { NET.ws = new WebSocket(u); } catch (e) { }
          if (NET.ws) {
            NET.ws.onopen = function () { netSend({ t: 'hi', name: NET.myName, host: NET.host ? 1 : 0, key: NET.key || '' }); };
            NET.ws.onmessage = function (ev2) { netHandle(ev2.data); };
            NET.ws.onclose = function () { netLeave(true); };
          }
        }, 1200);
        return;
      }
      if (NET.on) netLeave(true);
    };
  }

  function netLeave(silent) {
    NET.on = false;
    if (NET.connT) { clearInterval(NET.connT); NET.connT = null; }
    if (NET.ws) { try { NET.ws.onclose = null; NET.ws.close(); } catch (e) { } NET.ws = null; }
    for (var id in NET.peers) netDropPeer(id);
    NET.mobNet.forEach(function (m) {
      scene.remove(m.obj);
      var i = mobs.indexOf(m); if (i >= 0) mobs.splice(i, 1);
    });
    NET.mobNet.clear();
    NET.netEdits.clear();
    NET.host = false;
    NET.key = '';
    NET.room = '';
    netPill('');
    if (window.AndroidNet && window.AndroidNet.stopHost) { try { window.AndroidNet.stopHost(); } catch (e) { } }
    if (!silent) showTip('已退出联机');
  }

  /* ---------- 入口，由 UI 调用 ---------- */
  function netStartHost(name) {
    var ip = location.hostname || '127.0.0.1';
    if (window.AndroidNet && window.AndroidNet.startHost) {
      try {
        var info = JSON.parse(window.AndroidNet.startHost(name) || '{}');
        if (info && info.ok === false) {
          showTip('开服失败：端口被占用，请先退出其他房间');
          return;
        }
        if (info && info.ip) ip = info.ip;
      } catch (e) { }
    }
    NET.addr = ip + ':' + NET.port;
    netConnect('ws://127.0.0.1:' + NET.port, name, true);
  }

  function netJoinAt(addr, name) {
    var s = String(addr || '').trim().replace(/^ws:\/\//, '').replace(/\/.*$/, '');
    if (!s) { showTip('请输入房主 IP'); return false; }
    if (s.indexOf(':') < 0) s += ':' + NET.port;
    NET.mode = 'lan';
    NET.addr = s;
    netConnect('ws://' + s, name, false);
    return true;
  }

  /* ---------- 公网中继 ---------- */
  // 中继地址只记到域名为止，协议和端口都保留，例如 wss://relay.example.com
  function netTrimRelay(v) {
    var s = String(v || '').trim();
    if (!s) return '';
    s = s.replace(/\/+$/, '');
    s = s.replace(/\/room\/[A-Za-z0-9]+$/i, '');
    if (!/^wss?:\/\//i.test(s)) {
      // 没写协议：https 页面下强制 wss，本地 http 下允许 ws
      var 安全 = location.protocol === 'https:' ? 'wss://' : 'ws://';
      if (/^https:\/\//i.test(s)) s = 'wss://' + s.slice(8);
      else if (/^http:\/\//i.test(s)) s = 'ws://' + s.slice(7);
      else s = 安全 + s;
      s = s.replace(/\/+$/, '');
    }
    return s;
  }

  function netRoomUrl(relay, room) {
    return relay + '/room/' + encodeURIComponent(String(room || '').toUpperCase());
  }

  function netMakeCode() {
    // 去掉容易看错的 0 O 1 I，念起来不费劲
    var 表 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 6; i++) s += 表.charAt(Math.floor(Math.random() * 表.length));
    return s;
  }

  function netMakeKey() {
    var a = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
    else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    var s = '';
    for (var j = 0; j < a.length; j++) s += ('0' + a[j].toString(16)).slice(-2);
    return s;
  }

  function netShowRoomInfo() {
    var box = document.getElementById('netRoomInfo');
    if (!box) return;
    if (NET.mode !== 'wan' || !NET.room) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    var 链 = location.origin + location.pathname + '?room=' + NET.room +
      (NET.relay ? '&relay=' + encodeURIComponent(NET.relay) : '');
    var 码 = document.getElementById('netRoomCode');
    var 址 = document.getElementById('netRoomLink');
    if (码) 码.textContent = NET.room;
    if (址) 址.value = 链;
    var 提示 = document.getElementById('netRoomRole');
    if (提示) 提示.textContent = NET.host ? '你是房主，把房间码或邀请链接发给朋友' : '已加入房间，房主掉线时你会自动接手';
  }

  /* 创建公网房间：自己生成房间码和密钥，连上中继就算开好房 */
  function netStartPublic(name, relay) {
    var 址 = netTrimRelay(relay);
    if (!址) { showTip('请先填中继地址'); return false; }
    NET.mode = 'wan';
    NET.relay = 址;
    NET.room = netMakeCode();
    NET.key = netMakeKey();
    NET.addr = NET.room;
    netConnect(netRoomUrl(址, NET.room), name, true);
    return true;
  }

  /* 加入公网房间：只带房间码，密钥留空 */
  function netJoinPublic(name, relay, room) {
    var 址 = netTrimRelay(relay);
    var 码 = String(room || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!址) { showTip('请先填中继地址'); return false; }
    if (码.length < 4) { showTip('房间码至少 4 位'); return false; }
    NET.mode = 'wan';
    NET.relay = 址;
    NET.room = 码;
    NET.key = '';
    NET.addr = 码;
    netConnect(netRoomUrl(址, 码), name, false);
    return true;
  }

  function netScan() {
    var box = document.getElementById('netRooms');
    if (!box) return;
    if (!window.AndroidNet || !window.AndroidNet.getRooms) {
      box.innerHTML = '<div class="np dim">当前环境不支持自动搜索，请手动输入房主 IP</div>';
      return;
    }
    var raw = '';
    try { raw = window.AndroidNet.getRooms() || '[]'; } catch (e) { }
    var list = [];
    try { list = JSON.parse(raw); } catch (e) { }
    list = list.filter(function (r) { return r && r.ip && r.ip !== NET.addr.split(':')[0]; });
    if (!list.length) {
      box.innerHTML = '<div class="np dim">附近没找到房间，确认两台设备连的是同一个 Wi-Fi</div>';
      return;
    }
    box.innerHTML = '';
    list.forEach(function (r) {
      var d = document.createElement('button');
      d.className = 'netroom';
      d.innerHTML = '<b>' + netEsc(r.name || '房间') + '</b><span>' + netEsc(r.ip + ':' + (r.port || 8765)) +
        (r.players ? ' · ' + r.players + ' 人' : '') + '</span>';
      d.onclick = function () {
        document.getElementById('netIp').value = r.ip;
        document.getElementById('netPanel').classList.add('hide');
        startNetGame(r.ip);
      };
      box.appendChild(d);
    });
  }

  /* ===================== 14. 主循环 ===================== */
  var clock = new THREE.Clock();
  var fpsAcc = 0, fpsFrames = 0, fpsShown = 60, statTimer = 0;

  function frame() {
    requestAnimationFrame(frame);
    var dt = Math.min(clock.getDelta(), 0.05);

    if (input.started) {
      updatePlayer(dt);
      doMine(dt);
      placeCooldown = Math.max(0, placeCooldown - dt);
      updateMobs(dt);
      updateVitals(dt);
    }
    updateParticles(dt);
    if (NET.on) {
      netUpdateAvatars(dt);
      NET.stT -= dt;
      if (NET.stT <= 0) { NET.stT = 0.12; netSendMobs(); }
    }

    // 选中框
    if (input.started) {
      var hit = currentHit();
      if (hit) {
        hl.visible = true;
        hl.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      } else {
        hl.visible = false;
      }
    }

    clouds.position.x = -((performance.now() * 0.0006) % 200);

    // 手臂动画
    if (swingT > 0) swingT = Math.max(0, swingT - dt * 4.2);
    var sw = Math.sin(swingT * Math.PI);
    var sp = Math.hypot(P.vel.x, P.vel.z);
    walkPhase += dt * (4 + sp * 1.6);
    updateHeld();
    armPivot.rotation.x = 0.06 + sw * 0.5;
    // 视图模型用 NDC 反算相机局部坐标：宽高比怎么变都钉在同一块屏幕位置，
    // 也不会像之前那样被屏幕边缘切掉。矮屏（横屏手机）把手臂往上抬一档，
    // 免得压到快捷栏和右下按钮
    var vH = window.innerHeight;
    var compact = vH < 520;
    var vT = Math.tan(camera.fov * Math.PI / 360) * 1.045;   // 方块中心到相机的距离
    var nx = compact ? 0.42 : 0.60;
    var ny = compact ? -0.22 : -0.68;
    armPivot.position.x = nx * vT * camera.aspect + Math.cos(walkPhase * 0.5) * 0.008;
    armPivot.position.y = ny * vT + Math.sin(walkPhase) * (sp > 0.4 ? 0.018 : 0.005) + sw * 0.05;

    // 太阳跟随相机（保持远景）
    sun.position.set(camera.position.x - 150, camera.position.y + 190, camera.position.z - 260);
    sun.lookAt(camera.position);

    streamChunks(P.pos.x, P.pos.z);
    renderer.render(scene, camera);

    fpsAcc += dt; fpsFrames++;
    statTimer += dt;
    if (statTimer > 0.5) {
      fpsShown = fpsFrames / fpsAcc;
      fpsAcc = 0; fpsFrames = 0; statTimer = 0;
      updateStats(fpsShown);
    }
    if (saveDirty) {
      saveGame();
      saveDirty = false;
    }
  }

  /* ===================== 15. 初始化 ===================== */
  function boot() {
    var saved = loadGame();
    if (saved && saved.player) {
      P.pos.set(saved.player.x, saved.player.y, saved.player.z);
      P.yaw = saved.player.yaw || 0;
      P.pitch = saved.player.pitch || 0;
    } else {
      P.pos.set(8.5, surfaceH(8, 8) + 3, 8.5);
    }

    // 先生成出生点附近，保证落地不会穿过地形
    for (var i = 0; i < 60; i++) streamChunks(P.pos.x, P.pos.z);
    if (!saved) dropPlayerToGround();
    else if (playerCollides(P.pos.x, P.pos.y, P.pos.z)) dropPlayerToGround();

    if (!saved) starterKit();
    renderHotbar();
    renderVitals();
    bindTouches();

    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    });

    renderer.render(scene, camera);
    loadingEl.style.display = 'none';
    frame();
  }

  // 调试接口（同时方便自动化测试）
  window.__mc = {
    P: P,
    input: input,
    getBlock: getBlock,
    setBlock: setBlock,
    select: function (id) {
      for (var i = 0; i < HOTBAR_SIZE; i++) if (inv[i] && inv[i].id === id) { hotbarIndex = i; renderHotbar(); return true; }
      return false;
    },
    state: function () {
      var ec = 0;
      edits.forEach(function (m) { ec += m.size; });
      return {
        pos: [P.pos.x, P.pos.y, P.pos.z],
        yaw: P.yaw, pitch: P.pitch,
        mobs: mobs.length, chunks: chunks.size,
        fps: fpsShown, sel: selectedId(), fly: P.fly,
        onGround: P.onGround, edits: ec,
        hot: hotbarIndex, invN: inv.reduce(function (a, x) { return a + (x ? x.n : 0); }, 0),
        sprint: sprinting, sneak: input.sneak,
        hp: hp, food: food, dead: dead
      };
    },
    inv: function () { return inv.map(function (x) { return x ? [x.id, x.n] : 0; }); },
    hotbar: function (i) { hotbarIndex = i; renderHotbar(); },
    give: function (id, n) { addItem(id, n || 1); renderHotbar(); },
    look: function (yaw, pitch) { P.yaw = yaw; P.pitch = pitch; clampPitch(); },
    teleport: function (x, y, z) { P.pos.set(x, y, z); P.vel.set(0, 0, 0); },
    mobs: function () { return mobs.map(function (m) { return [m.pos.x, m.pos.y, m.pos.z, m.hp]; }); },
    clearMobs: function () {
      for (var i = 0; i < mobs.length; i++) scene.remove(mobs[i].obj);
      mobs.length = 0;
    },
    noSpawn: function () { mobTimer = 1e9; },
    setMob: function (i, x, y, z) {
      var m = mobs[i];
      if (!m) return false;
      m.pos.set(x, y, z); m.vy = 0; m.onGround = false; m.stuck = 0;
      m.obj.position.set(x, y, z);
      return true;
    },
    hurt: function (n) { damagePlayer(n === undefined ? 2 : n); },
    setHp: function (v) { hp = Math.max(1, Math.min(MAX_HP, v)); hurtTimer = 0; renderVitals(); },
    setFood: function (v) { food = Math.max(0, Math.min(MAX_FOOD, v)); renderVitals(); },
    vitals: function () { return [hp, food, dead]; },
    spawnMob: trySpawnMob,
    arm: armPivot,
    attack: attack
  };

  document.getElementById('btnStart').addEventListener('click', function () {
    initAudio();
    document.getElementById('start').classList.add('hide');
    input.started = true;
    clock.getDelta();
    showTip('拖动画面转视角，左下摇杆移动');
  });

  /* ---------- 联机 UI ---------- */
  var netOverlayEl = document.getElementById('net');
  var netNameEl = document.getElementById('netName');
  var netNameLanEl = document.getElementById('netNameLan');
  var netIpEl = document.getElementById('netIp');
  var netScanTimer = null;
  var netRelayEl = document.getElementById('netRelay');
  var netCodeEl = document.getElementById('netCode');
  var netModeEl = document.getElementById('netMode');

  try {
    var savedName = localStorage.getItem('mcblocks_name');
    if (savedName) {
      if (netNameEl) netNameEl.value = savedName;
      if (netNameLanEl) netNameLanEl.value = savedName;
    }
    var savedRelay = localStorage.getItem('mcblocks_relay');
    if (savedRelay && netRelayEl) netRelayEl.value = savedRelay;
  } catch (e) { }

  /* 两个昵称输入框互通，改哪边都算数 */
  if (netNameEl && netNameLanEl) {
    netNameEl.addEventListener('input', function () { netNameLanEl.value = netNameEl.value; });
    netNameLanEl.addEventListener('input', function () { netNameEl.value = netNameLanEl.value; });
  }

  function netNameValue() {
    var v = ((netNameEl && netNameEl.value) || '').replace(/[<>]/g, '').trim().slice(0, 10);
    if (!v) v = '玩家' + (1000 + Math.floor(Math.random() * 9000));
    try { localStorage.setItem('mcblocks_name', v); } catch (e) { }
    return v;
  }

  function netRelayValue() {
    var v = netTrimRelay(netRelayEl ? netRelayEl.value : '');
    if (v) { try { localStorage.setItem('mcblocks_relay', v); } catch (e) { } }
    return v;
  }

  /* 两个入口分页：公网中继 / 同一 Wi-Fi */
  function netSwitchMode(m) {
    NET.uiMode = m;
    var a = document.getElementById('netWanPane'), b = document.getElementById('netLanPane');
    var ta = document.getElementById('tabWan'), tb = document.getElementById('tabLan');
    if (a) a.style.display = m === 'wan' ? 'block' : 'none';
    if (b) b.style.display = m === 'lan' ? 'block' : 'none';
    if (ta) ta.classList.toggle('on', m === 'wan');
    if (tb) tb.classList.toggle('on', m === 'lan');
    if (netModeEl) netModeEl.textContent = m === 'wan' ? '公网中继' : '同一 Wi-Fi';
    if (m === 'lan') netScan();
  }

  function netOpenPanel() {
    if (!netOverlayEl) return;
    netOverlayEl.classList.remove('hide');
    netSwitchMode(NET.uiMode || 'wan');
  }

  function netEnterWorld() {
    initAudio();
    document.getElementById('start').classList.add('hide');
    netOverlayEl.classList.add('hide');
    input.started = true;
    clock.getDelta();
    document.getElementById('mNetInfo').style.display = 'block';
    document.getElementById('mNetLeave').style.display = 'block';
  }

  /* 入口按钮都在 index.html 里额外绑定过一遍（WebGL 坏了也能点开说明），
     这里只接管真正需要游戏跑起来的动作。 */

  var btnNet = document.getElementById('btnNet');
  if (btnNet) btnNet.addEventListener('click', netOpenPanel);

  var tabWan = document.getElementById('tabWan');
  if (tabWan) tabWan.onclick = function () { netSwitchMode('wan'); };
  var tabLan = document.getElementById('tabLan');
  if (tabLan) tabLan.onclick = function () { netSwitchMode('lan'); };

  document.getElementById('netBack').addEventListener('click', function () {
    netOverlayEl.classList.add('hide');
    if (netScanTimer) { clearInterval(netScanTimer); netScanTimer = null; }
  });

  /* 公网：开房 */
  var netWanHost = document.getElementById('netWanHost');
  if (netWanHost) netWanHost.addEventListener('click', function () {
    var 址 = netRelayValue();
    if (!址) { showTip('请先填中继地址'); return; }
    netEnterWorld();
    netStartPublic(netNameValue(), 址);
    showTip('正在创建房间…');
  });

  /* 公网：加入 */
  var netWanJoin = document.getElementById('netWanJoin');
  if (netWanJoin) netWanJoin.addEventListener('click', function () {
    var 址 = netRelayValue();
    var 码 = netCodeEl ? netCodeEl.value : '';
    if (!址) { showTip('请先填中继地址'); return; }
    netEnterWorld();
    netJoinPublic(netNameValue(), 址, 码);
    showTip('正在连接…');
  });

  if (netCodeEl) {
    netCodeEl.addEventListener('input', function () {
      netCodeEl.value = netCodeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    });
    netCodeEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && netWanJoin) netWanJoin.click();
    });
  }

  /* 公网：复制房间码 / 邀请链接 */
  var btnCopyCode = document.getElementById('netCopyCode');
  if (btnCopyCode) btnCopyCode.addEventListener('click', function () {
    netCopy(NET.room, btnCopyCode, '复制房间码');
  });
  var btnCopyLink = document.getElementById('netCopyLink');
  if (btnCopyLink) btnCopyLink.addEventListener('click', function () {
    var 址 = document.getElementById('netRoomLink');
    netCopy(址 ? 址.value : '', btnCopyLink, '复制邀请链接');
  });

  function netCopy(txt, btn, 原名) {
    if (!txt) return;
    function 完() {
      if (!btn) return;
      btn.textContent = '已复制';
      setTimeout(function () { btn.textContent = 原名; }, 1400);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(完, function () { netCopyFallback(txt, 完); });
    } else {
      netCopyFallback(txt, 完);
    }
  }

  function netCopyFallback(txt, cb) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { }
    document.body.removeChild(ta);
    if (cb) cb();
  }

  /* 局域网：开房 */
  document.getElementById('netHost').addEventListener('click', function () {
    if (netScanTimer) { clearInterval(netScanTimer); netScanTimer = null; }
    netEnterWorld();
    netStartHost(netNameValue());
    showTip('正在创建房间…');
  });

  /* 局域网：按 IP 加入 */
  document.getElementById('netJoinBtn').addEventListener('click', function () {
    var ip = netIpEl.value.trim();
    if (!ip) { showTip('请输入房主的 IP'); return; }
    if (netScanTimer) { clearInterval(netScanTimer); netScanTimer = null; }
    netEnterWorld();
    netJoinAt(ip, netNameValue());
    showTip('正在连接…');
  });

  document.getElementById('mNetLeave').addEventListener('click', function () {
    netLeave(true);
    showTip('已退出联机');
    setTimeout(function () { location.reload(); }, 420);
  });

  window.__mc.net = {
    start: netStartHost,
    join: netJoinAt,
    startPublic: netStartPublic,
    joinPublic: netJoinPublic,
    openPanel: netOpenPanel,
    makeCode: netMakeCode,
    trimRelay: netTrimRelay,
    leave: netLeave,
    info: function () {
      return {
        mode: NET.mode, on: NET.on, host: NET.host, room: NET.room, relay: NET.relay,
        url: NET.relay && NET.room ? netRoomUrl(NET.relay, NET.room) : '', err: NET.lastErr
      };
    },
    peers: function () {
      var r = [];
      for (var k in NET.peers) r.push([+k, NET.peers[k].name, NET.peers[k].pos.toArray()]);
      return r;
    },
    state: function () {
      return { on: NET.on, host: NET.host, id: NET.myId, addr: NET.addr, peers: Object.keys(NET.peers).length, mobs: NET.mobNet.size };
    },
    send: netSend,
    mobIds: function () {
      return mobs.filter(function (m) { return m.nid; }).map(function (m) { return [m.nid, m.hp]; });
    }
  };

  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) {
    if (e.target === document.body || e.target === canvas) e.preventDefault();
  }, { passive: false });

  try {
    boot();
  } catch (err) {
    loadingEl.textContent = '初始化失败：' + err.message;
  }
})();
