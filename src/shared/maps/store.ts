// Карта «Магазин»: большой супермаркет под крышей. Команды появляются на складах в западном и восточном концах,
// между ними — торговый зал. Стеллажи стоят так, что прямой линии обзора от одного склада до другого нет:
// в центре — промо-стенд и две стойки-киоска, по бокам — поперечные стеллажи, служебные коридоры вдоль стен
// идут зигзагом. Над каждым складом — офис с окнами на зал (оттуда видно поверх стеллажей) и мостиком перед ними,
// на мостик снизу ведёт лестница у колонны. Планировка своя; стороны зеркальны по X, чтобы командам было поровну.
import { builder, type Breakable, type GameMap, type Ladder, type SpawnPoint } from './types.js';
import { addGround } from './ground.js';

const HALF = { x: 32, z: 22 };
/** Потолок зала */
const H = 9;

const TILE = '#d9d6cf';
const WALL = '#e8e4da';
const CONCRETE = '#9aa0a6';
const CEILING = '#c9c4b8';
const SHELF_GREEN = '#3f8f4f';
const SHELF_YELLOW = '#d8b03a';
const GOODS = '#e7e1d2';
const PROMO = '#c0392b';
const PROMO_TOP = '#f0d36b';
const KIOSK = '#2f5f9e';
const COUNTER = '#5a5f66';
const BELT = '#2b2e33';
const PALLET = '#9a7347';
const BOX = '#c9a36b';
const OFFICE = '#f2efe6';
const FLOOR2 = '#8a8f96';
const RAIL = '#3d4148';
const WOOD = '#8a5a2b';
const DOOR = '#6b7078';
const GLASS = '#9fd3ff';

const { boxes, b } = builder();

/** Блок на западной половине и его отражение на восточной (x → −x); у восточной свой цвет. */
const mx = (x1: number, z1: number, x2: number, z2: number, h: number, left: string, y = 0, right = left): void => {
  b(x1, z1, x2, z2, h, left, y);
  b(-x2, z1, -x1, z2, h, right, y);
};
/** То же и ещё отражение по Z — для того, что одинаково у северной и южной стен. */
const q = (x1: number, z1: number, x2: number, z2: number, h: number, left: string, y = 0, right = left): void => {
  mx(x1, z1, x2, z2, h, left, y, right);
  mx(x1, -z2, x2, -z1, h, left, y, right);
};

// Стены и потолок: выхода наружу нет
b(-HALF.x - 1, -HALF.z - 1, HALF.x + 1, -HALF.z, H + 0.3, WALL);
b(-HALF.x - 1, HALF.z, HALF.x + 1, HALF.z + 1, H + 0.3, WALL);
b(-HALF.x - 1, -HALF.z, -HALF.x, HALF.z, H + 0.3, WALL);
b(HALF.x, -HALF.z, HALF.x + 1, HALF.z, H + 0.3, WALL);
b(-HALF.x, -HALF.z, HALF.x, HALF.z, 0.3, CEILING, H);

// ---------- Склады: стена между складом и залом ----------
const SW = -26;           // грань стены склада со стороны зала
const T = 0.3;
const DOOR_H = 2.4;
/** Пол офиса над складом */
const F2 = 3.6;
/** Офис над складом — над северной частью склада, окна на зал */
const OZ1 = 9, OZ2 = 15;
// Проёмы: две двери в зал и широкие проходы в служебные коридоры
const openings: Array<[number, number, boolean]> = [[-19, -16, false], [-7.4, -6, true], [3, 4.4, true], [16, 19, false]];
/** Сплошной кусок стены; напротив офиса — только до его пола: выше — передняя стена офиса с окнами */
const solid = (z1: number, z2: number): void => {
  const lo = Math.max(z1, OZ1), hi = Math.min(z2, OZ2);
  if (lo >= hi) { mx(SW - T, z1, SW, z2, H, CONCRETE); return; }
  mx(SW - T, z1, SW, z2, F2, CONCRETE);
  if (z1 < lo) mx(SW - T, z1, SW, lo, H - F2, CONCRETE, F2);
  if (hi < z2) mx(SW - T, hi, SW, z2, H - F2, CONCRETE, F2);
};
let z = -HALF.z;
for (const [z1, z2, door] of openings) {
  solid(z, z1);
  const top = door ? DOOR_H : 3.2;                                         // двери — по росту, проходы в коридоры — шире
  mx(SW - T, z1, SW, z2, H - top, CONCRETE, top);
  z = z2;
}
solid(z, HALF.z);
// Паллеты с коробками на складе
q(-31.5, 16, -30, 17.4, 1.4, PALLET);
q(-31.3, 16.2, -30.2, 17.2, 0.6, BOX, 1.4);
mx(-29, -14, -27.6, -12.6, 1.4, PALLET);

// ---------- Офис над складом: лестница со склада, окна и дверь на мостик над залом ----------
const OX1 = -HALF.x + 0.3;
mx(OX1, OZ1, SW - T, OZ2, 0.25, FLOOR2, F2 - 0.25);                      // пол офиса
mx(OX1, OZ2 - T, SW - T, OZ2, H - F2, OFFICE, F2);                       // северная стена
// Южная стена с дверью к лестнице (x −31.7…−30.4)
mx(-30.4, OZ1, SW - T, OZ1 + T, H - F2, OFFICE, F2);
mx(OX1, OZ1, -30.4, OZ1 + T, H - F2 - DOOR_H, OFFICE, F2 + DOOR_H);
// Передняя стена (в стене склада): окна на зал и дверь на мостик посередине
const front = (z1: number, z2: number, sill: number, top: number): void => {
  if (sill > 0) mx(SW - T, z1, SW, z2, sill, CONCRETE, F2);
  mx(SW - T, z1, SW, z2, H - F2 - top, CONCRETE, F2 + top);
};
mx(SW - T, OZ1, SW, 9.5, H - F2, CONCRETE, F2);
front(9.5, 11.2, 1, 2.2);
mx(SW - T, 11.2, SW, 11.4, H - F2, CONCRETE, F2);
front(11.4, 12.6, 0, DOOR_H);
mx(SW - T, 12.6, SW, 12.8, H - F2, CONCRETE, F2);
front(12.8, 14.5, 1, 2.2);
mx(SW - T, 14.5, SW, OZ2, H - F2, CONCRETE, F2);
// Лестница со склада: вдоль западной стены, вверх на север, к площадке у двери офиса
// 11 ступеней по 0.33 м (выше 0.35 м без прыжка не шагнуть); перед нижней — свободный пол склада
const STEPS = 11, RISE = F2 / STEPS, RUN = 0.4, SZ = 1.6, SX1 = OX1, SX2 = -30.4;
for (let i = 0; i < STEPS; i++) mx(SX1, SZ + i * RUN, SX2, SZ + (i + 1) * RUN, RISE * (i + 1), WOOD);
mx(SX1, SZ + STEPS * RUN, SX2, OZ1, 0.25, FLOOR2, F2 - 0.25);             // площадка до двери
// Мостик над залом перед окнами, с перилами; опорные колонны, к южной прислонена лестница
mx(SW, OZ1 - 1, -24.8, OZ2 + 1, 0.25, FLOOR2, F2 - 0.25);
mx(-24.9, OZ1 - 1, -24.8, OZ2 + 1, 1, RAIL, F2);
mx(-25.9, OZ1 - 1, -25.1, OZ1 - 0.6, F2 - 0.25, RAIL);
mx(-25.9, OZ2 + 0.6, -25.1, OZ2 + 1, F2 - 0.25, RAIL);

// ---------- Торговый зал ----------
const SHELF_H = 2.6;
/** Стеллаж с товаром: каркас цвета команды и полоска товара */
const shelf = (x1: number, z1: number, x2: number, z2: number, h = SHELF_H): void => {
  mx(x1, z1, x2, z2, h, SHELF_GREEN, 0, SHELF_YELLOW);
  const along = x2 - x1 > z2 - z1;
  if (along) mx(x1 + 0.1, z1 - 0.05, x2 - 0.1, z2 + 0.05, 0.4, GOODS, 1.2);
  else mx(x1 - 0.05, z1 + 0.1, x2 + 0.05, z2 - 0.1, 0.4, GOODS, 1.2);
};
/** Стеллаж и его отражение по Z */
const shelf2 = (x1: number, z1: number, x2: number, z2: number): void => { shelf(x1, z1, x2, z2); shelf(x1, -z2, x2, -z1); };
// Ряды вдоль зала — проходы между ними
shelf2(-22, 3.5, -9, 4.4);
shelf2(-22, 8.5, -8, 9.4);
// Поперечные стеллажи у центра: перекрывают зал поперёк (в середине — проход к промо-стенду)
shelf2(-4.9, 1.2, -4, 9.4);
// Стеллажи, отделяющие служебные коридоры (в середине зала — разрыв)
shelf2(-22, 12.6, -6, 13.5);
// Коридоры — зигзагом: поперечные стеллажи с проходом то у стены, то у зала
shelf2(-14.45, 13.5, -13.55, 18.5);
b(-0.45, 15.5, 0.45, HALF.z, SHELF_H, SHELF_GREEN);
b(-0.45, -HALF.z, 0.45, -15.5, SHELF_H, SHELF_YELLOW);

// ---------- Центр: промо-стенд и стойки-киоски ----------
b(-2, -2.5, 2, 2.5, 2.2, PROMO);
b(-1.8, -2.3, 1.8, 2.3, 0.25, PROMO_TOP, 2.2);
b(-2, 9.4, 2, 12.6, 2.4, KIOSK);
b(-2, -12.6, 2, -9.4, 2.4, KIOSK);
// Кассы: стойка с лентой и экраном
for (const [z1, z2] of [[5, 8], [-8, -5]] as const) {
  mx(-11, z1, -10.2, z2, 1.05, COUNTER);
  mx(-10.95, z1 + 0.2, -10.25, z2 - 0.2, 0.05, BELT, 1.05);
  mx(-11, z1 + 0.3, -10.9, z1 + 0.9, 0.5, BELT, 1.1);
}

// ---------- Служебные коридоры: паллеты и коробки ----------
q(-20, 15, -18.6, 16.4, 1.2, PALLET);
q(-9.5, 19.5, -8.5, 20.5, 1.6, BOX);
q(-5, 14.2, -3.6, 15.6, 1.2, PALLET);

// ---------- Двери и окна ----------
let nextId = 1;
const breakables: Breakable[] = [];
const breakable = (kind: 'glass' | 'door', x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): void => {
  for (const [a1, a2] of [[x1, x2], [-x2, -x1]] as const) {
    breakables.push({
      id: nextId++, kind, hp: kind === 'glass' ? 20 : 250,
      box: { min: [a1, y1, z1], max: [a2, y2, z2], color: kind === 'glass' ? GLASS : DOOR },
    });
  }
};
breakable('door', SW - 0.25, 0, -7.4, SW - 0.05, DOOR_H, -6);           // двери склада в зал
breakable('door', SW - 0.25, 0, 3, SW - 0.05, DOOR_H, 4.4);
breakable('glass', SW - 0.2, F2 + 1, 9.5, SW - 0.1, F2 + 2.2, 11.2);    // окна офиса
breakable('glass', SW - 0.2, F2 + 1, 12.8, SW - 0.1, F2 + 2.2, 14.5);

addGround(boxes, HALF, TILE);

// Лестница на мостик — с его южного края
const ladders: Ladder[] = [
  { min: [-25.9, 0, OZ1 - 1.45], max: [-25.1, F2 + 0.4, OZ1 - 1], normal: [0, -1] },
  { min: [25.1, 0, OZ1 - 1.45], max: [25.9, F2 + 0.4, OZ1 - 1], normal: [0, -1] },
];

// Зелёные — на западном складе (взгляд на восток), красные — на восточном
const E = -Math.PI / 2, W = Math.PI / 2;
const green: SpawnPoint[] = [[-29.5, -19, E], [-29.5, -10, E], [-29.5, -3, E], [-28.5, 7, E], [-29.5, 12.5, E], [-28.5, 19.5, E]];
const red: SpawnPoint[] = green.map(([x, z]) => [-x, z, W]);

export const STORE: GameMap = {
  id: 'store',
  name: 'Магазин',
  fresh: true,
  half: HALF,
  floor: TILE,
  sky: '#cfd6dd',
  indoor: true,
  boxes,
  ladders,
  breakables,
  crateDrops: [[0, 0, 6], [0, 0, -6], [-18, 0, 18.5], [18, 0, -18.5]],
  medkitDrops: [[-12, 0, 0], [12, 0, 0], [-12, 0, 11], [12, 0, -11]],
  spawns: {
    green,
    red,
    // Плюс офисы над складами и проходы у касс
    ffa: [...green, ...red, [-29, 12, E, F2], [29, 12, W, F2], [-7, 0, E], [7, 0, W]],
  },
};
