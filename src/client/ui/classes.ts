// Классы — шаблоны снаряжения: стволы, нож или граната; выбор и правка в меню Esc.
import type { MeleeKind, WeaponId } from '../../shared/protocol.js';
import { fitGear, fitKit, GEAR, GEAR_ORDER, GUN_TYPES, GUNS, isGear, isKit, KIT_SIZE, WEAPONS } from '../../shared/map.js';
import { isUnlocked, UNLOCK_LEVEL, unlockLevel } from '../../shared/ranks.js';
import { sendMsg } from '../core/net.js';
import { settings } from '../core/settings.js';
import { me } from '../core/state.js';
import { $, textEl } from '../core/util.js';
import { toast, updateHud } from './hud.js';
import { renderHome, view } from './shell.js';
import { knownKills } from './ranks.js';
import { applySettings } from './settings-menu.js';
import { setWeapon } from '../weapons/viewmodel.js';

function setMelee(kind: MeleeKind): void {
  if (settings.melee === kind) return;
  settings.melee = kind;
  applySettings();
  saveActiveClass();
  sendMsg({ t: 'melee', kind });
  renderMeleeChoice();
  toast(`${GEAR[kind].icon} ${GEAR[kind].name} в слоте 1 — со следующей жизни`);
  updateHud();
}

/** Кнопка закрытого оружия или снаряжения: не нажимается и подписана уровнем, с которого откроется. */
function markLock(b: HTMLButtonElement, id: string, title: string): void {
  const open = isUnlocked(id, knownKills);
  b.disabled = !open;
  b.classList.toggle('locked', !open);
  b.textContent = open ? title : `🔒 ${title} · ур. ${unlockLevel(id)}`;
}

function renderMeleeChoice(): void {
  for (const root of document.querySelectorAll<HTMLElement>('.melee')) {
    if (!root.childElementCount) {
      for (const g of GEAR_ORDER) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.melee = g;
        b.addEventListener('click', () => setMelee(g));
        root.append(b);
      }
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('button')) {
      const g = b.dataset.melee as MeleeKind;
      markLock(b, g, `${GEAR[g].icon} ${GEAR[g].name}`);
      b.classList.toggle('active', g === settings.melee);
    }
  }
  $('gear-hint').textContent = `${GEAR[settings.melee].hint}. Кроме ножа, всё — одна штука на жизнь; выбор действует со следующей жизни.`;
}

/**
 * Уровень изменился или класс собран на другом уровне: закрытые стволы и снаряжение
 * заменяются доступными, а кнопки показывают, что и с какого уровня открывается.
 */
export function enforceUnlocks(): void {
  const kit = fitKit(settings.kit, knownKills);
  if (kit.length !== settings.kit.length || kit.some((w, i) => w !== settings.kit[i])) setKit(kit);
  if (fitGear(settings.melee, knownKills) !== settings.melee) setMelee('knife');
  renderKit();
  renderMeleeChoice();
  const next = Object.entries(UNLOCK_LEVEL).filter(([id]) => !isUnlocked(id, knownKills)).sort((a, b) => a[1] - b[1])[0];
  $('unlock-note').textContent = next ? `— следующее открытие на ${next[1]} уровне` : '';
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
      // Стволы разложены по типам: пистолеты, пистолеты-пулемёты, дробовики, автоматы, пулемёты, снайперские винтовки
      for (const type of GUN_TYPES) {
        const group = document.createElement('div');
        group.className = 'gun-type';
        const row = document.createElement('div');
        row.className = 'choice';
        for (const w of GUNS.filter((g) => WEAPONS[g].type === type.id)) {
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.w = w;
          b.addEventListener('click', () => {
            const kit = settings.kit.filter((k) => k !== w);
            if (kit.length === settings.kit.length) kit.push(w);   // добавить
            if (kit.length > KIT_SIZE) kit.shift();                 // вытеснить самый старый
            if (kit.length) setKit(kit);
          });
          row.append(b);
        }
        group.append(textEl('small', type.name), row);
        root.append(group);
      }
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('button')) {
      const w = b.dataset.w as WeaponId;
      markLock(b, w, WEAPONS[w].name);
      b.classList.toggle('active', settings.kit.includes(w));
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
        return [{ name: o.name.slice(0, 16) || 'Класс', kit: o.kit, melee: isGear(o.melee) ? o.melee : 'knife' }];
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
  if (view === 'classes') renderClasses();
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
      textEl('small', `${GEAR[c.melee].icon} ${GEAR[c.melee].name}`),
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
  $('nav-class-name').textContent = c.name;
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initClasses(): void {
  renderMeleeChoice();
  renderKit();
  {
    // Набор в игре — всегда набор выбранного класса
    const c = classes.list[classes.active]!;
    settings.kit = [...c.kit];
    settings.melee = c.melee;
    // Класс мог быть собран на более высоком уровне (другой прогресс) — закрытое заменяем доступным
    settings.kit = fitKit(settings.kit, knownKills);
    settings.melee = fitGear(settings.melee, knownKills);
    applySettings();
    enforceUnlocks();
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
  renderHome();
}
