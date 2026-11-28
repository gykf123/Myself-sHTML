/* 中继自测：模拟两个客户端走完整流程
 * 用法：先启动 node relay/server.js 8788，再 node relay/自测.mjs 8788
 */
'use strict';
import { WebSocket } from 'ws';

const 端口 = process.argv[2] || 8788;
const 基址 = `ws://127.0.0.1:${端口}/room/`;
const 键 = 'KEY' + Date.now().toString(36).toUpperCase();
const 房 = 键.slice(0, 8);

let 通过 = 0, 失败 = 0;
function 断言(名, 条件, 附注) {
  if (条件) { 通过++; console.log('  ✓ ' + 名); }
  else { 失败++; console.log('  ✗ ' + 名 + (附注 ? ' → ' + 附注 : '')); }
}

function 开(name, host, key, 房码) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(基址 + (房码 || 房));
    const 收件箱 = [];
    ws.on('message', d => 收件箱.push(JSON.parse(d.toString())));
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hi', name, host: host ? 1 : 0, key: key || '' }));
      res({ ws, 收件箱 });
    });
    ws.on('error', rej);
  });
}

const 等 = ms => new Promise(r => setTimeout(r, ms));
const 找 = (箱, t, 谓 = () => true) => 箱.find(m => m.t === t && 谓(m));
const 等消息 = async (箱, t, 谓, 超时 = 2000) => {
  const 起 = Date.now();
  while (Date.now() - 起 < 超时) {
    if (找(箱, t, 谓)) return 找(箱, t, 谓);
    await 等(30);
  }
  return null;
};

(async () => {
  console.log('\n[1] 房主与访客握手');
  const 甲 = await 开('甲', true, 键);
  const 甲欢迎 = await 等消息(甲.收件箱, 'w');
  断言('房主收到欢迎包', !!甲欢迎);
  断言('房主 id 为 1', 甲欢迎 && 甲欢迎.id === 1, 甲欢迎 && 甲欢迎.id);
  断言('欢迎包带回房间码', 甲欢迎 && 甲欢迎.room === 房, 甲欢迎 && 甲欢迎.room);
  断言('房主被标记为房主', 甲欢迎 && 甲欢迎.host === 甲欢迎.id);

  const 乙 = await 开('乙', false, '', 房);
  const 乙欢迎 = await 等消息(乙.收件箱, 'w');
  断言('访客收到欢迎包', !!乙欢迎);
  断言('访客 id 为 2', 乙欢迎 && 乙欢迎.id === 2, 乙欢迎 && 乙欢迎.id);
  断言('访客知道房主是 1', 乙欢迎 && 乙欢迎.host === 1);
  断言('访客看到房主在玩家列表', 乙欢迎 && 乙欢迎.players.some(p => p.name === '甲'),
    乙欢迎 && JSON.stringify(乙欢迎.players));
  断言('房主收到加入通知', !!(await 等消息(甲.收件箱, 'j', m => m.name === '乙')));

  console.log('\n[2] 位置与方块同步');
  乙.ws.send(JSON.stringify({ t: 'st', x: 1.5, y: 20, z: 3, yaw: 0.5, pitch: 0, mv: 1 }));
  const 位置 = await 等消息(甲.收件箱, 'st');
  断言('房主收到访客位置', 位置 && 位置.x === 1.5 && 位置.from === 2);
  断言('位置包带 from，房主能区分是谁', 位置 && 位置.from === 2, 位置 && JSON.stringify(位置));

  乙.ws.send(JSON.stringify({ t: 'blk', x: 3, y: 10, z: -2, id: 5 }));
  const 改块 = await 等消息(甲.收件箱, 'blk');
  断言('房主收到方块改动', 改块 && 改块.id === 5 && 改块.x === 3);
  断言('方块改动不回弹给发送者', !找(乙.收件箱, 'blk'));

  console.log('\n[3] 新房客能拿到已保存的改动');
  const 丙 = await 开('丙', false, '', 房);
  const 丙欢迎 = await 等消息(丙.收件箱, 'w');
  断言('新房客收到历史方块改动', 丙欢迎 && 丙欢迎.edits.some(e => e[0] === 3 && e[1] === 10 && e[2] === -2 && e[3] === 5),
    丙欢迎 && JSON.stringify(丙欢迎.edits));

  console.log('\n[4] 房间隔离');
  const 丁 = await 开('丁', true, 'OTHERKEY', 'ZZ99');
  const 丁欢迎 = await 等消息(丁.收件箱, 'w');
  断言('另一个房间码能独立开房', !!丁欢迎);
  甲.ws.send(JSON.stringify({ t: 'mb', m: [[1, 0, 0, 0, 3]] }));
  await 等(200);
  断言('怪物包不会串房', !找(丁.收件箱, 'mb'));
  断言('怪物包在本房内转发', !!(await 等消息(乙.收件箱, 'mb')));
  丁.ws.close();

  console.log('\n[5] 重复开同名房被拒');
  const 戊 = await 开('戊', true, 'WRONGKEY', 房);
  const 戊错 = await 等消息(戊.收件箱, 'err', m => m.code === 'hosted' || m.code === 'badkey');
  断言('没有房主密钥不能抢房', !!戊错, 戊错 && 戊错.msg);
  戊.ws.close();

  console.log('\n[6] 房主断线宽限与认回');
  甲.ws.close();
  await 等(300);
  断言('房主断开后访客仍在房内（未被解散）', !找(乙.收件箱, 'bye'));
  const 甲2 = await 开('甲', true, 键, 房);
  const 甲2欢迎 = await 等消息(甲2.收件箱, 'w');
  断言('房主凭密钥认回房间', !!甲2欢迎 && 甲2欢迎.host === 甲2欢迎.id);
  断言('认回后仍能看到历史改动', 甲2欢迎 && 甲2欢迎.edits.length >= 1);

  console.log('\n[7] 访客离开通知');
  丙.ws.close();
  断言('房主收到离开通知', !!(await 等消息(甲2.收件箱, 'l', m => m.id === 3)));

  console.log('\n[8] 非法路径与房间码');
  const 坏 = new WebSocket(`ws://127.0.0.1:${端口}/room/中文`);
  const 坏结果 = await new Promise(r => { 坏.on('error', () => r('error')); 坏.on('open', () => r('open')); });
  断言('非法房间码被拒绝', 坏结果 === 'error', 坏结果);

  乙.ws.close(); 甲2.ws.close();
  await 等(200);
  console.log(`\n结果：通过 ${通过}，失败 ${失败}\n`);
  process.exit(失败 ? 1 : 0);
})().catch(e => { console.error('自测异常：', e); process.exit(1); });
