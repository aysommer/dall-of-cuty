// Снаряды: гранаты, метательные ножи и ракеты — полёт, попадания, взрывы.
import type { Vec3 } from '../../shared/protocol.js';
import { bodyPoints, clipWalls, FLASH, GRENADE, isThrown, stepSticky, GUNSHIP, lineOfSight, MAPS, playerBox, rayBox, rayWorld, ROCKET, stepGrenade, THROW, WEAPONS } from '../../shared/map.js';
import { distToPlayer, eyeOf, hurt, isEnemy, killPlayer, scaleOf, lowOf } from './combat.js';
import { checkWin } from './match.js';
import { placeMine } from './mines.js';
import { broadcast, broadcastPlayers, isVec3, send } from './net.js';
import { setRockets } from './pickups.js';
import type { Grenade, Incoming, Knife, Player, Rocket, Room } from './state.js';
import { endGunship, gunshipNow, sendLoadout } from './streaks.js';
import { blastBreakables, worldBoxes } from './world.js';

/** Зажал ЛКМ с гранатой — чека сорвана, пошёл отсчёт. */
export function pullPin(room: Room, p: Player): void {
  // Мину и растяжку не бросают, а ставят под ноги тем же нажатием
  if (p.gear === 'mine' || p.gear === 'tripwire') { placeMine(room, p); return; }
  if (!p.alive || room.roundOver || p.grenades <= 0 || p.cookStart || !isThrown(p.gear)) return;
  p.grenades--;
  p.cookStart = Date.now();
  sendLoadout(p);
}

export function spawnGrenade(room: Room, p: Player, pos: Vec3, vel: Vec3): void {
  const kind = p.gear === 'flash' || p.gear === 'sticky' ? p.gear : 'grenade';
  room.grenades.push({ id: room.nextGrenadeId++, owner: p.id, pos, vel, explodeAt: p.cookStart + GRENADE.fuseMs, kind, stuck: false });
  p.cookStart = 0;
}

/** Отпустил ЛКМ — бросок: сколько держал, столько отсчёта уже прошло. */
export function throwGrenade(room: Room, p: Player, msg: Incoming): void {
  if (!p.alive || !p.cookStart || !isVec3(msg.d)) return;
  const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
  if (len < 0.5) return;
  const d: Vec3 = [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len];
  const eye = eyeOf(p);
  spawnGrenade(room, p, [eye[0] + d[0] * 0.4, eye[1] + d[1] * 0.4, eye[2] + d[2] * 0.4],
    [d[0] * GRENADE.speed, d[1] * GRENADE.speed + GRENADE.lift, d[2] * GRENADE.speed]);
}

export function dropCookedGrenade(room: Room, p: Player): void {
  spawnGrenade(room, p, [p.pos[0], p.pos[1] + 0.3, p.pos[2]], [0, 0, 0]);
}

/**
 * Взрыв гранаты: в killR — насмерть, дальше урон падает до нуля к maxR; стена закрывает.
 * Задевает противников и самого бросившего, союзников — нет.
 */
export function explodeGrenade(room: Room, ownerId: number, at: Vec3, id: number): void {
  broadcast(room, { t: 'boom', id: -5000 - id, p: at });
  blastBreakables(room, at, GRENADE.maxR * 0.6);
  const owner = room.players.get(ownerId);
  if (!owner || room.roundOver) return;
  const walls = worldBoxes(room);
  const from: Vec3 = [at[0], at[1] + 0.2, at[2]];
  for (const v of room.players.values()) {
    if (!v.alive || (v !== owner && !isEnemy(room, owner, v))) continue;
    const d = distToPlayer(v, at);
    if (d > GRENADE.maxR) continue;
    if (bodyPoints(v.pos, lowOf(v), scaleOf(v)).every((pt) => !lineOfSight(walls, from, pt))) continue;
    if (d <= GRENADE.killR) killPlayer(room, owner, v, 'grenade');
    else hurt(room, owner, v, GRENADE.maxDmg * (1 - (d - GRENADE.killR) / (GRENADE.maxR - GRENADE.killR)), 'grenade', false);
  }
  broadcastPlayers(room);
  checkWin(room);
}

/**
 * Световая граната: вспышку видят все, а ослепляет она каждого, кто в FLASH.radius метрах
 * и не закрыт стеной, — и своих, и чужих, и самого бросившего.
 */
export function flashBang(room: Room, at: Vec3): void {
  broadcast(room, { t: 'flash', p: at });
  if (room.roundOver) return;
  const walls = worldBoxes(room);
  const from: Vec3 = [at[0], at[1] + 0.2, at[2]];
  for (const v of room.players.values()) {
    if (!v.alive || distToPlayer(v, at) > FLASH.radius) continue;
    if (bodyPoints(v.pos, lowOf(v), scaleOf(v)).every((pt) => !lineOfSight(walls, from, pt))) continue;
    send(v.ws, { t: 'blind', ms: FLASH.ms });
  }
}

export function stepGrenades(room: Room, dt: number, now: number): void {
  // Передержал — граната срабатывает в руке
  for (const p of room.players.values()) {
    if (p.cookStart && now - p.cookStart >= GRENADE.fuseMs) {
      p.cookStart = 0;
      if (p.gear === 'flash') flashBang(room, eyeOf(p));
      else explodeGrenade(room, p.id, eyeOf(p), room.nextGrenadeId++);
    }
  }
  if (!room.grenades.length) return;
  // Отскакивает от всех блоков карты и от невидимых стен по краю
  const solids = [...worldBoxes(room), ...clipWalls(MAPS[room.mapId].half)];
  const left: Grenade[] = [];
  for (const g of room.grenades) {
    for (let i = 0; i < 5 && !g.stuck; i++) {
      // Липучка останавливается на первой же поверхности; остальные отскакивают
      if (g.kind === 'sticky') g.stuck = stepSticky(solids, g, dt / 5);
      else stepGrenade(solids, g, dt / 5);
    }
    if (now < g.explodeAt) left.push(g);
    else if (g.kind === 'flash') flashBang(room, [...g.pos]);
    else explodeGrenade(room, g.owner, [...g.pos], g.id);
  }
  room.grenades = left;
  broadcast(room, {
    t: 'grenades',
    list: room.grenades.map((g) => [g.id, +g.pos[0].toFixed(2), +g.pos[1].toFixed(2), +g.pos[2].toFixed(2), g.explodeAt - now,
      g.kind === 'flash' ? 1 : g.kind === 'sticky' ? 2 : 0]),
  });
}

export function handleThrow(room: Room, p: Player, msg: Incoming): void {
  if (!p.alive || !p.hasKnife || room.roundOver || !isVec3(msg.d)) return;
  const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
  if (len < 0.5) return;
  const d: Vec3 = [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len];
  p.hasKnife = false;
  sendLoadout(p);
  const k: Knife = {
    id: room.nextKnifeId++, owner: p.id, pos: eyeOf(p),
    vel: [d[0] * THROW.speed, d[1] * THROW.speed, d[2] * THROW.speed], born: Date.now(),
  };
  room.knives.push(k);
  broadcast(room, { t: 'throw', id: k.id, by: p.id, o: k.pos, d });
}

export function stepKnives(room: Room, dt: number): void {
  if (!room.knives.length) return;
  const walls = worldBoxes(room);
  const now = Date.now();
  const flying: Knife[] = [];
  for (const k of room.knives) {
    const owner = room.players.get(k.owner);
    if (!owner) continue;
    k.vel[1] -= THROW.gravity * dt;
    const speed = Math.hypot(...k.vel);
    const dir: Vec3 = [k.vel[0] / speed, k.vel[1] / speed, k.vel[2] / speed];
    const step = speed * dt;
    let t = rayWorld(walls, k.pos, dir, step);
    let victim: Player | null = null;
    for (const v of room.players.values()) {
      if (!v.alive || !isEnemy(room, owner, v)) continue;
      // Хитбокс для ножа чуть шире, чтобы бросок «впритирку» по краю засчитывался
      const [min, max] = playerBox(v.pos, v.yaw, lowOf(v), scaleOf(v));
      const pad = THROW.pad;
      const tv = rayBox(k.pos, dir, [min[0] - pad, min[1] - pad, min[2] - pad], [max[0] + pad, max[1] + pad, max[2] + pad]);
      if (tv < t) { t = tv; victim = v; }
    }
    const at: Vec3 = [k.pos[0] + dir[0] * t, k.pos[1] + dir[1] * t, k.pos[2] + dir[2] * t];
    if (t < step || now - k.born > THROW.lifeMs) {
      broadcast(room, { t: 'thrown', id: k.id, p: at, hit: victim !== null });
      if (victim && !room.roundOver) {
        hurt(room, owner, victim, THROW.dmg, 'throw', false);
        broadcastPlayers(room);
        checkWin(room);
      }
    } else {
      k.pos = at;
      flying.push(k);
    }
  }
  room.knives = flying;
}

export function handleRocket(room: Room, p: Player, msg: Incoming): void {
  if (!p.alive || p.rockets <= 0 || !isVec3(msg.d)) return;
  const len = Math.hypot(msg.d[0], msg.d[1], msg.d[2]);
  const now = Date.now();
  if (len < 0.5 || now - p.lastShot < WEAPONS.rocket.rate * 0.7) return;
  p.lastShot = now;
  setRockets(p, p.rockets - 1);
  const dir: Vec3 = [msg.d[0] / len, msg.d[1] / len, msg.d[2] / len];
  const pos = eyeOf(p);
  const r: Rocket = { id: room.nextRocketId++, owner: p.id, pos, dir, born: now };
  room.rockets.push(r);
  broadcast(room, { t: 'rocket', id: r.id, by: p.id, o: pos, d: dir });
}

export function explode(room: Room, r: Rocket, at: Vec3): void {
  broadcast(room, { t: 'boom', id: r.id, p: at });
  blastBreakables(room, at, r.fromGunship ? GUNSHIP.rocketRadius : ROCKET.radius);
  const owner = room.players.get(r.owner);
  if (!owner || room.roundOver) return;
  const walls = worldBoxes(room);
  // Точку взрыва чуть отодвигаем от поверхности, иначе она сама закроет обзор
  const from: Vec3 = [at[0] - r.dir[0] * 0.2, at[1] - r.dir[1] * 0.2, at[2] - r.dir[2] * 0.2];
  let killed = false;
  for (const v of room.players.values()) {
    // Взрыв задевает противников и самого стрелка, если он слишком близко; союзников — нет.
    // Ракета самолёта хозяина не задевает: он в небе
    if (!v.alive || (v !== owner && !isEnemy(room, owner, v)) || (r.fromGunship && v === owner)) continue;
    // Расстояние от взрыва до ближайшей точки игрока
    if (distToPlayer(v, at) > (r.fromGunship ? GUNSHIP.rocketRadius : ROCKET.radius)) continue;
    const covered = bodyPoints(v.pos, lowOf(v), scaleOf(v)).every((pt) => !lineOfSight(walls, from, pt));
    if (covered) continue; // за стеной взрыв не достаёт
    killPlayer(room, owner, v, r.fromGunship ? 'gunship' : 'rocket');
    killed = true;
  }
  if (killed) {
    broadcastPlayers(room);
    checkWin(room);
  }
}

export function stepRockets(room: Room, dt: number): void {
  if (!room.rockets.length) return;
  const walls = worldBoxes(room);
  const now = Date.now();
  const flying: Rocket[] = [];
  for (const r of room.rockets) {
    const owner = room.players.get(r.owner);
    if (!owner) continue;
    const step = ROCKET.speed * dt;
    let t = rayWorld(walls, r.pos, r.dir, step);
    for (const v of room.players.values()) {
      if (!v.alive || !isEnemy(room, owner, v)) continue;
      const [min, max] = playerBox(v.pos, v.yaw, lowOf(v), scaleOf(v));
      t = Math.min(t, rayBox(r.pos, r.dir, min, max));
    }
    // Ракета из ракетницы может попасть в чужой самолёт
    let hitPlane = false;
    if (room.gunship && !r.fromGunship && isEnemy(room, owner, room.players.get(room.gunship.owner) ?? owner)) {
      const c = gunshipNow(room, room.gunship, now), h = GUNSHIP.half;
      const tp = rayBox(r.pos, r.dir, [c[0] - h[0], c[1] - h[1], c[2] - h[2]], [c[0] + h[0], c[1] + h[1], c[2] + h[2]]);
      if (tp < t) { t = tp; hitPlane = true; }
    }
    const at: Vec3 = [r.pos[0] + r.dir[0] * t, r.pos[1] + r.dir[1] * t, r.pos[2] + r.dir[2] * t];
    if (t < step || now - r.born > ROCKET.lifeMs) {
      explode(room, r, at);
      if (hitPlane && room.gunship) {
        room.gunship.hits++;
        broadcast(room, { t: 'gunship-hit', id: room.gunship.id, left: GUNSHIP.hitsToDown - room.gunship.hits });
        if (room.gunship.hits >= GUNSHIP.hitsToDown) endGunship(room, owner);
      }
    } else { r.pos = at; flying.push(r); }
  }
  room.rockets = flying;
}
