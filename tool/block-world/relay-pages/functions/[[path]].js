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

export async function onRequest({ request, env }) {
    const url = new URL(request.url);

    if (url.pathname === '/healthz' || url.pathname === '/status.json') {
      return 返回JSON({
        ok: true,
        service: 'block-world-relay',
        runtime: 'cloudflare-pages',
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
