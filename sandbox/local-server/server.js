/* 方块世界 · 联机版服务端（零依赖）
 * 用法：node server.js [端口]
 * 同一个 Wi-Fi 下：房主跑这个，另一台在游戏里输入房主 IP 即可。
 * 也顺带把当前目录当成静态站点，浏览器直接打开 http://127.0.0.1:8765 就能玩。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const crypto = require('crypto');

const PORT = parseInt(process.argv[2], 10) || 8765;
// 静态资源在上一级目录，联机脚本单独放这里，开房时也要能打开游戏本体
const ROOT = path.resolve(__dirname, '..');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/* ---------------- WebSocket 帧 ---------------- */
function encodeFrame(str) {
  const p = Buffer.from(str, 'utf8');
  const n = p.length;
  let head;
  if (n < 126) { head = Buffer.alloc(2); head[1] = n; }
  else if (n < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  head[0] = 0x81;
  return Buffer.concat([head, p]);
}

function decodeFrames(buf) {
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
      len = Number(buf.readBigUInt64BE(p)); p += 8;
    }
    const masked = (b1 & 0x80) !== 0;
    let mask = null;
    if (masked) {
      if (p + 4 > buf.length) break;
      mask = buf.subarray(p, p + 4); p += 4;
    }
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
    else if (op === 0x1) out.push({ op: 'text', data: payload.toString('utf8') });
  }
  return { msgs: out, rest: buf.subarray(off) };
}

/* ---------------- 房间状态 ---------------- */
const clients = new Map();      // id -> {id, name, sock, buf}
const edits = new Map();        // "x,y,z" -> blockId
let nextId = 1;
let hostId = 0;
let roomName = '方块世界';

function send(id, obj) {
  const c = clients.get(id);
  if (!c || c.sock.destroyed) return;
  try { c.sock.write(encodeFrame(JSON.stringify(obj))); } catch (e) { }
}

function broadcast(obj, except) {
  const s = JSON.stringify(obj);
  for (const c of clients.values()) {
    if (c.id === except || c.sock.destroyed) continue;
    try { c.sock.write(encodeFrame(s)); } catch (e) { }
  }
}

function playerList() {
  return Array.from(clients.values()).map(c => ({ id: c.id, name: c.name }));
}

function onMessage(id, raw) {
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;

  if (m.t === 'hi') {
    const c = clients.get(id);
    if (!c) return;
    c.name = String(m.name || '玩家').slice(0, 10) || ('玩家' + id);
    if (m.host && !hostId) hostId = id;
    send(id, {
      t: 'w', id: id, host: hostId,
      players: playerList().filter(p => p.id !== id),
      edits: Array.from(edits.entries()).map(([k, v]) => {
        const p = k.split(',').map(Number);
        return [p[0], p[1], p[2], v];
      })
    });
    broadcast({ t: 'j', id: id, name: c.name }, id);
    console.log(`[join] #${id} ${c.name}${hostId === id ? ' (房主)' : ''} 在线 ${clients.size}`);
    return;
  }

  if (m.t === 'blk') {
    if (typeof m.x !== 'number' || typeof m.y !== 'number' || typeof m.z !== 'number') return;
    edits.set(m.x + ',' + m.y + ',' + m.z, m.id | 0);
    broadcast(Object.assign({}, m, { from: id }), id);
    return;
  }

  // 其余消息按原样转发（位置、怪物、伤害、攻击…）
  broadcast(Object.assign({}, m, { from: id }), id);
}

function onClose(id) {
  const c = clients.get(id);
  if (!c) return;
  clients.delete(id);
  if (hostId === id) {
    // 房主走了，房间就散了
    broadcast({ t: 'bye' });
    hostId = 0;
    edits.clear();
    for (const other of clients.values()) {
      try { other.sock.end(); } catch (e) { }
    }
    clients.clear();
    console.log('[room] 房主离开，房间关闭');
    return;
  }
  broadcast({ t: 'l', id: id });
  console.log(`[leave] #${id} ${c.name} 在线 ${clients.size}`);
}

/* ---------------- HTTP + 升级 ---------------- */
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = url === '/' ? '/index.html' : url;
  const full = path.join(ROOT, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
});

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  sock.setNoDelay(true);

  const id = nextId++;
  const c = { id, name: '', sock, buf: Buffer.alloc(0) };
  clients.set(id, c);

  sock.on('data', chunk => {
    c.buf = Buffer.concat([c.buf, chunk]);
    const { msgs, rest } = decodeFrames(c.buf);
    c.buf = rest;
    for (const m of msgs) {
      if (m.op === 'close') { try { sock.end(); } catch (e) { } return; }
      if (m.op === 'ping') { try { sock.write(Buffer.from([0x8a, 0x00])); } catch (e) { } continue; }
      if (m.op === 'text') onMessage(id, m.data);
    }
  });
  sock.on('error', () => { });
  sock.on('close', () => onClose(id));
});

server.listen(PORT, () => {
  console.log(`方块世界联机服务已启动：http://127.0.0.1:${PORT}  （端口 ${PORT}）`);
  console.log('同一 Wi-Fi 下，其他设备在游戏里输入本机 IP 即可加入。');
  // UDP 广播，方便同网段设备自动发现
  const udp = dgram.createSocket('udp4');
  udp.bind(() => {
    try { udp.setBroadcast(true); } catch (e) { }
    setInterval(() => {
      if (!clients.size) return;
      const msg = Buffer.from(JSON.stringify({ app: 'mcblocks', port: PORT, name: roomName, players: clients.size }));
      try { udp.send(msg, 0, msg.length, 30001, '255.255.255.255'); } catch (e) { }
    }, 2000);
  });
});
