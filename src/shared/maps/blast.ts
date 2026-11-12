// Карта «Explosion City»: тихая улица, которая упирается в круглый тупик. Посреди круга — автобус,
// рядом грузовик, две машины и клумба. Слева — зелёный дом, справа — жёлтый, друг напротив друга;
// у каждого гараж, лестница, окна и двери на улицу. За домами — дворы, там появляются команды.
// Сверху и снизу вдоль заборов — обходные пути. Стороны зеркальны по X, чтобы командам было поровну.
// Планировка своя, по описанию схемы.
import { builder, type Breakable, type GameMap, type Ladder, type SpawnPoint } from './types.js';
import { addGroundAndSewer, subtract } from './sewer.js';

const HALF = { x: 30, z: 20 };
const FENCE_H = 2.4;

const FENCE = '#c9b48f';
const GRASS = '#86b35e';
const ASPHALT = '#55585e';
const GREEN_HOUSE = '#6fae5f';
const YELLOW_HOUSE = '#e3c14a';
const ROOF = '#4a4f57';
const FLOOR = '#8a6a45';
const WOOD = '#8a5a2b';
const STONE = '#a7a29a';
const HEDGE = '#3f7a3a';
const BUS = '#3b6fb6';
const BUS_ROOF = '#e8e8e8';
const DARK = '#24272c';
const TRUCK = '#ecebe6';
const TRUCK_CAB = '#c4462f';
const CAR_GREEN = '#b0392f';
const CAR_YELLOW = '#2f6db0';
const SOIL = '#6b4a2f';
const PINK = '#e86fa8';
const DOOR = '#7a4a22';
const GLASS = '#9fd3ff';
const POLE = '#3d4148';

const { boxes, b } = builder();

/** Блок слева (у зелёного дома) и его отражение справа (у жёлтого): x → −x, цвет справа — свой. */
const mx = (x1: number, z1: number, x2: number, z2: number, h: number, left: string, y = 0, right = left): void => {
  b(x1, z1, x2, z2, h, left, y);
  b(-x2, z1, -x1, z2, h, right, y);
};

// Забор вокруг квартала
b(-HALF.x - 1, -HALF.z - 1, HALF.x + 1, -HALF.z, FENCE_H, FENCE);
b(-HALF.x - 1, HALF.z, HALF.x + 1, HALF.z + 1, FENCE_H, FENCE);
b(-HALF.x - 1, -HALF.z, -HALF.x, HALF.z, FENCE_H, FENCE);
b(HALF.x, -HALF.z, HALF.x + 1, HALF.z, FENCE_H, FENCE);

// --- Улица: въезд снизу и круглый тупик в центре (асфальт чуть выше газона — на него заходят без прыжка) ---
const ROAD = 0.04;
b(-3.5, -HALF.z, 3.5, -7, ROAD, ASPHALT);
for (const [rx, rz] of [[9, 3.5], [8, 5.5], [6.5, 7.5], [4, 8.7]] as const) b(-rx, -rz, rx, rz, ROAD, ASPHALT);
// Подъезды к гаражам
mx(-16, -9.4, -9, -3.3, ROAD, ASPHALT);

// --- Автобус посреди круга: вдоль улицы, с полосой окон и светлой крышей ---
// Колёса стоят на асфальте (низом чуть выше него — иначе грани совпадают и мерцают)
for (const z of [-3.2, 2.6]) for (const x of [-1.35, 1.0]) b(x, z, x + 0.35, z + 0.7, 0.35 - ROAD, DARK, ROAD);
b(-1.3, -4.5, 1.3, 4.5, 2.65, BUS, 0.35);
b(-1.35, -4.2, 1.35, 4.2, 0.7, DARK, 1.6);           // окна
b(-1.3, -4.5, 1.3, 4.5, 0.12, BUS_ROOF, 3.0);

// --- Грузовик за автобусом, кабиной к верхнему забору ---
for (const z of [10.6, 13.6, 15.4]) for (const x of [-1.3, 0.95]) b(x, z, x + 0.35, z + 0.8, 0.45, DARK);
b(-1.25, 10, 1.25, 14.6, 2.9, TRUCK, 0.45);          // кузов
b(-1.15, 14.8, 1.15, 16.5, 1.9, TRUCK_CAB, 0.45);    // кабина
b(-1.2, 15.9, 1.2, 16.45, 0.6, DARK, 1.45);          // лобовое стекло

// --- Две машины у въезда в круг: красная у зелёного дома, синяя у жёлтого ---
for (const z of [-8.3, -5.4]) for (const x of [4.9, 6.75]) mx(-x - 0.35, z, -x, z + 0.6, 0.3 - ROAD, DARK, ROAD);
mx(-7.05, -8.6, -4.95, -4.5, 0.8, CAR_GREEN, 0.3, CAR_YELLOW);
mx(-6.85, -7.6, -5.15, -5.4, 0.55, DARK, 1.1);

// --- Клумба посреди въезда: каменный бортик, земля и цветы — укрытие по пояс ---
b(-1.6, -14, 1.6, -11, 0.5, STONE, ROAD);
b(-1.4, -13.8, 1.4, -11.2, 0.12, SOIL, ROAD + 0.5);
for (const [x, z] of [[-0.8, -13], [0.5, -12.6], [-0.2, -11.9], [0.9, -11.7]] as const) b(x - 0.15, z - 0.15, x + 0.15, z + 0.15, 0.35, PINK, ROAD + 0.62);

// --- Фонари у круга ---
for (const z of [-9.5, 9.5]) mx(-10.2, z - 0.1, -10, z + 0.1, 4.2, POLE);

// ---------- Дома: зелёный слева, жёлтый справа, фасадом на улицу ----------
const T = 0.3, F2 = 3.2, TOP = 6.4;
const HX1 = -25, HX2 = -15, HZ1 = -1, HZ2 = 9;      // зелёный дом (жёлтый — отражение по X)
const FRONT = HX2 - T;                                // внутренняя грань фасада
/** Кусок стены фасада или задней стены (по Z) с проёмом: сплошные части, подоконник и перемычка. */
const wallZ = (x1: number, x2: number, y0: number, h: number, openings: Array<[z1: number, z2: number, sill: number, top: number]>): void => {
  let z = HZ1;
  for (const [z1, z2, sill, top] of openings) {
    if (z1 > z) mx(x1, z, x2, z1, h, GREEN_HOUSE, y0, YELLOW_HOUSE);
    if (sill > 0) mx(x1, z1, x2, z2, sill, GREEN_HOUSE, y0, YELLOW_HOUSE);
    if (top < h) mx(x1, z1, x2, z2, h - top, GREEN_HOUSE, y0 + top, YELLOW_HOUSE);
    z = z2;
  }
  if (z < HZ2) mx(x1, z, x2, HZ2, h, GREEN_HOUSE, y0, YELLOW_HOUSE);
};
/** То же для боковых стен (по X). */
const wallX = (z1: number, z2: number, y0: number, h: number, openings: Array<[x1: number, x2: number, sill: number, top: number]>): void => {
  let x = HX1 + T;
  for (const [x1, x2, sill, top] of openings) {
    if (x1 > x) mx(x, z1, x1, z2, h, GREEN_HOUSE, y0, YELLOW_HOUSE);
    if (sill > 0) mx(x1, z1, x2, z2, sill, GREEN_HOUSE, y0, YELLOW_HOUSE);
    if (top < h) mx(x1, z1, x2, z2, h - top, GREEN_HOUSE, y0 + top, YELLOW_HOUSE);
    x = x2;
  }
  if (x < FRONT) mx(x, z1, FRONT, z2, h, GREEN_HOUSE, y0, YELLOW_HOUSE);
};
const H1 = F2, H2 = TOP - F2;
// Фасад: дверь и окно внизу, два окна наверху
wallZ(FRONT, HX2, 0, H1, [[2, 3.4, 0, 2.3], [5, 7, 1, 2.2]]);
wallZ(FRONT, HX2, F2, H2, [[0.5, 2.5, 1, 2.2], [5, 7, 1, 2.2]]);
// Задняя стена: дверь во двор внизу, окно наверху
wallZ(HX1, HX1 + T, 0, H1, [[5, 6.4, 0, 2.3]]);
wallZ(HX1, HX1 + T, F2, H2, [[2, 4, 1, 2.2]]);
// Боковые стены с окнами
wallX(HZ2 - T, HZ2, 0, H1, [[-18, -16.5, 1, 2.2]]);
wallX(HZ2 - T, HZ2, F2, H2, [[-19, -17, 1, 2.2]]);
wallX(HZ1, HZ1 + T, 0, H1, [[-21, -19, 1, 2.2]]);
wallX(HZ1, HZ1 + T, F2, H2, [[-23, -21, 1, 2.2]]);
// Лестница на второй этаж вдоль задней части боковой стены: 10 ступеней, вверх к фасаду
const STEPS = 10, RISE = F2 / STEPS, RUN = 0.42;
const SX = HX1 + T + 0.2, SZ1 = HZ2 - T - 1.35, SZ2 = HZ2 - T;
for (let i = 0; i < STEPS; i++) mx(SX + i * RUN, SZ1, SX + (i + 1) * RUN, SZ2, RISE * (i + 1), FLOOR);
const STAIR_END = SX + STEPS * RUN;
// Перекрытие второго этажа с проёмом над лестницей
for (const [x1, z1, x2, z2] of subtract([HX1 + T, HZ1 + T, FRONT, HZ2 - T], [[HX1 + T, SZ1 - 0.1, STAIR_END + 0.1, HZ2 - T]])) {
  mx(x1, z1, x2, z2, 0.25, FLOOR, F2 - 0.25);
}
// Перила вдоль проёма (выход с лестницы — к фасаду)
mx(HX1 + T, SZ1 - 0.2, STAIR_END - 0.4, SZ1 - 0.1, 1, WOOD, F2);
// Крыша
mx(HX1, HZ1, HX2, HZ2, 0.3, ROOF, TOP);
// Навес над входом
mx(HX2, 1.5, HX2 + 1.2, 3.9, 0.15, ROOF, 2.6);

// ---------- Гаражи: рядом с домом, воротами на подъезд ----------
const GX1 = -25, GX2 = -16, GZ1 = -10.5, GZ2 = -2.2, GH = 3;
mx(GX1, GZ2 - T, GX2, GZ2, GH, GREEN_HOUSE, 0, YELLOW_HOUSE);                  // стена к дому
mx(GX1, GZ1, GX2, GZ1 + T, GH, GREEN_HOUSE, 0, YELLOW_HOUSE);                  // стена к нижнему обходу
mx(GX1, GZ1 + T, GX1 + T, -7, GH, GREEN_HOUSE, 0, YELLOW_HOUSE);               // задняя стена с дверью во двор
mx(GX1, -5.8, GX1 + T, GZ2 - T, GH, GREEN_HOUSE, 0, YELLOW_HOUSE);
mx(GX1, -7, GX1 + T, -5.8, GH - 2.3, GREEN_HOUSE, 2.3, YELLOW_HOUSE);
mx(GX2 - T, GZ1 + T, GX2, -9.4, GH, GREEN_HOUSE, 0, YELLOW_HOUSE);             // ворота открыты: столбы и перемычка
mx(GX2 - T, -3.3, GX2, GZ2 - T, GH, GREEN_HOUSE, 0, YELLOW_HOUSE);
mx(GX2 - T, -9.4, GX2, -3.3, GH - 2.4, GREEN_HOUSE, 2.4, YELLOW_HOUSE);
mx(GX1, GZ1, GX2, GZ2, 0.3, ROOF, GH);                                         // крыша — по ней можно ходить
// Машина в гараже
for (const z of [-8.3, -5.3]) for (const x of [-23.1, -21.25]) mx(x, z, x + 0.35, z + 0.6, 0.3, DARK);
mx(-23, -8.6, -21, -4.4, 0.8, '#7f8a96', 0.3);
mx(-22.8, -7.6, -21.2, -5.4, 0.55, DARK, 1.1);
// Деревянная лестница снаружи гаража — на его крышу, со стороны двора
const G_STEPS = 10, G_RISE = (GH + 0.3) / G_STEPS, G_RUN = 0.5;
for (let i = 0; i < G_STEPS; i++) mx(-24.6 + i * G_RUN, GZ1 - 1.2, -24.6 + (i + 1) * G_RUN, GZ1, G_RISE * (i + 1), WOOD);

// ---------- Палисадники: низкий забор между домом и улицей, проходы к двери и к гаражу ----------
for (const [z1, z2] of [[-11.5, -9.6], [-3.1, 1.6], [3.8, 11]] as const) mx(-12.6, z1, -12.45, z2, 1, '#e8e2d4');

// ---------- Дворы за домами: здесь появляются команды ----------
mx(-29.6, 11.5, -27.6, 14.5, 2.4, WOOD);                        // сарай
mx(-29.8, -1.2, -28.6, 0, 1.1, WOOD);                           // ящики
mx(-29.8, 0, -28.9, 0.9, 1.1, WOOD);
mx(-HALF.x, 11, -26.5, 11.15, 1.8, FENCE);                      // заборчики дворов — с проходом к обходам
mx(-HALF.x, -12.2, -27, -12.05, 1.8, FENCE);

// ---------- Обходы вдоль заборов: сверху и снизу ----------
mx(-22, 13.8, -17, 14.6, 1.2, HEDGE);                            // живая изгородь
mx(-12.2, 16.5, -11, 17.7, 1.2, WOOD);                           // ящики
mx(-8, 13, -6.8, 14.2, 1.2, WOOD);
mx(-20, -16.5, -17, -16, 1.1, STONE);                            // низкая стенка
mx(-10.6, -15.8, -9.4, -14.6, 1.2, WOOD);
mx(-7, -18.6, -5.8, -17.4, 1.2, WOOD);

// ---------- Двери и окна: двери открываются на F, стёкла и двери можно разбить ----------
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
breakable('door', HX2 - 0.25, 0, 2, HX2 - 0.05, 2.3, 3.4);        // дверь на улицу
breakable('door', HX1 + 0.05, 0, 5, HX1 + 0.25, 2.3, 6.4);        // дверь во двор
breakable('door', GX1 + 0.05, 0, -7, GX1 + 0.25, 2.3, -5.8);      // дверь гаража во двор
breakable('glass', HX2 - 0.2, 1, 5, HX2 - 0.1, 2.2, 7);           // окна фасада
breakable('glass', HX2 - 0.2, F2 + 1, 0.5, HX2 - 0.1, F2 + 2.2, 2.5);
breakable('glass', HX2 - 0.2, F2 + 1, 5, HX2 - 0.1, F2 + 2.2, 7);

// Канализация: под верхним обходом, люки у живых изгородей
const ladders: Ladder[] = [];
const { lamps } = addGroundAndSewer(boxes, ladders, HALF, { axis: 'x', from: -19, to: 19, at: 16.8 }, GRASS);

// Зелёные — во дворе зелёного дома (взгляд на восток), красные — во дворе жёлтого
const E = -Math.PI / 2, W = Math.PI / 2;
const green: SpawnPoint[] = [[-27.5, -6, E], [-27.5, -2.6, E], [-27, 3.5, E], [-27, 8, E], [-28.5, -15.5, E], [-26, 16.5, E]];
const red: SpawnPoint[] = green.map(([x, z]) => [-x, z, W]);

export const BLAST: GameMap = {
  id: 'blast',
  name: 'Explosion City',
  fresh: true,
  half: HALF,
  floor: GRASS,
  sky: '#f0c9a0',
  boxes,
  ladders,
  lamps,
  breakables,
  // Ящик падает на въезд, в верхний обход или на крыши гаражей
  crateDrops: [[0, ROAD, -17], [-14, 0, 15], [14, 0, 15], [-20.5, GH + 0.3, -6], [20.5, GH + 0.3, -6]],
  medkitDrops: [[-6, ROAD, 0], [6, ROAD, 0], [-9, 0, -14], [9, 0, -14]],
  spawns: {
    green,
    red,
    // Плюс вторые этажи домов и концы улицы
    ffa: [...green, ...red, [-19, 3, E, F2], [19, 3, W, F2], [0, -18, Math.PI, ROAD], [0, 18.6, 0]],
  },
};
