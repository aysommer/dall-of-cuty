// Классы — шаблоны снаряжения: стволы, нож или граната; выбор и правка в меню Esc.
import type { MeleeKind, WeaponId } from '../../shared/protocol.js';
import { GUNS, isKit, KIT_SIZE, WEAPONS } from '../../shared/map.js';
import { sendMsg } from '../core/net.js';
import { settings } from '../core/settings.js';
import { me } from '../core/state.js';
import { $, textEl } from '../core/util.js';
import { toast, updateHud } from './hud.js';
import { pauseView, renderProfileTile } from './pause.js';
import { applySettings } from './settings-menu.js';
import { setWeapon } from '../weapons/viewmodel.js';

function setMelee(kind: MeleeKind): void {
  if (settings.melee === kind) return;
  settings.melee = kind;
  applySettings();
  saveActiveClass();
  sendMsg({ t: 'melee', kind });
  renderMeleeChoice();
  toast(kind === 'grenade' ? '💣 Граната вместо ножа — со следующей жизни' : '🔪 Нож вместо гранаты — со следующей жизни');
  updateHud();
}

function renderMeleeChoice(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.melee button')) {
    b.classList.toggle('active', b.dataset.melee === settings.melee);
  }
}

function setKit(kit: WeaponId[]): void {
  settings.kit = kit;
  applySettings();
  saveActiveClass();
  sendMsg({ t: 'kit', guns: kit });
  if (GUNS.includes(me.weapon) && !kit.includes(me.weapon)) setWeapon(kit[0]!);
  renderKit();
  updateHud();
}

/** Кнопки выбора: отмечено не больше двух; третий выбор вытесняет самый первый. */
function renderKit(): void {
  for (const root of document.querySelectorAll<HTMLElement>('.kit')) {
    if (!root.childElementCount) {
      for (const w of GUNS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.w = w;
        b.textContent = WEAPONS[w].name;
        b.addEventListener('click', () => {
          const kit = settings.kit.filter((k) => k !== w);
          if (kit.length === settings.kit.length) kit.push(w);   // добавить
          if (kit.length > KIT_SIZE) kit.shift();                 // вытеснить самый старый
          if (kit.length) setKit(kit);
        });
        root.append(b);
      }
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('button')) {
      b.classList.toggle('active', settings.kit.includes(b.dataset.w as WeaponId));
    }
  }
}

interface PlayerClass { name: string; kit: WeaponId[]; melee: MeleeKind }

const CLASSES_KEY = 'doc-classes';

const MAX_CLASSES = 10;

function loadClasses(): { list: PlayerClass[]; active: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(CLASSES_KEY) ?? 'null') as { list?: unknown; active?: unknown } | null;
    if (raw && Array.isArray(raw.list)) {
      const list = raw.list.flatMap((c: unknown): PlayerClass[] => {
        const o = c as Partial<PlayerClass> | null;
        if (!o || typeof o.name !== 'string' || !isKit(o.kit)) return [];
        return [{ name: o.name.slice(0, 16) || 'Класс', kit: o.kit, melee: o.melee === 'grenade' ? 'grenade' : 'knife' }];
      }).slice(0, MAX_CLASSES);
      if (list.length) {
        const a = Number(raw.active);
        return { list, active: Number.isInteger(a) && a >= 0 && a < list.length ? a : 0 };
      }
    }
  } catch { /* испорченные классы — берём стандартные */ }
  // Первый запуск: текущий набор становится первым классом, плюс пара готовых шаблонов
  return {
    list: [
      { name: 'Штурмовик', kit: [...settings.kit], melee: settings.melee },
      { name: 'Снайпер', kit: ['sniper', 'smg'], melee: 'knife' },
      { name: 'Ближний бой', kit: ['shotgun', 'pistol'], melee: 'grenade' },
    ],
    active: 0,
  };
}

const classes = loadClasses();

function storeClasses(): void {
  try { localStorage.setItem(CLASSES_KEY, JSON.stringify(classes)); } catch { /* хранилище недоступно */ }
}

/** Набор поменяли — записываем его в выбранный класс. */
function saveActiveClass(): void {
  const c = classes.list[classes.active];
  if (!c) return;
  c.kit = [...settings.kit];
  c.melee = settings.melee;
  storeClasses();
  if (pauseView === 'classes') renderClasses();
}

function selectClass(i: number): void {
  const c = classes.list[i];
  if (!c) return;
  classes.active = i;
  storeClasses();
  setKit([...c.kit]);
  setMelee(c.melee);
  renderClasses();
}

export function renderClasses(): void {
  const list = $('class-list');
  list.textContent = '';
  classes.list.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'class-tile' + (i === classes.active ? ' active' : '');
    b.append(
      textEl('span', c.name, 'cname'),
      textEl('small', c.kit.map((w) => WEAPONS[w].name).join(' + ')),
      textEl('small', c.melee === 'grenade' ? '💣 Граната' : '🔪 Нож'),
    );
    if (i === classes.active) b.append(textEl('span', '✓', 'check'));
    b.addEventListener('click', () => selectClass(i));
    list.append(b);
  });
  if (classes.list.length < MAX_CLASSES) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'class-tile add';
    add.append(textEl('span', '+', 'plus'), textEl('small', `Новый класс (${classes.list.length}/${MAX_CLASSES})`));
    add.addEventListener('click', () => {
      // Новый класс — копия выбранного, его сразу можно переименовать и поменять
      const base = classes.list[classes.active]!;
      classes.list.push({ name: `Класс ${classes.list.length + 1}`, kit: [...base.kit], melee: base.melee });
      selectClass(classes.list.length - 1);
      $<HTMLInputElement>('class-name').select();
    });
    list.append(add);
  }
  const c = classes.list[classes.active]!;
  const input = $<HTMLInputElement>('class-name');
  if (document.activeElement !== input) input.value = c.name;
  const del = $<HTMLButtonElement>('class-delete');
  del.disabled = classes.list.length <= 1;
  del.title = del.disabled ? 'Последний класс удалить нельзя' : '';
  $('tile-class').textContent = c.name;
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initClasses(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.melee button')) {
    b.addEventListener('click', () => setMelee(b.dataset.melee === 'grenade' ? 'grenade' : 'knife'));
  }
  renderMeleeChoice();
  renderKit();
  {
    // Набор в игре — всегда набор выбранного класса
    const c = classes.list[classes.active]!;
    settings.kit = [...c.kit];
    settings.melee = c.melee;
    applySettings();
    renderKit();
    renderMeleeChoice();
  }
  $('class-name').addEventListener('input', () => {
    const c = classes.list[classes.active]!;
    c.name = $<HTMLInputElement>('class-name').value.slice(0, 16);
    storeClasses();
    renderClasses();
  });
  $('class-name').addEventListener('blur', () => {
    const c = classes.list[classes.active]!;
    if (!c.name.trim()) { c.name = `Класс ${classes.active + 1}`; storeClasses(); renderClasses(); }
  });
  $('class-delete').addEventListener('click', () => {
    if (classes.list.length <= 1) return;
    classes.list.splice(classes.active, 1);
    selectClass(Math.min(classes.active, classes.list.length - 1));
  });
  renderClasses();
  renderProfileTile();
}
