// js/battle-ui.js — battle menu, link (host/join) screen, battle screen DOM.
// Owner: Agent B. Builds its DOM dynamically inside the existing empty shells
// #screen-battle and #screen-link (Agent A owns index.html/css/style.css/
// main.js and creates those shells). Injects one small <style> block for
// battle-specific CSS (prefixed `bui-` to avoid clashing with Agent A's CSS).
//
// Integration: Agent A's js/game.js exposes `window.SlimeGame` glue built
// specifically for this file (getPet, snapshot, canBattle, payBattleCost,
// grantBattleResult, showScreen, toast, refresh, renderPet). We prefer that
// glue when present (it already handles save()/refresh() and the real
// pet.care sub-object correctly) and fall back to calling pet.js directly /
// a standalone demo pet + local screen toggling when it's missing, so this
// screen still works in isolation (e.g. before game.js existed, or in tests).

import { createBattle, legalActions, applyTurn } from './battle.js';
import { generateWildOpponent, pickAction, randomGenome } from './battle-ai.js';
import { createHost, createGuest, renderQR, startScanner } from './net.js';
import { renderPet } from './render.js';
import { battleSnapshot, grantBattleXp } from './pet.js';
import { listRivals, saveRival, recordResult, removeRival, ensureSeeded } from './rivals.js';
import { t, onLangChange } from './i18n.js';

// Re-render hook for the CURRENT battle-area view, so a live language switch
// rebuilds its labels. Each top-level view sets this to a closure that redraws
// itself; a language change re-invokes it while the battle screen is showing.
let currentRerender = null;
onLangChange(() => {
  const scr = document.getElementById('screen-battle');
  if (scr && scr.classList.contains('active') && typeof currentRerender === 'function') {
    try { currentRerender(); } catch (err) { console.error('[battle-ui] lang re-render failed', err); }
  }
});

// ---- small shared utilities -------------------------------------------------

function qs(id) {
  return document.getElementById(id);
}

/**
 * Fallback screen switcher used only if window.SlimeGame.showScreen isn't
 * available. Mirrors game.js's own router (`.screen` + `.active` class) but
 * also forces inline display so it degrades gracefully even without Agent
 * A's CSS rules for `.screen.active`.
 */
function fallbackShowScreen(id) {
  document.querySelectorAll('[id^="screen-"]').forEach((el) => {
    const isTarget = el.id === id;
    el.style.display = isTarget ? '' : 'none';
    el.classList.toggle('active', isTarget);
  });
}

/** goToScreen('battle'|'link') — routes through game.js's router when available. */
function goToScreen(name) {
  if (window.SlimeGame && typeof window.SlimeGame.showScreen === 'function') {
    try { window.SlimeGame.showScreen(name); return; } catch (err) { console.error('[battle-ui] SlimeGame.showScreen failed', err); }
  }
  fallbackShowScreen(`screen-${name}`);
}

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'battle-ui-styles';
  style.textContent = `
    .bui-menu { display:flex; flex-direction:column; gap:12px; padding:20px; align-items:stretch; }
    .bui-menu h2 { text-align:center; margin:0 0 8px; }
    .bui-btn { font-size:1.05rem; padding:14px 18px; border-radius:16px; border:none;
      background:hsl(280 70% 85%); color:#402a55; font-weight:600; cursor:pointer; }
    .bui-btn:active { transform: scale(0.97); }
    .bui-btn:disabled { opacity:0.5; cursor:default; }
    .bui-btn-secondary { background:hsl(200 60% 88%); }
    .bui-link { display:flex; flex-direction:column; gap:14px; padding:20px; align-items:center; text-align:center; }
    .bui-qr-box { background:#fff; padding:10px; border-radius:12px; display:inline-block; }
    .bui-id-text { font-family:monospace; font-size:1rem; background:hsl(0 0% 95%); padding:8px 12px;
      border-radius:8px; word-break:break-all; user-select:all; }
    .bui-video { width:100%; max-width:320px; border-radius:12px; background:#000; }
    .bui-input { font-size:1rem; padding:10px 12px; border-radius:10px; border:1px solid hsl(0 0% 80%); width:80%; max-width:280px; }
    .bui-error { color:#b0304a; font-weight:600; }
    .bui-battle { display:flex; flex-direction:column; gap:10px; padding:14px; height:100%; box-sizing:border-box; }
    .bui-arena { display:flex; justify-content:space-between; gap:10px; }
    .bui-panel { flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; position:relative; }
    .bui-panel svg { width:100%; max-width:140px; aspect-ratio:1; transition: transform 0.15s ease; }
    .bui-panel.bui-shake svg { animation: bui-shake 0.4s; }
    .bui-panel.bui-guardflash { box-shadow: 0 0 0 4px hsl(200 80% 70%) inset; border-radius:16px; }
    .bui-panel.bui-faint svg { opacity:0.25; filter:grayscale(1); }
    .bui-name { font-weight:700; }
    .bui-hpwrap { width:100%; background:hsl(0 0% 88%); border-radius:8px; overflow:hidden; height:14px; }
    .bui-hpbar { height:100%; background:hsl(140 60% 55%); transition: width 0.35s ease; }
    .bui-hpbar.bui-low { background:hsl(45 90% 55%); }
    .bui-hpbar.bui-crit { background:hsl(0 80% 55%); }
    .bui-hptext { font-size:0.8rem; }
    .bui-float { position:absolute; top:20%; left:50%; transform:translateX(-50%);
      font-weight:800; color:#b0304a; pointer-events:none; animation: bui-float 0.8s ease-out forwards; }
    .bui-float.bui-crit { color:#ff7a00; font-size:1.2em; }
    .bui-float.bui-eff-super { color:#c0392b; }
    .bui-float.bui-eff-weak { color:#7a7a7a; }
    .bui-efftext { position:absolute; top:8%; left:50%; transform:translateX(-50%);
      font-weight:700; font-size:0.78rem; white-space:nowrap; pointer-events:none;
      animation: bui-float 1s ease-out forwards; }
    .bui-efftext-super { color:#c0392b; }
    .bui-efftext-weak { color:#7a7a7a; }
    .bui-actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .bui-log { flex:1; overflow-y:auto; background:hsl(0 0% 97%); border-radius:10px; padding:8px 10px;
      font-size:0.85rem; display:flex; flex-direction:column; gap:2px; min-height:60px; max-height:120px; }
    .bui-result { display:flex; flex-direction:column; gap:14px; align-items:center; padding:30px 20px; text-align:center; }
    .bui-result h2 { margin:0; }
    .bui-rivals { display:flex; flex-direction:column; gap:10px; }
    .bui-rival-row { display:flex; align-items:center; gap:10px; background:hsl(280 40% 96%);
      border-radius:16px; padding:8px 10px; }
    .bui-rival-thumb { width:56px; height:56px; flex:0 0 auto; }
    .bui-rival-info { flex:1; display:flex; flex-direction:column; gap:2px; min-width:0; text-align:left; }
    .bui-rival-name { font-weight:700; color:#402a55; }
    .bui-rival-sub { font-size:0.8rem; color:#7a6a8a; }
    .bui-rival-actions { display:flex; flex-direction:column; gap:6px; align-items:stretch; }
    .bui-rival-actions .bui-btn { padding:8px 14px; font-size:0.9rem; }
    .bui-rival-empty { text-align:center; color:#7a6a8a; padding:10px 0; }
    @keyframes bui-shake { 0%,100%{transform:translateX(0);} 20%{transform:translateX(-6px);} 40%{transform:translateX(6px);} 60%{transform:translateX(-4px);} 80%{transform:translateX(4px);} }
    @keyframes bui-float { 0%{opacity:1; transform:translate(-50%,0);} 100%{opacity:0; transform:translate(-50%,-30px);} }
  `;
  document.head.appendChild(style);
}

/** uiToast(msg) — routes through game.js's toast when present, else alert-free no-op console. */
function uiToast(msg) {
  if (window.SlimeGame && typeof window.SlimeGame.toast === 'function') {
    try { window.SlimeGame.toast(msg); return; } catch (err) { /* fall through */ }
  }
  console.log('[battle-ui]', msg);
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---- v4 typed-move action buttons -------------------------------------------
// legalActions(state, side) now returns the player's known move ids + 'guard'
// + 'special' (no more 'charge' — see DESIGN_v4.md §3). We label move-id
// buttons by looking the id up in the player's OWN snapshot.moves (the engine
// guarantees this array for the player; back-compat opponents/old engines may
// not have it, so every lookup here is defensive).
const ELEMENT_ICON = {
  none: '⚪', water: '💧', fire: '🔥', grass: '🌿', earth: '⛰️',
  lightning: '⚡', dark: '🌑', light: '✨',
};

/** actionLabel(actionId, snap) -> button label for a legalActions() entry. */
function actionLabel(actionId, snap) {
  if (actionId === 'guard') return t('battle.guard');
  if (actionId === 'special') return t('battle.special');
  const moves = snap && Array.isArray(snap.moves) ? snap.moves : null;
  const mv = moves ? moves.find((m) => m && m.id === actionId) : null;
  if (mv) {
    const icon = ELEMENT_ICON[mv.element] || ELEMENT_ICON.none;
    // Move proper-names (Ember, Bubble, …) stay in English for now.
    return `${icon} ${mv.name || actionId}`;
  }
  // Back-compat: pre-v4 engine (no moves metadata yet) or an id we don't
  // recognize — fall back to a readable label derived from the id itself.
  if (actionId === 'attack') return `${ELEMENT_ICON.none} ${t('battle.attack')}`;
  if (actionId === 'charge') return `⚡ ${t('battle.charge')}`; // legacy action, engine is retiring it
  return actionId ? actionId.charAt(0).toUpperCase() + actionId.slice(1) : String(actionId);
}

// ---- "my" snapshot (real pet if available, else a standalone demo pet) ----

function demoSnapshot() {
  const rng = (() => {
    let a = (Date.now() ^ 0x2545F491) >>> 0;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const genome = randomGenome(rng);
  return {
    name: 'You',
    genome,
    stage: 'teen',
    level: 5,
    stats: { hp: 55, str: 12, spd: 11, def: 10, crit: 7 },
  };
}

function getMySnapshot() {
  // Preferred path: game.js's own glue (already calls battleSnapshot(state.pet)
  // internally, so it stays correct even if pet.js's internal pet shape shifts).
  if (window.SlimeGame && typeof window.SlimeGame.snapshot === 'function') {
    try {
      const snap = window.SlimeGame.snapshot();
      if (snap) return snap;
    } catch (err) {
      console.error('[battle-ui] SlimeGame.snapshot() failed, falling back', err);
    }
  }
  // Fallback: call pet.js directly if we at least have a pet reference.
  const pet = window.SlimeGame?.getPet ? window.SlimeGame.getPet() : window.SlimeGame?.pet;
  if (pet) {
    try {
      const snap = battleSnapshot(pet);
      if (snap) return snap;
    } catch (err) {
      console.error('[battle-ui] battleSnapshot(pet) failed, using demo pet', err);
    }
  }
  return demoSnapshot();
}

/**
 * canStartBattle() — gates entry into any battle flow. Prefers game.js's
 * canBattle() (stamina >= 25 and not an egg); if the glue isn't present we
 * don't have enough information to refuse, so we allow it (demo/offline use).
 */
function canStartBattle() {
  if (window.SlimeGame && typeof window.SlimeGame.canBattle === 'function') {
    try {
      if (!window.SlimeGame.canBattle()) {
        if (typeof window.SlimeGame.toast === 'function') window.SlimeGame.toast(t('battle.tooTired'));
        else alert(t('battle.tooTired'));
        return false;
      }
    } catch (err) {
      console.error('[battle-ui] SlimeGame.canBattle() failed', err);
    }
  }
  return true;
}

/**
 * applyBattleRewardsAndCost(won, info) — pays the battle cost and grants
 * rewards. `info` = { remainingHp, kind:'wild'|'pvp', draw }. Returns
 * { leveledUp, coins } for the result screen.
 */
function applyBattleRewardsAndCost(won, info) {
  info = info || {};
  // Preferred path: game.js's own glue, which mutates the real pet fields
  // (stamina / care / hpCurrent / coins) and handles save()/refresh() itself.
  if (window.SlimeGame && (window.SlimeGame.payBattleCost || window.SlimeGame.grantBattleResult)) {
    let leveledUp = 0;
    let coins = 0;
    try {
      if (typeof window.SlimeGame.payBattleCost === 'function') window.SlimeGame.payBattleCost();
    } catch (err) {
      console.error('[battle-ui] SlimeGame.payBattleCost() failed', err);
    }
    try {
      if (typeof window.SlimeGame.grantBattleResult === 'function') {
        const res = window.SlimeGame.grantBattleResult(won, info) || {};
        // Back-compat: old glue returned a bare level count.
        if (typeof res === 'number') { leveledUp = res; }
        else { leveledUp = res.leveledUp || 0; coins = res.coins || 0; }
      }
    } catch (err) {
      console.error('[battle-ui] SlimeGame.grantBattleResult() failed', err);
    }
    return { leveledUp, coins };
  }

  // Fallback: no game.js glue available — talk to pet.js directly.
  const pet = window.SlimeGame?.getPet ? window.SlimeGame.getPet() : window.SlimeGame?.pet;
  if (!pet) return null;
  let leveledUp = 0;
  try {
    // grantBattleXp (js/pet.js) returns the number of levels gained.
    leveledUp = grantBattleXp(pet, won) || 0;
  } catch (err) {
    console.error('[battle-ui] grantBattleXp failed', err);
  }
  try {
    // Battle costs 25 stamina + some hunger (v2: no energy stat).
    if (typeof pet.stamina === 'number') pet.stamina = Math.max(0, pet.stamina - 25);
    if (pet.care && typeof pet.care.hunger === 'number') {
      pet.care.hunger = Math.max(0, pet.care.hunger - 8);
    }
  } catch (err) {
    console.error('[battle-ui] applying battle cost to pet failed', err);
  }
  return { leveledUp, coins: 0 };
}

// ---- menu -------------------------------------------------------------------

function renderMenu() {
  currentRerender = renderMenu;
  const root = qs('screen-battle');
  if (!root) return;
  root.innerHTML = '';
  const wrap = el('div', 'bui-menu');
  wrap.appendChild(el('h2', null, t('battle.title')));

  const wildBtn = el('button', 'bui-btn', t('battle.wild'));
  wildBtn.onclick = startWildBattle;

  const rivalsBtn = el('button', 'bui-btn', t('battle.rivals'));
  rivalsBtn.onclick = openRivals;

  const hostBtn = el('button', 'bui-btn bui-btn-secondary', t('battle.hostQr'));
  hostBtn.onclick = startHostFlow;

  const joinQrBtn = el('button', 'bui-btn bui-btn-secondary', t('battle.joinQr'));
  joinQrBtn.onclick = startJoinQrFlow;

  const joinCodeBtn = el('button', 'bui-btn bui-btn-secondary', t('battle.joinCode'));
  joinCodeBtn.onclick = startJoinCodeFlow;

  wrap.appendChild(wildBtn);
  wrap.appendChild(rivalsBtn);
  wrap.appendChild(hostBtn);
  wrap.appendChild(joinQrBtn);
  wrap.appendChild(joinCodeBtn);
  root.appendChild(wrap);
}

function startWildBattle() {
  if (!canStartBattle()) return;
  const mySnap = getMySnapshot();
  const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
  const oppSnap = generateWildOpponent(mySnap.level, (seed ^ 0xBEEF) >>> 0);
  runBattleScreen({ snapA: mySnap, snapB: oppSnap, mySide: 'A', mode: 'ai', engineSeed: seed });
}

// ---- rivals (async battles vs locally-stored pets, piloted by the AI) ------

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Roster screen inside #screen-battle: thumbnail, name, Lv, stage, W-L. */
function openRivals() {
  currentRerender = openRivals;
  ensureStyles();
  cleanupLinkScreen();
  goToScreen('battle');
  const root = qs('screen-battle');
  if (!root) return;
  root.innerHTML = '';

  const wrap = el('div', 'bui-menu');
  wrap.appendChild(el('h2', null, t('battle.rivals')));

  let list = [];
  try { list = listRivals(); } catch (err) { console.error('[battle-ui] listRivals failed', err); }

  if (!list.length) {
    wrap.appendChild(el('div', 'bui-rival-empty', t('battle.noRivals')));
  } else {
    const listWrap = el('div', 'bui-rivals');
    list.forEach((entry) => listWrap.appendChild(buildRivalRow(entry)));
    wrap.appendChild(listWrap);
  }

  const backBtn = el('button', 'bui-btn bui-btn-secondary', t('battle.back'));
  backBtn.onclick = openMenu;
  wrap.appendChild(backBtn);
  root.appendChild(wrap);
}

function buildRivalRow(entry) {
  const row = el('div', 'bui-rival-row');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.classList.add('bui-rival-thumb');
  try {
    renderPet(svg, entry.snap.genome, entry.snap.stage, {});
  } catch (err) {
    console.error('[battle-ui] renderPet (rival thumb) failed', err);
  }
  row.appendChild(svg);

  const info = el('div', 'bui-rival-info');
  info.appendChild(el('div', 'bui-rival-name', entry.name));
  info.appendChild(el('div', 'bui-rival-sub',
    t('battle.rivalSub', { level: entry.snap.level, stage: t('stage.' + entry.snap.stage) })));
  info.appendChild(el('div', 'bui-rival-sub',
    t('battle.rivalRecord', { wins: entry.wins || 0, losses: entry.losses || 0 })));
  row.appendChild(info);

  const actions = el('div', 'bui-rival-actions');
  const battleBtn = el('button', 'bui-btn', t('battle.battleBtn'));
  battleBtn.onclick = () => startRivalBattle(entry);
  actions.appendChild(battleBtn);
  if (entry.source === 'qr') {
    const delBtn = el('button', 'bui-btn bui-btn-secondary', '🗑');
    delBtn.title = t('battle.removeRival');
    delBtn.onclick = () => {
      try { removeRival(entry.id); } catch (err) { console.error('[battle-ui] removeRival failed', err); }
      openRivals();
    };
    actions.appendChild(delBtn);
  }
  row.appendChild(actions);
  return row;
}

function startRivalBattle(entry) {
  if (!canStartBattle()) return;
  const mySnap = getMySnapshot();
  const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
  // Same flow as a wild battle (side B = ghost, piloted by pickAction), but the
  // opponent is the rival's stored snapshot (hpCurrent honored by the engine).
  runBattleScreen({ snapA: mySnap, snapB: entry.snap, mySide: 'A', mode: 'ai', engineSeed: seed, rival: entry });
}

// ---- link screen (host / join) ---------------------------------------------

let activeScannerStop = null;

function cleanupLinkScreen() {
  if (activeScannerStop) {
    try { activeScannerStop(); } catch (e) { /* ignore */ }
    activeScannerStop = null;
  }
}

function renderLinkContainer() {
  const root = qs('screen-link');
  if (!root) return null;
  cleanupLinkScreen();
  root.innerHTML = '';
  goToScreen('link');
  const wrap = el('div', 'bui-link');
  root.appendChild(wrap);
  return wrap;
}

function backToMenuButton(onBack) {
  const btn = el('button', 'bui-btn bui-btn-secondary', t('battle.cancel'));
  btn.onclick = () => {
    cleanupLinkScreen();
    onBack && onBack();
    openMenu();
  };
  return btn;
}

function startHostFlow() {
  if (!canStartBattle()) return;
  const wrap = renderLinkContainer();
  if (!wrap) return;
  const mySnap = getMySnapshot();

  wrap.appendChild(el('h2', null, t('battle.hostTitle')));
  wrap.appendChild(el('p', null, t('battle.hostWaiting')));
  const qrBox = el('div', 'bui-qr-box');
  wrap.appendChild(qrBox);
  const idText = el('div', 'bui-id-text', '...');
  wrap.appendChild(idText);

  const bridge = { onAction: null, onDisconnect: null, onBye: null };

  const net = createHost(mySnap, {
    onPeerOpen(id) {
      renderQR(qrBox, id);
      idText.textContent = id;
    },
    onStart({ opponentSnap, seed, mySide }) {
      runBattleScreen({ snapA: mySnap, snapB: opponentSnap, mySide, mode: 'net', engineSeed: seed, net, bridge });
    },
    onAction(msg) { bridge.onAction && bridge.onAction(msg); },
    onBye() {
      if (bridge.onBye) bridge.onBye();
      else { alert(t('battle.opponentLeft')); openMenu(); }
    },
    onDisconnect(reason) {
      if (bridge.onDisconnect) bridge.onDisconnect(reason);
      else { showLinkError(wrap, t('battle.connectionLost')); }
    },
    onError(err) {
      showLinkError(wrap, t('battle.error', { msg: err && err.message ? err.message : err }));
    },
  });

  const cancelBtn = backToMenuButton(() => net.destroy());
  wrap.appendChild(cancelBtn);
}

function showLinkError(wrap, msg) {
  const existing = wrap.querySelector('.bui-error');
  if (existing) { existing.textContent = msg; return; }
  wrap.appendChild(el('div', 'bui-error', msg));
}

function connectAsGuest(hostId, wrap) {
  const mySnap = getMySnapshot();
  const bridge = { onAction: null, onDisconnect: null, onBye: null };

  wrap.innerHTML = '';
  wrap.appendChild(el('h2', null, t('battle.connecting')));

  const net = createGuest(hostId, mySnap, {
    onStart({ opponentSnap, seed, mySide }) {
      runBattleScreen({ snapA: opponentSnap, snapB: mySnap, mySide, mode: 'net', engineSeed: seed, net, bridge });
    },
    onAction(msg) { bridge.onAction && bridge.onAction(msg); },
    onBye() {
      if (bridge.onBye) bridge.onBye();
      else { alert(t('battle.opponentLeft')); openMenu(); }
    },
    onDisconnect(reason) {
      if (bridge.onDisconnect) bridge.onDisconnect(reason);
      else { showLinkError(wrap, t('battle.connectionLost')); }
    },
    onError(err) {
      showLinkError(wrap, t('battle.error', { msg: err && err.message ? err.message : err }));
    },
  });

  const cancelBtn = backToMenuButton(() => net.destroy());
  wrap.appendChild(cancelBtn);
}

function startJoinQrFlow() {
  if (!canStartBattle()) return;
  const wrap = renderLinkContainer();
  if (!wrap) return;

  wrap.appendChild(el('h2', null, t('battle.joinQr')));
  const status = el('p', null, t('battle.pointCamera'));
  wrap.appendChild(status);
  const video = document.createElement('video');
  video.className = 'bui-video';
  video.muted = true;
  wrap.appendChild(video);

  const manualBtn = el('button', 'bui-btn bui-btn-secondary', t('battle.enterCodeInstead'));
  manualBtn.onclick = () => { cleanupLinkScreen(); startJoinCodeFlow(); };
  wrap.appendChild(manualBtn);
  wrap.appendChild(backToMenuButton());

  activeScannerStop = startScanner(video, {
    onResult(hostId) {
      activeScannerStop = null;
      connectAsGuest(hostId.trim(), wrap);
    },
    onError(err) {
      status.textContent = t('battle.cameraUnavailable', { msg: err && err.message ? err.message : err });
    },
  });
}

function startJoinCodeFlow() {
  if (!canStartBattle()) return;
  const wrap = renderLinkContainer();
  if (!wrap) return;

  wrap.appendChild(el('h2', null, t('battle.joinCode')));
  wrap.appendChild(el('p', null, t('battle.enterHostCode')));
  const input = document.createElement('input');
  input.className = 'bui-input';
  input.type = 'text';
  input.placeholder = t('battle.hostCodePlaceholder');
  wrap.appendChild(input);

  const connectBtn = el('button', 'bui-btn', t('battle.connect'));
  connectBtn.onclick = () => {
    const id = input.value.trim();
    if (!id) return;
    connectAsGuest(id, wrap);
  };
  wrap.appendChild(connectBtn);
  wrap.appendChild(backToMenuButton());
}

// ---- battle screen ----------------------------------------------------------

function runBattleScreen({ snapA, snapB, mySide, mode, engineSeed, net, bridge, rival }) {
  cleanupLinkScreen();
  const root = qs('screen-battle');
  if (!root) return;
  goToScreen('battle');
  root.innerHTML = '';

  let state = createBattle(snapA, snapB, engineSeed);
  const oppSide = mySide === 'A' ? 'B' : 'A';
  const mySnap = mySide === 'A' ? snapA : snapB;
  const oppSnap = mySide === 'A' ? snapB : snapA;

  const wrap = el('div', 'bui-battle');
  const arena = el('div', 'bui-arena');

  const leftPanel = buildPetPanel(mySnap, true);
  const rightPanel = buildPetPanel(oppSnap, false);
  arena.appendChild(leftPanel.panel);
  arena.appendChild(rightPanel.panel);
  wrap.appendChild(arena);

  const actionsRow = el('div', 'bui-actions');
  wrap.appendChild(actionsRow);

  const log = el('div', 'bui-log');
  wrap.appendChild(log);

  const exitBtn = el('button', 'bui-btn bui-btn-secondary', t('battle.forfeit'));
  wrap.appendChild(exitBtn);

  root.appendChild(wrap);

  // Live language switch during a battle: relabel the action buttons + exit.
  currentRerender = () => {
    try { renderActionButtons(); } catch (err) { console.error('[battle-ui] relabel actions failed', err); }
    exitBtn.textContent = t('battle.forfeit');
  };

  function panelFor(side) {
    return side === mySide ? leftPanel : rightPanel;
  }

  function appendLog(text) {
    const line = el('div', null, text);
    log.appendChild(line);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  function updateHpBars() {
    updatePanelHp(leftPanel, state[mySide]);
    updatePanelHp(rightPanel, state[oppSide]);
  }
  updateHpBars();

  let animating = false;
  const pendingByTurn = {};

  function setButtonsEnabled(enabled) {
    actionsRow.querySelectorAll('button').forEach((b) => { b.disabled = !enabled; });
  }

  function renderActionButtons() {
    actionsRow.innerHTML = '';
    let actions = [];
    try {
      actions = legalActions(state, mySide) || [];
    } catch (err) {
      console.error('[battle-ui] legalActions failed', err);
    }
    actions.forEach((a) => {
      const btn = el('button', 'bui-btn', actionLabel(a, mySnap));
      btn.onclick = () => handleLocalAction(a);
      actionsRow.appendChild(btn);
    });
  }

  function animateEvents(events, onDone) {
    animating = true;
    let i = 0;
    function step() {
      if (i >= events.length) {
        animating = false;
        onDone && onDone();
        return;
      }
      const ev = events[i++];
      playEvent(ev);
      setTimeout(step, 550);
    }
    step();
  }

  function playEvent(ev) {
    const p = ev.side ? panelFor(ev.side) : null;
    switch (ev.type) {
      case 'hit':
      case 'crit': {
        if (p) {
          // damage lands on the OPPONENT of ev.side (the attacker's side is
          // ev.side; the target is whoever just lost hp — we just flash/shake
          // whichever panel's hp changed since the last update).
        }
        updateHpBars();
        const targetPanel = ev.side === mySide ? rightPanel : leftPanel;
        shakePanel(targetPanel);
        if (typeof ev.dmg === 'number') floatDamage(targetPanel, ev.dmg, ev.type === 'crit', ev.eff);
        floatEffText(targetPanel, ev.eff);
        // The engine already folds the effectiveness phrase into ev.text (e.g.
        // "...hits for 5. It's super effective!"), so the log line alone covers
        // it; the floating banner above is the extra visual surfacing DESIGN_v4
        // §3 asks for. Back-compat: if ev.eff is set but ev.text doesn't mention
        // it (older/partial engine), append it ourselves so nothing is silently lost.
        // Engine event text is left as-is (language-neutral engine). If the
        // engine omitted the effectiveness phrase, append a localized one.
        let logText = ev.text || `${ev.type} for ${ev.dmg ?? ''}`;
        if (ev.eff === 'super' && !/effective/i.test(logText)) logText += ' ' + t('battle.eff.super');
        else if (ev.eff === 'weak' && !/effective/i.test(logText)) logText += ' ' + t('battle.eff.weak');
        appendLog(logText);
        break;
      }
      case 'guard': {
        if (p) flashGuard(p);
        appendLog(ev.text || t('battle.log.guards'));
        break;
      }
      case 'charge': {
        appendLog(ev.text || t('battle.log.charges'));
        break;
      }
      case 'special': {
        updateHpBars();
        appendLog(ev.text || t('battle.log.usesSpecial'));
        break;
      }
      case 'faint': {
        updateHpBars();
        const faintedPanel = ev.side === mySide ? leftPanel : rightPanel;
        faintPanel(faintedPanel);
        appendLog(ev.text || t('battle.log.faints'));
        break;
      }
      case 'text':
      default: {
        appendLog(ev.text || '');
        break;
      }
    }
  }

  function handleLocalAction(action) {
    if (animating) return;
    setButtonsEnabled(false);

    if (mode === 'ai') {
      const aiAction = pickAction(state, oppSide, Math.random);
      const actionA = mySide === 'A' ? action : aiAction;
      const actionB = mySide === 'A' ? aiAction : action;
      const result = applyTurn(state, actionA, actionB);
      state = result.state;
      animateEvents(result.events, () => afterTurn(result.winner));
    } else {
      const turnNum = state.turn + 1;
      pendingByTurn[turnNum] = pendingByTurn[turnNum] || {};
      pendingByTurn[turnNum].mine = action;
      net.sendAction(turnNum, action);
      tryResolveNet();
    }
  }

  function tryResolveNet() {
    if (animating) return;
    const turnNum = state.turn + 1;
    const pending = pendingByTurn[turnNum];
    if (!pending || pending.mine == null || pending.theirs == null) return;
    const actionA = mySide === 'A' ? pending.mine : pending.theirs;
    const actionB = mySide === 'A' ? pending.theirs : pending.mine;
    delete pendingByTurn[turnNum];
    const result = applyTurn(state, actionA, actionB);
    state = result.state;
    animateEvents(result.events, () => {
      afterTurn(result.winner);
      // In case both turns raced ahead (remote already sent the next one).
      if (!result.winner) tryResolveNet();
    });
  }

  if (mode === 'net' && bridge) {
    bridge.onAction = (msg) => {
      pendingByTurn[msg.turn] = pendingByTurn[msg.turn] || {};
      pendingByTurn[msg.turn].theirs = msg.action;
      tryResolveNet();
    };
    bridge.onDisconnect = () => {
      appendLog(t('battle.log.opponentDisconnected'));
      setButtonsEnabled(false);
      setTimeout(() => { net.destroy(); openMenu(); }, 1800);
    };
    bridge.onBye = () => {
      appendLog(t('battle.log.opponentLeftBattle'));
      setButtonsEnabled(false);
      setTimeout(() => { net.destroy(); openMenu(); }, 1800);
    };
  }

  exitBtn.onclick = () => {
    if (net) { try { net.sendBye(); } catch (e) { /* ignore */ } try { net.destroy(); } catch (e) { /* ignore */ } }
    openMenu();
  };

  function afterTurn(winner) {
    updateHpBars();
    if (winner) {
      setButtonsEnabled(false);
      setTimeout(() => showResultScreen(winner, mySide, net, mode, state, oppSnap, rival), 400);
    } else {
      renderActionButtons();
      setButtonsEnabled(true);
    }
  }

  renderActionButtons();
}

function buildPetPanel(snap, isMine) {
  const panel = el('div', 'bui-panel');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  panel.appendChild(svg);
  try {
    renderPet(svg, snap.genome, snap.stage, { flip: !isMine });
  } catch (err) {
    console.error('[battle-ui] renderPet failed', err);
  }
  panel.appendChild(el('div', 'bui-name', `${snap.name}${isMine ? '' : ` Lv.${snap.level}`}`));
  const hpWrap = el('div', 'bui-hpwrap');
  const hpBar = el('div', 'bui-hpbar');
  hpBar.style.width = '100%';
  hpWrap.appendChild(hpBar);
  panel.appendChild(hpWrap);
  const hpText = el('div', 'bui-hptext', `${snap.stats.hp}/${snap.stats.hp}`);
  panel.appendChild(hpText);
  return { panel, svg, hpBar, hpText, maxHp: snap.stats.hp };
}

function updatePanelHp(p, fighterState) {
  if (!fighterState) return;
  const pct = Math.max(0, Math.min(1, fighterState.hp / fighterState.maxHp));
  p.hpBar.style.width = `${Math.round(pct * 100)}%`;
  p.hpBar.classList.toggle('bui-low', pct <= 0.5 && pct > 0.2);
  p.hpBar.classList.toggle('bui-crit', pct <= 0.2);
  p.hpText.textContent = `${Math.max(0, Math.round(fighterState.hp))}/${fighterState.maxHp}`;
}

function shakePanel(p) {
  p.panel.classList.remove('bui-shake');
  // eslint-disable-next-line no-void
  void p.panel.offsetWidth; // restart animation
  p.panel.classList.add('bui-shake');
}

function floatDamage(p, dmg, isCrit, eff) {
  let cls = 'bui-float';
  if (isCrit) cls += ' bui-crit';
  if (eff === 'super') cls += ' bui-eff-super';
  else if (eff === 'weak') cls += ' bui-eff-weak';
  const f = el('div', cls, `-${dmg}`);
  p.panel.appendChild(f);
  setTimeout(() => f.remove(), 850);
}

/** floatEffText(p, eff) — brief "Super effective!" / "Not very effective..." banner. */
function floatEffText(p, eff) {
  if (eff !== 'super' && eff !== 'weak') return;
  const text = eff === 'super' ? t('battle.eff.super') : t('battle.eff.weak');
  const f = el('div', `bui-efftext bui-efftext-${eff}`, text);
  p.panel.appendChild(f);
  setTimeout(() => f.remove(), 1100);
}

function flashGuard(p) {
  p.panel.classList.add('bui-guardflash');
  setTimeout(() => p.panel.classList.remove('bui-guardflash'), 500);
}

function faintPanel(p) {
  p.panel.classList.add('bui-faint');
}

// ---- result screen ----------------------------------------------------------

function showResultScreen(winner, mySide, net, mode, state, oppSnap, rival) {
  const root = qs('screen-battle');
  if (!root) return;
  root.innerHTML = '';

  const won = winner === mySide;
  const isDraw = winner === 'draw';
  // The player's remaining HP at battle end, persisted through the glue.
  const remainingHp = state && state[mySide] ? Math.floor(state[mySide].hp) : undefined;
  // Rival ghost battles reward 20 coins (between wild 15 and pvp 25).
  const kind = rival ? 'rival' : (mode === 'net' ? 'pvp' : 'wild');
  const rewardInfo = applyBattleRewardsAndCost(won, { remainingHp, kind, draw: isDraw });

  // Update your W-L record vs this rival (draws don't count either way).
  if (rival && !isDraw) {
    try { recordResult(rival.id, won); } catch (err) { console.error('[battle-ui] recordResult failed', err); }
  }

  // Auto-save the QR opponent to the Rivals roster so you can rematch offline.
  if (mode === 'net' && oppSnap && oppSnap.genome) {
    try {
      const entry = saveRival(oppSnap, 'qr');
      if (entry) uiToast(t('battle.result.joinedRivals', { name: entry.name }));
    } catch (err) {
      console.error('[battle-ui] saveRival (QR opponent) failed', err);
    }
  }

  const wrap = el('div', 'bui-result');
  wrap.appendChild(el('h2', null, isDraw
    ? t('battle.result.draw')
    : (won ? t('battle.result.win') : t('battle.result.lose'))));
  if (rewardInfo) {
    wrap.appendChild(el('p', null, rewardInfo.leveledUp > 0
      ? t('battle.result.xpLevelUp', { levels: rewardInfo.leveledUp })
      : t('battle.result.xp')));
    if (rewardInfo.coins > 0) {
      wrap.appendChild(el('p', null, t('battle.result.earnedCoins', { coins: rewardInfo.coins })));
    }
  }
  const backBtn = el('button', 'bui-btn', t('battle.result.backToMenu'));
  backBtn.onclick = () => {
    if (net) { try { net.destroy(); } catch (e) { /* ignore */ } }
    openMenu();
  };
  wrap.appendChild(backBtn);
  root.appendChild(wrap);
}

// ---- public entry point ------------------------------------------------------

function openMenu() {
  ensureStyles();
  cleanupLinkScreen();
  // Populate the roster with seed rivals on first open (idempotent).
  try { ensureSeeded(); } catch (err) { console.error('[battle-ui] ensureSeeded failed', err); }
  goToScreen('battle');
  renderMenu();
}

window.SlimeBattle = { openMenu };
