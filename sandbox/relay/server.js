/* 方块世界 · 公网中继（零依赖 Node）
 *
 * 干什么：把原来「房主自己开一台局域网服务」改成「大家都连一台公网中继」。
 * 中继只做四件事：分房间、转发消息、存方块改动、管房主身份。游戏逻辑全在客户端。
 *
 * 用法：node server.js            （默认端口 8787）
 *      PORT=9000 node server.js
 *      node server.js 9000
 *
 * 连接地址：ws(s)://<你的域名或IP>:<端口>/room/<4~12 位房间码>
 * 房间码只允许 A-Z 0-9，客户端会统一转大写。
 *
 * 和原包的兼容性：w / j / l / st / blk / mb / hit / hurt / bye 全部不变，
 * 只额外支持握手时带 key（房主密钥），用来在房主断线后把房间认回来。
 *
 * 不连任何数据库。房间数据全在内存里，进程重启就清空，重启后房间码也就作废了。
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* 静态站点目录：本文件在 sandbox/relay/ 下，站点根在再上一级。
   有它就顺带把游戏本身也发出去，方便一个进程搞定「开服 + 开网页」。 */
const 站点根 = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function 发静态(req, res, 相对) {
  const 安全路径 = path.normalize(相对).replace(/^(\.\.[/\\])+/, '');
  const 全路径 = path.join(站点根, 安全路径);
  if (!全路径.startsWith(站点根)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403');
    return true;
  }
  let data;
  try { data = fs.readFileSync(全路径); } catch (e) { return false; }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(全路径).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  res.end(data);
  return true;
}

const PORT = parseInt(process.argv[2], 10) || parseInt(process.env.PORT, 10) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const 配置 = {
  每房人数上限: 12,
  房间数上限: 200,
  单房方块改动上限: 40000,
  房主断线宽限毫秒: 20000,      // 房主掉线后房间留 20 秒，期间可凭密钥认回
  空房保留毫秒: 60000,          // 房间没人了再留 1 分钟，方便刷新页面回来
  心跳间隔毫秒: 25000,
  单连接消息上限每分钟: 1800,   // 客户端每 100ms 一包位置，约 600 包/分钟，留足余量
  单条消息字节上限: 64 * 1024
};

/* ---------------- WebSocket 帧编解码 ---------------- */
function 编码帧(str) {
  const p = Buffer.from(str, 'utf8');
  const n = p.length;
  let head;
  if (n < 126) { head = Buffer.alloc(2); head[1] = n; }
  else if (n < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  head[0] = 0x81;
  return Buffer.concat([head, p]);
}

function 编码控制帧(op, payload) {
  const p = payload || Buffer.alloc(0);
  return Buffer.concat([Buffer.from([0x80 | op, p.length]), p]);
}

function 解码帧(buf) {
  const out = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const b0 = buf[off], b1 = buf[off + 1];
    const op = b0 & 0x0f;
    let len = b1 & 0x7f, p = off + 2;
    if (len === 126) {
      if (p + 2 > buf.length) break;
      len = buf.readUInt16BE(p); p += 2;
    } else if (len === 127) {
      if (p + 8 > buf.length) break;
      const big = buf.readBigUInt64BE(p);
      if (big > BigInt(配置.单条消息字节上限)) { out.push({ op: 'toolarge' }); break; }
      len = Number(big); p += 8;
    }
    const masked = (b1 & 0x80) !== 0;
    let mask = null;
    if (masked) {
      if (p + 4 > buf.length) break;
      mask = buf.subarray(p, p + 4); p += 4;
    }
    if (len > 配置.单条消息字节上限) { out.push({ op: 'toolarge' }); off = buf.length; break; }
    if (p + len > buf.length) break;
    let payload = buf.subarray(p, p + len);
    if (masked) {
      const d = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) d[i] = payload[i] ^ mask[i & 3];
      payload = d;
    }
    off = p + len;
    if (op === 0x8) out.push({ op: 'close' });
    else if (op === 0x9) out.push({ op: 'ping' });
    else if (op === 0xa) out.push({ op: 'pong' });
    else if (op === 0x1) out.push({ op: 'text', data: payload.toString('utf8') });
  }
  return { msgs: out, rest: buf.subarray(off) };
}

/* ---------------- 房间 ---------------- */
const 房间表 = new Map();   // 房间码 -> 房间
let 累计连接 = 0;
const 启动时间 = Date.now();

function 新房间(码) {
  return {
    码,
    成员: new Map(),        // 房内 id -> 连接
    房主: null,             // 房主连接
    房主密钥: '',           // 客户端生成，第一次认领时记下
    改动: new Map(),        // "x,y,z" -> 方块 id
    空房定时: null,
    房主宽限定时: null,
    创建时间: Date.now(),
    最近活动: Date.now()
  };
}

function 取房间(码) {
  let r = 房间表.get(码);
  if (!r) {
    if (房间表.size >= 配置.房间数上限) return null;
    r = 新房间(码);
    房间表.set(码, r);
  }
  return r;
}

function 房内分配id(房间) {
  for (let i = 1; i <= 配置.每房人数上限; i++) if (!房间.成员.has(i)) return i;
  return 0;
}

function 玩家列表(房间) {
  const list = [];
  房间.成员.forEach(c => {
    // 还没握手的连接不对外露出，免得列表里冒出空名字
    if (!c.已握手 && c.名字 === '') return;
    list.push({ id: c.id, name: c.名字 });
  });
  return list;
}

function 发送(c, obj) {
  if (!c || c.已关闭) return;
  try { c.sock.write(编码帧(JSON.stringify(obj))); } catch (e) { }
}

function 广播(房间, obj, 除了) {
  const s = JSON.stringify(obj);
  const frame = s.length ? 编码帧(s) : null;
  房间.成员.forEach(c => {
    if (c === 除了 || c.已关闭) return;
    try { c.sock.write(frame); } catch (e) { }
  });
}

function 清理房间(房间) {
  if (房间.房主宽限定时) { clearTimeout(房间.房主宽限定时); 房间.房主宽限定时 = null; }
  if (房间.空房定时) { clearTimeout(房间.空房定时); 房间.空房定时 = null; }
  房间表.delete(房间.码);
}

function 关闭房间(房间, 原因) {
  房间.成员.forEach(c => {
    发送(c, { t: 'bye', reason: 原因 || '房间已关闭' });
    try { c.sock.end(); } catch (e) { }
  });
  房间.成员.clear();
  清理房间(房间);
}

/* ---------------- 消息处理 ---------------- */
function 处理消息(连接, raw) {
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;

  const 房间 = 连接.房间;
  if (!房间) {
    // 还没握手，只认 hi
    if (m.t === 'hi') 握手(连接, m);
    return;
  }
  房间.最近活动 = Date.now();

  // 限流：防止有人刷包把房间打爆
  const now = Date.now();
  if (now - 连接.计数起点 > 60000) { 连接.计数起点 = now; 连接.计数 = 0; }
  if (++连接.计数 > 配置.单连接消息上限每分钟) {
    if (!连接.已警告限流) {
      连接.已警告限流 = true;
      发送(连接, { t: 'err', code: 'rate', msg: '消息发太快了，先歇一下' });
    }
    return;
  }

  const id = 连接.id;

  if (m.t === 'hi') { 握手(连接, m); return; }

  if (m.t === 'blk') {
    if (typeof m.x !== 'number' || typeof m.y !== 'number' || typeof m.z !== 'number') return;
    const 键 = m.x + ',' + m.y + ',' + m.z;
    if (!房间.改动.has(键) && 房间.改动.size >= 配置.单房方块改动上限) return;
    房间.改动.set(键, m.id | 0);
    广播(房间, { t: 'blk', x: m.x, y: m.y, z: m.z, id: m.id | 0, from: id }, 连接);
    return;
  }

  if (m.t === 'ping') { 发送(连接, { t: 'pong', n: m.n }); return; }

  if (!连接.已握手) return;   // 没握手前不接受其他消息

  // 位置、怪物、攻击、伤害、离开：按原样转发，带上来者 id
  广播(房间, Object.assign({}, m, { from: id }), 连接);
}

function 握手(连接, m) {
  const 房间 = 连接.房间;
  if (!房间) return;

  const 名 = String(m.name || '').replace(/[<>&"']/g, '').trim().slice(0, 10) || ('玩家' + 连接.id);
  连接.名字 = 名;
  连接.已握手 = true;
  const 密钥 = String(m.key || '').slice(0, 64);
  const 想当房主 = !!m.host;

  if (想当房主) {
    if (!房间.房主 || 房间.房主.已关闭) {
      // 没人当房主，直接认领；第一次认领把密钥记下来
      if (!房间.房主密钥) 房间.房主密钥 = 密钥;
      if (密钥 && 房间.房主密钥 && 密钥 !== 房间.房主密钥) {
        发送(连接, { t: 'err', code: 'badkey', msg: '这个房间已经有房主了，换个房间码或直接加入' });
        return;
      }
      认房主(连接, 房间);
    } else if (密钥 && 房间.房主密钥 && 密钥 === 房间.房主密钥 && 房间.房主 !== 连接) {
      // 原房主断线重连，且手里有密钥：踢掉旧连接，把房间交回来
      const 旧 = 房间.房主;
      发送(旧, { t: 'bye', reason: '房主在别处重新连上了' });
      try { 旧.sock.end(); } catch (e) { }
      旧.已关闭 = true;
      认房主(连接, 房间);
    } else {
      发送(连接, { t: 'err', code: 'hosted', msg: '这个房间已经有房主了，换一个房间码，或直接加入' });
      return;
    }
  } else if (!房间.房主) {
    // 第一个进来的人自动当房主，省得谁先谁后吵架
    认房主(连接, 房间);
  }

  发送(连接, {
    t: 'w',
    id: 连接.id,
    host: 房间.房主 ? 房间.房主.id : 0,
    room: 房间.码,
    players: 玩家列表(房间).filter(p => p.id !== 连接.id),
    hostName: 房间.房主 && 房间.房主 !== 连接 ? 房间.房主.名字 : '',
    edits: Array.from(房间.改动.entries()).map(([k, v]) => {
      const p = k.split(',').map(Number);
      return [p[0], p[1], p[2], v];
    })
  });

  广播(房间, { t: 'j', id: 连接.id, name: 连接.名字 }, 连接);
  console.log(`[加入] ${房间.码} #${连接.id} ${连接.名字}${房间.房主 === 连接 ? '（房主）' : ''} 在线 ${房间.成员.size}`);
}

function 认房主(连接, 房间) {
  if (房间.房主宽限定时) { clearTimeout(房间.房主宽限定时); 房间.房主宽限定时 = null; }
  房间.房主 = 连接;
  连接.是房主 = true;
  if (房间.空房定时) { clearTimeout(房间.空房定时); 房间.空房定时 = null; }
}

function 连接断开(连接) {
  if (连接.已关闭 && 连接.清理过) return;
  连接.清理过 = true;
  const 房间 = 连接.房间;
  if (!房间) return;
  连接.已关闭 = true;
  房间.成员.delete(连接.id);

  if (房间.房主 === 连接) {
    房间.房主 = null;
    // 房主掉线：留一段宽限，等他用密钥回来，免得整房人被动解散
    console.log(`[房主离线] ${房间.码}，等待 ${Math.round(配置.房主断线宽限毫秒 / 1000)}s 认回`);
    房间.房主宽限定时 = setTimeout(() => {
      房间.房主宽限定时 = null;
      if (房间.房主) return;
      if (房间.成员.size === 0) { 清理房间(房间); return; }
      // 房主没回来，把房间里剩下的人里最早进来的那个扶正，别让所有人卡死
      const 下一个 = 房间.成员.values().next().value;
      if (下一个) {
        认房主(下一个, 房间);
        广播(房间, { t: 'host', id: 下一个.id });
        console.log(`[换房主] ${房间.码} 交给 #${下一个.id} ${下一个.名字}`);
      } else {
        清理房间(房间);
      }
    }, 配置.房主断线宽限毫秒);
  } else {
    广播(房间, { t: 'l', id: 连接.id, name: 连接.名字 });
  }

  console.log(`[离开] ${房间.码} #${连接.id} ${连接.名字 || ''} 在线 ${房间.成员.size}`);

  if (房间.成员.size === 0) {
    if (房间.空房定时) clearTimeout(房间.空房定时);
    房间.空房定时 = setTimeout(() => {
      房间.空房定时 = null;
      if (房间.成员.size === 0) {
        console.log(`[回收] 房间 ${房间.码}`);
        清理房间(房间);
      }
    }, 配置.空房保留毫秒);
  }
}

/* ---------------- HTTP 部分 ---------------- */
function 状态快照() {
  const 房间们 = [];
  房间表.forEach(r => {
    房间们.push({
      code: r.码,
      players: r.成员.size,
      host: r.房主 ? r.房主.id : 0,
      edits: r.改动.size,
      age: Math.round((Date.now() - r.创建时间) / 1000)
    });
  });
  return {
    ok: true,
    rooms: 房间表.size,
    clients: 房间们.reduce((a, r) => a + r.players, 0),
    totalConnections: 累计连接,
    uptime: Math.round((Date.now() - 启动时间) / 1000),
    detail: 房间们
  };
}

function 页面() {
  const s = 状态快照();
  const 行 = s.detail.map(r =>
    `<tr><td>${r.code}</td><td>${r.players}</td><td>${r.host || '—'}</td><td>${r.edits}</td><td>${r.age}s</td></tr>`
  ).join('') || '<tr><td colspan="5" style="color:#7f93a6">暂无房间</td></tr>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>方块世界 · 公网中继状态</title>
<style>
body{margin:0;padding:28px;background:#0b1016;color:#dff0e6;font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
h1{font-size:18px;margin:0 0 4px}p{color:#8fa4b8;margin:0 0 18px;font-size:13px}
.k{display:flex;gap:22px;flex-wrap:wrap;margin-bottom:20px}
.k div{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 16px}
.k b{display:block;font-size:22px;color:#9ee87a}
.k span{font-size:12px;color:#8fa4b8}
table{border-collapse:collapse;width:100%;max-width:680px;font-size:13px}
th,td{text-align:left;padding:7px 12px;border-bottom:1px solid rgba(255,255,255,.08)}
th{color:#8fa4b8;font-weight:500}
code{background:rgba(255,255,255,.07);padding:2px 6px;border-radius:5px;font-size:12px}
</style></head><body>
<h1>方块世界 · 公网中继</h1>
<p>运行中 · 房间码 <code>ws://本机:${PORT}/room/房间码</code> · 房间数据只在内存，重启即清空</p>
<div class="k">
  <div><b>${s.rooms}</b><span>房间</span></div>
  <div><b>${s.clients}</b><span>在线玩家</span></div>
  <div><b>${s.totalConnections}</b><span>累计连接</span></div>
  <div><b>${s.uptime}s</b><span>运行时长</span></div>
</div>
<table><thead><tr><th>房间码</th><th>人数</th><th>房主 id</th><th>方块改动</th><th>已存在</th></tr></thead>
<tbody>${行}</tbody></table>
</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': '*'
    });
    res.end();
    return;
  }
  if (url === '/healthz' || url === '/status.json') {
    const s = 状态快照();
    const body = JSON.stringify(s);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
    return;
  }
  if (url === '/' || url === '/index.html') {
    // 根路径优先给中继状态页，游戏本体走 /game/
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(页面());
    return;
  }
  // 顺手把游戏本体也发出去：/game/ 就是 sandbox/ 静态站
  if (url.startsWith('/game/')) {
    const 相对 = url.slice('/game/'.length) || 'index.html';
    if (发静态(req, res, 相对)) return;
  } else if (/^\/(three\.min\.js|game\.js|favicon\.png)$/.test(url)) {
    if (发静态(req, res, url.slice(1))) return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 · 中继提供 /room/<房间码> 的 WebSocket、/healthz，游戏本体在 /game/');
});

/* ---------------- 升级为 WebSocket ---------------- */
const 房间码规则 = /^[A-Z0-9]{4,12}$/;

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  const 路径 = (req.url || '/').split('?')[0];
  const 匹配 = /^\/room\/([^/]+)\/?$/.exec(路径);
  const 码 = 匹配 ? decodeURIComponent(匹配[1]).toUpperCase() : '';

  function 拒(code, 说明) {
    const body = JSON.stringify({ ok: false, error: 说明 });
    try {
      sock.write(
        'HTTP/1.1 ' + code + '\r\n' +
        'Content-Type: application/json; charset=utf-8\r\n' +
        'Content-Length: ' + Buffer.byteLength(body) + '\r\n' +
        'Access-Control-Allow-Origin: *\r\n' +
        'Connection: close\r\n\r\n' + body
      );
    } catch (e) { }
    try { sock.end(); } catch (e) { }
  }

  if (!key) { 拒('400 Bad Request', '不是合法的 WebSocket 握手'); return; }
  if (!匹配) { 拒('404 Not Found', '路径要是 /room/房间码'); return; }
  if (!房间码规则.test(码)) { 拒('400 Bad Request', '房间码只能是 4~12 位字母或数字'); return; }

  const 房间 = 取房间(码);
  if (!房间) { 拒('503 Service Unavailable', '中继房间已满，稍后再试'); return; }
  if (房间.成员.size >= 配置.每房人数上限) { 拒('503 Service Unavailable', '这个房间满员了（最多 ' + 配置.每房人数上限 + ' 人）'); return; }

  const id = 房内分配id(房间);
  if (!id) { 拒('503 Service Unavailable', '这个房间满员了'); return; }

  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  sock.setNoDelay(true);
  sock.setKeepAlive(true, 15000);

  const 连接 = {
    id, sock, 房间, 名字: '', 已握手: false, 已关闭: false, 是房主: false,
    buf: Buffer.alloc(0), 计数: 0, 计数起点: Date.now(), 活着: true, 最后收到: Date.now()
  };
  房间.成员.set(id, 连接);
  if (房间.空房定时) { clearTimeout(房间.空房定时); 房间.空房定时 = null; }
  累计连接++;

  // 客户端没握手就断开，也要能正常回收
  sock.on('data', chunk => {
    连接.最后收到 = Date.now();
    连接.buf = Buffer.concat([连接.buf, chunk]);
    if (process.env.RELAY_DEBUG) console.log('[调试] 收到字节', chunk.length, '累计', 连接.buf.length);
    const { msgs, rest } = 解码帧(连接.buf);
    if (process.env.RELAY_DEBUG) console.log('[调试] 解出帧', JSON.stringify(msgs.map(m => ({ op: m.op, n: (m.data || '').length }))));
    连接.buf = rest;
    for (const m of msgs) {
      if (m.op === 'close') { try { sock.end(); } catch (e) { } return; }
      if (m.op === 'ping') { try { sock.write(编码控制帧(0xa)); } catch (e) { } continue; }
      if (m.op === 'pong') { 连接.活着 = true; continue; }
      if (m.op === 'toolarge') { try { sock.end(); } catch (e) { } return; }
      if (m.op === 'text') {
        if (m.data.length > 配置.单条消息字节上限) { try { sock.end(); } catch (e) { } return; }
        处理消息(连接, m.data);
      }
    }
  });
  sock.on('error', () => { });
  sock.on('close', () => 连接断开(连接));
});

/* 服务端主动 ping，清掉半死不活的连接（手机切后台、掉 Wi-Fi） */
setInterval(() => {
  const now = Date.now();
  房间表.forEach(房间 => {
    房间.成员.forEach(c => {
      if (now - c.最后收到 > 配置.心跳间隔毫秒 * 2.6) {
        try { c.sock.end(); } catch (e) { }
        return;
      }
      try { c.sock.write(编码控制帧(0x9)); } catch (e) { }
    });
  });
}, 配置.心跳间隔毫秒);

function 退出(sig) {
  console.log(`\n收到 ${sig}，关闭中继`);
  房间表.forEach(r => 关闭房间(r, '中继重启，房间已关闭'));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', () => 退出('SIGINT'));
process.on('SIGTERM', () => 退出('SIGTERM'));

server.listen(PORT, HOST, () => {
  console.log('方块世界中继已启动');
  console.log(`  状态页：http://127.0.0.1:${PORT}/`);
  console.log(`  健康检查：http://127.0.0.1:${PORT}/healthz`);
  console.log(`  游戏连接：ws://127.0.0.1:${PORT}/room/房间码`);
  console.log('  公网部署请放在 HTTPS 反向代理后面，游戏里填 wss://你的域名');
});
