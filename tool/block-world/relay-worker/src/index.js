/* 方块世界 · Cloudflare Workers 公网中继
 *
 * 协议与 relay/server.js 完全一致，只是运行方式换成
 * Workers + Durable Objects：每个房间码对应一个 Durable Object，
 * 房间之间天然隔离，WebSocket 由 Cloudflare 边缘节点维持。
 *
 * 部署：npx wrangler deploy
 * 连接：wss://<worker 域名>/room/<房间码>
 */

const 房间码规则 = /^[A-Z0-9]{4,12}$/;
const 每房人数上限 = 12;
const 单房方块改动上限 = 40000;
const 房主宽限毫秒 = 20000;
const 空房保留毫秒 = 60000;
const 单条消息字节上限 = 64 * 1024;
const 每分钟消息上限 = 1800;

function 返回JSON(数据, 状态码 = 200) {
  return new Response(JSON.stringify(数据), {
    status: 状态码,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

const 状态页 = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>方块世界 · Cloudflare 中继</title>
<style>
body{margin:0;padding:28px;background:#0b1016;color:#dff0e6;font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
h1{font-size:18px;margin:0 0 4px}p{color:#8fa4b8;margin:0 0 16px;font-size:13px}
code{background:rgba(255,255,255,.07);padding:2px 6px;border-radius:5px;font-size:12px}
.box{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:14px 18px;max-width:680px}
.box b{color:#9ee87a}
ul{padding-left:20px;color:#b8c8d8;font-size:13px}li{margin:5px 0}
</style></head><body>
<h1>方块世界 · Cloudflare 中继</h1>
<p>运行在 Workers + Durable Objects 上 · 每个房间码一个独立 Durable Object</p>
<div class="box">
  <p style="color:#dff0e6;margin-bottom:8px"><b>连接地址</b></p>
  <p><code>wss://本域名/room/房间码</code></p>
  <p><b>健康检查</b>：<code>/healthz</code></p>
  <p style="margin-bottom:0">房间和方块改动只存在对应 Durable Object 的内存里，长时间没人会自动回收；没有接任何外部数据库。</p>
</div>
<ul>
  <li>游戏本体不在这里，仍在 GitHub Pages 的 <code>/tool/block-world/</code></li>
  <li>中继只转发消息，不跑游戏逻辑</li>
  <li>房间码就是通行证，别公开分享</li>
  <li>每房最多 12 人，全服不设固定房间数上限，按实际用量计费</li>
</ul>
</body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/healthz' || url.pathname === '/status.json') {
      return 返回JSON({
        ok: true,
        service: 'block-world-relay',
        runtime: 'cloudflare-workers',
        time: new Date().toISOString()
      });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(状态页, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    }

    const 匹配 = /^\/room\/([^/]+)\/?$/.exec(url.pathname);
    if (!匹配) {
      return new Response('404 · 中继提供 /room/<房间码> 的 WebSocket 与 /healthz', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    let 房间码;
    try {
      房间码 = decodeURIComponent(匹配[1]).toUpperCase();
    } catch (e) {
      return 返回JSON({ ok: false, error: '房间码编码不正确' }, 400);
    }
    if (!房间码规则.test(房间码)) {
      return 返回JSON({ ok: false, error: '房间码只能是 4~12 位字母或数字' }, 400);
    }
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return 返回JSON({ ok: false, error: '这个地址要升级成 WebSocket 才能用' }, 426);
    }

    const id = env.ROOMS.idFromName(房间码);
    const 房间 = env.ROOMS.get(id);
    return 房间.fetch(request);
  }
};

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.房间码 = '';
    this.下一个id = 0;
    this.房主id = 0;
    this.房主密钥 = '';
    this.改动 = new Map();
    this.限流 = new Map();

    this.就绪 = this.state.blockConcurrencyWhile(async () => {
      this.房主密钥 = (await this.state.storage.get('hostKey')) || '';
      this.房间码 = (await this.state.storage.get('roomCode')) || '';

      // 休眠后内存会重置，但 WebSocket 的 attachment 还在；
      // 从现有连接里恢复最大 id 和房主，避免 id 重复。
      for (const ws of this.state.getWebSockets()) {
        const 记录 = this.取记录(ws);
        if (记录.id > this.下一个id) this.下一个id = 记录.id;
        if (记录.host && ws.readyState === 1) this.房主id = 记录.id;
      }
    });
  }

  取记录(ws) {
    try {
      return ws.deserializeAttachment() || {};
    } catch (e) {
      return {};
    }
  }

  存记录(ws, 补充) {
    const 记录 = Object.assign({ id: 0, name: '', ready: false, host: false }, this.取记录(ws), 补充 || {});
    try { ws.serializeAttachment(记录); } catch (e) { }
    return 记录;
  }

  活着的连接() {
    const 列表 = [];
    for (const ws of this.state.getWebSockets()) {
      if (ws.readyState === 1) 列表.push(ws);
    }
    return 列表;
  }

  发(ws, 数据) {
    try { ws.send(JSON.stringify(数据)); } catch (e) { }
  }

  广播(数据, 除了) {
    const 文本 = JSON.stringify(数据);
    for (const ws of this.活着的连接()) {
      if (ws === 除了) continue;
      try { ws.send(文本); } catch (e) { }
    }
  }

  玩家列表() {
    const 列表 = [];
    for (const ws of this.活着的连接()) {
      const 记录 = this.取记录(ws);
      if (记录.ready && 记录.name) 列表.push({ id: 记录.id, name: 记录.name });
    }
    列表.sort((a, b) => a.id - b.id);
    return 列表;
  }

  拒绝(ws, 代码, 说明) {
    this.发(ws, { t: 'err', code: 代码, msg: 说明 });
    try { ws.close(1008, String(说明).slice(0, 100)); } catch (e) { }
  }

  async fetch(request) {
    await this.就绪;

    const 路径 = new URL(request.url).pathname;
    const 路径匹配 = /^\/room\/([^/]+)\/?$/.exec(路径);
    let 请求码 = '';
    if (路径匹配) {
      try { 请求码 = decodeURIComponent(路径匹配[1]).toUpperCase(); } catch (e) { }
    }
    if (请求码 && 请求码 !== this.房间码) {
      this.房间码 = 请求码;
      await this.state.storage.put('roomCode', 请求码);
    }

    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('需要 WebSocket 升级', { status: 426 });
    }
    if (this.活着的连接().length >= 每房人数上限) {
      return new Response('房间满员了（最多 ' + 每房人数上限 + ' 人）', { status: 503 });
    }

    const 配对 = new WebSocketPair();
    const 客户端 = 配对[0];
    const 服务端 = 配对[1];
    this.state.acceptWebSocket(服务端);

    const id = ++this.下一个id;
    服务端.serializeAttachment({ id, name: '', ready: false, host: false });

    return new Response(null, { status: 101, webSocket: 客户端 });
  }

  async webSocketMessage(ws, 原始) {
    await this.就绪;

    let 文本;
    if (typeof 原始 === 'string') 文本 = 原始;
    else if (原始 instanceof ArrayBuffer) 文本 = new TextDecoder().decode(原始);
    else return;

    if (文本.length > 单条消息字节上限) {
      try { ws.close(1009, '消息太大'); } catch (e) { }
      return;
    }

    let 消息;
    try { 消息 = JSON.parse(文本); } catch (e) { return; }
    if (!消息 || typeof 消息.t !== 'string') return;

    const 记录 = this.取记录(ws);
    if (!记录.ready) {
      if (消息.t === 'hi') await this.握手(ws, 记录, 消息);
      return;
    }

    // 简单限流：每连接每分钟最多 1800 条，位置包正常约 600 条
    const 现在 = Date.now();
    let 计数 = this.限流.get(记录.id);
    if (!计数 || 现在 - 计数.起点 > 60000) {
      计数 = { 起点: 现在, 数量: 0, 警告过: false };
      this.限流.set(记录.id, 计数);
    }
    计数.数量++;
    if (计数.数量 > 每分钟消息上限) {
      if (!计数.警告过) {
        计数.警告过 = true;
        this.发(ws, { t: 'err', code: 'rate', msg: '消息发太快了，先歇一下' });
      }
      return;
    }

    const id = 记录.id;

    if (消息.t === 'ping') {
      this.发(ws, { t: 'pong', n: 消息.n });
      return;
    }

    if (消息.t === 'blk') {
      if (typeof 消息.x !== 'number' || typeof 消息.y !== 'number' || typeof 消息.z !== 'number') return;
      const 键 = 消息.x + ',' + 消息.y + ',' + 消息.z;
      if (!this.改动.has(键) && this.改动.size >= 单房方块改动上限) return;
      const 方块id = 消息.id | 0;
      this.改动.set(键, 方块id);
      this.广播({ t: 'blk', x: 消息.x, y: 消息.y, z: 消息.z, id: 方块id, from: id }, ws);
      return;
    }

    if (消息.t === 'hi') return;

    // 位置、怪物、攻击、伤害、离开：原样转发，带上来者 id
    const 转发 = Object.assign({}, 消息, { from: id });
    delete 转发.key;
    this.广播(转发, ws);
  }

  async 握手(ws, 记录, 消息) {
    const id = 记录.id;
    const 名字 = String(消息.name || '').replace(/[<>&"']/g, '').trim().slice(0, 10) || ('玩家' + id);
    const 密钥 = String(消息.key || '').slice(0, 64);
    const 想当房主 = !!消息.host;

    this.存记录(ws, { name: 名字 });

    if (想当房主) {
      if (!密钥) {
        this.拒绝(ws, 'badkey', '房主密钥缺失，请从游戏面板重新创建房间');
        return;
      }

      const 现有房主 = this.房主id
        ? this.活着的连接().find(x => this.取记录(x).id === this.房主id)
        : null;

      if (!现有房主) {
        // 没有房主：如果这个房间从没认领过，就把密钥记下来；否则必须匹配
        if (!this.房主密钥) {
          this.房主密钥 = 密钥;
          await this.state.storage.put('hostKey', 密钥);
        } else if (密钥 !== this.房主密钥) {
          this.拒绝(ws, 'hosted', '这个房间已经有房主了，换个房间码或直接加入');
          return;
        }
        this.房主id = id;
        this.存记录(ws, { host: true, ready: true });
        await this.state.storage.deleteAlarm();
      } else if (密钥 === this.房主密钥) {
        // 原房主在别处重连：把旧连接踢掉，房间交给新连接
        this.房主id = id;
        this.存记录(ws, { host: true, ready: true });
        await this.state.storage.deleteAlarm();
        if (现有房主 !== ws) {
          this.发(现有房主, { t: 'bye', reason: '房主在别处重新连上了' });
          try { 现有房主.close(1008, '房主在其他地方重连'); } catch (e) { }
          // 清掉旧连接的 host 标记，防止它关闭时误判
          this.存记录(现有房主, { host: false });
        }
      } else {
        this.拒绝(ws, 'hosted', '这个房间已经有房主了，换个房间码或直接加入');
        return;
      }
    } else {
      // 普通加入：如果房主刚掉线，允许第一个进来的人接手，避免整房卡死
      if (!this.房主id) {
        this.房主id = id;
        this.存记录(ws, { host: true });
      }
      this.存记录(ws, { ready: true });
      await this.state.storage.deleteAlarm();
    }

    const 玩家 = this.玩家列表().filter(p => p.id !== id);
    const 改动列表 = [];
    for (const [键, 值] of this.改动) {
      const 部分 = 键.split(',').map(Number);
      改动列表.push([部分[0], 部分[1], 部分[2], 值]);
    }

    this.发(ws, {
      t: 'w',
      id,
      host: this.房主id,
      room: this.房间码,
      players: 玩家,
      edits: 改动列表
    });

    this.广播({ t: 'j', id, name: 名字 }, ws);
  }

  async webSocketClose(ws, 代码, 原因, 是否正常) {
    await this.就绪;

    const 记录 = this.取记录(ws);
    if (!记录.ready) return;

    if (this.房主id === 记录.id) {
      this.房主id = 0;
      this.广播({ t: 'l', id: 记录.id, name: 记录.name });
      await this.state.storage.setAlarm(Date.now() + 房主宽限毫秒);
    } else {
      this.广播({ t: 'l', id: 记录.id, name: 记录.name });
      if (this.活着的连接().length === 0) {
        await this.state.storage.setAlarm(Date.now() + 空房保留毫秒);
      }
    }
  }

  async webSocketError(ws, 错误) {
    // 关闭事件会跟着来，这里只做记录，避免重复广播
    console.log('WebSocket 异常', 错误 && 错误.message ? 错误.message : 错误);
  }

  async alarm() {
    await this.就绪;

    const 连接 = this.活着的连接();

    if (连接.length === 0) {
      this.改动.clear();
      this.限流.clear();
      this.房主id = 0;
      this.房主密钥 = '';
      await this.state.storage.deleteAll();
      return;
    }

    if (!this.房主id) {
      const 下一个 = 连接[0];
      const 记录 = this.取记录(下一个);
      this.房主id = 记录.id;
      this.存记录(下一个, { host: true });
      this.广播({ t: 'host', id: 记录.id });
    }
  }
}
