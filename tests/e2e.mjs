// Сквозные проверки: поднимаем сервер на свободном порту и гоняем сценарии
// через WebSocket и в настоящем браузере (Playwright + Chromium).
// Запуск: npm run build && npm test. Если Playwright не установлен, браузерные проверки пропускаются.
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3199;
const URL = `http://localhost:${PORT}`;
const SECRET = 'e2e-secret';

let failed = 0, passed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------- сервер ----------
const server = spawn(process.execPath, [path.join(ROOT, 'dist/server/index.js')], {
  env: { ...process.env, PORT: String(PORT), PROGRESS_SECRET: SECRET },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => { if (String(d).includes('Сервер запущен')) res(); });
  server.on('exit', (c) => rej(new Error(`сервер завершился с кодом ${c}`)));
});
const stop = () => server.kill();
process.on('exit', stop);

/** Токен прогресса, как его шифрует сервер (AES-256-GCM, ключ — sha256 от PROGRESS_SECRET). */
function token(kills, deaths = 0) {
  const key = crypto.createHash('sha256').update(SECRET).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(JSON.stringify({ v: 1, k: kills, d: deaths })), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}

// ---------- комнаты через WebSocket ----------
async function wsClient() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const box = { ws, msgs: [] };
  ws.on('message', (d) => box.msgs.push(JSON.parse(String(d))));
  await new Promise((r) => ws.on('open', r));
  return box;
}
const last = (b, t) => [...b.msgs].reverse().find((m) => m.t === t);
const BASE = { name: 'X', team: 'green', mode: 'ffa', map: 'sands', limitKind: 'time', limitValue: 10, kit: ['rifle', 'pistol'], melee: 'knife' };
const join = (b, extra) => b.ws.send(JSON.stringify({ t: 'join', ...BASE, ...extra }));

console.log('Комнаты (WebSocket)');
{
  const lob = await wsClient(); await wait(150);
  check('пустое меню: комнат нет', last(lob, 'lobby')?.rooms.length === 0);
  const a = await wsClient();
  join(a, { room: 'new', roomName: 'Альфа', password: '12', name: 'A' }); await wait(150);
  check('короткий пароль отвергнут', /от 4 до 16/.test(last(a, 'error')?.text ?? ''));
  join(a, { room: 'new', roomName: 'Альфа', password: 'secret', name: 'A' }); await wait(250);
  check('комната с паролем создана', !!last(a, 'welcome'));
  const room = last(lob, 'lobby').rooms[0];
  check('в меню комната с замком', room?.locked === true && room.count === 1);
  const b = await wsClient();
  join(b, { room: room.id, password: 'wrong', name: 'B' }); await wait(150);
  check('неверный пароль', last(b, 'error')?.text === 'Неверный пароль');
  join(b, { room: room.id, password: 'secret', name: 'B' }); await wait(250);
  check('вход с паролем', !!last(b, 'welcome'));
  check('в чате «зашёл»', a.msgs.some((m) => m.t === 'chat' && m.kind === 'join' && m.name === 'B'));
  const extra = [];
  for (const n of ['Б', 'В', 'Г']) { const c = await wsClient(); join(c, { room: 'new', roomName: n, name: n }); extra.push(c); }
  await wait(300);
  const e = await wsClient(); join(e, { room: 'new', roomName: 'Лишняя', name: 'E' }); await wait(150);
  check('пятую комнату создать нельзя', /больше создать нельзя/.test(last(e, 'error')?.text ?? ''));
  check('игроки комнат не смешиваются', last(a, 'players').list.map((p) => p.name).join() === 'A,B');
  b.ws.close(); await wait(250);
  check('в чате «вышел»', a.msgs.some((m) => m.t === 'chat' && m.kind === 'leave' && m.name === 'B'));
  extra[0].ws.close(); await wait(1200);
  check('пустая комната закрылась', last(lob, 'lobby').rooms.length === 3);
  for (const c of [a, e, lob, ...extra]) c.ws.close();
  await wait(1200);
}

console.log('Снаряды (WebSocket)');
{
  // Граната: сорвать чеку, бросить — летит, через 3 с взрывается; бросивший стоит рядом и погибает
  const g = await wsClient();
  join(g, { room: 'new', roomName: 'Гранаты', name: 'G', melee: 'grenade' }); await wait(300);
  check('с гранатой в слоте 1 — одна граната', last(g, 'loadout')?.grenades === 1);
  g.ws.send(JSON.stringify({ t: 'pin' })); await wait(100);
  g.ws.send(JSON.stringify({ t: 'gthrow', d: [0, -1, 0] })); await wait(300);
  check('граната летит', (last(g, 'grenades')?.list.length ?? 0) === 1);
  await wait(3200);
  check('взрыв гранаты под ногами убил бросившего', g.msgs.some((m) => m.t === 'kill' && m.w === 'grenade'));
  // Ракета без ракетницы не вылетает
  g.ws.send(JSON.stringify({ t: 'rocket', d: [0, 0, -1] })); await wait(200);
  check('без ракетницы ракеты нет', !g.msgs.some((m) => m.t === 'rocket'));
  g.ws.close(); await wait(1200);
}

// ---------- браузер ----------
let chromium;
try {
  // require, а не import: так находится и глобально установленный Playwright (через NODE_PATH)
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch { /* нет Playwright */ }
if (!chromium) {
  console.log('Браузер: Playwright не найден — браузерные проверки пропущены');
} else {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  async function open({ w = 960, h = 640, kills } = {}) {
    const p = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(URL);
    if (kills !== undefined) {
      await p.evaluate((t) => localStorage.setItem('doc-progress', t), token(kills));
      await p.reload();
    }
    await p.waitForFunction(() => !document.getElementById('play').disabled);
    return p;
  }
  /** Создать комнату (или войти в выбранную) и закрыть меню паузы. */
  async function play(p, { name = 'Игрок', map, ffa = true, pass } = {}) {
    await p.fill('#name', name);
    if (map) await p.selectOption('#map-choice', map);
    if (ffa && await p.isVisible('#mode-choice')) await p.click('#mode-choice [data-mode=ffa]');
    if (pass) await p.fill(await p.isVisible('#room-pass') ? '#room-pass' : '#room-pass-new', pass);
    await p.click('#play');
    await p.waitForFunction(() => document.getElementById('menu').classList.contains('hidden'));
    await p.click('#resume');
    await p.waitForTimeout(300);
  }
  /** shooter стреляет в упор, пока target не умрёт (или пока не выйдет время). */
  async function kill(shooter, target) {
    for (let i = 0; i < 60; i++) {
      if (!(await target.evaluate(() => game.me.alive))) return true;
      const at = await shooter.evaluate(() => game.me.pos.toArray());
      await target.evaluate(([x, y, z]) => { game.me.pos.set(x, y, z - 2); game.me.vel.set(0, 0, 0); }, at);
      await shooter.evaluate(() => { game.me.yaw = 0; game.me.pitch = -0.05; });
      await shooter.mouse.down(); await shooter.waitForTimeout(150); await shooter.mouse.up();
      await shooter.waitForTimeout(150);
    }
    return false;
  }

  console.log('Меню и комната (браузер)');
  const A = await open({ kills: 19 });
  check('меню: лучшего игрока пока нет', /никто не играет/.test(await A.textContent('#best')));
  await A.fill('#room-pass-new', '12'); await A.click('#play'); await A.waitForTimeout(200);
  check('меню не пускает с коротким паролем', /от 4 до 16/.test(await A.textContent('#status')));
  await play(A, { name: 'Волк', pass: 'tiger42' });
  check('A создал комнату и в игре', await A.isVisible('#hud'));

  const B = await open();
  check('B видит комнату с замком', /🔒/.test(await B.textContent('#room-list')));
  await B.fill('#name', 'Лиса'); await B.fill('#room-pass', 'nope'); await B.click('#play'); await B.waitForTimeout(300);
  check('B: неверный пароль', (await B.textContent('#status')) === 'Неверный пароль');
  await play(B, { name: 'Лиса', pass: 'tiger42', ffa: false });
  await A.waitForTimeout(300);
  check('чат у A: Лиса заходит', /Лиса заходит/.test(await A.textContent('#chat')));

  console.log('Модель игрока');
  check('модель загрузилась', (await A.evaluate(() => game.dbg())).model === 'ready');
  check('пиксельных лиц больше нет', (await A.$('#my-face')) === null);
  {
    // B бежит — у A его модель переходит на бег; прыгает — «в воздухе»; перезаряжается — рука идёт за магазином
    const anim = async () => (await A.evaluate(() => game.dbg())).remoteAnim[0];
    await B.evaluate(() => { game.me.pos.set(0, 0, -6); game.me.vel.set(0, 0, 0); game.me.yaw = Math.PI; });
    // Ждём, пока A увидит B на новом месте и стоящим (тестовый браузер рисует редко)
    await A.waitForFunction(() => { const a = game.dbg().remoteAnim[0]; return a && Math.abs(a.speed) < 0.3 && Math.abs([...game.remotes.values()][0].pos.z + 6) < 0.3; }, null, { timeout: 10000 }).catch(() => {});
    await B.keyboard.down('KeyW');
    const ran = await A.waitForFunction(() => { const a = game.dbg().remoteAnim[0]; return a.run > 0.5 && a.speed > 3; }, null, { timeout: 10000 }).then(() => true, () => false);
    const run = await anim();
    await B.keyboard.up('KeyW'); await A.waitForTimeout(800);
    check('у бегущего играет анимация бега', ran, JSON.stringify(run));
    const airIs = (want) => A.waitForFunction((w) => (game.dbg().remoteAnim[0].air > 0.5) === w, want, { timeout: 10000 }).then(() => true, () => false);
    await B.keyboard.down('Space');
    const up = await airIs(true);
    await B.keyboard.up('Space');
    check('в прыжке ноги поджаты', up);
    check('после приземления — снова на земле', await airIs(false));
    await B.evaluate(() => { game.me.reloadUntil = performance.now() + 1500; }); await A.waitForTimeout(500);
    check('перезарядка видна другим', (await anim()).reload === true);
    await A.waitForTimeout(1500);
  }

  console.log('Бой');
  check('A убивает B', await kill(A, B));
  {
    const corpse = () => A.evaluate(() => game.dbg().corpse);
    const first = await corpse();
    check('тело погибшего — модель с физикой', first?.modelled === true);
    check('у погибшего на экране тоже своё тело с физикой', (await B.evaluate(() => game.dbg().corpse))?.modelled === true);
    // Голова за пару секунд оказывается у земли, а конечности остаются на своих местах относительно тела
    const fell = await A.waitForFunction(() => (game.dbg().corpse?.joints[2]?.[1] ?? 9) < 0.6, null, { timeout: 20000 }).then(() => true, () => false);
    const c = await corpse();
    check('тело упало на землю', fell, c ? `голова на высоте ${c.joints[2][1]}` : 'тела нет');
    if (c) {
      const d = (i, j) => Math.hypot(c.joints[i][0] - c.joints[j][0], c.joints[i][1] - c.joints[j][1], c.joints[i][2] - c.joints[j][2]);
      check('кости не растянулись (бедро и голень ~0.4 м)', Math.abs(d(9, 10) - 0.41) < 0.08 && Math.abs(d(10, 11) - 0.42) < 0.08, `${d(9, 10).toFixed(2)} и ${d(10, 11).toFixed(2)}`);
      check('тело не провалилось под землю', c.joints.every((j) => j[1] > -0.05));
    }
  }
  await A.waitForTimeout(500);
  check('счёт A вырос', /Ты: 1/.test(await A.textContent('#score')));
  check('лента убийств', /Лиса/.test(await A.textContent('#feed')));
  check('повышение до 2-го уровня (19 → 20 убийств)', await A.isVisible('#promo') && /ПОВЫСИЛИ/.test(await A.textContent('#promo')));
  check('B после смерти возродился', await B.waitForFunction(() => game.me.alive, null, { timeout: 6000 }).then(() => true, () => false));

  const C = await open();
  await C.waitForTimeout(1300);
  check('лучший игрок в меню — Волк', /Волк/.test(await C.textContent('#best')) && /Ночная|Комната/.test(await C.textContent('#best')));
  await C.close();

  console.log('Движение');
  const speed = async (p, sprint) => {
    await p.evaluate(() => { game.me.pos.set(0, 0, 0); game.me.vel.set(0, 0, 0); game.me.yaw = 0; });
    if (sprint) await p.keyboard.down('ShiftLeft');
    await p.keyboard.down('KeyW'); await p.waitForTimeout(1000);
    const v = await p.evaluate(() => Math.hypot(game.me.vel.x, game.me.vel.z));
    await p.keyboard.up('KeyW'); if (sprint) await p.keyboard.up('ShiftLeft');
    await p.waitForTimeout(300);
    return v;
  };
  const walk = await speed(A, false), run = await speed(A, true);
  check('ходьба 6.5', Math.abs(walk - 6.5) < 0.05, walk.toFixed(2));
  check('бег 8.125', Math.abs(run - 8.125) < 0.05, run.toFixed(2));

  console.log('Меню паузы');
  await A.evaluate(() => document.exitPointerLock()); await A.waitForTimeout(300);
  await A.evaluate(() => document.getElementById('pause').classList.remove('hidden'));
  check('плитка профиля: ник и звание', /Волк/.test(await A.textContent('#tile-profile')) && /PV2/.test(await A.textContent('#tile-profile')));
  await A.click('.t-classes');
  await A.click('.class-tile >> nth=1'); await A.waitForTimeout(200);
  check('класс «Снайпер» меняет набор', /2:Снайперка/.test((await A.evaluate(() => game.dbg())).hotbar));
  await A.click('.class-tile.add'); await A.fill('#class-name', 'Тест'); await A.waitForTimeout(100);
  check('новый класс сохранён', JSON.parse(await A.evaluate(() => localStorage.getItem('doc-classes'))).list.some((c) => c.name === 'Тест'));
  await A.click('#pause-back');
  await A.click('.t-settings');
  check('настройки: громкость есть, прокачки нет', /Громкость/.test(await A.textContent('#pv-settings')) && !/Прокачка/.test(await A.textContent('#pv-settings')));
  await A.click('#pause-back');
  await A.click('#tile-exit');
  await A.waitForFunction(() => !document.getElementById('menu').classList.contains('hidden') && !document.getElementById('play').disabled);
  check('«Выйти» возвращает в главное меню', true);
  await B.waitForTimeout(400);
  check('чат у B: Волк выходит', /Волк выходит/.test(await B.textContent('#chat')));
  await B.close(); await A.close();

  console.log('Карта «Дом»');
  const H = await open();
  await play(H, { name: 'Дом', map: 'house' });
  await H.evaluate(() => { game.me.pos.set(-4.6, 0, 0); game.me.yaw = Math.PI / 2; game.me.pitch = 0; game.me.vel.set(0, 0, 0); });
  await H.waitForTimeout(300);
  check('у двери подсказка F', /F — открыть дверь/.test(await H.textContent('#crate-text')));
  await H.keyboard.press('KeyF'); await H.waitForTimeout(500);
  check('дверь открылась', (await H.evaluate(() => game.dbg())).openDoors.length === 1);
  await H.evaluate(() => { game.me.pos.set(2.75, 3.5, 3.2); game.me.yaw = Math.PI; game.me.vel.set(0, 0, 0); });
  await H.waitForTimeout(300);
  await H.keyboard.down('KeyW'); await H.waitForTimeout(1800); await H.keyboard.up('KeyW'); await H.waitForTimeout(300);
  const y = await H.evaluate(() => game.me.pos.y);
  check('лестница ведёт на крышу (y 7.3)', Math.abs(y - 7.3) < 0.05, y.toFixed(2));
  await H.close();

  console.log('Сенсорный экран (телефон)');
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    const T = await ctx.newPage();
    T.on('pageerror', (e) => errors.push(e.message));
    const cdp = await ctx.newCDPSession(T);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const centre = async (sel) => { const r = await T.locator(sel).boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
    await T.goto(URL);
    await T.waitForFunction(() => !document.getElementById('play').disabled);
    await T.locator('#play').scrollIntoViewIfNeeded();
    await T.tap('#play');
    await T.waitForFunction(() => document.getElementById('menu').classList.contains('hidden'));
    await T.tap('#resume'); await T.waitForTimeout(400);
    check('«ИГРАТЬ» пальцем запускает игру без захвата мыши', await T.evaluate(() => document.body.classList.contains('playing') && document.getElementById('pause').classList.contains('hidden')));
    await T.evaluate(() => { game.me.pos.set(0, 0, 10); game.me.vel.set(0, 0, 0); game.me.yaw = 0; game.me.pitch = 0; });
    await touch('touchStart', [[150, 260, 1]]);
    await touch('touchMove', [[150, 230, 1]]); await T.waitForTimeout(1000);
    const walk = await T.evaluate(() => Math.hypot(game.me.vel.x, game.me.vel.z));
    await touch('touchMove', [[150, 190, 1]]); await T.waitForTimeout(1000);
    const run = await T.evaluate(() => Math.hypot(game.me.vel.x, game.me.vel.z));
    check('джойстик: ходьба и бег до упора', Math.abs(walk - 6.5) < 0.1 && Math.abs(run - 8.125) < 0.1, `${walk.toFixed(2)} и ${run.toFixed(2)}`);
    const yaw0 = await T.evaluate(() => game.me.yaw);
    await touch('touchStart', [[150, 190, 1], [520, 150, 2]]);
    for (let x = 540; x <= 620; x += 20) await touch('touchMove', [[150, 190, 1], [x, 150, 2]]);
    await T.waitForTimeout(100);
    check('второй палец поворачивает взгляд, первый продолжает бег',
      Math.abs(await T.evaluate((y) => game.me.yaw - y, yaw0)) > 0.3 && await T.evaluate(() => Math.hypot(game.me.vel.x, game.me.vel.z)) > 6);
    await touch('touchEnd', []); await T.waitForTimeout(500);
    const ammo = await T.evaluate(() => game.me.ammo[game.me.weapon]);
    const [fx, fy] = await centre('#t-fire');
    await touch('touchStart', [[fx, fy, 3]]); await T.waitForTimeout(600); await touch('touchEnd', []);
    check('кнопка огня стреляет', await T.evaluate(() => game.me.ammo[game.me.weapon]) < ammo);
    await T.tap('#t-aim'); await T.waitForTimeout(700);
    check('кнопка прицела включает прицел', (await T.evaluate(() => game.dbg().adsK)) > 0.9);
    await T.tap('#t-aim');
    await T.tap('#hotbar .slot >> nth=2'); await T.waitForTimeout(200);
    check('слот оружия нажимается', await T.evaluate(() => game.me.weapon) === 'pistol');
    await T.tap('#t-menu'); await T.waitForTimeout(200);
    check('кнопка меню открывает паузу', await T.isVisible('#tile-profile'));
    await ctx.close();
  }

  check('без ошибок на страницах', errors.length === 0, errors.join(' | '));
  await browser.close();
}

stop();
console.log(`\nИтого: ${passed} пройдено, ${failed} не пройдено`);
process.exit(failed ? 1 : 0);
