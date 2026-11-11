// Сервер: раздаёт статику и ведёт до 4 игровых комнат по 4 игрока.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { ROOMS } from '../shared/map.js';
import type { BestPlayer, LobbyMsg, ServerMsg } from '../shared/protocol.js';
import { createRoom, type Incoming, type Player, type Room } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

// ---------- статика ----------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath: string;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.join(PUBLIC_DIR, urlPath);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------- комнаты ----------
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
const rooms = new Map<number, Room>();
let nextRoomId = 1;
/** Кто сейчас в главном меню (не в комнате) — им шлём список комнат */
const lobby = new Set<WebSocket>();

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/** Лучший игрок сейчас: больше всех убийств в текущем матче, при равенстве — меньше смертей. */
function bestPlayer(): BestPlayer | null {
  let top: BestPlayer | null = null;
  for (const r of rooms.values()) {
    const b = r.best();
    if (b && (!top || b.kills > top.kills || (b.kills === top.kills && b.deaths < top.deaths))) top = b;
  }
  return top;
}

function lobbyMsg(): LobbyMsg {
  return { t: 'lobby', rooms: [...rooms.values()].map((r) => r.info()), maxRooms: ROOMS.max, best: bestPlayer() };
}

/** Рассылаем меню, только если оно изменилось (счёт меняется часто — проверяем раз в секунду). */
let lastLobby = '';
function pushLobby(force = false): void {
  const data = JSON.stringify(lobbyMsg());
  if (!force && data === lastLobby) return;
  lastLobby = data;
  for (const ws of lobby) if (ws.readyState === ws.OPEN) ws.send(data);
}
setInterval(() => pushLobby(), 1000);

/** Название комнаты: без разметки, не длиннее nameMax; пустое — «Комната N». */
function cleanRoomName(raw: unknown, id: number): string {
  const s = typeof raw === 'string' ? raw.replace(/[<>&]/g, '').trim().slice(0, ROOMS.nameMax) : '';
  return s || `Комната ${id}`;
}

/** Пароль: пустой — без пароля, иначе от passMin до passMax символов. null — пароль не подходит по длине. */
function cleanPassword(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string') return null;
  return raw.length >= ROOMS.passMin && raw.length <= ROOMS.passMax ? raw : null;
}

function openRoom(msg: Incoming): Room | string {
  if (rooms.size >= ROOMS.max) return `Комнат уже ${ROOMS.max} — больше создать нельзя, зайди в существующую`;
  const password = cleanPassword(msg.password);
  if (password === null) return `Пароль — от ${ROOMS.passMin} до ${ROOMS.passMax} символов (или оставь пустым)`;
  const id = nextRoomId++;
  const room = createRoom(id, cleanRoomName(msg.roomName, id), password, {
    changed: () => pushLobby(),
    empty: () => {
      rooms.delete(id);
      console.log(`Комната «${room.name}» закрыта, комнат: ${rooms.size}`);
      pushLobby();
    },
  });
  rooms.set(id, room);
  console.log(`Комната «${room.name}» открыта${password ? ' (с паролем)' : ''}, комнат: ${rooms.size}`);
  return room;
}

wss.on('connection', (ws) => {
  let room: Room | null = null;
  let me: Player | null = null;
  lobby.add(ws);
  send(ws, lobbyMsg());

  ws.on('message', (raw) => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString()); } catch { return; }
    if (typeof parsed !== 'object' || parsed === null) return;
    const msg = parsed as Incoming;

    if (msg.t === 'join') {
      if (me) return;
      let target: Room | undefined;
      if (msg.room === 'new') {
        const r = openRoom(msg);
        if (typeof r === 'string') { send(ws, { t: 'error', text: r }); return; }
        target = r;
      } else {
        target = rooms.get(Number(msg.room));
        if (!target) { send(ws, { t: 'error', text: 'Этой комнаты уже нет — выбери другую' }); send(ws, lobbyMsg()); return; }
        if (!target.checkPassword(msg.password)) { send(ws, { t: 'error', text: 'Неверный пароль' }); return; }
      }
      me = target.join(ws, msg);
      if (!me) {
        // Новая комната, в которую никто не вошёл, не нужна
        if (target.size === 0) rooms.delete(target.id);
        return;
      }
      room = target;
      lobby.delete(ws);
      pushLobby();
      return;
    }
    if (room && me) room.handle(me, msg);
  });

  ws.on('close', () => {
    lobby.delete(ws);
    if (room && me) room.leave(me);
  });
  ws.on('error', () => {});
});

// Такт всех комнат 20 раз в секунду
setInterval(() => {
  for (const r of rooms.values()) r.tick();
}, 50);

server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});

// Быстрая остановка контейнера по `docker stop`
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => process.exit(0));
}
