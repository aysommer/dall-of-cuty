// Карта «Дом»: двухэтажный дом, из которого не выйти. На каждом этаже — комнаты,
// между этажами две лестницы. Посередине второго этажа — стеклянный пол: разбей его —
// и можно спрыгнуть в зал первого этажа. Коричневые двери выдерживают много выстрелов,
// потом разлетаются в щепки. Планировка своя и симметрична относительно центра.
import { builder, type Breakable, type GameMap, type Ladder, type SpawnPoint } from './types.js';
import { addGroundAndSewer, subtract } from './sewer.js';

const HALF = { x: 15, z: 11 };
const F2 = 3.5;         // пол второго этажа
const SLAB = 0.3;       // толщина перекрытия
const CEIL = 7;         // потолок второго этажа
const T = 0.3;          // толщина внутренних стен
const DOOR_H = 2.4;

const OUTER = '#d8cbb3';
const INNER = '#efe6d2';
const FLOOR1 = '#9c8b74';
const WOOD = '#8a6a45';
const DARK = '#4b4036';
const DOOR = '#7a4a22';
const GLASS = '#9fd3ff';
const WINDOW = '#a9d8ff';
const SOFA = '#5a6f8f';
const BED = '#c25b4f';

const { boxes, b, sym } = builder();

// Наружные стены на оба этажа и потолок — выхода нет
b(-HALF.x - 1, -HALF.z - 1, HALF.x + 1, -HALF.z, CEIL + SLAB, OUTER);
b(-HALF.x - 1, HALF.z, HALF.x + 1, HALF.z + 1, CEIL + SLAB, OUTER);
b(-HALF.x - 1, -HALF.z, -HALF.x, HALF.z, CEIL + SLAB, OUTER);
b(HALF.x, -HALF.z, HALF.x + 1, HALF.z, CEIL + SLAB, OUTER);
b(-HALF.x, -HALF.z, HALF.x, HALF.z, SLAB, DARK, CEIL);

// --- Лестницы: 12 ступеней по 0.29 м — заходишь без прыжка ---
const STEPS = 12, RISE = F2 / STEPS, RUN = 0.35;
for (let i = 0; i < STEPS; i++) {
  const x1 = -2 + i * RUN;
  sym(x1, -HALF.z, x1 + RUN, -9.5, RISE * (i + 1), WOOD); // вдоль северной стены, вверх на восток (и зеркально)
}

// --- Перекрытие второго этажа: дыры над лестницами и стеклянный пол в центре ---
const holes: Array<[number, number, number, number]> = [
  [-1.5, -1.5, 1.5, 1.5],             // стекло
  [-2, -HALF.z, 2.2, -9.5],           // над лестницей у северной стены
  [-2.2, 9.5, 2, HALF.z],             // над лестницей у южной стены
];
for (const [x1, z1, x2, z2] of subtract([-HALF.x, -HALF.z, HALF.x, HALF.z], holes)) {
  boxes.push({ min: [x1, F2 - SLAB, z1], max: [x2, F2, z2], color: DARK, top: WOOD });
}
// Перила вокруг лестничных проёмов
sym(-2, -9.6, 2.2, -9.5, 1, DARK, F2);
sym(-2.1, -HALF.z, -2, -9.6, 1, DARK, F2);

// --- Внутренние стены: перегородки x = ±6 на обоих этажах ---
// Первый этаж: дверь (z −1…1) и открытый проём (z 5.5…7)
sym(-6 - T / 2, -HALF.z, -6 + T / 2, -1, F2 - SLAB, INNER);
sym(-6 - T / 2, 1, -6 + T / 2, 5.5, F2 - SLAB, INNER);
sym(-6 - T / 2, 7, -6 + T / 2, HALF.z, F2 - SLAB, INNER);
sym(-6 - T / 2, -1, -6 + T / 2, 1, F2 - SLAB - DOOR_H, INNER, DOOR_H);       // над дверью
sym(-6 - T / 2, 5.5, -6 + T / 2, 7, F2 - SLAB - DOOR_H, INNER, DOOR_H);      // над проёмом
// Второй этаж: дверь (z −1…1) и открытый проём (z −7.5…−6)
sym(-6 - T / 2, -HALF.z, -6 + T / 2, -7.5, CEIL - F2, INNER, F2);
sym(-6 - T / 2, -6, -6 + T / 2, -1, CEIL - F2, INNER, F2);
sym(-6 - T / 2, 1, -6 + T / 2, HALF.z, CEIL - F2, INNER, F2);
sym(-6 - T / 2, -1, -6 + T / 2, 1, CEIL - F2 - DOOR_H, INNER, F2 + DOOR_H);
sym(-6 - T / 2, -7.5, -6 + T / 2, -6, CEIL - F2 - DOOR_H, INNER, F2 + DOOR_H);
// Второй этаж: спальня отделена стеной z = 3 с дверью (x −11…−9.5)
sym(-HALF.x, 3 - T / 2, -11, 3 + T / 2, CEIL - F2, INNER, F2);
sym(-9.5, 3 - T / 2, -6 - T / 2, 3 + T / 2, CEIL - F2, INNER, F2);
sym(-11, 3 - T / 2, -9.5, 3 + T / 2, CEIL - F2 - DOOR_H, INNER, F2 + DOOR_H);

// --- Мебель ---
// Первый этаж: кухня (запад) и диваны в зале
sym(-HALF.x, -7, -14.2, 1, 1, WOOD);                 // кухонная стойка вдоль стены
sym(-11, -3.5, -9, -1.5, 0.8, WOOD);                 // стол
sym(-3, 6.4, 1, 7.2, 0.7, SOFA);                     // диван
sym(-3, 7.2, 1, 7.6, 1.3, SOFA);                     // спинка
// Второй этаж: кровати, шкафы
sym(-14, 6, -12, 9, 0.6, BED, F2);
sym(-HALF.x, -3, -14.4, 0, 2.2, WOOD, F2);           // шкаф
sym(-10, -10, -8, -9, 1, WOOD, F2);                  // комод

// --- Окна (стекло на стене изнутри, не бьётся) ---
for (const x of [-10, 10]) {
  for (const y of [0.9, F2 + 0.9]) {
    b(x - 1, -HALF.z, x + 1, -HALF.z + 0.05, 1.3, WINDOW, y);
    b(x - 1, HALF.z - 0.05, x + 1, HALF.z, 1.3, WINDOW, y);
  }
}

// --- Разрушаемое: стеклянный пол в центре и двери ---
let nextId = 1;
const breakables: Breakable[] = [];
const breakable = (kind: 'glass' | 'door', x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): void => {
  breakables.push({
    id: nextId++, kind, hp: kind === 'glass' ? 20 : 250,
    box: { min: [x1, y1, z1], max: [x2, y2, z2], color: kind === 'glass' ? GLASS : DOOR },
  });
};
breakable('glass', -1.5, F2 - 0.1, -1.5, 1.5, F2, 1.5);
for (const s of [-1, 1]) {
  // Двери в перегородках x = ±6 на обоих этажах (z −1…1) и дверь в спальню
  breakable('door', s * 6 - 0.1, 0, -1, s * 6 + 0.1, DOOR_H, 1);
  breakable('door', s * 6 - 0.1, F2, -1, s * 6 + 0.1, F2 + DOOR_H, 1);
}
breakable('door', -11, F2, 2.9, -9.5, F2 + DOOR_H, 3.1);
breakable('door', 9.5, F2, -3.1, 11, F2 + DOOR_H, -2.9);

// Канализация: под первым этажом, люки в комнатах запада и востока
const ladders: Ladder[] = [];
const { lamps } = addGroundAndSewer(boxes, ladders, HALF, { axis: 'x', from: -13, to: 13, at: 4 }, FLOOR1);

// Зелёные — в западной части первого этажа, красные — в восточной
const E = -Math.PI / 2, W = Math.PI / 2;
const green: SpawnPoint[] = [[-13.5, -9, E], [-8.5, -9.5, E], [-13.5, 9.5, E], [-8.5, 9.5, E], [-8, -6, E], [-8, 7, E]];
const red: SpawnPoint[] = green.map(([x, z]) => [-x, -z, W]);

export const HOUSE: GameMap = {
  id: 'house',
  name: 'Дом',
  half: HALF,
  floor: FLOOR1,
  sky: '#c9d6e3',
  boxes,
  ladders,
  lamps,
  breakables,
  indoor: true,
  crateDrops: [[-3.5, 0, -4], [3.5, 0, 4], [-9, F2, -6], [9, F2, 6]],
  medkitDrops: [[-3.5, 0, 4], [3.5, 0, -4], [-9, F2, 7], [9, F2, -7]],
  spawns: {
    green,
    red,
    ffa: [...green, ...red, [-12, -6, 0, F2], [12, 6, Math.PI, F2], [-10, 8, 0, F2], [10, -8, Math.PI, F2]],
  },
};
