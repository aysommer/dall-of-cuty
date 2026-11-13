// Карта «Дом»: трёхэтажный дом, из которого не выйти. На первых двух этажах — комнаты,
// между этажами по две лестницы. Посередине второго этажа — стеклянный пол: разбей его —
// и можно спрыгнуть в зал первого этажа. Коричневые двери выдерживают много выстрелов,
// потом разлетаются в щепки. Третий этаж — открытая крыша без потолка с грудами стальных
// балок: за ними прячутся, а ракеты с неба и самолёт достают только сюда.
// Планировка своя и симметрична относительно центра.
import { builder, type Breakable, type GameMap, type Ladder, type SpawnPoint } from './types.js';
import { addGround, subtract } from './ground.js';

const HALF = { x: 15, z: 11 };
const F2 = 3.5;         // пол второго этажа
const SLAB = 0.3;       // толщина перекрытия
const CEIL = 7;         // потолок второго этажа
const F3 = CEIL + SLAB; // пол третьего этажа (открытая крыша)
const PARAPET = 1.2;    // бортик по краю крыши
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
const STEEL = '#6d7480';
const RUST = '#8f5a3c';

const { boxes, b, sym } = builder();

// Наружные стены на все этажи с бортиком по краю крыши. Крыши нет — над третьим этажом небо
const WALL_H = F3 + PARAPET;
b(-HALF.x - 1, -HALF.z - 1, HALF.x + 1, -HALF.z, WALL_H, OUTER);
b(-HALF.x - 1, HALF.z, HALF.x + 1, HALF.z + 1, WALL_H, OUTER);
b(-HALF.x - 1, -HALF.z, -HALF.x, HALF.z, WALL_H, OUTER);
b(HALF.x, -HALF.z, HALF.x + 1, HALF.z, WALL_H, OUTER);

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

// --- Лестницы на третий этаж: из центрального зала второго этажа, вверх на юг (и зеркально) ---
const S3 = { x1: 2, x2: 3.5, z1: 4 };
const RISE3 = (F3 - F2) / STEPS;
for (let i = 0; i < STEPS; i++) {
  const z1 = S3.z1 + i * RUN;
  sym(S3.x1, z1, S3.x2, z1 + RUN, RISE3 * (i + 1), WOOD, F2);
}
const S3_END = S3.z1 + STEPS * RUN;

// --- Пол третьего этажа (бывший потолок) с проёмами над лестницами ---
for (const [x1, z1, x2, z2] of subtract([-HALF.x, -HALF.z, HALF.x, HALF.z], [
  [S3.x1, S3.z1, S3.x2, S3_END],
  [-S3.x2, -S3_END, -S3.x1, -S3.z1],
])) {
  boxes.push({ min: [x1, CEIL, z1], max: [x2, F3, z2], color: DARK, top: '#7d7a73' });
}
// Перила вокруг проёма на крыше; выход с лестницы — с южного края
sym(S3.x1 - 0.1, S3.z1 - 0.1, S3.x1, S3_END, 1, DARK, F3);
sym(S3.x2, S3.z1 - 0.1, S3.x2 + 0.1, S3_END, 1, DARK, F3);
sym(S3.x1, S3.z1 - 0.1, S3.x2, S3.z1, 1, DARK, F3);

// --- Третий этаж: груды стальных балок — укрытия ---
// Высокие штабеля (2 м) прячут целиком, низкие (1.1 м) — по пояс, на них можно запрыгнуть
sym(-13, -8.5, -8, -7.9, 2, STEEL, F3);              // длинный штабель у северо-западного угла
sym(-13, -7.9, -12.4, -5, 1.1, RUST, F3);            // поперечная балка к нему
sym(-10.5, -2.5, -9.9, 2.5, 2, STEEL, F3);           // стенка из балок на западе
sym(-7.5, 4.5, -3, 5.1, 1.1, RUST, F3);              // низкая балка
sym(-13.5, 6, -12.9, 9.5, 2, STEEL, F3);             // штабель в юго-западном углу
sym(-5.5, -6, -4.9, -2.5, 2, STEEL, F3);             // стойка у лестницы
sym(-2.5, 8.5, 1, 9.1, 1.1, RUST, F3);               // низкая балка у края
b(-2, -0.3, 2, 0.3, 1.1, RUST, F3);                  // балка посередине крыши
b(-0.3, -2.5, 0.3, -0.3, 2, STEEL, F3);              // и две стойки поперёк неё
b(-0.3, 0.3, 0.3, 2.5, 2, STEEL, F3);
// Каркас недостроя: столбы с перекладиной — сквозь него видно, но столбы держат пули
for (const x of [-8, -4.5]) sym(x, -10.2, x + 0.4, -9.8, 3, STEEL, F3);
sym(-8, -10.2, -4.1, -9.8, 0.4, STEEL, F3 + 3);

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

// Земля под всем домом; лестниц-подъёмов на карте нет
const ladders: Ladder[] = [];
addGround(boxes, HALF, FLOOR1);

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
  breakables,
  indoor: true,
  crateDrops: [[-3.5, 0, -4], [3.5, 0, 4], [-9, F2, -6], [9, F2, 6], [-7, F3, 0], [7, F3, 0]],
  medkitDrops: [[-3.5, 0, 4], [3.5, 0, -4], [-9, F2, 7], [9, F2, -7], [-11.5, F3, 4], [11.5, F3, -4]],
  spawns: {
    green,
    red,
    ffa: [...green, ...red, [-12, -6, 0, F2], [12, 6, Math.PI, F2], [-10, 8, 0, F2], [10, -8, Math.PI, F2], [-7, 7, 0, F3], [7, -7, Math.PI, F3]],
  },
};
