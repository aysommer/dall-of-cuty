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

console.log('Снаряжение и уровни (WebSocket)');
{
  const state = (c, p, yaw = 0) => c.ws.send(JSON.stringify({ t: 'state', p, yaw, pitch: 0, w: 'grenade', sl: false }));
  const hpOf = (c, name) => last(c, 'players').list.find((p) => p.name === name)?.hp;
  // Пара игроков в своей комнате: владелец устройства (с нужным числом убийств) и его противник
  const pair = async (kills, melee, map = 'sands') => {
    const a = await wsClient(), b = await wsClient();
    join(a, { room: 'new', roomName: `Тест ${melee}`, name: 'Хозяин', melee, map, token: token(kills) }); await wait(250);
    join(b, { room: last(a, 'welcome') && (await roomId(a)), name: 'Враг' }); await wait(250);
    return [a, b];
  };
  const roomId = async (c) => { const l = await wsClient(); await wait(120); const id = l.msgs.find((m) => m.t === 'lobby').rooms.at(-1).id; l.ws.close(); return id; };
  const done = async (...cs) => { for (const c of cs) c.ws.close(); await wait(300); };

  // Уровни: без прогресса мина не выдаётся, с 20 убийствами (уровень 2) — выдаётся
  const n = await wsClient();
  join(n, { room: 'new', roomName: 'Новичок', name: 'N', melee: 'mine', kit: ['sniper', 'smg'] }); await wait(250);
  check('уровень 1: мина закрыта — в слоте нож', last(n, 'loadout')?.gear === 'knife');
  await done(n);

  // Мина: хозяин её не взводит, враг в 2 м — взводит, через секунду взрыв; в 1,5 м — 50 урона
  {
    const [a, b] = await pair(20, 'mine');
    check('уровень 2: мина открыта', last(a, 'loadout')?.gear === 'mine');
    state(a, [0, 0, 10]); state(b, [0, 0, 30]); await wait(120);
    a.ws.send(JSON.stringify({ t: 'pin' })); await wait(300);
    const placed = last(a, 'mines')?.list ?? [];
    check('мина лежит под ногами хозяина и не взведена им', placed.length === 1 && placed[0].kind === 'mine' && placed[0].armed === 0 && placed[0].p[2] === 10);
    state(a, [0, 0, 30]); state(b, [0, 0, 13]); await wait(300);
    check('враг в 3 м мину не взводит', last(a, 'mines').list[0].armed === 0);
    state(b, [0, 0, 11.9]); await wait(200);
    check('враг в 2 м взводит мину', last(b, 'mines').list[0]?.armed > 0);
    await wait(1200);
    check('через секунду взрыв: мины больше нет', last(b, 'mines').list.length === 0 && b.msgs.some((m) => m.t === 'boom'));
    check('в 1,5 м от мины — 50 урона', hpOf(b, 'Враг') === 50, `здоровье ${hpOf(b, 'Враг')}`);
    await done(a, b);
  }
  // Мина: кто не успел отойти (ближе метра) — погибает
  {
    const [a, b] = await pair(20, 'mine');
    state(a, [0, 0, 10]); state(b, [0, 0, 30]); await wait(120);
    a.ws.send(JSON.stringify({ t: 'pin' })); await wait(200);
    state(a, [0, 0, 30]); state(b, [0, 0, 10.6]); await wait(1500);
    check('вплотную к мине — смерть', b.msgs.some((m) => m.t === 'kill' && m.w === 'mine'));
    await done(a, b);
  }
  // Растяжка (уровень 3): верёвка 2 м по взгляду; задел — взведена
  {
    const [a, b] = await pair(50, 'tripwire');
    state(a, [0, 0, 10], 0); state(b, [8, 0, 30]); await wait(120);
    a.ws.send(JSON.stringify({ t: 'pin' })); await wait(300);
    const w = last(a, 'mines')?.list[0];
    check('растяжка: верёвка 2 м вперёд по взгляду', !!w && w.kind === 'tripwire' && Math.abs(w.to[2] - 8) < 0.05 && Math.abs(w.to[0]) < 0.05);
    state(a, [8, 0, 30]); state(b, [3, 0, 9]); await wait(300);
    check('враг рядом, но не на верёвке — не взведена', last(a, 'mines').list[0].armed === 0);
    state(b, [0.2, 0, 8.8]); await wait(200);
    check('враг задел верёвку — взведена', last(a, 'mines').list[0]?.armed > 0);
    await done(a, b);
  }
  // Световая (уровень 2): ослепляет того, кто рядом (и бросившего), а далёкого — нет
  {
    const [a, b] = await pair(20, 'flash');
    state(a, [0, 0, 10]); state(b, [0, 0, 25]); await wait(120);
    a.ws.send(JSON.stringify({ t: 'pin' })); await wait(100);
    a.ws.send(JSON.stringify({ t: 'gthrow', d: [0, -1, 0] })); await wait(300);
    check('световая летит как граната (вид 1)', last(a, 'grenades')?.list[0]?.[5] === 1);
    await wait(3100);
    check('вспышку видят все', a.msgs.some((m) => m.t === 'flash') && b.msgs.some((m) => m.t === 'flash'));
    check('бросивший рядом — ослеплён, дальний — нет', a.msgs.some((m) => m.t === 'blind') && !b.msgs.some((m) => m.t === 'blind'));
    check('световая не наносит урона', hpOf(a, 'Хозяин') === 100);
    await done(a, b);
  }
  // Липучка (уровень 4): прилипает к стене, а не падает
  {
    const [a, b] = await pair(90, 'sticky', 'house');
    state(a, [-3, 0, 4], Math.PI / 2); state(b, [10, 0, 8]); await wait(120);
    a.ws.send(JSON.stringify({ t: 'pin' })); await wait(100);
    a.ws.send(JSON.stringify({ t: 'gthrow', d: [-1, 0.1, 0] })); await wait(900);
    const g1 = last(a, 'grenades')?.list[0]; await wait(500);
    const g2 = last(a, 'grenades')?.list[0];
    check('липучка висит на стене и не сползает', !!g1 && !!g2 && g1[5] === 2 && g1[2] > 1 && g1[1] === g2[1] && g1[2] === g2[2], JSON.stringify(g2));
    await done(a, b);
  }
  await wait(1200);
}

console.log('Ящик и карты (сервер)');
{
  const { CRATE_ODDS, crateReward, MAPS, MAP_SECTIONS } = await import(path.join(ROOT, 'dist/shared/map.js'));
  const odds = Object.fromEntries(CRATE_ODDS.map((o) => [o.kind, o.chance]));
  check('в ящике — любая награда за серию, без ловушки', CRATE_ODDS.length === 6 && Math.abs(CRATE_ODDS.reduce((s, o) => s + o.chance, 0) - 1) < 1e-9);
  check('чем дороже награда, тем реже: БПЛА чаще всех, бомба — меньше 2%',
    odds.uav > odds.missile && odds.missile > odds.launcher && odds.launcher > odds.juggernaut && odds.juggernaut > odds.gunship && odds.gunship > odds.nuke && odds.nuke < 0.02,
    CRATE_ODDS.map((o) => `${o.kind} ${(o.chance * 100).toFixed(1)}%`).join(', '));
  check('жребий раскладывается по шансам', crateReward(0) === 'uav' && crateReward(0.999) === 'nuke');
  check('разделы карт: в «Новых» — «Падение», остальные — в «Старых»; Explosion City нет',
    MAP_SECTIONS[0].title === 'Новые' && MAP_SECTIONS[0].maps.join() === 'fall' && MAPS.fall.name === 'Падение' && MAP_SECTIONS[1].maps.length === 6 && !('blast' in MAPS));
  check('канализации нет ни на одной карте', Object.values(MAPS).every((m) => !m.boxes.some((b) => b.min[1] < -1.01) && !('lamps' in m)));
  check('на «Песках» есть лестница на серую крышу', MAPS.sands.ladders.some((l) => l.max[1] > 4 && l.min[1] === 0));
  const f = await wsClient();
  join(f, { room: 'new', roomName: 'Падение', name: 'F', map: 'fall' }); await wait(300);
  check('в комнате можно играть на новой карте «Падение»', last(f, 'welcome')?.map === 'fall');
  f.ws.close(); await wait(1200);
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
  /** Открыть игру: ник и прогресс кладём в хранилище браузера до загрузки, как после прошлого захода. */
  async function open({ w = 960, h = 640, kills, name = 'Игрок' } = {}) {
    const p = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript(([t, k, n]) => {
      if (sessionStorage.getItem('seeded')) return; // только при первом открытии: дальше игра хранит своё
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('doc-name', n);
      if (t) { localStorage.setItem('doc-progress', t); localStorage.setItem('doc-kills', String(k)); }
    }, [kills !== undefined ? token(kills) : null, kills ?? 0, name]);
    await p.goto(URL);
    await p.waitForFunction(() => !document.getElementById('play').disabled);
    return p;
  }
  /** Через «Обзор комнат» создать комнату (или войти в выбранную). В бой попадаешь сразу, без паузы. */
  async function play(p, { map, ffa = true, pass } = {}) {
    await p.click('#nav-rooms');
    if (map) await p.selectOption('#map-choice', map);
    if (ffa && await p.isVisible('#mode-choice')) await p.click('#mode-choice [data-mode=ffa]');
    if (pass) await p.fill(await p.isVisible('#room-pass') ? '#room-pass' : '#room-pass-new', pass);
    await p.click('#play');
    await p.waitForFunction(() => document.body.classList.contains('in-game') && document.getElementById('menu').classList.contains('hidden'));
    await p.waitForTimeout(300);
  }
  /** Открыть меню в бою (как по Esc) и вернуться обратно. */
  const openMenu = async (p) => { await p.evaluate(() => document.exitPointerLock()); await p.waitForFunction(() => !document.getElementById('menu').classList.contains('hidden')); };
  /** shooter стреляет в упор, пока target не умрёт (или пока не выйдет время). */
  async function kill(shooter, target) {
    for (let i = 0; i < 60; i++) {
      // О смерти судим по данным стрелка: страница жертвы в тестовом браузере может отставать на секунды
      if (await shooter.evaluate(() => [...game.remotes.values()].some((r) => !r.info.alive))) return true;
      const at = await shooter.evaluate(() => game.me.pos.toArray());
      await target.evaluate(([x, y, z]) => { game.me.pos.set(x, y, z - 2); game.me.vel.set(0, 0, 0); }, at);
      await shooter.evaluate(() => { game.me.yaw = 0; game.me.pitch = -0.05; });
      await shooter.mouse.down(); await shooter.waitForTimeout(150); await shooter.mouse.up();
      await shooter.waitForTimeout(150);
    }
    return false;
  }

  console.log('Меню и комната (браузер)');
  const A = await open({ kills: 19, name: 'Волк' });
  check('меню: лучшего игрока пока нет', /никто не играет/.test(await A.textContent('#best')));
  check('главный экран: кольцо уровня, звание и ник', /1/.test(await A.textContent('#home-ring')) && /Рядовой/.test(await A.textContent('#home-rank')) && (await A.textContent('#home-nick')) === 'Волк');
  check('списка всех званий в меню нет', !/Все звания|Генерал/.test(await A.textContent('#menu')));
  await A.click('#nick-edit'); await A.fill('#name', 'Волк'); await A.click('#nick-edit');
  check('ник меняется кнопкой «Изменить»', (await A.textContent('#home-nick')) === 'Волк' && await A.evaluate(() => localStorage.getItem('doc-name')) === 'Волк');
  await A.click('#nav-progress');
  {
    // Уровень 1 (19 убийств): только две отметки — текущий и следующий; у первого список оружия не пишется
    const text = await A.textContent('#progress');
    check('прогресс: только текущий и следующий уровень', (await A.locator('#progress .node').count()) === 2 && !/Piz|Z700|UZE90/.test(text));
    check('прогресс: на 1-м уровне оружие не перечисляется, на 2-м — что откроется', (await A.locator('#progress .node >> nth=0').locator('.chip').count()) === 0 && /🔒.*Мина/.test(text) && /🔒.*Световая/.test(text));
  }
  await A.click('#nav-settings');
  check('настройки: FOV и разложенный по клавишам список управления', /FOV/.test(await A.textContent('#view-settings')) && (await A.locator('#keys .key-row').count()) > 15);
  await A.click('#nav-rooms');
  await A.fill('#room-pass-new', '12'); await A.click('#play'); await A.waitForTimeout(200);
  check('меню не пускает с коротким паролем', /от 4 до 16/.test(await A.textContent('#status')));
  await play(A, { pass: 'tiger42' });
  check('A создал комнату и сразу в бою, без паузы', await A.isVisible('#hud') && !(await A.isVisible('#menu')));

  const B = await open({ name: 'Лиса' });
  await B.click('#nav-rooms');
  check('B видит комнату с замком', /🔒/.test(await B.textContent('#room-list')));
  await B.fill('#room-pass', 'nope'); await B.click('#play'); await B.waitForTimeout(300);
  check('B: неверный пароль', (await B.textContent('#status')) === 'Неверный пароль');
  await play(B, { pass: 'tiger42', ffa: false });
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
  // Окно повышения висит 4,5 с — смотрим сразу, пока тело ещё падает
  // Строка в ленте живёт 5 с — тоже смотрим сразу
  const feedOk = await A.waitForFunction(() => /Лиса/.test(document.getElementById('feed').textContent), null, { timeout: 4000 }).then(() => true, () => false);
  const promoted = await A.waitForFunction(() => /ПОВЫСИЛИ/.test(document.getElementById('promo').textContent) && !document.getElementById('promo').classList.contains('hidden'), null, { timeout: 4000 }).then(() => true, () => false);
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
  check('лента убийств', feedOk);
  check('повышение до 2-го уровня (19 → 20 убийств)', promoted);
  check('B после смерти возродился', await B.waitForFunction(() => game.me.alive, null, { timeout: 6000 }).then(() => true, () => false));

  const C = await open({ name: 'Третий' });
  await C.waitForTimeout(1300);
  check('лучший игрок в меню — Волк', /Волк/.test(await C.textContent('#best')) && /Ночная|Комната/.test(await C.textContent('#best')));
  // Случайный матч: единственная комната с паролем — значит, открывается своя, и игрок сразу в бою
  await C.click('#nav-random');
  check('«Найти случайный матч» сразу отправляет в бой', await C.waitForFunction(() => document.body.classList.contains('in-game') && document.getElementById('menu').classList.contains('hidden'), null, { timeout: 8000 }).then(() => true, () => false));
  await C.close();

  console.log('Движение');
  const speed = async (p, sprint) => {
    await p.evaluate(() => { game.me.pos.set(0, 0, 0); game.me.vel.set(0, 0, 0); game.me.yaw = 0; });
    if (sprint) await p.keyboard.down('ShiftLeft');
    await p.keyboard.down('KeyW'); await p.waitForTimeout(800);
    // Скорость набирается плавно, а тестовый браузер рисует редко — берём установившееся значение
    let v = 0;
    for (let i = 0; i < 8; i++) { v = Math.max(v, await p.evaluate(() => Math.hypot(game.me.vel.x, game.me.vel.z))); await p.waitForTimeout(150); }
    await p.keyboard.up('KeyW'); if (sprint) await p.keyboard.up('ShiftLeft');
    await p.waitForTimeout(300);
    return v;
  };
  const walk = await speed(A, false), run = await speed(A, true);
  {
    // На ходу камера слегка покачивается, стоя — нет
    await A.keyboard.down('KeyW'); await A.waitForTimeout(700);
    const bobs = []; for (let i = 0; i < 6; i++) { bobs.push((await A.evaluate(() => game.dbg())).bob); await A.waitForTimeout(60); }
    await A.keyboard.up('KeyW'); await A.waitForTimeout(900);
    check('камера покачивается на ходу (на шаге — до 3 см)', bobs.some((b) => b < -0.005) && bobs.every((b) => b >= -0.035), bobs.join(' '));
    check('стоя камера не качается', await A.waitForFunction(() => Math.abs(game.dbg().bob) < 0.002, null, { timeout: 8000 }).then(() => true, () => false));
  }
  check('ходьба 6.5', Math.abs(walk - 6.5) < 0.05, walk.toFixed(2));
  check('бег 8.125', Math.abs(run - 8.125) < 0.05, run.toFixed(2));

  console.log('Присед, лёжа, руки, разброс');
  {
    const pose = () => A.evaluate(() => { const d = game.dbg(); return { crouch: d.crouch, low: d.low, eye: d.eyeH }; });
    const settle = (fn) => A.waitForFunction(fn, null, { timeout: 8000 }).then(() => true, () => false);
    await A.evaluate(() => { game.me.pos.set(0, 0, 10); game.me.vel.set(0, 0, 0); game.me.yaw = 0; });
    await A.keyboard.press('KeyC');
    check('C — присед: взгляд опускается до 1,05 м', await settle(() => game.dbg().crouch && Math.abs(game.dbg().eyeH - 1.05) < 0.03), JSON.stringify(await pose()));
    await A.keyboard.down('KeyW'); await A.waitForTimeout(900);
    let v = 0; for (let i = 0; i < 6; i++) { v = Math.max(v, await A.evaluate(() => Math.hypot(game.me.vel.x, game.me.vel.z))); await A.waitForTimeout(120); }
    await A.keyboard.up('KeyW');
    check('в приседе скорость вдвое ниже (3,25)', Math.abs(v - 3.25) < 0.1, v.toFixed(2));
    await A.keyboard.press('ControlLeft');
    check('Ctrl — лёжа: взгляд у земли', await settle(() => game.dbg().low && Math.abs(game.dbg().eyeH - 0.6) < 0.03), JSON.stringify(await pose()));
    await A.keyboard.down('KeyW'); await A.waitForTimeout(900);
    v = 0; for (let i = 0; i < 6; i++) { v = Math.max(v, await A.evaluate(() => Math.hypot(game.me.vel.x, game.me.vel.z))); await A.waitForTimeout(120); }
    await A.keyboard.up('KeyW');
    check('ползком — четверть скорости (1,63)', Math.abs(v - 1.625) < 0.1, v.toFixed(2));
    // Чужой игрок видит позу: сервер передаёт «присел» и «лежит»
    await A.waitForTimeout(300);
    check('лежащего видят лежащим другие', await B.evaluate(() => [...game.remotes.values()][0].slide === true));
    await A.keyboard.press('Space');
    check('пробел поднимает на ноги', await settle(() => !game.dbg().low && !game.dbg().crouch));
    check('руки от первого лица — руки модели, кубика нет', (await A.evaluate(() => game.dbg())).arms === true);
    // Разброс от бедра: 40 выстрелов в стену с 30 м — пятно намного шире, чем в прицел
    const { WEAPONS, hipSpread } = await import(path.join(ROOT, 'dist/shared/map.js'));
    check('от бедра разброс в 5,5 раза больше прицельного (у дробовика — в 2,4)', hipSpread(WEAPONS.rifle) === 5.5 && hipSpread(WEAPONS.shotgun) === 2.4);
    check('названия и баланс: UZE90 — 13 урона и 42 патрона', WEAPONS.smg.name === 'UZE90' && WEAPONS.smg.dmg === 13 && WEAPONS.smg.mag === 42 &&
      ['Jecov', 'Chester', 'AK49', 'Z700', 'Piz'].join() === ['pistol', 'shotgun', 'rifle', 'lmg', 'sniper'].map((w) => WEAPONS[w].name).join());
  }

  console.log('Смена оружия и бег');
  {
    // Пистолет достаётся быстрее основного ствола; пока достаёшь — стрелять нельзя
    const draw = async (key) => { await A.keyboard.press(key); await A.waitForTimeout(100); return A.evaluate(() => game.dbg().drawMs); };
    await A.keyboard.press('Digit2'); await A.waitForTimeout(900);
    const pistol = await draw('Digit3'); await A.waitForTimeout(900);
    const rifle = await draw('Digit2'); await A.waitForTimeout(900);
    check('пистолет достаётся быстрее основного оружия', pistol === 280 && rifle >= 500, `${Math.round(pistol)} и ${Math.round(rifle)} мс`);
    await A.evaluate(() => { game.me.pos.set(0, 0, 10); game.me.vel.set(0, 0, 0); game.me.yaw = 0; });
    await A.keyboard.down('ShiftLeft'); await A.keyboard.down('KeyW'); await A.waitForTimeout(900);
    let bob = 0, cam = 0;
    for (let i = 0; i < 8; i++) { const d = await A.evaluate(() => game.dbg()); bob = Math.max(bob, d.gunBob); cam = Math.min(cam, d.bob); await A.waitForTimeout(70); }
    await A.keyboard.up('KeyW'); await A.keyboard.up('ShiftLeft'); await A.waitForTimeout(600);
    check('на бегу оружие и камера качаются сильнее, чем на шаге', bob > 1.2 && cam < -0.04, `оружие ${bob}, камера ${cam}`);
  }

  console.log('Съёмный прицел');
  {
    await A.keyboard.press('Digit2'); await A.waitForTimeout(500);
    const gun = await A.evaluate(() => game.me.weapon);
    check('прицел по умолчанию надет', (await A.evaluate(() => game.dbg())).scopeOn === true);
    await A.keyboard.press('KeyV');
    const off = await A.waitForFunction(() => game.dbg().scopeOn === false && !game.dbg().scopeAnim, null, { timeout: 8000 }).then(() => true, () => false);
    check('V снимает коллиматор', off);
    check('выбор запомнен по стволу', JSON.parse(await A.evaluate(() => localStorage.getItem('doc-sights')))[gun] === false);
    await A.keyboard.press('Digit3'); await A.waitForTimeout(500);
    check('на другом стволе прицел остался', (await A.evaluate(() => game.dbg())).scopeOn === true);
    await A.keyboard.press('Digit2'); await A.waitForTimeout(500);
    check('вернулся к первому — прицел по-прежнему снят', (await A.evaluate(() => game.dbg())).scopeOn === false);
    await A.keyboard.press('KeyV');
    await A.waitForFunction(() => game.dbg().scopeOn === true && !game.dbg().scopeAnim, null, { timeout: 8000 }).catch(() => {});
    check('V надевает обратно', (await A.evaluate(() => game.dbg())).scopeOn === true);
  }

  console.log('Меню в бою');
  await openMenu(A);
  check('в бою меню называется меню: «Вернуться в бой», без комнат и случайного матча', await A.isVisible('#resume') && !(await A.isVisible('#nav-rooms')) && !(await A.isVisible('#nav-random')) && !/Пауза/.test(await A.textContent('#menu')));
  check('главный экран в бою: ник, звание и счёт матча', (await A.textContent('#home-nick')) === 'Волк' && /PV2/.test(await A.textContent('#home-ring')) && /в этом матче/.test(await A.textContent('#home-stats')));
  await A.click('#nav-classes');
  await A.click('.class-tile >> nth=1'); await A.waitForTimeout(200);
  check('класс «Ближний бой» меняет набор', /2:Chester/.test((await A.evaluate(() => game.dbg())).hotbar));
  check('стволы разложены по типам', /Пистолеты/.test(await A.textContent('#class-edit .kit')) && /Снайперские винтовки/.test(await A.textContent('#class-edit .kit')) && (await A.locator('#class-edit .gun-type').count()) === 6);
  check('закрытое по уровню подписано замком', /🔒.*Piz.*ур\. 5/.test(await A.textContent('#class-edit .kit')) && /🔒.*Растяжка.*ур\. 3/.test(await A.textContent('#class-edit .melee')));
  check('на 2-м уровне мина уже открыта', await A.isEnabled('#class-edit .melee [data-melee=mine]'));
  await A.click('.class-tile.add'); await A.fill('#class-name', 'Тест'); await A.waitForTimeout(100);
  check('новый класс сохранён', JSON.parse(await A.evaluate(() => localStorage.getItem('doc-classes'))).list.some((c) => c.name === 'Тест'));
  await A.click('#nav-exit');
  await A.waitForFunction(() => !document.body.classList.contains('in-game') && !document.getElementById('play').disabled);
  check('«Выход» в бою возвращает в главное меню', await A.isVisible('#nav-random'));
  await B.waitForTimeout(400);
  check('чат у B: Волк выходит', /Волк выходит/.test(await B.textContent('#chat')));
  await B.close(); await A.close();

  console.log('Карта «Дом»');
  const H = await open();
  await play(H, { map: 'house' });
  await H.evaluate(() => { game.me.pos.set(-4.6, 0, 0); game.me.yaw = Math.PI / 2; game.me.pitch = 0; game.me.vel.set(0, 0, 0); });
  await H.waitForTimeout(300);
  check('у двери подсказка F', /F — открыть дверь/.test(await H.textContent('#crate-text')));
  await H.keyboard.press('KeyF'); await H.waitForTimeout(500);
  check('дверь открылась', (await H.evaluate(() => game.dbg())).openDoors.length === 1);
  await H.evaluate(() => { game.me.pos.set(2.75, 3.5, 3.2); game.me.yaw = Math.PI; game.me.vel.set(0, 0, 0); });
  await H.waitForTimeout(300);
  await H.keyboard.down('KeyW');
  await H.waitForFunction(() => game.me.pos.y > 7.25, null, { timeout: 8000 }).catch(() => {});
  await H.keyboard.up('KeyW'); await H.waitForTimeout(300);
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
    await T.tap('#nav-rooms');
    await T.locator('#play').scrollIntoViewIfNeeded();
    await T.tap('#play');
    await T.waitForFunction(() => document.getElementById('menu').classList.contains('hidden'));
    await T.waitForTimeout(400);
    check('вход пальцем запускает игру без захвата мыши', await T.evaluate(() => document.body.classList.contains('playing') && document.getElementById('menu').classList.contains('hidden')));
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
    check('кнопка меню открывает меню', await T.isVisible('#resume'));
    await ctx.close();
  }

  check('без ошибок на страницах', errors.length === 0, errors.join(' | '));
  await browser.close();
}

stop();
console.log(`\nИтого: ${passed} пройдено, ${failed} не пройдено`);
process.exit(failed ? 1 : 0);
