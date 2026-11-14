// Обзор комнат: список, создание своей и вход (с паролем), случайный матч, лучший игрок.
import type { BestPlayer, LobbyMsg, Mode, Team } from '../../shared/protocol.js';
import { type LimitKind, MAP_ORDER, MAP_SECTIONS, type MapId, MAPS, MATCH, ROOMS } from '../../shared/map.js';
import { levelOf, rankProgress, RANKS } from '../../shared/ranks.js';
import { initAudio } from '../core/audio.js';
import { playBtn, sendMsg } from '../core/net.js';
import { settings, TOKEN_KEY } from '../core/settings.js';
import { state } from '../core/state.js';
import { $, textEl } from '../core/util.js';
import { rankRing } from './ranks.js';
import { loadMap } from '../world/map.js';

let chosenMode: Mode = 'tdm';

let chosenMap: MapId = 'sands';

let chosenLimitKind: LimitKind = 'time';

let chosenLimitValue = 10;

let chosenTeam: Team = 'green';

let lobbyState: LobbyMsg | null = null;

/** Выбранная в меню комната: номер или 'new' — создать новую */
let chosenRoom: number | 'new' = 'new';

/** Пользователь сам выбрал вариант — не перескакиваем на другую комнату при обновлении списка */
let roomPicked = false;

const nameInput = $<HTMLInputElement>('name');

const buttonsOf = (id: string): HTMLButtonElement[] =>
  [...$(id).querySelectorAll<HTMLButtonElement>('button')];

const MODE_NAMES: Record<Mode, string> = { tdm: `Команды ${ROOMS.team} × ${ROOMS.team}`, ffa: 'Каждый сам за себя' };

const limitText = (kind: LimitKind, value: number): string => kind === 'time' ? `${value} мин` : `до ${value} убийств`;

export function onLobby(m: LobbyMsg): void {
  lobbyState = m;
  renderBest(m.best);
  if (state.joined) return;
  const open = m.rooms.filter((r) => r.count < r.max);
  // Выбранной комнаты больше нет — по умолчанию первая, куда можно войти, иначе новая
  if (chosenRoom !== 'new' && !m.rooms.some((r) => r.id === chosenRoom)) roomPicked = false;
  if (!roomPicked) chosenRoom = open[0]?.id ?? 'new';
  if (chosenRoom === 'new' && m.rooms.length >= m.maxRooms) chosenRoom = open[0]?.id ?? 'new';
  $('rooms-note').textContent = String(open.length);
  $('rooms-note').title = `Комнат: ${m.rooms.length} из ${m.maxRooms}, можно войти: ${open.length}`;
  renderMenu();
}

/** Список комнат, настройки новой или сведения о выбранной, выбор цвета и кнопка. */
function renderMenu(): void {
  const m = lobbyState;
  if (!m) return;
  const list = $('room-list');
  list.textContent = '';
  for (const r of m.rooms) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.room = String(r.id);
    b.className = 'room' + (r.id === chosenRoom ? ' active' : '');
    b.disabled = r.count >= r.max;
    const top = document.createElement('span');
    top.className = 'room-top';
    top.append(textEl('span', (r.locked ? '🔒 ' : '') + r.name, 'room-name'), textEl('span', `${r.count}/${r.max}`, 'room-count'));
    b.append(top, textEl('small', `${MODE_NAMES[r.mode]} · ${MAPS[r.map].name} · ${limitText(r.limitKind, r.limitValue)}${r.count >= r.max ? ' · заполнена' : ''}`));
    list.append(b);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.dataset.room = 'new';
  add.className = 'room new' + (chosenRoom === 'new' ? ' active' : '');
  add.disabled = m.rooms.length >= m.maxRooms;
  add.append(textEl('span', '+ Новая комната', 'room-name'),
    textEl('small', add.disabled ? `Уже ${m.maxRooms} комнаты — больше нельзя` : 'Свои режим, карта, время и пароль'));
  list.append(add);

  const creating = chosenRoom === 'new';
  const room = creating ? null : m.rooms.find((r) => r.id === chosenRoom) ?? null;
  $('new-room').classList.toggle('hidden', !creating);
  $('join-room').classList.toggle('hidden', creating);
  if (room) {
    chosenMode = room.mode;
    $('room-desc').textContent = `${MODE_NAMES[room.mode]} · карта «${MAPS[room.map].name}» · ${limitText(room.limitKind, room.limitValue)} · игроков ${room.count} из ${room.max}`;
    $('room-pass-field').classList.toggle('hidden', !room.locked);
    loadMap(room.map); // карта комнаты видна за меню
  } else {
    renderNewRoom();
    loadMap(chosenMap);
  }

  // Цвет — только в командном режиме
  const tdm = chosenMode === 'tdm';
  $('team-field').classList.toggle('hidden', !tdm);
  const green = room?.green ?? 0, red = room?.red ?? 0;
  $('green-count').textContent = `${green}/${ROOMS.team}`;
  $('red-count').textContent = `${red}/${ROOMS.team}`;
  const full: Record<Team, boolean> = { green: tdm && green >= ROOMS.team, red: tdm && red >= ROOMS.team };
  if (full[chosenTeam]) chosenTeam = chosenTeam === 'green' ? 'red' : 'green';
  for (const b of buttonsOf('team-choice')) {
    b.disabled = full[b.dataset.team as Team];
    b.classList.toggle('active', b.dataset.team === chosenTeam);
  }

  const blocked = creating ? m.rooms.length >= m.maxRooms : !room || room.count >= room.max;
  playBtn.disabled = blocked;
  playBtn.textContent = creating ? 'СОЗДАТЬ И ИГРАТЬ' : 'ВОЙТИ И ИГРАТЬ';
}

/** Настройки новой комнаты: режим, карта и лимит матча. */
function renderNewRoom(): void {
  for (const b of buttonsOf('mode-choice')) b.classList.toggle('active', b.dataset.mode === chosenMode);
  $<HTMLSelectElement>('map-choice').value = chosenMap;
  for (const b of buttonsOf('limit-kind')) b.classList.toggle('active', b.dataset.kind === chosenLimitKind);
  // Значения — минуты или убийства, смотря что выбрано
  const values: readonly number[] = chosenLimitKind === 'time' ? MATCH.minutes : MATCH.kills;
  const unit = chosenLimitKind === 'time' ? 'мин' : 'убийств';
  const valueBox = $('limit-value');
  if (valueBox.dataset.kind !== chosenLimitKind) {
    valueBox.dataset.kind = chosenLimitKind;
    valueBox.textContent = '';
    for (const v of values) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.v = String(v);
      b.textContent = `${v} ${unit}`;
      valueBox.append(b);
    }
  }
  if (!values.includes(chosenLimitValue)) chosenLimitValue = values[1]!;
  for (const b of buttonsOf('limit-value')) b.classList.toggle('active', Number(b.dataset.v) === chosenLimitValue);
}

/** Карточка справа: лучший игрок сейчас по всем комнатам. */
function renderBest(best: BestPlayer | null): void {
  const card = $('best');
  card.textContent = '';
  card.append(textEl('small', '🏆 ЛУЧШИЙ ИГРОК СЕЙЧАС', 'best-title'));
  if (!best) {
    card.append(textEl('span', 'Пока никто не играет — стань первым!', 'best-empty'));
    return;
  }
  const pr = rankProgress(best.totalKills);
  const r = RANKS[best.rank]!;
  const kd = (k: number, d: number): string => (d ? k / d : k).toFixed(2);
  const stat = (value: string, label: string): HTMLElement => {
    const el = document.createElement('div');
    el.append(textEl('span', value, 'v'), textEl('small', label));
    return el;
  };
  const match = document.createElement('div');
  match.className = 'best-stats';
  match.append(stat(String(best.kills), 'убийств'), stat(String(best.deaths), 'смертей'), stat(kd(best.kills, best.deaths), 'У/С'));
  const total = document.createElement('div');
  total.className = 'best-stats small';
  total.append(stat(String(best.totalKills), 'всего убийств'), stat(String(best.totalDeaths), 'всего смертей'), stat(kd(best.totalKills, best.totalDeaths), 'У/С за всё время'));
  card.append(
    rankRing(levelOf(best.rank), r.abbr, pr.part),
    textEl('span', best.name, 'best-name'),
    textEl('span', `${r.abbr} · ${r.name}`, 'best-rank'),
    textEl('small', `в комнате «${best.room}»`),
    textEl('small', 'В этом матче', 'best-sub'),
    match,
    textEl('small', 'За всё время', 'best-sub'),
    total,
  );
}

function pickedButton(e: MouseEvent): HTMLButtonElement | null {
  const b = (e.target as HTMLElement).closest('button');
  return b && !b.disabled ? b : null;
}

function join(room: number | 'new', extra: { roomName?: string; password?: string; map?: MapId } = {}): void {
  initAudio();
  $('status').textContent = '';
  playBtn.disabled = true;
  sendMsg({
    t: 'join', room, roomName: extra.roomName ?? '', password: extra.password ?? '',
    name: nameInput.value.trim(), team: chosenTeam, mode: chosenMode, map: extra.map ?? chosenMap,
    limitKind: chosenLimitKind, limitValue: chosenLimitValue,
    kit: settings.kit, melee: settings.melee, token: localStorage.getItem(TOKEN_KEY) ?? undefined,
  });
}

/**
 * Случайный матч: любая открытая комната без пароля, где уже есть игроки.
 * Если таких нет — открываем свою на случайной карте, чтобы к ней могли присоединиться.
 */
export function joinRandom(): void {
  const m = lobbyState;
  if (!m) { $('status').textContent = 'Нет связи с сервером'; return; }
  const open = m.rooms.filter((r) => !r.locked && r.count > 0 && r.count < r.max);
  if (open.length) { join(open[Math.floor(Math.random() * open.length)]!.id); return; }
  if (m.rooms.length >= m.maxRooms) { $('status').textContent = 'Свободных комнат нет — загляни в «Обзор комнат»'; return; }
  join('new', { map: MAP_ORDER[Math.floor(Math.random() * MAP_ORDER.length)]! });
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initMenu(): void {
  $('room-list').addEventListener('click', (e) => {
    const b = pickedButton(e);
    if (!b) return;
    chosenRoom = b.dataset.room === 'new' ? 'new' : Number(b.dataset.room);
    roomPicked = true;
    $('status').textContent = '';
    renderMenu();
  });
  $('mode-choice').addEventListener('click', (e) => {
    const b = pickedButton(e);
    if (!b) return;
    chosenMode = b.dataset.mode === 'ffa' ? 'ffa' : 'tdm';
    renderMenu();
  });
  // Карт много — выбор выпадающим списком, чтобы ничего не вылезало за края меню
  // Карты разложены по разделам: «Новые» и «Старые»
  for (const section of MAP_SECTIONS) {
    const group = document.createElement('optgroup');
    group.label = section.title;
    for (const id of section.maps) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = MAPS[id].name;
      group.append(o);
    }
    $('map-choice').append(group);
  }
  $<HTMLSelectElement>('map-choice').value = chosenMap;
  $('map-choice').addEventListener('change', () => {
    const v = $<HTMLSelectElement>('map-choice').value;
    chosenMap = MAP_ORDER.find((id) => id === v) ?? 'sands';
    renderMenu();
  });
  $('limit-kind').addEventListener('click', (e) => {
    const b = pickedButton(e);
    if (!b) return;
    chosenLimitKind = b.dataset.kind === 'kills' ? 'kills' : 'time';
    renderMenu();
  });
  $('limit-value').addEventListener('click', (e) => {
    const b = pickedButton(e);
    if (!b) return;
    chosenLimitValue = Number(b.dataset.v);
    renderMenu();
  });
  $('team-choice').addEventListener('click', (e) => {
    const b = pickedButton(e);
    if (!b) return;
    chosenTeam = b.dataset.team === 'red' ? 'red' : 'green';
    renderMenu();
  });
  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const creating = chosenRoom === 'new';
    const password = $<HTMLInputElement>(creating ? 'room-pass-new' : 'room-pass').value;
    if (creating && password && (password.length < ROOMS.passMin || password.length > ROOMS.passMax)) {
      $('status').textContent = `Пароль — от ${ROOMS.passMin} до ${ROOMS.passMax} символов (или оставь пустым)`;
      return;
    }
    const room = lobbyState?.rooms.find((r) => r.id === chosenRoom);
    if (room?.locked && !password) {
      $('status').textContent = 'У комнаты есть пароль — введи его';
      return;
    }
    join(chosenRoom, { roomName: $<HTMLInputElement>('room-name').value.trim(), password });
  });
}
