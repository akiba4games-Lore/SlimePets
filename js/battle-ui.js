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

import { createBattle, legalActions, applyTurn, typeMult } from './battle.js';
import { generateWildOpponent, pickAction, randomGenome } from './battle-ai.js';
import { createHost, createGuest, renderQR, startScanner } from './net.js';
import { renderPet } from './render.js';
import { battleSnapshot, grantBattleXp } from './pet.js';
import { listRivals, saveRival, recordResult, removeRival } from './rivals.js';
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
    .bui-hub { position:relative; padding-top:28px; }
    .bui-charges { text-align:center; font-weight:800; color:#6b5570; margin:-4px 0 2px; font-size:0.95rem; }
    .bui-rivals-btn { position:absolute; top:8px; right:10px; width:48px; height:48px;
      border-radius:50%; border:none; background:hsl(280 70% 90%); color:#402a55;
      font-size:1.4rem; cursor:pointer; box-shadow:0 2px 8px rgba(120,90,140,0.3); }
    .bui-rivals-btn:active { transform:scale(0.94); }
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
    .bui-element { font-size:0.82rem; font-weight:700; color:#6b5570; background:hsl(0 0% 100% / 0.65);
      border-radius:10px; padding:2px 8px; }
    .bui-move-btn { position:relative; display:flex; align-items:center; justify-content:center; gap:4px; }
    .bui-cd-badge { position:absolute; top:-6px; right:-6px; background:hsl(0 0% 30%); color:#fff;
      font-size:0.7rem; font-weight:800; border-radius:10px; padding:1px 6px; box-shadow:0 1px 3px rgba(0,0,0,0.3); }
    .bui-confirm-overlay { position:absolute; inset:0; z-index:90; background:rgba(80,60,90,0.4);
      display:flex; align-items:center; justify-content:center; padding:20px; }
    .bui-confirm-card { width:100%; max-width:300px; background:linear-gradient(160deg,#fff5fb,#eef4ff);
      border-radius:22px; box-shadow:0 12px 34px rgba(120,90,140,0.4); padding:18px 18px 14px;
      display:flex; flex-direction:column; align-items:center; gap:6px; animation:bui-pop 0.25s ease; }
    .bui-confirm-title { font-size:1.1rem; font-weight:800; color:#c05a8a; text-align:center; }
    .bui-confirm-lines { display:flex; flex-direction:column; gap:4px; width:100%; margin:4px 0 8px; }
    .bui-confirm-line { font-size:0.85rem; font-weight:700; color:#6b5570; text-align:center;
      background:hsl(0 0% 100% / 0.7); border-radius:10px; padding:5px 10px; }
    .bui-confirm-line.bui-eff-super { color:#c0392b; }
    .bui-confirm-line.bui-eff-weak { color:#7a7a7a; }
    .bui-confirm-actions { display:flex; gap:10px; width:100%; }
    .bui-confirm-actions .bui-btn { flex:1; padding:12px; font-size:1rem; }
    @keyframes bui-shake { 0%,100%{transform:translateX(0);} 20%{transform:translateX(-6px);} 40%{transform:translateX(6px);} 60%{transform:translateX(-4px);} 80%{transform:translateX(4px);} }
    @keyframes bui-float { 0%{opacity:1; transform:translate(-50%,0);} 100%{opacity:0; transform:translate(-50%,-30px);} }
    @keyframes bui-pop { 0%{transform:scale(0.85); opacity:0.4;} 60%{transform:scale(1.04);} 100%{transform:scale(1); opacity:1;} }
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

// v14A (§6) — bind TAP vs LONG-PRESS on a button. A quick tap fires onTap; a
// press held >= LONG_PRESS_MS fires onLongPress instead (and suppresses the
// tap). Uses Pointer Events so mouse + touch share one path; the synthesized
// click is swallowed so it can't double-fire onTap.
const LONG_PRESS_MS = 400;
function attachTapOrLongPress(btn, onTap, onLongPress) {
  let timer = null;
  let longFired = false;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  btn.addEventListener('pointerdown', () => {
    longFired = false;
    clear();
    timer = setTimeout(() => { longFired = true; timer = null; try { onLongPress(); } catch (e) { console.error('[battle-ui] longpress failed', e); } }, LONG_PRESS_MS);
  });
  btn.addEventListener('pointerup', () => {
    if (timer) { clear(); if (!longFired) { try { onTap(); } catch (e) { console.error('[battle-ui] tap failed', e); } } }
  });
  btn.addEventListener('pointerleave', clear);
  btn.addEventListener('pointercancel', clear);
  // Swallow the native click (pointer events already drive tap/long-press).
  btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
}

// ---- v4 typed-move action buttons -------------------------------------------
// legalActions(state, side) now returns the player's known move ids + 'guard'
// + 'special' (no more 'charge' — see DESIGN_v4.md §3). We label move-id
// buttons by looking the id up in the player's OWN snapshot.moves (the engine
// guarantees this array for the player; back-compat opponents/old engines may
// not have it, so every lookup here is defensive).
const ELEMENT_ICON = {
  none: '⚪', water: '💧', fire: '🔥', grass: '🍃', earth: '🪨',
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

// Localized short stat token for effect lines (ATK/SPD/DEF…).
function effStat(k) {
  return t('effect.stat.' + k);
}

// Human-readable effect lines for a move — buffs/debuffs/heal/recoil/guard/charge
// (DESIGN v11 "Effect encoding"). Negative cooldown means "charge |n|".
function moveEffectLines(mv) {
  const lines = [];
  const fx = mv && mv.effect;
  if (fx) {
    if (fx.selfBuff) for (const [k, v] of Object.entries(fx.selfBuff)) {
      lines.push(t('effect.selfBuff', { stat: effStat(k), sign: v >= 0 ? '+' : '−', pct: Math.abs(Math.round(v * 100)) }));
    }
    if (fx.enemyDebuff) for (const [k, v] of Object.entries(fx.enemyDebuff)) {
      lines.push(t('effect.enemyDebuff', { stat: effStat(k), sign: v >= 0 ? '+' : '−', pct: Math.abs(Math.round(v * 100)) }));
    }
    if (typeof fx.heal === 'number' && fx.heal > 0) lines.push(t('effect.heal', { pct: Math.round(fx.heal * 100) }));
    if (typeof fx.recoil === 'number' && fx.recoil > 0) lines.push(t('effect.recoil', { pct: Math.round(fx.recoil * 100) }));
    if (fx.guard) lines.push(t('effect.guard'));
    if (fx.noDamage) lines.push(t('effect.noDamage'));
  }
  if (mv && (mv.cooldown | 0) < 0) lines.push(t('effect.charge', { n: Math.abs(mv.cooldown | 0) }));
  return lines;
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
function canStartBattle(kind) {
  if (window.SlimeGame && typeof window.SlimeGame.canBattle === 'function') {
    try {
      if (!window.SlimeGame.canBattle()) {
        uiToast(t('battle.tooTired'));
        return false;
      }
    } catch (err) {
      console.error('[battle-ui] SlimeGame.canBattle() failed', err);
    }
  }
  // v14A (§3): wild/rival battles consume a battle charge; refuse at 0. Local QR
  // PvP (kind 'pvp') is never gated. The glue toasts the countdown on refusal.
  if ((kind === 'wild' || kind === 'rival') &&
      window.SlimeGame && typeof window.SlimeGame.consumeBattleCharge === 'function') {
    try {
      if (!window.SlimeGame.consumeBattleCharge(kind)) return false;
    } catch (err) {
      console.error('[battle-ui] consumeBattleCharge failed', err);
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
    // Battles no longer cost stamina — only a little hunger.
    if (pet.care && typeof pet.care.hunger === 'number') {
      pet.care.hunger = Math.max(0, pet.care.hunger - 8);
    }
  } catch (err) {
    console.error('[battle-ui] applying battle cost to pet failed', err);
  }
  return { leveledUp, coins: 0 };
}

// ---- menu -------------------------------------------------------------------

// v12 — the battle tab is a HUB: three big buttons (Random / Local / Prep) plus
// a Rivals button in the TOP-RIGHT corner. Each hub button opens its own view.
function renderMenu() {
  currentRerender = renderMenu;
  const root = qs('screen-battle');
  if (!root) return;
  root.innerHTML = '';
  const wrap = el('div', 'bui-menu bui-hub');

  // Rivals roster — small button in the top-right of the hub.
  const rivalsBtn = el('button', 'bui-rivals-btn', '👥');
  rivalsBtn.title = t('battle.rivals');
  rivalsBtn.setAttribute('aria-label', t('battle.rivals'));
  rivalsBtn.onclick = openRivals;
  wrap.appendChild(rivalsBtn);

  wrap.appendChild(el('h2', null, t('battle.title')));

  // v14A (§3): remaining battle charges (wild/rival cost 1 each; +1 / 5 min).
  if (window.SlimeGame && typeof window.SlimeGame.getBattleCharges === 'function') {
    try {
      const bc = window.SlimeGame.getBattleCharges();
      wrap.appendChild(el('div', 'bui-charges', t('battle.charges', { n: bc.charges, max: bc.max })));
    } catch (err) {
      console.error('[battle-ui] getBattleCharges failed', err);
    }
  }

  const randomBtn = el('button', 'bui-btn', t('battle.hub.random'));
  randomBtn.onclick = startWildBattle;

  const localBtn = el('button', 'bui-btn bui-btn-secondary', t('battle.hub.local'));
  localBtn.onclick = openLocalPanel;

  const prepBtn = el('button', 'bui-btn bui-btn-secondary', t('battle.hub.prep'));
  prepBtn.onclick = () => goToScreen('moves');

  wrap.appendChild(randomBtn);
  wrap.appendChild(localBtn);
  wrap.appendChild(prepBtn);
  root.appendChild(wrap);
}

// v12 — the "Local battle" sub-panel: Host QR / Join by QR / Join by code, plus
// a Back-to-hub button.
function openLocalPanel() {
  currentRerender = openLocalPanel;
  ensureStyles();
  cleanupLinkScreen();
  goToScreen('battle');
  const root = qs('screen-battle');
  if (!root) return;
  root.innerHTML = '';
  const wrap = el('div', 'bui-menu');
  wrap.appendChild(el('h2', null, t('battle.localTitle')));

  const hostBtn = el('button', 'bui-btn', t('battle.hostQr'));
  hostBtn.onclick = startHostFlow;

  const joinQrBtn = el('button', 'bui-btn bui-btn-secondary', t('battle.joinQr'));
  joinQrBtn.onclick = startJoinQrFlow;

  const joinCodeBtn = el('button', 'bui-btn bui-btn-secondary', t('battle.joinCode'));
  joinCodeBtn.onclick = startJoinCodeFlow;

  const backBtn = el('button', 'bui-btn bui-btn-secondary', t('battle.back'));
  backBtn.onclick = openMenu;

  wrap.appendChild(hostBtn);
  wrap.appendChild(joinQrBtn);
  wrap.appendChild(joinCodeBtn);
  wrap.appendChild(backBtn);
  root.appendChild(wrap);
}

function startWildBattle() {
  if (!canStartBattle('wild')) return;
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
  if (!canStartBattle('rival')) return;
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
  if (!canStartBattle('pvp')) return;
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
  if (!canStartBattle('pvp')) return;
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
  if (!canStartBattle('pvp')) return;
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

  // Enable/disable the action buttons. When re-enabling, a button that is NOT
  // usable this turn (on cooldown) stays disabled — its state is stamped in
  // dataset.usable by renderActionButtons so a blanket re-enable can't override it.
  function setButtonsEnabled(enabled) {
    actionsRow.querySelectorAll('button').forEach((b) => {
      b.disabled = enabled ? (b.dataset.usable === '0') : true;
    });
  }

  // v9/v10: render ALL of the player's EQUIPPED moves each turn (snap.moves is
  // the <=4 equipped set). A move on cooldown is disabled with a ⏳N badge;
  // priority>0 ("fast") moves get a ⚡. legalActions still governs usability.
  function renderActionButtons() {
    actionsRow.innerHTML = '';
    const cd = (state[mySide] && state[mySide].cd) || {};
    let legal = [];
    try { legal = legalActions(state, mySide) || []; } catch (err) { console.error('[battle-ui] legalActions failed', err); }
    const legalSet = new Set(legal);
    const moves = (mySnap && Array.isArray(mySnap.moves) && mySnap.moves.length) ? mySnap.moves : null;

    if (moves) {
      moves.forEach((mv) => {
        const turnsLeft = cd[mv.id] || 0;
        const usable = turnsLeft === 0 && legalSet.has(mv.id);
        const icon = ELEMENT_ICON[mv.element] || ELEMENT_ICON.none;
        let label = `${icon} ${mv.name || mv.id}`;
        if ((mv.priority | 0) > 0) label += ' ⚡';
        const btn = el('button', 'bui-btn bui-move-btn', label);
        btn.dataset.usable = usable ? '1' : '0';
        btn.disabled = !usable;
        if (turnsLeft > 0) btn.appendChild(el('span', 'bui-cd-badge', `⏳${turnsLeft}`));
        // v14A (§6): TAP commits the move immediately; LONG-PRESS (~400ms) opens
        // the move-details popup WITHOUT committing.
        if (usable) attachTapOrLongPress(btn, () => handleLocalAction(mv.id), () => openMoveConfirm(mv));
        actionsRow.appendChild(btn);
      });
      return;
    }

    // Back-compat fallback (demo pet / old engine without a moves array):
    // render whatever legalActions returns, all usable.
    legal.forEach((a) => {
      const btn = el('button', 'bui-btn', actionLabel(a, mySnap));
      btn.dataset.usable = '1';
      btn.onclick = () => handleLocalAction(a);
      actionsRow.appendChild(btn);
    });
  }

  // v14A (§6): LONG-PRESSING a move opens this move-DETAILS card (icon+name,
  // element, power, cooldown, fast, effects, effectiveness vs the opponent's
  // element). It is inspect-only now — it NEVER commits the move (a normal tap
  // commits). Close/Cancel/backdrop just dismiss it. battle-ui owns this DOM.
  function openMoveConfirm(mv) {
    if (animating || !mv) return;
    const oppEl = (oppSnap && (oppSnap.element || (oppSnap.genome && oppSnap.genome.element))) ||
      (state[oppSide] && state[oppSide].element) || 'none';

    const overlay = el('div', 'bui-confirm-overlay');
    const card = el('div', 'bui-confirm-card');
    const icon = ELEMENT_ICON[mv.element] || ELEMENT_ICON.none;
    card.appendChild(el('div', 'bui-confirm-title', `${icon} ${mv.name || mv.id}`));

    const lines = el('div', 'bui-confirm-lines');
    const noDmg = !!(mv.effect && mv.effect.noDamage);
    const elKey = ELEMENT_ICON[mv.element] ? mv.element : 'none';
    lines.appendChild(el('div', 'bui-confirm-line', `${ELEMENT_ICON[elKey]} ${t('element.' + elKey)}`));
    if (!noDmg) lines.appendChild(el('div', 'bui-confirm-line', t('confirm.power', { power: (typeof mv.power === 'number' ? mv.power : 1).toFixed(2) })));
    if ((mv.cooldown | 0) > 0) lines.appendChild(el('div', 'bui-confirm-line', t('confirm.cooldown', { n: mv.cooldown | 0 })));
    if ((mv.priority | 0) > 0) lines.appendChild(el('div', 'bui-confirm-line', t('confirm.fast')));

    // v11 — surface the move's effects (buffs/debuffs/heal/recoil/guard/charge).
    for (const ln of moveEffectLines(mv)) lines.appendChild(el('div', 'bui-confirm-line', ln));

    // Effectiveness vs the opponent's element (skipped for no-damage moves).
    if (!noDmg) {
      let mult = 1;
      try { mult = typeMult(mv.element || 'none', oppEl); } catch (err) { console.error('[battle-ui] typeMult failed', err); }
      const effLine = mult > 1
        ? el('div', 'bui-confirm-line bui-eff-super', t('battle.eff.super'))
        : (mult < 1
          ? el('div', 'bui-confirm-line bui-eff-weak', t('battle.eff.weak'))
          : el('div', 'bui-confirm-line', t('confirm.effNormal')));
      lines.appendChild(effLine);
    }
    card.appendChild(lines);

    const actions = el('div', 'bui-confirm-actions');
    const closeBtn = el('button', 'bui-btn', t('confirm.close'));
    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    closeBtn.onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    actions.appendChild(closeBtn);
    card.appendChild(actions);
    overlay.appendChild(card);
    root.appendChild(overlay);
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
      // v11 effect events emitted by the engine (text is engine-authored English;
      // fall back to a localized generic line if absent).
      case 'buff': {
        appendLog(ev.text || t('battle.log.buff'));
        break;
      }
      case 'debuff': {
        appendLog(ev.text || t('battle.log.debuff'));
        break;
      }
      case 'heal': {
        updateHpBars();
        appendLog(ev.text || t('battle.log.heals'));
        break;
      }
      case 'recoil': {
        updateHpBars();
        appendLog(ev.text || t('battle.log.recoil'));
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
  // v9: show each fighter's element (icon + localized name) so the player can
  // plan type matchups — especially the opponent's.
  const elx = (snap.element || (snap.genome && snap.genome.element) || 'none');
  const elKey = ELEMENT_ICON[elx] ? elx : 'none';
  panel.appendChild(el('div', 'bui-element', `${ELEMENT_ICON[elKey]} ${t('element.' + elKey)}`));
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
  // v12: no seeding — the Rivals roster is REAL local opponents only. It grows
  // solely when a QR/local battle completes (saveRival(oppSnap, 'qr')).
  goToScreen('battle');
  renderMenu();
}

window.SlimeBattle = { openMenu };
