// js/game.js — care + training logic, screen wiring, glue for Agent B.
import {
  createPet,
  computeStats,
  battleSnapshot,
  grantBattleXp,
  grantXp,
  addTraining,
  advanceStage,
  xpForNext,
  randomSeed,
  getLearnset,
  getKnownMoves,
  getEquipped,
  equipMove,
  unequipMove,
  learnRandomMove,
  checkUnlocks,
  rerollMove,
  rebirth,
  ELEMENTS,
  STAGE_ORDER,
  STAGE_DURATION_MS,
  EGG_HATCH_MS,
  EGG_HATCH_TAPS,
} from './pet.js';
import { renderPet } from './render.js';
import { saveGame, loadGame, clearGame } from './storage.js';
import { t, getLang, setLang, onLangChange, applyStaticI18n } from './i18n.js';
import { clearRivals } from './rivals.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  pet: null,
  settings: {},
  screen: 'pet',
};

let saveThrottle = 0;
const OFFLINE_CAP_MS = 12 * 60 * 60 * 1000; // 12h

// Care decay rates per hour (v2: no more energy stat).
const DECAY_AWAKE = { hunger: 18, happiness: 10, hygiene: 7 };
const DECAY_SLEEP = { hunger: 9, hygiene: 4, happiness: 2 }; // happiness is a gain here

// Passive HP healing, as a fraction of max HP per hour (sleeping heals faster).
const HEAL_RATE_AWAKE = 0.08; // +8% / hour
const HEAL_RATE_SLEEP = 0.32; // +32% / hour
// Heal (🩹) is always FREE but limited to once every 4 hours. It never costs
// coins — for an off-cooldown top-up players buy a Cure Potion in the shop.
const HEAL_FREE_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 real hours

// Training config.
const EXERCISES = {
  Lift: { stat: 'str', label: 'STR', stam: 22, hunger: 7, hygiene: 8, base: 2.4, emoji: '🏋️' },
  Run: { stat: 'spd', label: 'SPD', stam: 18, hunger: 6, hygiene: 6, base: 2.4, emoji: '🏃' },
  Swim: { stat: 'hp', label: 'HP', stam: 24, hunger: 8, hygiene: 4, base: 1.6, emoji: '🏊' },
  Block: { stat: 'def', label: 'DEF', stam: 16, hunger: 5, hygiene: 5, base: 2.2, emoji: '🛡️' },
  Focus: { stat: 'crit', label: 'CRIT', stam: 20, hunger: 4, hygiene: 3, base: 2.0, emoji: '🎯' },
};

// Training-refusal flavor lines live in i18n as lazy.0 … lazy.(N-1).
const LAZY_LINE_COUNT = 6;

// v5 — Food economy (§2). Foods now COST coins, give LESS hunger and restore a
// little HP + stamina (clamped to max); sweets add happiness. Effects:
// cost (coins) / hunger / hp / stamina / weight / happy.
// Display names are localized via t('food.<key>'); `key` is the i18n suffix.
const FOODS = {
  milk: { emoji: '🍼', cost: 5, hunger: 18, hp: 3, stamina: 4, weight: 0, happy: 0, sweet: false },
  apple: { emoji: '🍎', cost: 5, hunger: 10, hp: 2, stamina: 3, weight: -1, happy: 0, sweet: false },
  bread: { emoji: '🍞', cost: 12, hunger: 18, hp: 3, stamina: 5, weight: 3, happy: 0, sweet: false },
  icecream: { emoji: '🍦', cost: 12, hunger: 8, hp: 2, stamina: 3, weight: 3, happy: 8, sweet: true },
  cake: { emoji: '🍰', cost: 15, hunger: 10, hp: 3, stamina: 4, weight: 4, happy: 12, sweet: true },
  meat: { emoji: '🍖', cost: 20, hunger: 22, hp: 6, stamina: 8, weight: 1, happy: 0, sweet: false },
};
const FOODS_BABY = ['milk'];
const FOODS_CHILD = ['apple', 'bread', 'icecream', 'cake', 'meat'];
function foodName(key) { return t('food.' + key); }

// v5 — same food 3× in a row bores the pet (§2).
const FOOD_BORED_STREAK = 3;
const FOOD_BORED_HAPPY = 8; // happiness lost when bored

// v5 — dirty (§4): hygiene < DIRTY_THRESHOLD makes the pet sad + decays
// happiness DIRTY_DECAY_MULT× faster.
const DIRTY_THRESHOLD = 35;
const DIRTY_DECAY_MULT = 1.6;

// v5 — shop prices (§6) and new-egg cooldown (§7). v6: potions dropped to 30.
const CURE_COST = 30;
const STAMINA_POTION_COST = 30;
const REROLL_COST = 200;

// v7 — Syringe (cure illness). 50 coins, +10 happiness.
const SYRINGE_COST = 50;
const CURE_HAPPY = 10;

// v7 — Illness (DESIGN v7). Sustained sad/hungry state makes the pet sick.
const ILL_ONSET_MS = 8 * 60 * 1000; // 8 real minutes of sustained bad state
const ILL_HAPPY_THRESH = 20; // happiness below this counts as a bad state
const ILL_HUNGER_THRESH = 15; // hunger below this counts as a bad state
const ILL_RECOVER_MULT = 2; // illTimer decays this × dt while healthy
const ILL_HP_PER_HR = 0.04; // fraction of MAX HP drained per hour while sick (floor 1)
const SICK_HAPPY_MULT = 2; // happiness decays this × faster while sick

// v6.1 — training now costs a flat 20 stamina per session (all exercises).
const TRAIN_STAMINA_COST = 20;
// v10 — Special training (🌟) costs 100 stamina and teaches a random move.
const SPECIAL_STAMINA_COST = 100;

// Spoiled food-refusal flavor lines live in i18n as brat.0 … brat.(N-1).
const BRAT_LINE_COUNT = 3;

// v3 timings & drifts.
// v6 — poop is now a simple 30-minute timer (§6). The need triggers ~30 min
// after the last relief (potty success or floor cleanup / hatch); once it
// triggers there's a hidden ~2 min grace before an accident on the floor.
const POOP_INTERVAL_MS = 30 * 60 * 1000; // 30 min between potty needs
const POOP_GRACE_MS = 2 * 60 * 1000; // hidden grace after the need triggers
const ACHIEVEMENT_WINDOW_MS = 3 * 60 * 1000; // "deserved" cuddle window
const MISBEHAVIOR_WINDOW_MS = 60 * 1000; // scold-valid window after a refusal
const SPOILED_DECAY_PER_H = 1; // spoiled -1/h
const WEIGHT_DRIFT_PER_H = 0.3; // weight drifts toward 30 at 0.3/h
const WEIGHT_TARGET = 30;
const SELF_POTTY_EDU = 60; // education >= this enables self-potty
const TRAIN_HYGIENE_HIT = 12; // extra hygiene lost per training session
const TRAIN_BLOCK_MS = 5 * 60 * 1000; // v5.1: a training refusal locks ALL training this long

// v4 — starvation (DESIGN §6). Neglect drains HP + weight after a grace period.
const STARVE_GRACE_MS = 2 * 60 * 60 * 1000; // 2h since last feed before it bites
const STARVE_HP_PER_HR = 0.125; // fraction of MAX HP lost per hour while starving
const STARVE_WEIGHT_PER_HR = 100 / 6; // ~16.7/h ⇒ full weight gone in 6h

// v4 — element display icons (UI only; the type chart lives in battle.js).
// Labels are localized via t('element.<el>').
const ELEMENT_ICON = {
  none: '⚪', water: '💧', fire: '🔥', grass: '🍃',
  earth: '🪨', lightning: '⚡', dark: '🌑', light: '✨',
};
function elementIcon(el) {
  return ELEMENT_ICON[el] || ELEMENT_ICON.none;
}
function elementLabel(el) {
  return t('element.' + (ELEMENT_ICON[el] ? el : 'none'));
}
// Localized stage display name for any stage id.
function stageLabel(stage) {
  return t('stage.' + stage);
}
// Human-readable, localized unlock hint for a locked ability.
function unlockHint(unlock) {
  if (!unlock) return '';
  switch (unlock.type) {
    case 'always': return '';
    case 'level': return t('unlock.reachLv', { value: unlock.value });
    case 'trainings': return t('unlock.train', { value: unlock.value });
    case 'weight': return t('unlock.weight', { value: unlock.value });
    case 'education': return t('unlock.education', { value: unlock.value });
    case 'wins': return t('unlock.wins', { value: unlock.value });
    case 'stage': return t('unlock.stage', { stage: stageLabel(unlock.value) });
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Toast + reaction feedback
// ---------------------------------------------------------------------------
let toastTimer = 0;
export function toast(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}

function reaction(emoji) {
  const stageEl = $('pet-stage');
  if (!stageEl) return;
  const b = document.createElement('div');
  b.className = 'reaction';
  b.textContent = emoji;
  b.style.left = 40 + Math.random() * 20 + '%';
  stageEl.appendChild(b);
  setTimeout(() => b.remove(), 1100);
}

function bouncePet() {
  const svg = $('pet-svg');
  if (!svg) return;
  svg.classList.remove('pop');
  // force reflow to restart animation
  void svg.offsetWidth;
  svg.classList.add('pop');
}

// ---------------------------------------------------------------------------
// v4 — learning + death helpers
// ---------------------------------------------------------------------------
function isDead() {
  return !!(state.pet && state.pet.state === 'dead');
}

function isStarving(pet) {
  return !!(pet && pet.state !== 'dead' && pet.stage !== 'egg' &&
    Date.now() - (pet.lastFedAt || 0) > STARVE_GRACE_MS);
}

// Re-check the learnset and toast any freshly-unlocked moves. Call after any
// change to level / trainingsDone / weight / education / battleWins.
function checkLearning() {
  const pet = state.pet;
  if (!pet) return;
  const learned = checkUnlocks(pet);
  for (const ab of learned) {
    toast(t('toast.learned', { name: pet.name, icon: elementIcon(ab.element), move: ab.name }));
  }
  return learned;
}

// Called when hpCurrent reaches 0 (starvation only). Freezes the pet.
function markDead() {
  const pet = state.pet;
  if (!pet || pet.state === 'dead') return;
  pet.state = 'dead';
  pet.hpCurrent = 0;
  pet.sleeping = false;
  save();
}

// Detect a fresh death after a care update (tick / offline catch-up).
function detectDeath() {
  const pet = state.pet;
  if (!pet || pet.state === 'dead' || pet.stage === 'egg') return false;
  if (pet.hpCurrent <= 0) {
    markDead();
    return true;
  }
  return false;
}

// Tap-to-send-off: fly the little angel up, then hatch a fresh egg (coins kept).
let sendingOff = false;
function handleSendOff() {
  const pet = state.pet;
  if (!pet || pet.state !== 'dead' || sendingOff) return;
  sendingOff = true;
  // Trigger the fly-away animation on the current (angel) render.
  renderPetCustom({ dead: true, flyAway: true });
  reaction('🕊️');
  setTimeout(() => {
    state.pet = rebirth(pet); // fresh egg, coins carried forward
    sendingOff = false;
    save();
    showScreen('pet');
    refresh();
    toast(t('toast.newEggAppeared'));
  }, 1050);
}

// ---------------------------------------------------------------------------
// Screen router
// ---------------------------------------------------------------------------
export function showScreen(name) {
  state.screen = name;
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  const el = $('screen-' + name);
  if (el) el.classList.add('active');
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.screen === name);
  });
  if (name === 'pet') refresh();
  if (name === 'train') refreshTrain();
  if (name === 'moves') refreshMoves();
  if (name === 'menu') refreshMenu();
  if (name === 'shop') refreshShop();
}

// ---------------------------------------------------------------------------
// Care simulation
// ---------------------------------------------------------------------------
function applyDecay(pet, dtSec) {
  if (dtSec <= 0) return;
  if (pet.state === 'dead') return; // dead pets are frozen (no care sim)
  const dtH = dtSec / 3600;
  const c = pet.care;
  const maxHp = computeStats(pet).hp;
  if (typeof pet.hpCurrent !== 'number' || !isFinite(pet.hpCurrent)) pet.hpCurrent = maxHp;
  const wounded = pet.hpCurrent < maxHp * 0.5; // <50% HP => happiness suffers faster
  // Starvation (§6): only after the egg has hatched and 2h since the last feed.
  const starving = pet.stage !== 'egg' && Date.now() - (pet.lastFedAt || 0) > STARVE_GRACE_MS;
  // A poop on the floor makes hygiene decay 3× faster.
  const hygMult = pet.poopInRoom ? 3 : 1;
  // v5 (§4): a dirty pet (hygiene < 35) loses happiness ~1.6× faster.
  const dirtyMult = c.hygiene < DIRTY_THRESHOLD ? DIRTY_DECAY_MULT : 1;
  // v7: a sick pet loses happiness ~2× faster (applied to awake decay only).
  const sickMult = pet.sick ? SICK_HAPPY_MULT : 1;
  if (pet.sleeping) {
    c.hunger -= DECAY_SLEEP.hunger * dtH;
    c.hygiene -= DECAY_SLEEP.hygiene * dtH * hygMult;
    c.happiness += DECAY_SLEEP.happiness * dtH;
  } else {
    c.hunger -= DECAY_AWAKE.hunger * dtH;
    c.happiness -= DECAY_AWAKE.happiness * dtH * (wounded ? 3 : 1) * dirtyMult * sickMult;
    c.hygiene -= DECAY_AWAKE.hygiene * dtH * hygMult;
  }
  // neglect drags happiness down
  if (c.hunger < 25 || c.hygiene < 25) c.happiness -= 6 * dtH;
  c.hunger = clamp(c.hunger, 0, 100);
  c.happiness = clamp(c.happiness, 0, 100);
  c.hygiene = clamp(c.hygiene, 0, 100);
  // v3 lifestyle drifts: spoiled fades, weight eases back toward its baseline.
  pet.spoiled = clamp((pet.spoiled || 0) - SPOILED_DECAY_PER_H * dtH, 0, 100);
  if (starving) {
    // Starvation weight drain overrides the normal drift and applies even while
    // asleep — a neglected pet keeps wasting away.
    pet.weight = clamp(pet.weight - STARVE_WEIGHT_PER_HR * dtH, 0, 100);
  } else {
    const wDelta = WEIGHT_DRIFT_PER_H * dtH;
    if (pet.weight > WEIGHT_TARGET) pet.weight = Math.max(WEIGHT_TARGET, pet.weight - wDelta);
    else if (pet.weight < WEIGHT_TARGET) pet.weight = Math.min(WEIGHT_TARGET, pet.weight + wDelta);
  }
  // HP: starvation HP drain applies ONLY while awake (a sleeping pet can't
  // starve to death — the sleep heal keeps running). Awake+starving overrides
  // the passive heal entirely and can reach 0 (death).
  if (starving && !pet.sleeping) {
    pet.hpCurrent = clamp(pet.hpCurrent - maxHp * STARVE_HP_PER_HR * dtH, 0, maxHp);
  } else if (pet.sick) {
    // v7: illness drains HP slowly (~4%/h) but NEVER kills (floor 1); it
    // overrides the passive heal so a sick pet can't heal up on its own.
    pet.hpCurrent = clamp(pet.hpCurrent - maxHp * ILL_HP_PER_HR * dtH, 1, maxHp);
  } else {
    // passive HP healing (awake +8%/h, sleeping +32%/h of max), floored at 1.
    const healRate = pet.sleeping ? HEAL_RATE_SLEEP : HEAL_RATE_AWAKE;
    pet.hpCurrent = clamp(pet.hpCurrent + maxHp * healRate * dtH, 1, maxHp);
  }
  // v7: illness accrual/onset. Only while hatched & not already sick: a
  // sustained sad OR hungry state fills illTimer; a healthy state drains it.
  if (pet.stage !== 'egg' && !pet.sick) {
    const badState = c.happiness < ILL_HAPPY_THRESH || c.hunger < ILL_HUNGER_THRESH;
    if (badState) {
      pet.illTimer = (pet.illTimer || 0) + dtSec * 1000;
      if (pet.illTimer >= ILL_ONSET_MS) {
        pet.sick = true;
        pet.illTimer = 0;
        toast(t('toast.gotSick', { name: pet.name }));
      }
    } else {
      pet.illTimer = Math.max(0, (pet.illTimer || 0) - dtSec * 1000 * ILL_RECOVER_MULT);
    }
  }
  // stamina regen: ~1 per 30s (2x sleeping)
  const rate = pet.sleeping ? 2 : 1;
  pet.stamina = clamp(pet.stamina + (dtSec / 30) * rate, 0, pet.genome.maxStamina);
}

function checkStageProgress(pet, dtSecOpen) {
  if (pet.stage === 'egg') {
    pet.eggOpenMs += dtSecOpen * 1000;
    if (pet.eggOpenMs >= EGG_HATCH_MS) {
      hatch();
    }
    return;
  }
  const dur = STAGE_DURATION_MS[pet.stage];
  if (dur && Date.now() - pet.stageEnteredAt >= dur) {
    if (advanceStage(pet)) {
      toast(t('toast.grew', { name: pet.name, stage: stageLabel(pet.stage) }));
      renderCurrentPet();
    }
  }
}

function hatch() {
  const pet = state.pet;
  if (!pet || pet.stage !== 'egg') return;
  advanceStage(pet); // -> baby
  pet.lastFedAt = Date.now(); // start the starvation clock at hatch, not egg birth
  scheduleNextPoop(pet); // start the 30-min potty timer at hatch
  toast(t('toast.hatched', { name: pet.name }));
  bouncePet();
  reaction('🎉');
  refresh();
  save();
}

// The per-second tick (driven by main.js). dtSec is real elapsed seconds.
export function tick(dtSec) {
  const pet = state.pet;
  if (!pet) return;
  pet.lastTick = Date.now();
  if (pet.state === 'dead') return; // frozen: wait for tap-to-send-off
  applyDecay(pet, dtSec);
  advancePoop(pet);
  if (detectDeath()) {
    refresh(); // starved to death this tick — show the send-off overlay
    return;
  }
  checkStageProgress(pet, dtSec);
  updateNotifications(pet); // §8: fire debounced notifications (best-effort)
  if (state.screen === 'pet') refreshBars();
  if (state.screen === 'train') refreshTrain();
  if (state.screen === 'menu') refreshMenu(); // live egg-cooldown countdown
  // periodic autosave (mutations also save explicitly)
  saveThrottle += dtSec;
  if (saveThrottle >= 8) {
    saveThrottle = 0;
    save();
  }
}

// Offline catch-up (called once at load). Age progression counts real time;
// egg hatch-by-time only counts app-open time so it is NOT advanced here.
function offlineCatchUp(pet) {
  const now = Date.now();
  if (pet.state === 'dead') { pet.lastTick = now; return; }
  let dt = (now - (pet.lastTick || now)) / 1000;
  if (dt <= 1) {
    pet.lastTick = now;
    return;
  }
  dt = Math.min(dt, OFFLINE_CAP_MS / 1000);
  applyDecay(pet, dt);
  // A pet CAN die while the app is closed (classic tamagotchi neglect).
  if (detectDeath()) { pet.lastTick = now; return; }
  // A potty-need pending at close just becomes an accident (no live countdown).
  if (pet.poopNeedUntil > 0) {
    pet.poopNeedUntil = 0;
    pet.poopInRoom = true;
    pet.poopScolded = false;
  }
  // age-based stage progression across offline time (skip egg)
  let guard = 0;
  while (pet.stage !== 'egg' && guard++ < 5) {
    const dur = STAGE_DURATION_MS[pet.stage];
    if (dur && now - pet.stageEnteredAt >= dur) {
      if (!advanceStage(pet)) break;
    } else break;
  }
  pet.lastTick = now;
}

// ---------------------------------------------------------------------------
// Care actions
// ---------------------------------------------------------------------------
function requirePet() {
  return state.pet && state.pet.stage !== 'egg' && state.pet.state !== 'dead';
}

// Mark an achievement (battle/training/play win) — feeds "deserved" cuddles.
function markAchievement() {
  if (state.pet) state.pet.lastAchievementAt = Date.now();
}

// v6 — arm the next potty need ~30 min from now. Called after any relief:
// hatch, a potty success, a floor cleanup, or a self-potty.
function scheduleNextPoop(pet) {
  pet.nextPoopAt = Date.now() + POOP_INTERVAL_MS;
}

// v6 — the 30-min poop timer + hidden grace. Runs every tick.
//  (1) timer elapsed & pet free  -> the need triggers (or a well-schooled pet
//      goes on its own); a thought-bubble shows near the pet (NO countdown).
//  (2) grace elapsed, need unmet -> an accident lands on the floor.
function advancePoop(pet) {
  if (pet.stage === 'egg' || pet.state === 'dead') return;
  const now = Date.now();
  if (pet.poopNeedUntil === 0 && !pet.poopInRoom && pet.nextPoopAt > 0 && now >= pet.nextPoopAt) {
    if (pet.education >= SELF_POTTY_EDU && Math.random() < 0.5) {
      // Well-schooled pet takes care of it on its own — resets the timer.
      scheduleNextPoop(pet);
      if (state.screen === 'pet') toast(t('toast.selfPotty', { name: pet.name }));
    } else {
      pet.poopNeedUntil = now + POOP_GRACE_MS; // hidden grace (not shown)
      if (state.screen === 'pet') toast(t('toast.needsPotty', { name: pet.name }));
    }
  }
  if (pet.poopNeedUntil > 0 && now >= pet.poopNeedUntil) {
    pet.poopNeedUntil = 0;
    pet.poopInRoom = true;
    pet.poopScolded = false;
    if (state.screen === 'pet') toast(t('toast.accident', { name: pet.name }));
  }
}

// ---------------------------------------------------------------------------
// Feed — opens a food picker; each food restores hunger and shifts weight.
// ---------------------------------------------------------------------------
export function openFoodPicker() {
  if (!requirePet()) return;
  const pet = state.pet;
  if (pet.care.hunger >= 98) {
    toast(t('toast.stuffed', { name: pet.name }));
    return;
  }
  const grid = $('food-grid');
  if (grid) {
    const keys = pet.stage === 'baby' ? FOODS_BABY : FOODS_CHILD;
    grid.innerHTML = keys
      .map((k) => {
        const fd = FOODS[k];
        return `<button class="food-item" data-food="${k}"><span class="f-ico">${fd.emoji}</span><span class="f-name">${foodName(k)}</span><span class="f-price">🪙 ${fd.cost}</span></button>`;
      })
      .join('');
    grid.querySelectorAll('.food-item').forEach((btn) => {
      btn.addEventListener('click', () => openFoodConfirm(btn.dataset.food));
    });
  }
  openSheet('food-sheet');
}

// v8 — tapping a food opens an in-page confirm popup (NOT native) showing its
// price + nonzero effects; only Confirm actually feeds. Cancel keeps the picker.
function openFoodConfirm(key) {
  const fd = FOODS[key];
  if (!fd) return;
  const lines = [t('confirm.price', { coins: fd.cost })];
  const fx = (label, v) => { if (v) lines.push(`${label} ${v > 0 ? '+' : ''}${v}`); };
  fx(t('bar.hunger'), fd.hunger);
  fx(t('bar.hp'), fd.hp);
  fx(t('bar.stamina'), fd.stamina);
  fx(t('bar.happiness'), fd.happy);
  fx(t('life.weight'), fd.weight);
  openConfirm({
    title: t('confirm.feedTitle', { food: foodName(key) }),
    emoji: fd.emoji,
    lines,
    onConfirm: () => doFeedFood(key),
  });
}

export function doFeedFood(key) {
  if (!requirePet()) return;
  const pet = state.pet;
  const fd = FOODS[key];
  if (!fd) return;
  const c = pet.care;
  // v5 (§2): foods cost coins. If short, toast and DON'T feed (sheet stays open
  // so the player can pick something cheaper).
  if ((pet.coins || 0) < fd.cost) {
    toast(t('shop.notEnough'));
    return;
  }
  // Spoiled pets may refuse non-sweet food; education tempers the tantrum.
  if (!fd.sweet) {
    const chance = (pet.spoiled / 150) * (1 - pet.education / 200);
    if (Math.random() < chance) {
      pet.lastMisbehaviorAt = Date.now();
      const idx = Math.floor(Math.random() * BRAT_LINE_COUNT);
      toast(t('brat.' + idx, { name: pet.name }));
      reaction('💢');
      closeSheet('food-sheet');
      save();
      return; // coins NOT spent, hunger not restored, meal not counted
    }
  }
  // Pay for the food.
  pet.coins = Math.max(0, (pet.coins || 0) - fd.cost);
  // Reduced hunger restore + a little HP and stamina back (clamped to max).
  const maxHp = computeStats(pet).hp;
  c.hunger = clamp(c.hunger + fd.hunger, 0, 100);
  c.happiness = clamp(c.happiness + fd.happy, 0, 100);
  pet.weight = clamp(pet.weight + fd.weight, 0, 100);
  pet.hpCurrent = clamp((pet.hpCurrent || 0) + fd.hp, 1, maxHp);
  pet.stamina = clamp(pet.stamina + fd.stamina, 0, pet.genome.maxStamina);
  // Same-food boredom streak (§2): same id increments, a different id resets.
  if (pet.lastFoodId === key) pet.sameFoodStreak = (pet.sameFoodStreak || 0) + 1;
  else pet.sameFoodStreak = 1;
  pet.lastFoodId = key;
  // v6 (§4): milk is EXEMPT from boredom — a baby can only drink milk, so
  // repeated milk must never sadden it (and babies never get bored of food).
  const boredExempt = key === 'milk' || pet.stage === 'baby';
  const bored = !boredExempt && pet.sameFoodStreak >= FOOD_BORED_STREAK;
  if (bored) c.happiness = clamp(c.happiness - FOOD_BORED_HAPPY, 0, 100);
  pet.lastFedAt = Date.now(); // any feed resets the starvation clock (§6)
  reaction(bored ? '😒' : fd.emoji);
  bouncePet();
  closeSheet('food-sheet');
  if (bored) toast(t('toast.boredFood', { name: pet.name, food: foodName(key).toLowerCase() }));
  else toast(t('toast.enjoyedFood', { name: pet.name, food: foodName(key).toLowerCase() }));
  checkLearning(); // weight may have crossed a milestone
  afterAction('yum!');
}

// ---------------------------------------------------------------------------
// Cuddle — deserved (recent achievement) gives more joy & no spoiling.
// ---------------------------------------------------------------------------
export function doCuddle() {
  if (!requirePet()) return;
  const pet = state.pet;
  const c = pet.care;
  const deserved = pet.lastAchievementAt > 0 && Date.now() - pet.lastAchievementAt <= ACHIEVEMENT_WINDOW_MS;
  if (deserved) {
    c.happiness = clamp(c.happiness + 15, 0, 100);
    toast(t('toast.cuddleDeserved', { name: pet.name }));
  } else {
    c.happiness = clamp(c.happiness + 6, 0, 100);
    pet.spoiled = clamp(pet.spoiled + 8, 0, 100);
    toast(t('toast.cuddleSpoiled', { name: pet.name }));
  }
  reaction('💗');
  bouncePet();
  afterAction('cuddle!');
}

// ---------------------------------------------------------------------------
// Potty — resolve a pending need (no mess) or clean up an accident.
// ---------------------------------------------------------------------------
export function doPotty() {
  if (!requirePet()) return;
  const pet = state.pet;
  const c = pet.care;
  if (pet.poopNeedUntil > 0) {
    pet.poopNeedUntil = 0;
    scheduleNextPoop(pet); // relieved in time -> restart the 30-min timer
    c.happiness = clamp(c.happiness + 4, 0, 100);
    reaction('🚽');
    toast(t('toast.pottyGood', { name: pet.name }));
  } else if (pet.poopInRoom) {
    pet.poopInRoom = false;
    pet.poopScolded = false;
    scheduleNextPoop(pet); // cleaned up -> restart the 30-min timer
    c.hygiene = clamp(c.hygiene + 8, 0, 100);
    reaction('🧹');
    toast(t('toast.messCleaned'));
  } else {
    toast(t('toast.noPottyNeeded', { name: pet.name }));
    return;
  }
  bouncePet();
  afterAction('potty!');
}

// ---------------------------------------------------------------------------
// Scold — valid only for a fresh accident or a recent refusal.
// ---------------------------------------------------------------------------
export function doScold() {
  if (!requirePet()) return;
  const pet = state.pet;
  const c = pet.care;
  const now = Date.now();
  const poopValid = pet.poopInRoom && !pet.poopScolded;
  const misValid = pet.lastMisbehaviorAt > 0 && now - pet.lastMisbehaviorAt <= MISBEHAVIOR_WINDOW_MS;
  const strikeValid = (pet.trainBlockUntil || 0) > now; // scolding ends a training strike
  if (poopValid || misValid || strikeValid) {
    pet.education = clamp(pet.education + 8, 0, 100);
    pet.spoiled = clamp(pet.spoiled - 10, 0, 100);
    c.happiness = clamp(c.happiness - 3, 0, 100);
    if (poopValid) pet.poopScolded = true;
    if (misValid) pet.lastMisbehaviorAt = 0;
    if (strikeValid) { pet.trainBlockUntil = 0; refreshTrain(); } // training available again
    reaction('📢');
    toast(t('toast.scoldLearn', { name: pet.name }));
    checkLearning(); // education may have crossed a milestone
  } else {
    c.happiness = clamp(c.happiness - 10, 0, 100);
    reaction('😢');
    toast(t('toast.scoldInvalid', { name: pet.name }));
  }
  afterAction('scold');
}

// Clean (🫧) — v5 (§4, updated): a PARTIAL bath. Raises hygiene by +75 (capped
// at 100) but does NOT clear poop (that stays the Potty button's job), and pets
// dislike baths so happiness drops by 8.
export function doClean() {
  if (!requirePet()) return;
  const c = state.pet.care;
  c.hygiene = clamp(c.hygiene + 75, 0, 100);
  c.happiness = clamp(c.happiness - 8, 0, 100);
  reaction('🫧');
  bouncePet();
  afterAction('bath time!');
}

export function doSleep() {
  if (!requirePet()) return;
  state.pet.sleeping = !state.pet.sleeping;
  reaction(state.pet.sleeping ? '💤' : '☀️');
  toast(state.pet.sleeping
    ? t('toast.napping', { name: state.pet.name })
    : t('toast.wokeUp', { name: state.pet.name }));
  renderCurrentPet();
  refresh();
  save();
}

// Play = a quick Rock-Paper-Scissors minigame (see RPS section below).
export function doPlay() {
  if (!requirePet()) return;
  const pet = state.pet;
  if (pet.sleeping) pet.sleeping = false;
  // v6: playing no longer costs or requires stamina.
  openRps();
}

// v6 — Heal (🩹) is ALWAYS FREE but limited to once every 4 hours. It never
// charges coins: for an off-cooldown top-up players buy a Cure Potion. While
// on cooldown, pressing Heal just refuses with a toast (no coins deducted).
export function doHeal() {
  if (!requirePet()) return;
  const pet = state.pet;
  const maxHp = computeStats(pet).hp;
  if (pet.hpCurrent >= maxHp) {
    toast(t('toast.fullHealth'));
    return;
  }
  if (healCooldownRemaining(pet) > 0) {
    toast(t('toast.healNotReady'));
    return;
  }
  pet.lastFreeHealAt = Date.now();
  pet.hpCurrent = maxHp;
  reaction('🩹');
  bouncePet();
  toast(t('toast.patchedUp', { name: pet.name }));
  afterAction('healed!');
}

function afterAction(mood) {
  refresh();
  save();
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------
export function doTrain(name) {
  const pet = state.pet;
  if (!pet) return;
  if (pet.state === 'dead') return;
  const isSpecial = name === 'Special';
  const ex = EXERCISES[name];
  if (!isSpecial && !ex) return;
  // v10: Special is gated on stage (child+); basics only need the egg hatched.
  if (isSpecial) {
    if (STAGE_ORDER.indexOf(pet.stage) < STAGE_ORDER.indexOf('child')) {
      toast(t('toast.specialLocked', { name: pet.name }));
      return;
    }
  } else if (pet.stage === 'egg') {
    toast(t('toast.eggFirst'));
    return;
  }
  if (pet.sleeping) {
    toast(t('toast.asleep', { name: pet.name }));
    return;
  }
  // v5.1: while on strike (after a refusal) ALL training is locked for 5 minutes.
  if (Date.now() < (pet.trainBlockUntil || 0)) {
    toast(t('toast.trainBlocked', { name: pet.name, time: fmtDuration(pet.trainBlockUntil - Date.now()) }));
    return;
  }
  // v6.1/v10: per-exercise stamina cost — 20 for the basics, 100 for Special.
  const staminaCost = isSpecial ? SPECIAL_STAMINA_COST : TRAIN_STAMINA_COST;
  if (pet.stamina < staminaCost) {
    toast(t('toast.tooTired', { name: pet.name }));
    return;
  }
  // Refusal (free): laziness + spoiled, tempered by education. A refusal puts the
  // pet ON STRIKE — ALL training locks for 5 min (clear early by scolding).
  const refuseChance = (pet.genome.laziness * 0.35 + pet.spoiled / 300) * (1 - pet.education / 200);
  if (Math.random() < refuseChance) {
    pet.lastMisbehaviorAt = Date.now();
    pet.trainBlockUntil = Date.now() + TRAIN_BLOCK_MS;
    const idx = Math.floor(Math.random() * LAZY_LINE_COUNT);
    toast(t('lazy.' + idx, { name: pet.name }));
    reaction('💢');
    refreshTrain();
    save();
    return;
  }
  // v10: Special training — a high-cost gamble that teaches a random move.
  // Cost: 100 stamina + halve happiness + halve HP (floor 1). No stat gain —
  // the move IS the reward.
  if (isSpecial) {
    pet.stamina = clamp(pet.stamina - SPECIAL_STAMINA_COST, 0, pet.genome.maxStamina);
    pet.care.happiness = clamp(pet.care.happiness * 0.5, 0, 100);
    const maxHp = computeStats(pet).hp;
    pet.hpCurrent = clamp(Math.floor((pet.hpCurrent || maxHp) * 0.5), 1, maxHp);
    const learned = learnRandomMove(pet);
    markAchievement();
    reaction('🌟');
    bouncePet();
    playTrainingAnim('Special');
    if (learned) {
      toast(t('toast.specialLearned', { name: pet.name, icon: elementIcon(learned.element), move: learned.name }));
      // If the new move couldn't auto-equip (all 4 slots full), hint the player.
      const eq = Array.isArray(pet.equipped) ? pet.equipped : [];
      if (eq.indexOf(learned.id) < 0) {
        setTimeout(() => toast(t('toast.moveNotEquipped')), 1400);
      }
    }
    refresh();
    refreshTrain();
    if (state.screen === 'moves') refreshMoves();
    save();
    return;
  }
  // pay costs (v6.1: flat 20 stamina + hunger/hygiene/weight)
  pet.stamina = clamp(pet.stamina - TRAIN_STAMINA_COST, 0, pet.genome.maxStamina);
  pet.care.hunger = clamp(pet.care.hunger - ex.hunger, 0, 100);
  pet.care.hygiene = clamp(pet.care.hygiene - ex.hygiene - TRAIN_HYGIENE_HIT, 0, 100);
  // Working out burns a little weight (running burns the most).
  pet.weight = clamp(pet.weight - (name === 'Run' ? 2.5 : 1.5), 0, 100);
  // gain = base * affinity * diminishing(current training)
  const cur = pet.training[ex.stat] || 0;
  const dim = 1 / (1 + cur * 0.05);
  const gain = ex.base * pet.genome.affinity[ex.stat] * dim;
  addTraining(pet, ex.stat, gain);
  const leveled = grantXp(pet, 6);
  pet.trainingsDone = (pet.trainingsDone || 0) + 1; // feeds 'trainings' unlocks
  markAchievement(); // a completed session counts as an achievement
  reaction(ex.emoji);
  bouncePet();
  playTrainingAnim(name); // pet trots on, works out, trots off (v5.1)
  const shown = Math.max(1, Math.round(gain * 10) / 10);
  toast(t('toast.trained', { name: pet.name, ex: t('train.' + name.toLowerCase()), amount: shown, stat: ex.label }));
  if (leveled > 0) setTimeout(() => toast(t('toast.reachedLevel', { name: pet.name, level: pet.level })), 700);
  // Level up, a completed session, and possible weight loss can all unlock moves.
  setTimeout(checkLearning, leveled > 0 ? 1100 : 400);
  refresh();
  refreshTrain();
  save();
}

// ---------------------------------------------------------------------------
// Bottom-sheet helpers (food picker / RPS)
// ---------------------------------------------------------------------------
function openSheet(id) {
  const el = $(id);
  if (el) el.classList.add('open');
}
function closeSheet(id) {
  const el = $(id);
  if (el) el.classList.remove('open');
}

// ---------------------------------------------------------------------------
// v8 — reusable in-page confirm popup (#confirm-popup). openConfirm shows a
// title + emoji + detail lines with Confirm/Cancel. Confirm runs onConfirm then
// closes; Cancel (or backdrop) just closes (any picker underneath stays open).
// ---------------------------------------------------------------------------
let confirmAction = null;
export function openConfirm({ title, emoji, lines, onConfirm } = {}) {
  const pop = $('confirm-popup');
  if (!pop) return;
  setText('confirm-title', title || '');
  const emo = $('confirm-emoji');
  if (emo) { emo.textContent = emoji || ''; emo.style.display = emoji ? '' : 'none'; }
  const linesEl = $('confirm-lines');
  if (linesEl) {
    linesEl.innerHTML = '';
    (lines || []).forEach((ln) => {
      const d = document.createElement('div');
      d.className = 'confirm-line';
      d.textContent = ln;
      linesEl.appendChild(d);
    });
  }
  setText('confirm-ok', t('confirm.confirm'));
  setText('confirm-cancel', t('confirm.cancel'));
  confirmAction = typeof onConfirm === 'function' ? onConfirm : null;
  pop.classList.add('open');
}
function closeConfirm() {
  const pop = $('confirm-popup');
  if (pop) pop.classList.remove('open');
  confirmAction = null;
}

// ---------------------------------------------------------------------------
// Play — Rock-Paper-Scissors minigame (UI-side Math.random, NOT the engine).
// ---------------------------------------------------------------------------
const RPS_EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

function openRps() {
  const pet = state.pet;
  const nameEl = $('rps-petname');
  if (nameEl) nameEl.textContent = pet ? pet.name : 'Pet';
  setText('rps-you', '❔');
  setText('rps-pet', '❔');
  setText('rps-result', t('rps.pick'));
  openSheet('rps-sheet');
}

export function playRps(choice) {
  if (!requirePet()) return;
  const pet = state.pet;
  if (!RPS_EMOJI[choice]) return;
  // v6: playing no longer costs or requires stamina.
  const opts = ['rock', 'paper', 'scissors'];
  const petChoice = opts[Math.floor(Math.random() * opts.length)];
  const youEl = $('rps-you');
  const petEl = $('rps-pet');
  if (youEl) {
    youEl.textContent = RPS_EMOJI[choice];
    youEl.classList.remove('reveal');
    void youEl.offsetWidth;
    youEl.classList.add('reveal');
  }
  if (petEl) {
    petEl.textContent = RPS_EMOJI[petChoice];
    petEl.classList.remove('reveal');
    void petEl.offsetWidth;
    petEl.classList.add('reveal');
  }
  const c = pet.care;
  let msg;
  if (choice === petChoice) {
    c.happiness = clamp(c.happiness + 6, 0, 100);
    msg = t('rps.tie');
  } else if (RPS_BEATS[choice] === petChoice) {
    c.happiness = clamp(c.happiness + 12, 0, 100);
    markAchievement();
    msg = t('rps.win');
  } else {
    c.happiness = clamp(c.happiness + 4, 0, 100);
    msg = t('rps.lose', { name: pet.name });
  }
  setText('rps-result', msg);
  refresh();
  save();
}

// ---------------------------------------------------------------------------
// Poop indicators (need badge + countdown, and the on-floor mess)
// ---------------------------------------------------------------------------
function refreshPoopUI() {
  const pet = state.pet;
  const need = $('poop-need');
  const mess = $('poop-mess');
  if (!pet) return;
  // v6: a cute thought-bubble while the need is active — NO countdown shown.
  if (need) need.style.display = pet.poopNeedUntil > 0 ? '' : 'none';
  if (mess) mess.style.display = pet.poopInRoom ? '' : 'none';
}

// ---------------------------------------------------------------------------
// Info panel (level, XP, battle stats, lifestyle, species traits)
// ---------------------------------------------------------------------------
export function toggleInfo(force) {
  const panel = $('info-panel');
  if (!panel) return;
  const open = force == null ? !panel.classList.contains('open') : force;
  panel.classList.toggle('open', open);
  if (open) renderInfo();
}

function renderInfo() {
  const pet = state.pet;
  if (!pet) return;
  setText('info-name', pet.name);
  setText('info-stage', pet.stage === 'egg'
    ? stageLabel('egg')
    : stageLabel(pet.stage) + ' · ' + t('info.lv', { n: pet.level }));
  const need = xpForNext(pet.level);
  const xpFill = $('info-xp');
  if (xpFill) xpFill.style.width = clamp((pet.xp / need) * 100, 0, 100) + '%';
  setText('info-xp-label', t('info.xp', { cur: Math.floor(pet.xp), need }));
  const stats = computeStats(pet);
  setChip('stat-str', stats.str);
  setChip('stat-hp', stats.hp);
  setChip('stat-spd', stats.spd);
  setChip('stat-def', stats.def);
  setChip('stat-crit', stats.crit);
  setLife('life-weight', 'life-weight-v', pet.weight);
  setLife('life-edu', 'life-edu-v', pet.education);
  setLife('life-spoiled', 'life-spoiled-v', pet.spoiled);
  setChip('trait-stamina', pet.genome.maxStamina);
  setChip('trait-lazy', pet.genome.laziness.toFixed(2));

  // Element line.
  const el = ELEMENTS.indexOf(pet.genome.element) >= 0 ? pet.genome.element : 'none';
  setText('info-element', `${elementIcon(el)} ${elementLabel(el)}`);

  // Moveset: known moves highlighted, locked ones show an unlock hint.
  const movesEl = $('info-moves');
  if (movesEl) {
    const known = new Set(Array.isArray(pet.moves) ? pet.moves : ['attack']);
    movesEl.innerHTML = getLearnset(pet)
      .map((ab) => {
        const unlocked = known.has(ab.id);
        const ic = elementIcon(ab.element);
        const pw = `×${ab.power.toFixed(2)}`;
        const right = unlocked
          ? `<span class="move-pw">${pw}</span>`
          : `<span class="move-hint">🔒 ${unlockHint(ab.unlock)}</span>`;
        return `<div class="move-item${unlocked ? '' : ' locked'}"><span class="move-ico">${ic}</span><span class="move-name">${ab.name}</span>${right}</div>`;
      })
      .join('');
  }
}

function setLife(barId, valId, v) {
  const bar = $(barId);
  if (bar) bar.style.width = clamp(v, 0, 100) + '%';
  setChip(valId, Math.round(v));
}
function setText(id, s) {
  const el = $(id);
  if (el) el.textContent = s;
}

// ---------------------------------------------------------------------------
// Rendering the pet + UI refresh
// ---------------------------------------------------------------------------
export function renderCurrentPet() {
  renderPetCustom(null);
}

// Render the current pet with optional extra opts (used by the send-off
// fly-away animation, which passes { dead:true, flyAway:true }).
function renderPetCustom(extra) {
  const pet = state.pet;
  const svg = $('pet-svg');
  if (!pet || !svg) return;
  // v5 (§4/§5): dirty (hygiene<35) or starving forces a sad mood (sad mouth),
  // and dirty also shows the smudge/fly overlay.
  const dirty = pet.stage !== 'egg' && pet.state !== 'dead' && pet.care.hygiene < DIRTY_THRESHOLD;
  const sad = pet.care.happiness < 30 || dirty || isStarving(pet);
  const mood = pet.sleeping ? 'sleepy' : sad ? 'sad' : 'idle';
  // Chubbiness: map weight 30..100 -> 0..1 so a heavier pet looks squatter.
  const chubby = clamp((pet.weight - 30) / 70, 0, 1);
  const opts = {
    animate: true,
    mood,
    tired: pet.sleeping,
    eggTaps: pet.eggTaps,
    chubby,
    element: pet.genome.element,
    dirty,
    sick: pet.stage !== 'egg' && pet.state !== 'dead' && !!pet.sick,
    dead: pet.state === 'dead',
  };
  if (extra) Object.assign(opts, extra);
  renderPet(svg, pet.genome, pet.stage, opts);
}

const BAR_KEYS = ['hunger', 'happiness', 'hygiene'];

function refreshBars() {
  const pet = state.pet;
  if (!pet) return;
  for (const k of BAR_KEYS) {
    const fill = $('bar-' + k);
    if (fill) {
      const v = Math.round(pet.care[k]);
      fill.style.width = v + '%';
      fill.parentElement.classList.toggle('low', v < 25);
    }
  }
  // HP bar (% of max). Below 50% = wounded => pulse.
  const maxHp = computeStats(pet).hp;
  const hp = $('bar-hp');
  if (hp) {
    const pct = clamp((pet.hpCurrent / maxHp) * 100, 0, 100);
    hp.style.width = pct + '%';
    hp.parentElement.classList.toggle('low', pct < 50);
  }
  // Stamina bar (% of max).
  const st = $('bar-stamina');
  if (st) {
    const pct = clamp((pet.stamina / pet.genome.maxStamina) * 100, 0, 100);
    st.style.width = pct + '%';
    const lbl = $('stamina-label');
    if (lbl) lbl.textContent = `${Math.floor(pet.stamina)}/${pet.genome.maxStamina}`;
  }
  refreshPoopUI();
  const starveBadge = $('starve-badge');
  if (starveBadge) starveBadge.style.display = isStarving(pet) ? '' : 'none';
  // v7: sick badge (🤒) — only while hatched, alive and sick.
  const sickBadge = $('sick-badge');
  if (sickBadge) sickBadge.style.display = (pet.sick && pet.stage !== 'egg' && pet.state !== 'dead') ? '' : 'none';
  // v7: Heal button — DISABLED with a live countdown while the free-heal cools
  // down; re-enables (and relabels to "Heal") the moment the cooldown expires.
  const healBtn = $('btn-heal');
  if (healBtn) {
    const rem = healCooldownRemaining(pet);
    const label = healBtn.querySelector('.act-label');
    if (rem > 0) {
      healBtn.disabled = true;
      healBtn.classList.add('disabled');
      if (label) label.textContent = t('action.healCooldown', { time: fmtDuration(rem) });
    } else {
      healBtn.disabled = false;
      healBtn.classList.remove('disabled');
      if (label) label.textContent = t('action.heal');
    }
  }
}

export function refresh() {
  const pet = state.pet;
  if (!pet) return;
  renderCurrentPet();
  refreshBars();

  const nameEl = $('pet-name');
  if (nameEl) nameEl.textContent = pet.name;
  const stageEl = $('pet-stage-label');
  if (stageEl) stageEl.textContent = pet.stage === 'egg'
    ? stageLabel('egg')
    : stageLabel(pet.stage) + ' · ' + t('info.lv', { n: pet.level });

  const stats = computeStats(pet);
  // Level/XP, battle stats and lifestyle now live in the info panel; keep it
  // fresh so it's up to date whenever the player slides it open.
  renderInfo();

  // death / egg / living UI
  const eggHint = $('egg-hint');
  const careUI = $('care-ui');
  const deathOverlay = $('death-overlay');
  const dead = pet.state === 'dead';
  if (deathOverlay) {
    deathOverlay.style.display = dead ? '' : 'none';
    if (dead) {
      const dt = $('death-text');
      if (dt) dt.textContent = t('pet.deathText', { name: pet.name });
    }
  }
  if (dead) {
    if (eggHint) eggHint.style.display = 'none';
    if (careUI) careUI.style.display = 'none';
  } else if (pet.stage === 'egg') {
    if (eggHint) {
      eggHint.style.display = '';
      const tapsLeft = Math.max(0, EGG_HATCH_TAPS - pet.eggTaps);
      eggHint.textContent = t('pet.eggHintTaps', { taps: tapsLeft });
    }
    if (careUI) careUI.style.display = 'none';
  } else {
    if (eggHint) eggHint.style.display = 'none';
    if (careUI) careUI.style.display = '';
  }

  // sleep button label
  const sleepBtn = $('btn-sleep');
  if (sleepBtn) sleepBtn.querySelector('.act-label').textContent = pet.sleeping ? t('action.wake') : t('action.sleep');

  // coins in the top bar
  const coinsEl = $('pet-coins');
  if (coinsEl) coinsEl.textContent = `🪙 ${pet.coins || 0}`;

  // v5 (§5): dark-blue night overlay over the stage while sleeping.
  const stageWrap = $('pet-stage');
  if (stageWrap) stageWrap.classList.toggle('night', !!pet.sleeping && pet.stage !== 'egg' && !dead);

  // keep the shop / menu labels fresh if either is on screen
  if (state.screen === 'shop') refreshShop();
  if (state.screen === 'menu') refreshMenu();

  // wounded status badge (HP < 50% of max)
  const statusEl = $('pet-status');
  const woundedNow = pet.stage !== 'egg' && pet.hpCurrent < stats.hp * 0.5;
  if (statusEl) statusEl.style.display = woundedNow ? '' : 'none';

  // v6: Heal is always FREE (4h cooldown enforced on press), so the button is
  // just "Heal" — no price, no countdown. The static data-i18n label handles it.
}

// Milliseconds until the next free heal (0 = free heal available now).
function healCooldownRemaining(pet) {
  const last = typeof pet.lastFreeHealAt === 'number' ? pet.lastFreeHealAt : 0;
  return Math.max(0, last + HEAL_FREE_COOLDOWN_MS - Date.now());
}

// Compact duration label like "3h", "2h 13m", "12m".
function fmtDuration(ms) {
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function setChip(id, v) {
  const el = $(id);
  if (el) el.textContent = v;
}

function refreshTrain() {
  const pet = state.pet;
  if (!pet) return;
  const st = $('train-stamina');
  if (st) st.textContent = t('train.staminaValue', { cur: Math.floor(pet.stamina), max: pet.genome.maxStamina });
  const stFill = $('train-stamina-fill');
  if (stFill) stFill.style.width = (pet.stamina / pet.genome.maxStamina) * 100 + '%';
  const blocked = Date.now() < (pet.trainBlockUntil || 0);
  // v5.1: "on strike" badge with a live countdown
  const badge = $('train-strike');
  if (badge) {
    if (blocked) {
      badge.style.display = '';
      badge.textContent = t('train.onStrike', { time: fmtDuration(pet.trainBlockUntil - Date.now()) });
    } else {
      badge.style.display = 'none';
    }
  }
  // disable exercises while on strike, still an egg, or too tired (v6.1: 20⚡ gate)
  const tooTired = pet.stamina < TRAIN_STAMINA_COST;
  const stageIdx = STAGE_ORDER.indexOf(pet.stage);
  document.querySelectorAll('.exercise').forEach((btn) => {
    if (btn.dataset.ex === 'Special') {
      // v10: Special needs child+, 100 stamina, and is subject to the strike lock.
      const lockedStage = stageIdx < STAGE_ORDER.indexOf('child');
      const tooTiredSp = pet.stamina < SPECIAL_STAMINA_COST;
      btn.classList.toggle('disabled', blocked || lockedStage || tooTiredSp);
      return;
    }
    const ex = EXERCISES[btn.dataset.ex];
    if (!ex) return;
    btn.classList.toggle('disabled', blocked || pet.stage === 'egg' || tooTired);
  });
}

// v5.1: on a successful session, the pet trots onto the training stage, does a
// few workout reps, then trots off. Purely cosmetic (CSS-driven).
let trainAnimTimer = 0;
function playTrainingAnim(name) {
  const stage = $('train-stage');
  const svg = $('train-svg');
  const pet = state.pet;
  if (!stage || !svg || !pet) return;
  renderPet(svg, pet.genome, pet.stage, { animate: true, element: pet.genome.element });
  const emo = $('train-emoji');
  const ex = EXERCISES[name];
  if (emo) emo.textContent = name === 'Special' ? '🌟' : (ex ? ex.emoji : '💪');
  stage.classList.remove('perform');
  void stage.offsetWidth; // reflow so the animation restarts on rapid repeats
  stage.classList.add('show', 'perform');
  clearTimeout(trainAnimTimer);
  trainAnimTimer = setTimeout(() => stage.classList.remove('perform', 'show'), 2600);
}

// ---------------------------------------------------------------------------
// v10 — Moves management screen. Lists KNOWN moves with an Equip/Unequip toggle
// (max 4 equipped, never below 1) and LOCKED moves greyed with their unlock hint.
// ---------------------------------------------------------------------------
function moveMetaLine(ab) {
  const parts = [`×${ab.power.toFixed(2)}`];
  if ((ab.cooldown | 0) > 0) parts.push(`⏳${ab.cooldown | 0}`);
  if ((ab.priority | 0) > 0) parts.push('⚡');
  return parts.join('   ');
}

function refreshMoves() {
  const pet = state.pet;
  if (!pet) return;
  const eq = Array.isArray(pet.equipped) ? pet.equipped : [];
  const equippedCount = getEquipped(pet).length;
  setText('moves-equipped', t('moves.equipped', { n: equippedCount }));

  const known = getKnownMoves(pet);
  const knownIdSet = new Set(known.map((a) => a.id));
  const knownEl = $('moves-known');
  if (knownEl) {
    knownEl.innerHTML = '';
    known.forEach((ab) => {
      const isEq = eq.indexOf(ab.id) >= 0;
      const row = document.createElement('div');
      row.className = 'move-manage-row';
      row.innerHTML = `<span class="mm-ico">${elementIcon(ab.element)}</span>`
        + `<span class="mm-body"><span class="mm-name">${ab.name}</span><span class="mm-sub">${moveMetaLine(ab)}</span></span>`;
      const btn = document.createElement('button');
      btn.className = 'mm-toggle' + (isEq ? ' equipped' : '');
      btn.textContent = isEq ? t('moves.unequip') : t('moves.equip');
      // Enforce the 4-cap: disable further Equip at 4; can't unequip the last one.
      btn.disabled = isEq ? (equippedCount <= 1) : (equippedCount >= 4);
      btn.addEventListener('click', () => toggleEquip(ab.id));
      row.appendChild(btn);
      knownEl.appendChild(row);
    });
  }

  const lockedEl = $('moves-locked');
  if (lockedEl) {
    lockedEl.innerHTML = '';
    const locked = getLearnset(pet).filter((a) => !knownIdSet.has(a.id));
    locked.forEach((ab) => {
      const row = document.createElement('div');
      row.className = 'move-manage-row locked';
      row.innerHTML = `<span class="mm-ico">${elementIcon(ab.element)}</span>`
        + `<span class="mm-body"><span class="mm-name">${ab.name}</span><span class="mm-sub">×${ab.power.toFixed(2)}</span></span>`
        + `<span class="mm-hint">🔒 ${unlockHint(ab.unlock)}</span>`;
      lockedEl.appendChild(row);
    });
  }
}

function toggleEquip(id) {
  const pet = state.pet;
  if (!pet) return;
  const isEq = Array.isArray(pet.equipped) && pet.equipped.indexOf(id) >= 0;
  if (isEq) {
    if (!unequipMove(pet, id)) { toast(t('moves.cantRemoveLast')); return; }
  } else if (!equipMove(pet, id)) {
    toast(t('moves.maxReached'));
    return;
  }
  save();
  refreshMoves();
}

// ---------------------------------------------------------------------------
// Egg tapping
// ---------------------------------------------------------------------------
function tapEgg() {
  const pet = state.pet;
  if (!pet || pet.stage !== 'egg') return;
  pet.eggTaps++;
  bouncePet();
  reaction('💗');
  if (pet.eggTaps >= EGG_HATCH_TAPS) {
    hatch();
  } else {
    refresh();
    save();
  }
}

// ---------------------------------------------------------------------------
// New egg / reset
// ---------------------------------------------------------------------------
export function newEgg(name, seed) {
  state.pet = createPet(name, seed != null ? seed >>> 0 : randomSeed());
  save();
  showScreen('pet');
  refresh();
  toast(t('toast.mysteriousEgg'));
}

// "Reset Everything" is now the ONLY way to start over — a full account wipe:
// the pet, the Rivals roster, coins and all progress are cleared, and a brand
// new egg (400 coins) is hatched. (There is no separate "new egg" button/timer.)
export function resetGame() {
  clearGame();
  clearRivals();
  newEgg('Slime', randomSeed());
  save();
}

// v6 — in-page two-step reset confirmation (replaces the native confirm(),
// which hangs the preview and is jarring). First press arms + shows a warning
// and a Cancel; a second press within the window wipes everything. Auto-disarms
// after RESET_DISARM_MS.
let resetArmed = false;
let resetDisarmTimer = 0;
const RESET_DISARM_MS = 4000;

function armReset() {
  resetArmed = true;
  const warn = $('reset-warning');
  const cancel = $('btn-reset-cancel');
  const btn = $('btn-reset');
  if (warn) warn.style.display = '';
  if (cancel) cancel.style.display = '';
  if (btn) { btn.textContent = t('menu.resetConfirm'); btn.classList.add('armed'); }
  clearTimeout(resetDisarmTimer);
  resetDisarmTimer = setTimeout(disarmReset, RESET_DISARM_MS);
}

function disarmReset() {
  resetArmed = false;
  clearTimeout(resetDisarmTimer);
  const warn = $('reset-warning');
  const cancel = $('btn-reset-cancel');
  const btn = $('btn-reset');
  if (warn) warn.style.display = 'none';
  if (cancel) cancel.style.display = 'none';
  if (btn) { btn.textContent = t('menu.reset'); btn.classList.remove('armed'); }
}

export function save() {
  saveGame(state);
}

// ---------------------------------------------------------------------------
// Battle glue for Agent B (window.SlimeGame)
// ---------------------------------------------------------------------------
function canBattle() {
  // Battles no longer cost stamina, so they're never blocked by low stamina.
  return !!(state.pet && state.pet.stage !== 'egg' && state.pet.state !== 'dead');
}

function payBattleCost() {
  const pet = state.pet;
  if (!pet) return;
  // Battles do NOT use stamina anymore; they still make the pet a little hungry.
  pet.care.hunger = clamp(pet.care.hunger - 8, 0, 100);
  save();
}

// Coin rewards for winning a battle.
const COINS_WILD_WIN = 15;
const COINS_PVP_WIN = 25;
const COINS_RIVAL_WIN = 20;

// Called by battle-ui once a battle ends. `info` carries:
//   remainingHp : the player's fighter HP at battle end (int)
//   kind        : 'wild' | 'pvp'
//   draw        : true if the battle was a draw
// Returns { leveledUp, coins } for the result screen.
function grantBattleResult(won, info) {
  const pet = state.pet;
  if (!pet) return { leveledUp: 0, coins: 0 };
  info = info || {};
  const leveled = grantBattleXp(pet, won);
  const maxHp = computeStats(pet).hp;

  // HP writeback (DESIGN v4 §4 — updated rule):
  //  win / draw ⇒ keep the ACTUAL in-battle HP the fighter walked away with.
  //  loss (faint) ⇒ 5% of max HP. Battles NEVER kill (5% > 0 ⇒ floor 1).
  if (won || info.draw) {
    if (typeof info.remainingHp === 'number' && isFinite(info.remainingHp)) {
      pet.hpCurrent = clamp(info.remainingHp, 1, maxHp);
    }
    if (info.draw && !won) {
      // draw: no happiness penalty
    }
  } else {
    pet.hpCurrent = Math.max(1, Math.round(0.05 * maxHp));
    pet.care.happiness = clamp(pet.care.happiness - 15, 0, 100);
  }

  let coins = 0;
  if (won) {
    coins = info.kind === 'pvp' ? COINS_PVP_WIN
      : info.kind === 'rival' ? COINS_RIVAL_WIN
      : COINS_WILD_WIN;
    pet.coins = (pet.coins || 0) + coins;
    pet.battleWins = (pet.battleWins || 0) + 1; // feeds 'wins' unlocks
    markAchievement();
  }

  // A win (XP/level + battleWins) can unlock new moves.
  checkLearning();

  save();
  refresh();
  return { leveledUp: leveled, coins };
}

// ---------------------------------------------------------------------------
// v5 — New-egg cooldown (§7)
// The menu has no dynamic content anymore (the timed "new egg" button was
// removed — "Reset Everything" is the only restart). Kept as a no-op so the
// existing call sites (showScreen/tick/onLangChange) stay valid.
function refreshMenu() {
  // v6: the notifications toggle lives on the Menu screen now (was in the Shop).
  updateNotifyButton();
}

// ---------------------------------------------------------------------------
// v5 — Shop (§6)
// ---------------------------------------------------------------------------
function refreshShop() {
  const pet = state.pet;
  const c = $('shop-coins');
  if (c) c.textContent = `🪙 ${(pet && pet.coins) || 0}`;
}

// Cure Potion — fully restores HP (no cooldown, unlike the free Heal).
function doBuyCure() {
  const pet = state.pet;
  if (!pet) return;
  if ((pet.coins || 0) < CURE_COST) { toast(t('shop.notEnough')); return; }
  const maxHp = computeStats(pet).hp;
  if (pet.hpCurrent >= maxHp) { toast(t('toast.fullHealth')); return; }
  pet.coins -= CURE_COST;
  pet.hpCurrent = maxHp;
  reaction('❤️');
  toast(t('shop.boughtCure', { name: pet.name }));
  refreshShop();
  refresh();
  save();
}

// Stamina Potion — fully restores stamina.
function doBuyStamina() {
  const pet = state.pet;
  if (!pet) return;
  if ((pet.coins || 0) < STAMINA_POTION_COST) { toast(t('shop.notEnough')); return; }
  if (pet.stamina >= pet.genome.maxStamina) { toast(t('shop.staminaFull', { name: pet.name })); return; }
  pet.coins -= STAMINA_POTION_COST;
  pet.stamina = pet.genome.maxStamina;
  reaction('⚡');
  toast(t('shop.boughtStamina', { name: pet.name }));
  refreshShop();
  refresh();
  save();
}

// v7 — Syringe (💉): cures illness. Refused FREE if the pet isn't sick; costs
// 50 coins otherwise, clears the sickness and gives a little happiness back.
function doBuySyringe() {
  const pet = state.pet;
  if (!pet) return;
  if (!pet.sick) { toast(t('shop.notSick', { name: pet.name })); return; }
  if ((pet.coins || 0) < SYRINGE_COST) { toast(t('shop.notEnough')); return; }
  pet.coins -= SYRINGE_COST;
  pet.sick = false;
  pet.illTimer = 0;
  pet.care.happiness = clamp(pet.care.happiness + CURE_HAPPY, 0, 100);
  reaction('💉');
  toast(t('shop.cured', { name: pet.name }));
  refreshShop();
  refresh();
  save();
}

// Ability Reroll — open a picker of the pet's currently-learned moves (excluding
// the protected Attack slot). Charges only once a slot is actually chosen.
function openRerollPicker() {
  const pet = state.pet;
  if (!pet) return;
  if ((pet.coins || 0) < REROLL_COST) { toast(t('shop.notEnough')); return; }
  const known = new Set(Array.isArray(pet.moves) ? pet.moves : ['attack']);
  const rerollable = getLearnset(pet).filter((a) => a.id !== 'attack' && known.has(a.id));
  if (rerollable.length === 0) { toast(t('shop.noRerollMoves', { name: pet.name })); return; }
  const grid = $('reroll-grid');
  if (grid) {
    grid.innerHTML = rerollable
      .map((a) => `<button class="food-item" data-slot="${a.id}"><span class="f-ico">${elementIcon(a.element)}</span><span class="f-name">${a.name}</span><span class="f-price">×${a.power.toFixed(2)}</span></button>`)
      .join('');
    grid.querySelectorAll('[data-slot]').forEach((btn) => {
      btn.addEventListener('click', () => doReroll(btn.dataset.slot));
    });
  }
  openSheet('reroll-sheet');
}

function doReroll(slotId) {
  const pet = state.pet;
  if (!pet) return;
  if ((pet.coins || 0) < REROLL_COST) { toast(t('shop.notEnough')); closeSheet('reroll-sheet'); return; }
  const ab = rerollMove(pet, slotId);
  if (!ab) { closeSheet('reroll-sheet'); return; }
  pet.coins -= REROLL_COST;
  closeSheet('reroll-sheet');
  toast(t('shop.rerolled', { name: pet.name, icon: elementIcon(ab.element), move: ab.name }));
  refreshShop();
  refresh(); // moveset in the info panel updates immediately
  save();
}

// ---------------------------------------------------------------------------
// v5 — Notifications (§8, Web Notifications API — best-effort)
// ---------------------------------------------------------------------------
// IMPORTANT LIMITATION: browser notifications only fire while THIS page/tab is
// alive (open or backgrounded). There is NO true push once the app is fully
// closed — that would require an installed PWA + service worker + a push
// backend, which is out of scope for v5.
//
// Each condition is debounced: it fires once when the pet ENTERS the state and
// won't fire again until the condition clears and re-triggers (tracked here).
const notifiedFlags = { poop: false, starving: false, hungry: false, lowhp: false, dirty: false, sick: false };

function notificationsGranted() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

function fireNotification(tag, title, body) {
  if (!notificationsGranted()) return;
  try {
    // eslint-disable-next-line no-new
    new Notification(title, { body, tag, lang: getLang() });
  } catch (e) { /* best-effort only */ }
}

// Ask for permission (from the Shop button). Cannot be re-prompted once the
// user has answered (granted/denied) — the browser only prompts on 'default'.
function requestNotifications() {
  if (typeof Notification === 'undefined') { toast(t('notif.unsupported')); return; }
  if (Notification.permission === 'granted') { toast(t('notif.alreadyOn')); updateNotifyButton(); return; }
  if (Notification.permission === 'denied') { toast(t('notif.blocked')); updateNotifyButton(); return; }
  Notification.requestPermission().then((perm) => {
    if (perm === 'granted') toast(t('notif.enabled'));
    else toast(t('notif.blocked'));
    updateNotifyButton();
  }).catch(() => { /* ignore */ });
}

function updateNotifyButton() {
  const btn = $('btn-notify');
  if (!btn) return;
  let key = 'notif.enable';
  let disabled = false;
  if (typeof Notification === 'undefined') { key = 'notif.unsupported'; disabled = true; }
  else if (Notification.permission === 'granted') { key = 'notif.on'; disabled = true; }
  else if (Notification.permission === 'denied') { key = 'notif.blocked'; disabled = true; }
  btn.textContent = t(key);
  btn.disabled = disabled;
  btn.classList.toggle('disabled', disabled);
}

// Evaluate the notification conditions once per tick (only when granted and the
// pet is alive & hatched). Debounced via notifiedFlags.
function updateNotifications(pet) {
  if (!pet || !notificationsGranted()) return;
  if (pet.state === 'dead' || pet.stage === 'egg') return;
  const name = pet.name;
  const maxHp = computeStats(pet).hp;
  const conditions = [
    ['poop', pet.poopNeedUntil > 0, 'notif.poopTitle', 'notif.poopBody'],
    ['starving', isStarving(pet), 'notif.starveTitle', 'notif.starveBody'],
    ['hungry', pet.care.hunger < 15, 'notif.hungryTitle', 'notif.hungryBody'],
    ['lowhp', pet.hpCurrent < maxHp * 0.25, 'notif.lowHpTitle', 'notif.lowHpBody'],
    ['dirty', pet.care.hygiene < DIRTY_THRESHOLD, 'notif.dirtyTitle', 'notif.dirtyBody'],
    ['sick', !!pet.sick, 'notif.sickTitle', 'notif.sickBody'],
  ];
  for (const [flag, active, titleKey, bodyKey] of conditions) {
    if (active && !notifiedFlags[flag]) {
      notifiedFlags[flag] = true;
      fireNotification('slimepets-' + flag, t(titleKey), t(bodyKey, { name }));
    } else if (!active && notifiedFlags[flag]) {
      notifiedFlags[flag] = false; // reset so it can fire again on re-entry
    }
  }
}

// ---------------------------------------------------------------------------
// Init & event wiring
// ---------------------------------------------------------------------------
export function initGame() {
  const loaded = loadGame();
  if (loaded && loaded.pet) {
    state.pet = loaded.pet;
    state.settings = loaded.settings || {};
    offlineCatchUp(state.pet);
  } else {
    state.pet = createPet('Slime', randomSeed());
  }
  // Silently sync moves for migrated saves (no toasts on first load).
  if (state.pet) checkUnlocks(state.pet);
  save();

  // tab bar
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      const scr = t.dataset.screen;
      if (scr === 'battle') {
        if (window.SlimeBattle && typeof window.SlimeBattle.openMenu === 'function') {
          showScreen('battle');
          window.SlimeBattle.openMenu();
        } else {
          toast(t('toast.battlesComingSoon'));
        }
        return;
      }
      showScreen(scr);
    });
  });

  // care action buttons
  bindClick('btn-feed', openFoodPicker);
  bindClick('btn-clean', doClean);
  bindClick('btn-sleep', doSleep);
  bindClick('btn-play', doPlay);
  bindClick('btn-heal', doHeal);
  bindClick('btn-cuddle', doCuddle);
  bindClick('btn-potty', doPotty);
  bindClick('btn-scold', doScold);

  // info panel toggle
  bindClick('btn-info', () => toggleInfo());
  bindClick('btn-info-close', () => toggleInfo(false));

  // sheet close buttons + tap-on-backdrop to dismiss
  bindClick('food-close', () => closeSheet('food-sheet'));
  bindClick('rps-close', () => closeSheet('rps-sheet'));
  bindSheetBackdrop('food-sheet');
  bindSheetBackdrop('rps-sheet');

  // RPS move buttons
  document.querySelectorAll('.rps-btn').forEach((btn) => {
    btn.addEventListener('click', () => playRps(btn.dataset.rps));
  });

  // egg tap / send-off tap
  const stageEl = $('pet-stage');
  if (stageEl) stageEl.addEventListener('click', () => {
    if (!state.pet) return;
    if (state.pet.state === 'dead') handleSendOff();
    else if (state.pet.stage === 'egg') tapEgg();
  });

  // training exercises
  document.querySelectorAll('.exercise').forEach((btn) => {
    btn.addEventListener('click', () => doTrain(btn.dataset.ex));
  });

  // v10 — Moves management screen (opened from Training)
  bindClick('btn-moves', () => showScreen('moves'));
  bindClick('btn-moves-back', () => showScreen('train'));

  // v8 — confirm popup (food + general). Confirm runs the stored action; Cancel
  // or a backdrop tap just closes (the picker underneath stays open).
  bindClick('confirm-ok', () => { const fn = confirmAction; closeConfirm(); if (fn) fn(); });
  bindClick('confirm-cancel', closeConfirm);
  const confirmPop = $('confirm-popup');
  if (confirmPop) confirmPop.addEventListener('click', (e) => { if (e.target === confirmPop) closeConfirm(); });

  // shop navigation + notifications toggle
  bindClick('btn-shop', () => showScreen('shop'));
  bindClick('btn-shop-back', () => showScreen('menu'));
  bindClick('btn-buy-cure', doBuyCure);
  bindClick('btn-buy-stamina', doBuyStamina);
  bindClick('btn-buy-syringe', doBuySyringe);
  bindClick('btn-buy-reroll', openRerollPicker);
  bindClick('btn-notify', requestNotifications);
  bindClick('reroll-close', () => closeSheet('reroll-sheet'));
  bindSheetBackdrop('reroll-sheet');
  bindClick('btn-rename', () => {
    const nameInput = $('menu-name');
    if (state.pet && nameInput && nameInput.value.trim()) {
      state.pet.name = nameInput.value.trim();
      save();
      refresh();
      toast(t('toast.renamed'));
    }
  });
  // v6: in-page double-confirm (no native confirm()).
  bindClick('btn-reset', () => {
    if (!resetArmed) { armReset(); return; }
    disarmReset();
    resetGame();
  });
  bindClick('btn-reset-cancel', disarmReset);

  // populate menu name field
  const nameInput = $('menu-name');
  if (nameInput && state.pet) nameInput.value = state.pet.name;

  // v6: language is a single "🌐 Language" button that opens an in-page chooser
  // (bottom sheet), replacing the always-visible 3-flag selector.
  bindClick('btn-language', () => { highlightActiveLang(); openSheet('lang-sheet'); });
  bindClick('lang-close', () => closeSheet('lang-sheet'));
  bindSheetBackdrop('lang-sheet');
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => { setLang(btn.dataset.lang); closeSheet('lang-sheet'); });
  });
  // Re-run every screen's render when the language changes so on-screen text
  // (including dynamic labels) updates live without a reload.
  onLangChange(() => {
    disarmReset(); // avoid a half-armed reset showing a stale label after relabel
    applyStaticI18n(document);
    highlightActiveLang();
    if (state.pet) refresh();
    refreshTrain();
    refreshMoves(); // re-apply Equip/Unequip + "Equipped n/4" labels
    refreshMenu(); // re-apply the (possibly cooldown) egg-button label
    refreshShop(); // re-apply shop coins + notification button label
  });
  // First paint: fill all static data-i18n text and highlight the saved language.
  applyStaticI18n(document);
  highlightActiveLang();

  showScreen('pet');
  refresh();

  // dev accelerator
  window.DEV = window.DEV || {};
  window.DEV.grow = () => {
    if (!state.pet) return;
    if (advanceStage(state.pet)) {
      toast(`DEV: grew to ${state.pet.stage}`);
      refresh();
      save();
    }
    return state.pet.stage;
  };
  window.DEV.state = () => state;
  // Set HP to pct% of max (default 25) for testing the wounded/heal flow.
  window.DEV.hurt = (pct) => {
    if (!state.pet) return;
    const maxHp = computeStats(state.pet).hp;
    const p = typeof pct === 'number' ? pct : 25;
    state.pet.hpCurrent = clamp((p / 100) * maxHp, 1, maxHp);
    refresh();
    save();
    return state.pet.hpCurrent;
  };
  // Set the coin balance for testing the paid-heal path.
  window.DEV.coins = (n) => {
    if (!state.pet) return;
    state.pet.coins = Math.max(0, Math.floor(Number(n) || 0));
    refresh();
    save();
    return state.pet.coins;
  };
  // v3 lifestyle test helpers.
  // v6: poop is time-based now. Force the potty timer to fire immediately.
  window.DEV.poop = () => {
    if (!state.pet) return;
    state.pet.nextPoopAt = Date.now();
    advancePoop(state.pet);
    refresh();
    save();
    return { poopNeedUntil: state.pet.poopNeedUntil, poopInRoom: state.pet.poopInRoom };
  };
  window.DEV.meal = window.DEV.poop; // back-compat alias
  window.DEV.spoil = (n) => {
    if (!state.pet) return;
    state.pet.spoiled = clamp(Number(n) || 0, 0, 100);
    refresh();
    save();
    return state.pet.spoiled;
  };
  window.DEV.edu = (n) => {
    if (!state.pet) return;
    state.pet.education = clamp(Number(n) || 0, 0, 100);
    refresh();
    save();
    return state.pet.education;
  };
  window.DEV.weight = (n) => {
    if (!state.pet) return;
    state.pet.weight = clamp(Number(n) || 0, 0, 100);
    refresh();
    save();
    return state.pet.weight;
  };
  // v4 test helpers.
  // Backdate the last feed by `hours` (default 3) to simulate neglect.
  window.DEV.starve = (hours) => {
    if (!state.pet) return;
    const h = typeof hours === 'number' ? hours : 3;
    state.pet.lastFedAt = Date.now() - h * 3600e3;
    refresh();
    save();
    return state.pet.lastFedAt;
  };
  // Force death (starvation-style) to test the send-off / rebirth flow.
  window.DEV.kill = () => {
    if (!state.pet) return;
    state.pet.hpCurrent = 0;
    markDead();
    refresh();
    return state.pet.state;
  };
  // Inspect element + learnset unlock state.
  window.DEV.moves = () => {
    if (!state.pet) return;
    return { element: state.pet.genome.element, known: state.pet.moves, learnset: getLearnset(state.pet) };
  };
  // Simulate a battle result (for HP-writeback / unlock testing).
  window.DEV.battle = (won, remainingHp, kind) =>
    grantBattleResult(!!won, { remainingHp, kind: kind || 'wild', draw: false });

  // glue for Agent B's battle/net code
  window.SlimeGame = {
    getPet: () => state.pet,
    snapshot: () => (state.pet ? battleSnapshot(state.pet) : null),
    canBattle,
    payBattleCost,
    grantBattleResult,
    showScreen,
    showPet: () => showScreen('pet'),
    toast,
    refresh,
    renderPet, // convenience re-export
  };

  return state;
}

function bindClick(id, fn) {
  const el = $(id);
  if (el) el.addEventListener('click', fn);
}

// Highlight the currently-active language button in the Menu screen.
function highlightActiveLang() {
  const lang = getLang();
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
}

// Dismiss a bottom sheet when its dark backdrop (not the sheet itself) is tapped.
function bindSheetBackdrop(id) {
  const el = $(id);
  if (el) el.addEventListener('click', (e) => {
    if (e.target === el) closeSheet(id);
  });
}

export { state };
