// Рассылка сообщений игрокам комнаты и общие сведения о ней (счёт, список для меню).
import type { WebSocket } from 'ws';
import type { RoomInfo, ServerMsg, Team, Vec3 } from '../../shared/protocol.js';
import { encodeProfile } from '../progress.js';
import { rankOf } from '../../shared/ranks.js';
import { MAX_PLAYERS, type Player, type Room } from './state.js';

export function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export function broadcast(room: Room, msg: ServerMsg, exceptId: number | null = null): void {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id !== exceptId && p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
}

export function sendProfile(p: Player): void {
  send(p.ws, { t: 'profile', token: encodeProfile(p.profile), kills: p.profile.kills, deaths: p.profile.deaths });
}

export function teamCount(room: Room, team: Team): number {
  let n = 0;
  for (const p of room.players.values()) if (p.team === team) n++;
  return n;
}

/** Комната в списке главного меню */
export function info(room: Room): RoomInfo {
  return {
    id: room.id, name: room.roomName, locked: room.password !== '', mode: room.mode, map: room.mapId, limitKind: room.limitKind, limitValue: room.limitValue,
    count: room.players.size, green: teamCount(room, 'green'), red: teamCount(room, 'red'), max: MAX_PLAYERS,
  };
}

/** Что-то поменялось для главного меню (игроки, карта) — пусть сервер обновит список комнат */
export function broadcastInfo(room: Room): void {
  room.hooks.changed();
}

export function teamScores(room: Room): Record<Team, number> {
  const s: Record<Team, number> = { green: 0, red: 0 };
  for (const p of room.players.values()) s[p.team] += p.kills;
  return s;
}

export function broadcastPlayers(room: Room): void {
  broadcast(room, {
    t: 'players',
    mode: room.mode,
    limit: room.limitKind === 'kills' ? room.limitValue : 0,
    left: room.roundOver || room.limitKind !== 'time' ? 0 : Math.max(0, room.matchEndsAt - Date.now()),
    scores: teamScores(room),
    list: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, hp: p.hp, armor: p.armor, alive: p.alive, kills: p.kills, deaths: p.deaths,
      big: p.big, rank: rankOf(p.profile.kills), helmet: p.helmet,
    })),
  });
}

export function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1000);
}

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
