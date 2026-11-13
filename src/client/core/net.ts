// Сеть: соединение с сервером и разбор всех его сообщений.
import * as THREE from 'three';
import type { ClientMsg, KillMsg, KillWeapon, OverMsg, PlayerInfo, PlayersMsg, ServerMsg, ShotMsg, SnapMsg, SpawnMsg, WeaponId } from '../../shared/protocol.js';
import { AMMO_PACK, PLAYER, STREAK, WEAPON_ORDER, WEAPONS, REWARD_NAMES } from '../../shared/map.js';
import { beep, shotSound } from './audio.js';
import { scene } from './scene.js';
import { settings } from './settings.js';
import { me, remotes, state } from './state.js';
import { $ } from './util.js';
import { spawnCorpse } from '../fx/corpses.js';
import { onSpray } from '../fx/sprays.js';
import { addTracer } from '../fx/tracers.js';
import { onAmmoPacks } from '../pickups/ammo.js';
import { onCrate } from '../pickups/crate.js';
import { onMedkits } from '../pickups/medkits.js';
import { muzzleWorld } from '../render/models.js';
import { applyLook, buildPlayer, dropHelmet, leaderId, placeCrown, setRemoteWeapon } from '../render/players.js';
import { gunner, gunshipFx, onGunship, onGunshipEnd } from '../streaks/gunship.js';
import { endMissile, onMissile, startMissile } from '../streaks/missile.js';
import { onNuke } from '../streaks/nuke.js';
import { onPing } from '../streaks/uav.js';
import { onLoadout, weaponSlots } from '../ui/hotbar.js';
import { feedNote, flashDamage, onChat, showHit, toast, updateHud } from '../ui/hud.js';
import { onNewMap, onVote } from '../ui/match.js';
import { unlock } from './input.js';
import { onLobby } from '../ui/menu.js';
import { enterGame, leaveGame, renderHome, view } from '../ui/shell.js';
import { onProfile, showPromotion } from '../ui/ranks.js';
import { onGrenades } from '../weapons/grenade.js';
import { onBlind, onFlash, onMines } from '../weapons/mines.js';
import { onThrow, onThrown } from '../weapons/knife.js';
import { onBoom, onRocket } from '../weapons/rockets.js';
import { setWeapon } from '../weapons/viewmodel.js';
import { loadMap, onBreaks, openDoors, rebuildSolids } from '../world/map.js';
import { applyFog, onWeather } from '../world/weather.js';

const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);

export function sendMsg(m: ClientMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

export const playBtn = $<HTMLButtonElement>('play');

function onPlayers(m: PlayersMsg): void {
  state.mode = m.mode; state.limit = m.limit; state.scores = m.scores; state.roster = m.list;
  if (view === 'home' && !$('menu').classList.contains('hidden')) renderHome();
  if (m.left > 0) state.matchEndsAt = performance.now() + m.left;
  const seen = new Set<number>();
  for (const p of state.roster) {
    if (p.id === me.id) {
      if ((p.hp < me.hp || p.armor < me.armor) && p.alive) flashDamage();
      if (p.alive && me.alive) {
        if (p.armor > me.armor) { toast('🛡 Броня +100'); beep(880, 0.2, 0.1); }
        if (p.hp > me.hp) { toast(`❤ Аптечка +${p.hp - me.hp} HP`); beep(660, 0.2, 0.1); }
      }
      me.hp = p.hp;
      me.armor = p.armor;
      me.big = p.big;
      me.team = p.team;
      if (me.alive && !p.alive) state.respawnAt = performance.now() + 3000;
      me.alive = p.alive;
      continue;
    }
    seen.add(p.id);
    let r = remotes.get(p.id);
    if (!r) { r = buildPlayer(p); remotes.set(p.id, r); }
    r.info = p;
    r.g.visible = p.alive;
    // Шлем сбили — он слетает с головы
    if (r.helmet.visible && p.helmet === 0 && p.alive) dropHelmet(r);
    applyLook(r);
    placeCrown(r); // корона — поверх шлема
    r.g.scale.setScalar(p.big ? STREAK.bigScale : 1); // Джаггернаут чуть крупнее
  }
  for (const [id, r] of remotes) {
    if (!seen.has(id)) { scene.remove(r.g); remotes.delete(id); }
  }
  const leader = leaderId();
  for (const [id, r] of remotes) {
    r.crown.visible = id === leader;
    r.labelY = PLAYER.h + (id === leader ? 0.7 : 0.35); // имя — над короной
  }
  $('crown-note').classList.toggle('hidden', leader !== me.id);
  updateHud();
}

function onSpawn(m: SpawnMsg): void {
  if (m.id === me.id) {
    me.pos.set(m.p[0], m.p[1], m.p[2]);
    me.vel.set(0, 0, 0);
    me.yaw = m.yaw;
    me.pitch = 0;
    me.alive = true;
    me.hp = 100;
    for (const w of WEAPON_ORDER) { me.ammo[w] = WEAPONS[w].mag; me.reserve[w] = WEAPONS[w].reserve; }
    if (me.ammo.rocket === 0 && me.weapon === 'rocket') setWeapon('pistol');
    me.reloadUntil = 0;
    state.low = false;
    state.crouch = false;
    state.stance = 0;
    state.slideUntil = 0;
    if (!state.roundOver) $('center-msg').textContent = '';
    updateHud();
    return;
  }
  const r = remotes.get(m.id);
  if (r) {
    r.pos.set(m.p[0], m.p[1], m.p[2]);
    r.target.copy(r.pos);
    r.yaw = r.targetYaw = m.yaw;
  }
}

function onSnap(m: SnapMsg): void {
  for (const [id, x, y, z, yaw, pitch, w, sl, air, rl, cr] of m.ps) {
    const r = remotes.get(id);
    if (!r) continue;
    r.slide = sl === 1;
    r.crouch = cr === 1;
    r.air = air === 1;
    r.reloading = rl === 1;
    r.target.set(x, y, z);
    r.targetYaw = yaw;
    r.pitch = pitch;
    setRemoteWeapon(r, w);
  }
}

function onShot(m: ShotMsg): void {
  const r = remotes.get(m.id);
  if (!r) return;
  setRemoteWeapon(r, m.w);
  if (!WEAPONS[m.w].melee) r.flashUntil = performance.now() + 50;
  const from = muzzleWorld(r.gun);
  for (const e of m.ends) addTracer(from, new THREE.Vector3(e[0], e[1], e[2]));
  const dist = r.pos.distanceTo(me.pos);
  shotSound(m.w, Math.max(0, 1 - dist / 70) * 0.8);
}

function onKill(m: KillMsg): void {
  const k = state.roster.find((p) => p.id === m.killer);
  const v = state.roster.find((p) => p.id === m.victim);
  if (!v) return;
  // Тело падает по физике: его толкает в сторону от убийцы, взрыв — ещё и подбрасывает
  {
    const r = m.victim === me.id ? null : remotes.get(m.victim);
    const at = m.victim === me.id ? me.pos : r?.pos;
    if (at) {
      const from = m.killer === me.id ? me.pos : m.killer !== null ? remotes.get(m.killer)?.pos : undefined;
      const blast = m.w === 'rocket' || m.w === 'grenade' || m.w === 'mine' || m.w === 'missile' || m.w === 'nuke' || m.w === 'crate' || m.w === 'gunship';
      const impulse = new THREE.Vector3();
      if (from && from !== at) impulse.subVectors(at, from).setY(0).normalize().multiplyScalar(blast ? 6 : m.w === 'shotgun' || m.w === 'sniper' ? 4.5 : 2.5);
      if (blast) impulse.y = 5.5;
      spawnCorpse({
        pos: at, yaw: r ? r.yaw : me.yaw, team: v.team, lying: r ? r.slide : state.low,
        scale: (r ? r.info.big : me.big) ? STREAK.bigScale : 1,
        grey: r ? r.info.big : me.big, vest: r ? r.info.armor > 0 && !r.info.big : me.armor > 0 && !me.big,
        char: r?.char ?? null, vel: r ? r.vel.clone() : me.vel.clone(), impulse,
      });
    }
  }
  if (!k || m.killer === null) {
    // Без убийцы: ящик-ловушка или бомба (для себя и своих)
    const trap = document.createElement('div');
    const name = document.createElement('span');
    name.className = 't-' + v.team;
    name.textContent = v.name;
    trap.append(m.w === 'nuke' ? '☢ Бомба ▸ ' : '💥 Ящик ▸ ', name);
    $('feed').prepend(trap);
    setTimeout(() => trap.remove(), 5000);
    if (m.victim === me.id) {
      $('center-msg').textContent = `${m.w === 'nuke' ? 'Бомба!' : 'Ящик взорвался!'}\nВозрождение через 3 сек.`;
    }
    return;
  }
  const row = document.createElement('div');
  const span = (p: PlayerInfo): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = 't-' + p.team;
    s.textContent = p.name;
    return s;
  };
  row.append(span(k), ` ▸ ${weaponName(m.w)}${m.head ? ' 🎯' : ''} ▸ `, span(v));
  $('feed').prepend(row);
  setTimeout(() => row.remove(), 5000);
  const self = m.killer === m.victim;
  if (m.killer === me.id && !self) { showHit(true); beep(880, 0.15); }
  if (m.victim === me.id) {
    $('center-msg').textContent = self
      ? `Ты подорвался: ${weaponName(m.w)}\nВозрождение через 3 сек.`
      : `Тебя убил ${k.name}\nВозрождение через 3 сек.`;
  }
}

function weaponName(w: KillWeapon): string {
  const extra: Record<string, string> = {
    crate: 'Ящик', throw: 'Метательный нож', missile: 'Ракета с неба', nuke: 'Бомба', gunship: 'Самолёт', mine: 'Мина',
  };
  return extra[w] ?? WEAPONS[w as WeaponId].name;
}

export let overText = '';

function onOver(m: OverMsg): void {
  state.roundOver = true;
  if (m.winner.draw) overText = 'Ничья';
  else if (m.winner.team) overText = m.winner.team === 'green' ? 'Победили ЗЕЛЁНЫЕ' : 'Победили КРАСНЫЕ';
  else overText = `Победил ${m.winner.name ?? ''}`;
  $('center-msg').textContent = '';
  endMissile();
}

/** Запуск модуля: подписки на события и начальная отрисовка (вызывается из main.ts). */
export function initNet(): void {
  ws.addEventListener('close', () => {
    $('status').textContent = 'Соединение с сервером потеряно. Обнови страницу.';
    playBtn.disabled = true;
    if (state.joined) {
      unlock();
      leaveGame();
    }
  });
  ws.addEventListener('message', (e: MessageEvent<string>) => {
    const m = JSON.parse(e.data) as ServerMsg;
    switch (m.t) {
      case 'lobby': onLobby(m); break;
      case 'chat': onChat(m.kind, m.name, m.team); break;
      case 'error': $('status').textContent = m.text; playBtn.disabled = false; break;
      case 'welcome':
        me.id = m.id;
        state.mode = m.mode;
        loadMap(m.map);
        applyFog();
        setWeapon(settings.kit[0]!);
        enterGame(); // сразу в бой, без паузы
        break;
      case 'players': onPlayers(m); break;
      case 'spawn': onSpawn(m); break;
      case 'snap': onSnap(m); break;
      case 'shot': onShot(m); break;
      case 'kill': onKill(m); break;
      case 'over': onOver(m); break;
      case 'profile': onProfile(m); break;
      case 'crate': onCrate(m); break;
      case 'rocket': onRocket(m); break;
      case 'boom': onBoom(m); break;
      case 'spray': onSpray(m); break;
      case 'medkits': onMedkits(m); break;
      case 'loadout': onLoadout(m); break;
      case 'ammopacks': onAmmoPacks(m); break;
      case 'grenades': onGrenades(m); break;
      case 'mines': onMines(m.list); break;
      case 'flash': onFlash(m.p); break;
      case 'blind': onBlind(m.ms); break;
      case 'breaks': onBreaks(m.broken); break;
      case 'doors': {
        const was = new Set(openDoors);
        openDoors.clear();
        for (const id of m.open) openDoors.add(id);
        if ([...openDoors].some((id) => !was.has(id)) || [...was].some((id) => !openDoors.has(id))) beep(240, 0.12, 0.06);
        rebuildSolids();
        break;
      }
      case 'weather': onWeather(m); break;
      case 'helmet': {
        // Попадание в шлем: стрелку — «звон» металла и маркер, всем — сообщение, когда шлем слетел
        if (m.by === me.id) { showHit(false); beep(2400, 0.08, 0.1); beep(3100, 0.06, 0.06); }
        if (m.id === me.id) beep(1800, 0.1, 0.12);
        if (m.left === 0) {
          const who = m.id === me.id ? 'С тебя' : `С ${state.roster.find((p) => p.id === m.id)?.name ?? 'Джаггернаута'}`;
          feedNote(`🪖 ${who} сбит шлем`);
        } else if (m.by === me.id) toast(`🪖 Шлем держит: ещё ${m.left} попад.`);
        break;
      }
      case 'promoted': {
        showPromotion(m.rank);
        beep(660, 0.18, 0.1);
        setTimeout(() => beep(990, 0.4, 0.12), 160);
        break;
      }
      case 'ammo': {
        // Патроны с погибшего: к своим стволам — половина полного запаса
        for (const w of settings.kit) {
          // Всего патронов не больше полного запаса (магазин + запас); у пулемёта это его лента на 100
          const full = WEAPONS[w].mag + WEAPONS[w].reserve;
          me.reserve[w] = Math.min(full - me.ammo[w], me.reserve[w] + Math.ceil(full * AMMO_PACK.share));
        }
        toast('🎒 Патроны +50%');
        beep(760, 0.15, 0.1);
        updateHud();
        break;
      }
      case 'throw': onThrow(m); break;
      case 'thrown': onThrown(m); break;
      case 'uav':
        state.uavUntil = performance.now() + m.ms;
        toast('📡 БПЛА в воздухе: противники видны на карте');
        break;
      case 'ping': onPing(m); break;
      case 'missile-go': startMissile(m.id, m.p); break;
      case 'missile': onMissile(m); break;
      case 'nuke': onNuke(m); break;
      case 'gunship': onGunship(m); break;
      case 'gunship-end': onGunshipEnd(m.id, m.by, m.p); break;
      case 'gunship-hit':
        if (gunshipFx?.id === m.id) {
          feedNote(`✈ Попадание в самолёт! Осталось ${m.left}`);
          if (gunner) beep(300, 0.3, 0.15);
        }
        break;
      case 'gsshot': {
        if (!gunshipFx || gunshipFx.id !== m.id) break;
        const from = gunshipFx.mesh.position.clone();
        for (const e of m.ends) addTracer(from, new THREE.Vector3(e[0], e[1], e[2]));
        shotSound('lmg', 0.5);
        break;
      }
      case 'vote': onVote(m); break;
      case 'newmap': onNewMap(m.map); break;
      case 'reward': toast(`📦 В ящике: ${REWARD_NAMES[m.kind]}`); beep(1200, 0.3, 0.12); break;
      case 'rockets': {
        me.ammo.rocket = m.n;
        // Ракетница — снаряжение на G: в руки сама не прыгает; кончились ракеты — в руках снова ствол
        if (m.n === 0 && me.weapon === 'rocket') setWeapon(weaponSlots()[1] ?? weaponSlots()[0] ?? 'pistol');
        updateHud();
        break;
      }
      case 'reset':
        state.roundOver = false;
        $('center-msg').textContent = '';
        break;
    }
  });
}
