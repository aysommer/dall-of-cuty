// Игровая комната: своя карта, свой матч и до 4 игроков. Комнат на сервере несколько,
// у каждой всё состояние своё (объект Room). Здесь — вход игрока, разбор его сообщений, выход и такт.
import type { WebSocket } from 'ws';
import { DEFAULT_KIT, fitGear, fitKit, GUNSHIP, isGear, isKit, isMapId, isWeapon, MATCH, STREAK } from '../../shared/map.js';
import type { SnapRow, Team } from '../../shared/protocol.js';
import { decodeProfile } from '../progress.js';
import { handleShoot, handleSpray } from './combat.js';
import { clearMines, minesMsg, stepMines } from './mines.js';
import { best, endMatch, handleVote, spawn, startMatchClock, voteMsg, winnerByScore } from './match.js';
import { broadcast, broadcastInfo, broadcastPlayers, info, isNum, isVec3, send, sendProfile, teamCount } from './net.js';
import { cancelOpening, crateMsg, expireAmmoPacks, handleOpen, medkitsMsg, packsMsg, pickAmmo, pickMedkit, startDrops, stopDrops } from './pickups.js';
import { handleRocket, handleThrow, pullPin, stepGrenades, stepKnives, stepRockets, throwGrenade } from './projectiles.js';
import { type Incoming, MAX_PLAYERS, newRoom, type Player, type Room, type RoomHooks, TEAM_SIZE } from './state.js';
import { detonateMissile, endGunship, gunshipFire, gunshipMsg, gunshipRocket, missileHit, missilePos, sendPings, useStreak } from './streaks.js';
import { resetBreakables, stepWeather, toggleDoor, weatherMsg } from './world.js';

export type { Incoming, Player } from './state.js';

/** Номера игроков общие для всех комнат — так их проще различать в журнале */
let nextId = 1;

export function handleJoin(room: Room, ws: WebSocket, msg: Incoming): Player | null {
  if (room.players.size >= MAX_PLAYERS) {
    send(ws, { t: 'error', text: `Комната заполнена (максимум ${MAX_PLAYERS} игрока)` });
    return null;
  }
  if (room.players.size === 0) {
    room.mode = msg.mode === 'ffa' ? 'ffa' : 'tdm';
    room.mapId = isMapId(msg.map) ? msg.map : 'sands';
    const value = Number(msg.limitValue);
    if (msg.limitKind === 'kills' && (MATCH.kills as readonly number[]).includes(value)) {
      room.limitKind = 'kills';
      room.limitValue = value;
    } else {
      room.limitKind = 'time';
      room.limitValue = (MATCH.minutes as readonly number[]).includes(value) ? value : 10;
    }
    startMatchClock(room);
    room.roundOver = false;
    resetBreakables(room);
    clearTimeout(room.voteTimer);
    room.votes.clear();
    stopDrops(room);
    startDrops(room);
    room.rockets = [];
  }
  let team: Team = msg.team === 'red' ? 'red' : 'green';
  if (room.mode === 'tdm' && teamCount(room, team) >= TEAM_SIZE) team = team === 'red' ? 'green' : 'red';

  const rawName = typeof msg.name === 'string' ? msg.name : '';
  const name = rawName.replace(/[<>&]/g, '').trim().slice(0, 14) || 'Игрок';
  const p: Player = {
    id: nextId++, ws, name, team,
    pos: [0, 0, 0], yaw: 0, pitch: 0, w: 'pistol', slide: false, crouch: false, air: false, reloading: false,
    hp: 100, armor: 0, alive: false, kills: 0, deaths: 0, lastShot: 0, lastSpray: 0,
    profile: decodeProfile(msg.token),
    rockets: 0,
    hasKnife: true, streak: 0, uav: 0, missile: 0, nuke: 0, gunship: 0, uavUntil: 0, big: false, helmet: 0,
    kit: isKit(msg.kit) ? msg.kit : [...DEFAULT_KIT],
    melee: 'knife', gear: 'knife', grenades: 0, cookStart: 0,
  };
  // Набор и снаряжение — только то, что открыто на уровне игрока
  p.kit = fitKit(p.kit, p.profile.kills);
  if (isGear(msg.melee)) p.melee = fitGear(msg.melee, p.profile.kills);
  room.players.set(p.id, p);
  send(ws, { t: 'welcome', id: p.id, mode: room.mode, map: room.mapId });
  if (room.roundOver) send(ws, voteMsg(room, p));
  sendProfile(p);
  send(ws, crateMsg(room));
  send(ws, medkitsMsg(room));
  send(ws, packsMsg(room));
  send(ws, weatherMsg(room));
  send(ws, { t: 'breaks', broken: [...room.brokenIds] });
  send(ws, { t: 'doors', open: [...room.openDoors] });
  send(ws, minesMsg(room));
  if (room.gunship) send(ws, gunshipMsg(room.gunship));
  broadcastPlayers(room);
  spawn(room, p);
  broadcastPlayers(room);
  // Новичку — где сейчас остальные
  for (const o of room.players.values()) {
    if (o.id !== p.id) send(ws, { t: 'spawn', id: o.id, p: o.pos, yaw: o.yaw });
  }
  // В чат комнаты: кто зашёл
  broadcast(room, { t: 'chat', kind: 'join', name: p.name, team: p.team });
  broadcastInfo(room);
  console.log(`[${room.roomName}] + ${p.name} (${team}), игроков: ${room.players.size}, режим: ${room.mode}, карта: ${room.mapId}`);
  return p;
}

/** Сообщение от игрока этой комнаты */
export function handle(room: Room, me: Player, msg: Incoming): void {
  if (msg.t === 'state') {
    if (me.alive && isVec3(msg.p)) me.pos = msg.p;
    me.slide = me.alive && msg.sl === true;
    me.crouch = me.alive && !me.slide && msg.cr === true;
    me.air = me.alive && msg.air === true;
    me.reloading = me.alive && msg.rl === true;
    pickMedkit(room, me);
    pickAmmo(room, me);
    // Во время открытия ящика двигаться нельзя: сдвинулся — открытие сорвано
    if (room.crate.state === 'opening' && room.crate.by === me.id &&
        Math.hypot(me.pos[0] - room.crate.start[0], me.pos[1] - room.crate.start[1], me.pos[2] - room.crate.start[2]) > 0.5) {
      cancelOpening(room);
    }
    if (isNum(msg.yaw)) me.yaw = msg.yaw;
    if (isNum(msg.pitch)) me.pitch = msg.pitch;
    if (isWeapon(msg.w)) me.w = msg.w;
  } else if (msg.t === 'shoot') {
    handleShoot(room, me, msg);
  } else if (msg.t === 'open') {
    handleOpen(room, me, msg.on === true);
  } else if (msg.t === 'rocket') {
    handleRocket(room, me, msg);
  } else if (msg.t === 'spray') {
    handleSpray(room, me, msg);
  } else if (msg.t === 'throw') {
    handleThrow(room, me, msg);
  } else if (msg.t === 'use') {
    useStreak(room, me, msg.kind);
  } else if (msg.t === 'mpos') {
    missilePos(room, me, msg);
  } else if (msg.t === 'gsfire') {
    gunshipFire(room, me, msg);
  } else if (msg.t === 'pin') {
    pullPin(room, me);
  } else if (msg.t === 'gthrow') {
    throwGrenade(room, me, msg);
  } else if (msg.t === 'door') {
    toggleDoor(room, me, msg.id);
  } else if (msg.t === 'melee') {
    // Новый выбор вступит в силу со следующей жизни
    if (isGear(msg.kind)) me.melee = fitGear(msg.kind, me.profile.kills);
  } else if (msg.t === 'gsrocket') {
    gunshipRocket(room, me, msg);
  } else if (msg.t === 'mhit') {
    missileHit(room, me, msg);
  } else if (msg.t === 'kit') {
    if (isKit(msg.guns)) me.kit = fitKit(msg.guns, me.profile.kills);
  } else if (msg.t === 'vote') {
    handleVote(room, me, msg.map);
  }
}

/** Игрок ушёл (закрыл вкладку или вышел в меню) */
export function leave(room: Room, me: Player): void {
  clearTimeout(me.respawnTimer);
  room.players.delete(me.id);
  room.votes.delete(me.id);
  clearMines(room, me.id);
  for (const [id, m] of room.missiles) if (m.owner === me.id) room.missiles.delete(id);
  if (room.gunship?.owner === me.id) endGunship(room, null);
  if (room.crate.state === 'opening' && room.crate.by === me.id) cancelOpening(room);
  console.log(`[${room.roomName}] - ${me.name}, игроков: ${room.players.size}`);
  if (room.players.size === 0) {
    clearTimeout(room.voteTimer);
    room.voteTimer = undefined;
    clearTimeout(room.nukeTimer);
    room.nukeTimer = undefined;
    room.votes.clear();
    room.roundOver = false;
    room.weather = null;
    room.lastWeatherRoll = 0;
    stopDrops(room);
  }
  if (room.players.size === 0) {
    // Последний вышел — комнату закрываем
    room.hooks.empty();
    return;
  }
  broadcast(room, { t: 'chat', kind: 'leave', name: me.name, team: me.team });
  broadcastPlayers(room);
  broadcastInfo(room);
}

/** Такт комнаты: 20 раз в секунду — снаряды, таймеры и рассылка позиций */
export function tick(room: Room): void {
  stepRockets(room, 0.05);
  stepKnives(room, 0.05);
  stepGrenades(room, 0.05, Date.now());
  stepMines(room, Date.now());
  const now = Date.now();
  if (room.players.size) {
    sendPings(room, now);
    expireAmmoPacks(room, now);
    if (room.gunship && now - room.gunship.start >= GUNSHIP.ms) endGunship(room, null); // облетел карту — улетает
    stepWeather(room, now);
    // Ракета с неба, которую не довели до цели, взрывается сама
    for (const m of room.missiles.values()) if (now - m.born > STREAK.missileMaxMs) detonateMissile(room, m, m.last);
    // Время матча вышло
    if (!room.roundOver && now >= room.matchEndsAt) endMatch(room, winnerByScore(room));
  }
  if (room.players.size < 2) return;
  const ps: SnapRow[] = [];
  for (const p of room.players.values()) {
    ps.push([p.id, p.pos[0], p.pos[1], p.pos[2], p.yaw, p.pitch, p.w, p.slide ? 1 : 0, p.air ? 1 : 0, p.reloading ? 1 : 0, p.crouch ? 1 : 0]);
  }
  broadcast(room, { t: 'snap', ps });
}

/** Комната снаружи: то, чем пользуется сервер (index.ts). */
export function createRoom(id: number, roomName: string, password: string, hooks: RoomHooks) {
  const room = newRoom(id, roomName, password, hooks);
  return {
    id, name: roomName,
    info: () => info(room),
    best: () => best(room),
    handle: (me: Player, msg: Incoming) => handle(room, me, msg),
    leave: (me: Player) => leave(room, me),
    tick: () => tick(room),
    join: (ws: WebSocket, msg: Incoming) => handleJoin(room, ws, msg),
    checkPassword: (p: unknown): boolean => password === '' || p === password,
    get size(): number { return room.players.size; },
  };
}

export type RoomHandle = ReturnType<typeof createRoom>;
