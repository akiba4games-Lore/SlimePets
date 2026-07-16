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
  exportPetCode,
  importPetCode,
  ELEMENTS,
  PERSONALITIES,
  derivePersonality,
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

// Transient pose flag: a scold makes the pet sulk (sad face) until the NEXT
// care/action runs. renderPetCustom forces mood='sad' while it's set; any other
// action clears it (see afterAction + the explicit clears in sleep/train/play).
let scoldSadPose = false;

// Care decay rates per hour (v2: no more energy stat).
const DECAY_AWAKE = { hunger: 18, happiness: 10, hygiene: 7 };
const DECAY_SLEEP = { hunger: 9, hygiene: 4, happiness: 2 }; // happiness is a gain here

// Passive HP healing, as a fraction of max HP per hour (sleeping heals faster).
const HEAL_RATE_AWAKE = 0.08; // +8% / hour
const HEAL_RATE_SLEEP = 0.32; // +32% / hour
// Heal (🩹) is always FREE. It now works as CHARGES: 3 charges, each restores
// 50% of max HP, one charge refills every 4h (up to 3 stored). Never costs
// coins — for an instant full top-up players buy a Cure Potion in the shop.
const HEAL_FREE_COOLDOWN_MS = 4 * 60 * 60 * 1000; // per-charge refill: 1 / 4h
const HEAL_PCT = 0.5;        // each heal restores 50% of max HP
const HEAL_MAX_CHARGES = 3;  // up to 3 charges stored

// v12 — Play (🎈 Rock-Paper-Scissors) is limited to CHARGES, mirroring Heal:
// 3 charges, one refills every 5 minutes (up to 3). Playing stays otherwise free.
const PLAY_REFILL_MS = 5 * 60 * 1000; // per-charge refill: 1 / 5 min
const PLAY_MAX_CHARGES = 3;           // up to 3 charges stored

// v14B — Clean (🫧) is likewise limited to CHARGES: 3, one refills every 5 min
// (up to 3). Cleaning stays otherwise free (still applies the bath effect).
const CLEAN_REFILL_MS = 5 * 60 * 1000; // per-charge refill: 1 / 5 min
const CLEAN_MAX_CHARGES = 3;           // up to 3 charges stored

// v12 — game version + menu changelog (newest-first). Item text carries EN + IT
// (JA where straightforward); headings are localized via i18n.
export const GAME_VERSION = 'v0.14b';
const CHANGELOG = [
  { version: 'v0.14b', items: [{
    en: 'Pets now have a PERSONALITY (Lazy, Glutton, Cuddly, Playful, Messy, Sleepyhead) set from their seed — it tweaks their care (e.g. gluttons get hungry faster, playful pets refill play charges quicker, messy pets get dirty sooner) and plays little idle animations on the pet screen. See it in the info panel. Also: Clean now uses charges (3, +1 every 5 min) like Heal & Play; the shop Back button now returns to your pet.',
    it: 'I pet ora hanno una PERSONALITÀ (Pigro, Goloso, Coccolone, Giocoso, Disordinato, Dormiglione) determinata dal loro seme — modifica le cure (es. i golosi hanno fame più in fretta, i giocosi ricaricano prima le cariche di gioco, i disordinati si sporcano prima) e mostra animazioni sullo schermo del pet. La vedi nel pannello info. Inoltre: Pulisci ora usa cariche (3, +1 ogni 5 min) come Cura e Gioca; il tasto Indietro del negozio ora torna al pet.',
    ja: 'ペットに せいかくが つきました（なまけもの・くいしんぼう・あまえんぼう・あそびずき・ずぼら・ねぼすけ）。シードで きまり、せわに えいきょうし（くいしんぼうは おなかが すきやすい、あそびずきは チャージが はやい、ずぼらは よごれやすい など）、がめんで アイドルアニメを みせます。じょうほうパネルで かくにん。また、おそうじも チャージせいに（3かい、5ふんで1かいかいふく／かいふく・あそぶ とおなじ）。ショップの「もどる」は ペットへ もどります。',
  }] },
  { version: 'v0.14', items: [{
    en: 'Shop Back returns to Menu; daily free 50 coins in the shop; battles use charges (3, +1 every 5 min) for Random & Rivals; Protect now blocks 50% (was full); neglect makes pets SICK with a 24h cure deadline (they lose stats each hour, no more instant HP-death); tap a battle move to use it, long-press to inspect it.',
    it: 'Il tasto Indietro del negozio torna al Menu; 50 monete gratis al giorno nel negozio; le battaglie usano cariche (3, +1 ogni 5 min) per Casuale e Rivali; Protezione ora blocca il 50% (prima tutto); la trascuratezza fa AMMALARE il pet con 24h per curarlo (perde statistiche ogni ora, niente più morte istantanea per HP); tocca una mossa in battaglia per usarla, tieni premuto per ispezionarla.',
    ja: 'ショップの「もどる」はメニューへ。ショップで まいにち 50コイン むりょう。ランダム＆ライバルのバトルは チャージせい（3かい、5ふんで1かいかいふく）。まもるは 50% ブロックに（まえは ぜんぶ）。せわを おこたると びょうきに——24じかんいないに なおさないと しんじゃう（まいじかん ステータスダウン、HPそくしは なし）。バトルのわざは タップで しよう、ながおしで しょうさい。',
  }] },
  { version: 'v0.12', items: [{
    en: 'Battle area split into Random / Local / Prep panels; Rivals moved top-right (local opponents only); Play limited to 3 charges (refills every 5 min); changelog + version in the menu.',
    it: 'Area battaglia divisa in pannelli Casuale / Locale / Preparazione; Rivali spostati in alto a destra (solo avversari locali); Gioca limitato a 3 cariche (si ricarica ogni 5 min); novità + versione nel menu.',
    ja: 'バトル画面を「ランダム / ローカル / じゅんび」に分割。ライバルは右上へ（ローカルのあいてのみ）。あそぶは3かいまで（5ふんで1かいかいふく）。メニューに こうしんりれきと バージョンを ついか。',
  }] },
  { version: 'v0.11', items: [{
    en: 'Full move system: per-move stats with effects (buffs, debuffs, heal, recoil, guard, charge), cooldowns & priority (fast moves); random learnset; special training teaches a random move; move-equip screen.',
    it: 'Sistema mosse completo: statistiche per mossa con effetti (potenziamenti, indebolimenti, cura, contraccolpo, parata, carica), ricariche e priorità (mosse veloci); set di mosse casuale; l\'allenamento speciale insegna una mossa casuale; schermata equipaggiamento mosse.',
  }] },
  { version: 'v0.10', items: [{
    en: 'Heal reworked to 3 charges of 50%; illness + Syringe cure; sad face below 50% happiness; rounder "drop" body.',
    it: 'Cura rifatta con 3 cariche del 50%; malattia + cura con Siringa; faccina triste sotto il 50% di felicità; corpo a "goccia" più tondo.',
  }] },
  { version: 'v0.9', items: [{
    en: 'Elements & type chart; body color follows the element; persistent HP; death & rebirth; starvation.',
    it: 'Elementi e tabella dei tipi; il colore del corpo segue l\'elemento; HP persistenti; morte e rinascita; fame estrema.',
  }] },
  { version: 'v0.8', items: [{
    en: 'Shop, potions, paid foods, weight.',
    it: 'Negozio, pozioni, cibi a pagamento, peso.',
  }] },
  { version: 'v0.7', items: [{
    en: 'Poop/potty, cuddle/spoiled, education/scold, rock-paper-scissors, info panel.',
    it: 'Cacca/bagno, coccole/viziato, educazione/sgridate, carta-forbice-sasso, pannello info.',
  }] },
  { version: 'v0.6', items: [{
    en: 'QR PvP battles, Rivals, coins, persistent HP economy.',
    it: 'Battaglie PvP via QR, Rivali, monete, economia HP persistente.',
  }] },
  { version: 'v0.5', items: [{
    en: 'Egg→adult growth, care loop, training, first battles.',
    it: 'Crescita uovo→adulto, ciclo di cure, allenamento, prime battaglie.',
  }] },
];

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

// v14C — laziness (0..1) drifts UP while the pet doesn't train and DOWN a little
// with each completed session. The per-session drop is tiny (invisible at the
// 2-decimal display) by design; idle time is what really pushes it up.
const LAZY_GROWTH_PER_DAY = 0.5; // laziness gained per full idle day
const LAZY_TRAIN_DROP = 0.005;   // laziness lost per completed training

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
const FOODS_BABY = ['milk', 'apple', 'icecream'];
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

// v7 — Illness (DESIGN v7 + v14A §5). Sustained sad/hungry state — OR prolonged
// starvation past the 2h grace — makes the pet SICK. Sickness is the lethal path:
// a 24h death timer starts and the pet loses ~1 battle stat point per real hour.
const ILL_ONSET_MS = 8 * 60 * 1000; // 8 real minutes of sustained bad state
const ILL_HAPPY_THRESH = 20; // happiness below this counts as a bad state
const ILL_HUNGER_THRESH = 15; // hunger below this counts as a bad state
const ILL_RECOVER_MULT = 2; // illTimer decays this × dt while healthy
const SICK_HAPPY_MULT = 2; // happiness decays this × faster while sick
// v14A (§5): once sick, the pet dies if not cured within 24h, and loses one
// random (currently >0) battle stat point per real hour (persistent penalty).
const SICK_DEADLINE_MS = 24 * 60 * 60 * 1000;
const SICK_STAT_STEP_MS = 60 * 60 * 1000; // one stat penalty point per real hour
const SICK_STAT_KEYS = ['str', 'spd', 'def', 'crit', 'hp'];

// v14A (§2) — daily free coins (economy safety-net): 50 coins once per 24h.
const DAILY_COIN_MS = 24 * 60 * 60 * 1000;
const DAILY_COIN_AMOUNT = 50;

// v14A (§3) — battle charges: 3, +1 every 5 min (max 3). Wild/rival battles
// consume 1 to start; local QR PvP is never gated.
const BATTLE_REFILL_MS = 5 * 60 * 1000;
const BATTLE_MAX_CHARGES = 3;

// v14B (§14B) — Personality flavor. Modest tweaks to action outcomes + decay so
// no personality is broken or OP; a pet whose personality matches none of a given
// branch keeps the pre-14B baseline exactly (all multipliers = 1, bonuses = 0).
const LAZY_REFUSE_BONUS = 0.15;          // Pigro: +15% flat training-refusal chance
const LAZY_STAMINA_MULT = 0.75;          // Pigro: slower stamina regen (0.75×)
const SLEEPY_STAMINA_MULT = 1.15;        // Dormiglione: small awake stamina-regen bonus
const SLEEPY_SLEEP_HEAL_MULT = 1.4;      // Dormiglione: sleep restores more HP (1.4×)
const GLUTTON_HUNGER_MULT = 1.3;         // Goloso: hunger decays faster (1.3×)
const GLUTTON_FOOD_HAPPY = 3;            // Goloso: extra happiness per feed
const GLUTTON_WEIGHT_MULT = 1.3;         // Goloso: weight GAIN from food ×1.3
const CUDDLY_CUDDLE_HAPPY = 4;           // Coccolone: extra happiness per cuddle
const CUDDLY_IGNORE_MS = 30 * 60 * 1000; // Coccolone: "recently cuddled" window (30 min)
const CUDDLY_IGNORE_MULT = 1.25;         // Coccolone: happiness decays 1.25× faster when ignored
const PLAYFUL_PLAY_HAPPY = 3;            // Giocoso: extra happiness on an RPS win
const PLAYFUL_HAPPY_MULT = 1.1;          // Giocoso: mild happiness decay (wants to play)
const PLAYFUL_REFILL_MS = 3.5 * 60 * 1000; // Giocoso: play charges refill in 3.5 min (vs 5)
const MESSY_HYGIENE_MULT = 1.4;          // Disordinato: hygiene decays faster (1.4×)
const MESSY_POOP_MULT = 0.7;             // Disordinato: shorter poop interval (poops more often)

// Personality display emoji (info panel + idle animations).
const PERSONALITY_EMOJI = {
  lazy: '🦥', glutton: '🤤', cuddly: '💕', playful: '🎈', messy: '💨', sleepyhead: '😴',
};

// The pet's personality id (falls back to the seed-derived one if unset/invalid).
function petPersonality(pet) {
  if (!pet) return '';
  if (PERSONALITIES.indexOf(pet.personality) >= 0) return pet.personality;
  return pet.genome ? derivePersonality(pet.genome.seed) : '';
}
function isPersona(pet, p) { return petPersonality(pet) === p; }

// Per-pet play-charge refill interval (Giocoso refills faster).
function playRefillMs(pet) {
  return isPersona(pet, 'playful') ? PLAYFUL_REFILL_MS : PLAY_REFILL_MS;
}

// Multiplier on AWAKE happiness decay from personality (idle craving). Coccolone
// decays faster once it hasn't been cuddled for a while; Giocoso always drifts a
// little faster (it wants to play).
function personalityHappyDecayMult(pet) {
  if (isPersona(pet, 'cuddly')) {
    return (Date.now() - (pet.lastCuddleAt || 0)) > CUDDLY_IGNORE_MS ? CUDDLY_IGNORE_MULT : 1;
  }
  if (isPersona(pet, 'playful')) return PLAYFUL_HAPPY_MULT;
  return 1;
}

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

// v4 — starvation (DESIGN §6; v14A §5). Neglect drains weight after a grace
// period and — past the grace — makes the pet SICK (no more HP-drain-to-death).
const STARVE_GRACE_MS = 2 * 60 * 60 * 1000; // 2h since last feed before it bites
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
    case 'weight': return unlock.cmp === 'lte'
      ? t('unlock.weightLte', { value: unlock.value })
      : t('unlock.weight', { value: unlock.value });
    case 'education': return t('unlock.education', { value: unlock.value });
    case 'wins': return t('unlock.wins', { value: unlock.value });
    case 'scold': return t('unlock.scold', { value: unlock.value });
    case 'cuddle': return t('unlock.cuddle', { value: unlock.value });
    case 'game': return t('unlock.game', { value: unlock.value });
    case 'healed': return t('unlock.healed', { value: unlock.value });
    case 'losses': return t('unlock.losses', { value: unlock.value });
    case 'spoiledEdu': return t('unlock.spoiledEdu');
    case 'stat': return t('unlock.stat', { stat: t('stat.' + unlock.stat + '.full'), value: unlock.value });
    case 'stage': return t('unlock.stage', { stage: stageLabel(unlock.value) });
    default: return '';
  }
}

// The unlock hint only reveals itself after 1 real day since the pet hatched
// (fallback: createdAt). Before that, locked moves show a mysterious placeholder.
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
function unlockRevealed(pet) {
  const anchor = (pet && typeof pet.hatchedAt === 'number' && pet.hatchedAt)
    ? pet.hatchedAt
    : ((pet && pet.createdAt) || Date.now());
  return Date.now() - anchor >= ONE_DAY_MS;
}
function lockedHintText(pet, unlock) {
  return unlockRevealed(pet) ? unlockHint(unlock) : t('unlock.later');
}

// Localized short abbreviation for a buffed/debuffed stat (ATK/SPD/DEF...).
function statAbbr(k) {
  return t('effect.stat.' + k);
}

// Compact effect tag for the Moves screen / info panel (icon-forward, terse).
function moveEffectTag(ab) {
  const fx = ab && ab.effect;
  const parts = [];
  if (fx) {
    if (fx.guard) parts.push('🛡️');
    if (typeof fx.heal === 'number' && fx.heal > 0) parts.push('💚' + Math.round(fx.heal * 100) + '%');
    if (typeof fx.recoil === 'number' && fx.recoil > 0) parts.push('💥' + Math.round(fx.recoil * 100) + '%');
    if (fx.selfBuff) for (const [k, v] of Object.entries(fx.selfBuff)) parts.push((v >= 0 ? '▲' : '▼') + statAbbr(k));
    if (fx.enemyDebuff) for (const [k] of Object.entries(fx.enemyDebuff)) parts.push('💢' + statAbbr(k));
  }
  if ((ab.cooldown | 0) < 0) parts.push('🔋' + Math.abs(ab.cooldown | 0));
  return parts.join(' ');
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
// v14B (§14B) — Personality idle animations. While the pet screen is active and
// the pet is idle (not egg/dead/sleeping, no modal/sheet/popup open) a short,
// non-interrupting, personality-flavored animation plays every ~15–30s. It
// reuses reaction()/bouncePet() and the renderer's sleepy pose — never spammy.
// ---------------------------------------------------------------------------
const IDLE_ANIM_MIN_MS = 15000;
const IDLE_ANIM_MAX_MS = 30000;
let idleAnimAt = 0;        // wall-clock ms of the next idle anim (0 = unscheduled)
let idleSleepyTimer = 0;   // pending "restore pose" timer for the Dormiglione doze

function scheduleIdleAnim() {
  idleAnimAt = Date.now() + IDLE_ANIM_MIN_MS + Math.random() * (IDLE_ANIM_MAX_MS - IDLE_ANIM_MIN_MS);
}

// Any open sheet / popup / panel / overlay that should suppress idle anims.
function anyOverlayOpen() {
  const ids = ['food-sheet', 'lang-sheet', 'reroll-sheet', 'confirm-popup', 'rps-panel', 'info-panel', 'train-anim-overlay'];
  for (const id of ids) {
    const el = $(id);
    if (el && el.classList.contains('open')) return true;
  }
  return false;
}

function petIsIdle() {
  const pet = state.pet;
  return !!(pet && state.screen === 'pet' && pet.stage !== 'egg'
    && pet.state !== 'dead' && !pet.sleeping && !scoldSadPose && !anyOverlayOpen());
}

// Play one short personality-flavored idle beat.
function playIdleAnim() {
  const pet = state.pet;
  if (!pet) return;
  switch (petPersonality(pet)) {
    case 'sleepyhead':
      // briefly close the eyes + a floating "z z z", then restore the pose.
      renderPetCustom({ mood: 'sleepy', tired: true });
      reaction('💤');
      clearTimeout(idleSleepyTimer);
      idleSleepyTimer = setTimeout(() => { if (state.screen === 'pet' && !state.pet.sleeping) renderCurrentPet(); }, 1500);
      break;
    case 'glutton':
      reaction('🤤');
      bouncePet();
      break;
    case 'playful':
      reaction('🎈');
      bouncePet();
      break;
    case 'cuddly':
      reaction('💕');
      break;
    case 'messy':
      reaction('💨');
      break;
    case 'lazy':
      reaction('😴');
      break;
    default:
      bouncePet();
  }
}

// Called every tick: fire an idle anim when due, or hold off while not idle.
function updateIdleAnim() {
  if (!petIsIdle()) { idleAnimAt = 0; return; }
  if (idleAnimAt === 0) { scheduleIdleAnim(); return; }
  if (Date.now() >= idleAnimAt) {
    playIdleAnim();
    scheduleIdleAnim();
  }
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

// Called when the pet dies (v14A §5: illness deadline; battles never kill).
// Freezes the pet and shows the send-off overlay.
function markDead() {
  const pet = state.pet;
  if (!pet || pet.state === 'dead') return;
  pet.state = 'dead';
  pet.hpCurrent = 0;
  pet.sleeping = false;
  save();
}

// Detect a fresh death after a care update (tick / offline catch-up). v14A §5:
// starvation no longer drains HP to 0 — the lethal path is now an uncured
// illness past its 24h deadline. (hpCurrent<=0 kept as a defensive safety net.)
function detectDeath() {
  const pet = state.pet;
  if (!pet || pet.state === 'dead' || pet.stage === 'egg') return false;
  if (pet.sick && (pet.sickDeadline || 0) > 0 && Date.now() >= pet.sickDeadline) {
    markDead();
    return true;
  }
  if (pet.hpCurrent <= 0) {
    markDead();
    return true;
  }
  return false;
}

// v14A (§5) — ensure a well-formed statPenalty object on the pet.
function ensureStatPenalty(pet) {
  if (!pet.statPenalty || typeof pet.statPenalty !== 'object') {
    pet.statPenalty = { str: 0, spd: 0, def: 0, crit: 0, hp: 0 };
  }
  for (const k of SICK_STAT_KEYS) {
    const v = pet.statPenalty[k];
    if (typeof v !== 'number' || !isFinite(v) || v < 0) pet.statPenalty[k] = 0;
  }
  return pet.statPenalty;
}

// v14A (§5) — the pet becomes sick (from any trigger). Starts the 24h death
// timer if one isn't already running, and toasts once.
function makeSick(pet) {
  if (!pet || pet.sick) return;
  pet.sick = true;
  pet.illTimer = 0;
  if (!pet.sickDeadline || pet.sickDeadline <= 0) pet.sickDeadline = Date.now() + SICK_DEADLINE_MS;
  toast(t('toast.gotSick', { name: pet.name }));
}

// v14A (§5) — apply one −1 penalty to a random battle stat whose CURRENT
// computed value is > 0 (hp is always >0 because computeStats floors it at 1).
function applySickStatPenalty(pet) {
  const pen = ensureStatPenalty(pet);
  const stats = computeStats(pet);
  const candidates = SICK_STAT_KEYS.filter((k) => (stats[k] || 0) > 0);
  if (candidates.length === 0) return;
  const stat = candidates[Math.floor(Math.random() * candidates.length)];
  pen[stat] += 1;
  // Keep the HP bar consistent when max HP shrinks (never above the new max).
  if (stat === 'hp') {
    const max = computeStats(pet).hp;
    if (typeof pet.hpCurrent === 'number' && isFinite(pet.hpCurrent)) {
      pet.hpCurrent = Math.max(1, Math.min(pet.hpCurrent, max));
    }
  }
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
  closeRps(); // never leave the RPS panel lingering over another screen
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
  if (name === 'changelog') renderChangelog();
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
  // A poop on the floor makes hygiene decay 3× faster; v14B: Disordinato adds 1.4×.
  const hygMult = (pet.poopInRoom ? 3 : 1) * (isPersona(pet, 'messy') ? MESSY_HYGIENE_MULT : 1);
  // v5 (§4): a dirty pet (hygiene < 35) loses happiness ~1.6× faster.
  const dirtyMult = c.hygiene < DIRTY_THRESHOLD ? DIRTY_DECAY_MULT : 1;
  // v7: a sick pet loses happiness ~2× faster (applied to awake decay only).
  const sickMult = pet.sick ? SICK_HAPPY_MULT : 1;
  // v14B: Goloso gets hungry ~1.3× faster; Coccolone/Giocoso lose happiness a bit faster.
  const hungerMult = isPersona(pet, 'glutton') ? GLUTTON_HUNGER_MULT : 1;
  const personaHappyMult = personalityHappyDecayMult(pet);
  if (pet.sleeping) {
    c.hunger -= DECAY_SLEEP.hunger * dtH * hungerMult;
    c.hygiene -= DECAY_SLEEP.hygiene * dtH * hygMult;
    c.happiness += DECAY_SLEEP.happiness * dtH;
  } else {
    c.hunger -= DECAY_AWAKE.hunger * dtH * hungerMult;
    c.happiness -= DECAY_AWAKE.happiness * dtH * (wounded ? 3 : 1) * dirtyMult * sickMult * personaHappyMult;
    c.hygiene -= DECAY_AWAKE.hygiene * dtH * hygMult;
  }
  // neglect drags happiness down
  if (c.hunger < 25 || c.hygiene < 25) c.happiness -= 6 * dtH;
  c.hunger = clamp(c.hunger, 0, 100);
  c.happiness = clamp(c.happiness, 0, 100);
  c.hygiene = clamp(c.hygiene, 0, 100);
  // v3 lifestyle drifts: spoiled fades, weight eases back toward its baseline.
  pet.spoiled = clamp((pet.spoiled || 0) - SPOILED_DECAY_PER_H * dtH, 0, 100);
  // v14C: laziness slowly climbs while the pet isn't training (+0.5 per idle day).
  if (pet.stage !== 'egg' && pet.genome) {
    pet.genome.laziness = clamp((pet.genome.laziness || 0) + LAZY_GROWTH_PER_DAY * (dtH / 24), 0, 1);
  }
  if (starving) {
    // Starvation weight drain overrides the normal drift and applies even while
    // asleep — a neglected pet keeps wasting away.
    pet.weight = clamp(pet.weight - STARVE_WEIGHT_PER_HR * dtH, 0, 100);
  } else {
    const wDelta = WEIGHT_DRIFT_PER_H * dtH;
    if (pet.weight > WEIGHT_TARGET) pet.weight = Math.max(WEIGHT_TARGET, pet.weight - wDelta);
    else if (pet.weight < WEIGHT_TARGET) pet.weight = Math.min(WEIGHT_TARGET, pet.weight + wDelta);
  }
  // HP (v14A §5): starvation no longer drains HP to death. While sick, block the
  // passive self-heal (hold HP steady — the lethal path is the 24h deadline, not
  // HP); otherwise passive HP healing (awake +8%/h, sleeping +32%/h), floored 1.
  if (pet.sick) {
    pet.hpCurrent = clamp(pet.hpCurrent, 1, maxHp);
  } else {
    // v14B: Dormiglione's sleep restores more HP (1.4× the sleeping heal rate).
    const sleepHeal = HEAL_RATE_SLEEP * (isPersona(pet, 'sleepyhead') ? SLEEPY_SLEEP_HEAL_MULT : 1);
    const healRate = pet.sleeping ? sleepHeal : HEAL_RATE_AWAKE;
    pet.hpCurrent = clamp(pet.hpCurrent + maxHp * healRate * dtH, 1, maxHp);
  }
  // v7/v14A (§5): illness onset. Only while hatched & not already sick: a
  // sustained sad OR hungry state fills illTimer; prolonged starvation (past the
  // 2h grace) goes straight to sick. A healthy state drains illTimer.
  if (pet.stage !== 'egg' && !pet.sick) {
    if (starving) {
      makeSick(pet); // 2h grace elapsed → sick (no HP-drain-to-death anymore)
    } else {
      const badState = c.happiness < ILL_HAPPY_THRESH || c.hunger < ILL_HUNGER_THRESH;
      if (badState) {
        pet.illTimer = (pet.illTimer || 0) + dtSec * 1000;
        if (pet.illTimer >= ILL_ONSET_MS) makeSick(pet);
      } else {
        pet.illTimer = Math.max(0, (pet.illTimer || 0) - dtSec * 1000 * ILL_RECOVER_MULT);
      }
    }
  }
  // v14A (§5): while sick, apply ~1 stat penalty per real hour elapsed since the
  // sickness began (sickStart = sickDeadline − 24h). We derive the count owed
  // from the elapsed hours minus the total already applied (sum of statPenalty),
  // so it self-corrects across the 1s tick AND the offline catch-up.
  if (pet.stage !== 'egg' && pet.sick) {
    if (!pet.sickDeadline || pet.sickDeadline <= 0) pet.sickDeadline = Date.now() + SICK_DEADLINE_MS;
    const sickStart = pet.sickDeadline - SICK_DEADLINE_MS;
    const owedHours = Math.floor((Date.now() - sickStart) / SICK_STAT_STEP_MS);
    const pen = ensureStatPenalty(pet);
    const applied = pen.str + pen.spd + pen.def + pen.crit + pen.hp;
    let toApply = Math.max(0, owedHours - applied);
    let guard = 0;
    while (toApply > 0 && guard < 240) { applySickStatPenalty(pet); toApply -= 1; guard += 1; }
  }
  // stamina regen: ~1 per 30s (2x sleeping). v14B: Pigro regens slower (0.75×);
  // Dormiglione gets a small awake regen bonus (1.15×).
  let rate = pet.sleeping ? 2 : 1;
  if (isPersona(pet, 'lazy')) rate *= LAZY_STAMINA_MULT;
  else if (isPersona(pet, 'sleepyhead') && !pet.sleeping) rate *= SLEEPY_STAMINA_MULT;
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
  updateIdleAnim(); // v14B: personality idle animation on the pet screen
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
  // v14B: Disordinato needs the potty more often (shorter interval).
  const mult = isPersona(pet, 'messy') ? MESSY_POOP_MULT : 1;
  pet.nextPoopAt = Date.now() + POOP_INTERVAL_MS * mult;
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
  // v14B: Goloso gets a little extra happiness from food and puts on weight faster.
  const glutton = isPersona(pet, 'glutton');
  c.happiness = clamp(c.happiness + fd.happy + (glutton ? GLUTTON_FOOD_HAPPY : 0), 0, 100);
  const wGain = fd.weight > 0 && glutton ? fd.weight * GLUTTON_WEIGHT_MULT : fd.weight;
  pet.weight = clamp(pet.weight + wGain, 0, 100);
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
  pet.cuddleCount = (pet.cuddleCount || 0) + 1; // any cuddle counts (feeds 'cuddle' unlocks)
  pet.lastCuddleAt = Date.now(); // v14B: resets the Coccolone idle-craving decay
  // v14B: Coccolone gets extra happiness from every cuddle.
  const cuddlyBonus = isPersona(pet, 'cuddly') ? CUDDLY_CUDDLE_HAPPY : 0;
  const deserved = pet.lastAchievementAt > 0 && Date.now() - pet.lastAchievementAt <= ACHIEVEMENT_WINDOW_MS;
  if (deserved) {
    c.happiness = clamp(c.happiness + 15 + cuddlyBonus, 0, 100);
    toast(t('toast.cuddleDeserved', { name: pet.name }));
  } else {
    c.happiness = clamp(c.happiness + 6 + cuddlyBonus, 0, 100);
    pet.spoiled = clamp(pet.spoiled + 8, 0, 100);
    toast(t('toast.cuddleSpoiled', { name: pet.name }));
  }
  reaction('💗');
  bouncePet();
  checkLearning(); // cuddle count may cross an unlock milestone
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
  // Scolding makes the pet sulk with a sad face until the next action clears it.
  scoldSadPose = true;
  const poopValid = pet.poopInRoom && !pet.poopScolded;
  const misValid = pet.lastMisbehaviorAt > 0 && now - pet.lastMisbehaviorAt <= MISBEHAVIOR_WINDOW_MS;
  const strikeValid = (pet.trainBlockUntil || 0) > now; // scolding ends a training strike
  if (poopValid || misValid || strikeValid) {
    pet.scoldCount = (pet.scoldCount || 0) + 1; // valid scold (feeds 'scold' unlocks)
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
  const pet = state.pet;
  // v14B: Clean is gated by CHARGES (3, +1 every 5 min), like Heal/Play.
  refreshCleanCharges(pet);
  if ((pet.cleanCharges || 0) <= 0) {
    toast(t('toast.cleanNotReady', { time: fmtDuration(cleanChargeRemaining(pet)) }));
    return;
  }
  if (pet.cleanCharges >= CLEAN_MAX_CHARGES) pet.cleanRefillAt = Date.now() + CLEAN_REFILL_MS;
  pet.cleanCharges--;
  const c = pet.care;
  c.hygiene = clamp(c.hygiene + 75, 0, 100);
  c.happiness = clamp(c.happiness - 8, 0, 100);
  reaction('🫧');
  bouncePet();
  afterAction('bath time!');
}

// Lazily refill clean charges: +1 every CLEAN_REFILL_MS, capped at max
// (mirrors refreshHealCharges / refreshPlayCharges).
function refreshCleanCharges(pet) {
  if (typeof pet.cleanCharges !== 'number') pet.cleanCharges = CLEAN_MAX_CHARGES;
  if (pet.cleanCharges >= CLEAN_MAX_CHARGES) { pet.cleanRefillAt = 0; return; }
  const now = Date.now();
  while (pet.cleanCharges < CLEAN_MAX_CHARGES && pet.cleanRefillAt && now >= pet.cleanRefillAt) {
    pet.cleanCharges++;
    pet.cleanRefillAt = pet.cleanCharges < CLEAN_MAX_CHARGES ? pet.cleanRefillAt + CLEAN_REFILL_MS : 0;
  }
}
// Milliseconds until the next clean charge (0 if a charge is available now).
function cleanChargeRemaining(pet) {
  refreshCleanCharges(pet);
  if ((pet.cleanCharges || 0) > 0) return 0;
  return Math.max(0, (pet.cleanRefillAt || 0) - Date.now());
}

export function doSleep() {
  if (!requirePet()) return;
  scoldSadPose = false; // sleeping is an action — clear the scold sulk
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
// v12: gated by CHARGES (3, +1 every 5 min). Refuse at 0 with a countdown toast;
// otherwise consume a charge (start the 5-min timer if we were full) and open RPS.
export function doPlay() {
  if (!requirePet()) return;
  const pet = state.pet;
  refreshPlayCharges(pet);
  if ((pet.playCharges || 0) <= 0) {
    toast(t('toast.playNotReady', { time: fmtDuration(playChargeRemaining(pet)) }));
    return;
  }
  if (pet.playCharges >= PLAY_MAX_CHARGES) pet.playRefillAt = Date.now() + playRefillMs(pet);
  pet.playCharges--;
  if (pet.sleeping) pet.sleeping = false;
  scoldSadPose = false; // playing is an action — clear the scold sulk
  // v6: playing no longer costs or requires stamina (still otherwise free).
  save();
  refresh();
  openRps();
}

// Lazily refill play charges: +1 every PLAY_REFILL_MS, capped at max (mirrors refreshHealCharges).
function refreshPlayCharges(pet) {
  if (typeof pet.playCharges !== 'number') pet.playCharges = PLAY_MAX_CHARGES;
  if (pet.playCharges >= PLAY_MAX_CHARGES) { pet.playRefillAt = 0; return; }
  const now = Date.now();
  while (pet.playCharges < PLAY_MAX_CHARGES && pet.playRefillAt && now >= pet.playRefillAt) {
    pet.playCharges++;
    pet.playRefillAt = pet.playCharges < PLAY_MAX_CHARGES ? pet.playRefillAt + playRefillMs(pet) : 0;
  }
}
// Milliseconds until the next play charge (0 if a charge is available now).
function playChargeRemaining(pet) {
  refreshPlayCharges(pet);
  if ((pet.playCharges || 0) > 0) return 0;
  return Math.max(0, (pet.playRefillAt || 0) - Date.now());
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
  refreshHealCharges(pet);
  if ((pet.healCharges || 0) <= 0) {
    toast(t('toast.healNotReady'));
    return;
  }
  // Consume a charge; if we were at full, start the refill timer.
  if (pet.healCharges >= HEAL_MAX_CHARGES) pet.healRefillAt = Date.now() + HEAL_FREE_COOLDOWN_MS;
  pet.healCharges--;
  const before = pet.hpCurrent || 0;
  pet.hpCurrent = Math.min(maxHp, before + maxHp * HEAL_PCT); // +50% of max HP
  const healed = pet.hpCurrent - before;
  pet.totalHealed = (pet.totalHealed || 0) + healed; // feeds 'healed' unlock (Healing Pollen)
  reaction('🩹');
  bouncePet();
  toast(t('toast.patchedUp', { name: pet.name }));
  checkLearning(); // total healed may cross the SPECIAL_05 milestone
  afterAction('healed!');
}

function afterAction(mood) {
  // Any action other than a scold clears the transient scold sad-pose so the
  // pet re-renders with its normal mood.
  if (mood !== 'scold') scoldSadPose = false;
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
    // v11: Special training can be done only ONCE PER DAY.
    const sinceSpecial = Date.now() - (pet.lastSpecialAt || 0);
    if (sinceSpecial < ONE_DAY_MS) {
      toast(t('toast.specialDailyLimit', { name: pet.name, time: fmtDuration(ONE_DAY_MS - sinceSpecial) }));
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
  // Basics cost a flat 20 stamina up front; Special drains the WHOLE bar on use
  // (no minimum) and is instead limited to once per day (checked above).
  if (!isSpecial && pet.stamina < TRAIN_STAMINA_COST) {
    toast(t('toast.tooTired', { name: pet.name }));
    return;
  }
  // Training (success or refusal) is an action — clear the scold sulk.
  scoldSadPose = false;
  // Refusal (free): laziness + spoiled, tempered by education. A refusal puts the
  // pet ON STRIKE — ALL training locks for 5 min (clear early by scolding).
  let refuseChance = (pet.genome.laziness * 0.35 + pet.spoiled / 300) * (1 - pet.education / 200);
  if (isPersona(pet, 'lazy')) refuseChance += LAZY_REFUSE_BONUS; // v14B: Pigro refuses more
  if (Math.random() < refuseChance) {
    pet.lastMisbehaviorAt = Date.now();
    pet.trainBlockUntil = Date.now() + TRAIN_BLOCK_MS;
    const idx = Math.floor(Math.random() * LAZY_LINE_COUNT);
    toast(t('lazy.' + idx, { name: pet.name }));
    reaction('💢');
    playRefuseAnim(); // pet trots on, shakes its head "no no", then leaves
    refreshTrain();
    save();
    return;
  }
  // v14C: a completed session (special or normal) makes the pet a bit less lazy.
  pet.genome.laziness = clamp((pet.genome.laziness || 0) - LAZY_TRAIN_DROP, 0, 1);
  // v10: Special training — a high-cost gamble that teaches a random move.
  // Cost: 100 stamina + halve happiness + halve HP (floor 1). No stat gain —
  // the move IS the reward.
  if (isSpecial) {
    pet.stamina = 0; // special training drains the ENTIRE energy bar
    pet.care.happiness = clamp(pet.care.happiness * 0.5, 0, 100);
    const maxHp = computeStats(pet).hp;
    pet.hpCurrent = clamp(Math.floor((pet.hpCurrent || maxHp) * 0.5), 1, maxHp);
    pet.lastSpecialAt = Date.now();
    const learned = learnRandomMove(pet);
    markAchievement();
    reaction('🌟');
    bouncePet();
    // v14C: show the Special result inside the animation overlay (below the pet).
    const specialMsg = learned
      ? t('toast.specialLearned', { name: pet.name, icon: elementIcon(learned.element), move: learned.name })
      : t('train.special');
    playTrainingAnim('Special', specialMsg);
    if (learned) {
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
  const shown = gain.toFixed(2);
  // v14C: two-line result text inside the animation overlay (below the pet),
  // appears halfway through the anim. The trained stat is rendered in pink.
  playTrainingAnim(name, {
    headline: t('train.result', { name: pet.name, ex: t('train.' + name.toLowerCase()) }),
    amount: shown,
    stat: ex.label,
  });
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

// v13 — RPS is a LOW bottom panel (#rps-panel), not a full sheet. Flow:
//   openRps -> show the 3 choice buttons
//   playRps -> hide buttons, run a 3-2-1 countdown over the pet area
//   revealRps -> pet icon below the pet (upside-down, bigger) + player icon
//                above the panel, then the result, then auto-close.
let rpsBusy = false;              // ignore choice taps mid-countdown/reveal
const rpsTimers = [];             // pending timeouts (cleared on close)
const RPS_COUNT_MS = 450;         // ~0.45s per number (~1.35s total for 3-2-1)
const RPS_REVEAL_HOLD_MS = 1800;  // how long the reveal lingers before auto-close

function clearRpsTimers() {
  while (rpsTimers.length) clearTimeout(rpsTimers.pop());
}

// Reset the transient reveal bits (countdown + both icons + result text).
function resetRpsReveal() {
  const cd = $('rps-countdown');
  if (cd) { cd.style.display = 'none'; cd.textContent = ''; cd.classList.remove('tick'); }
  const petIcon = $('rps-pet-icon');
  if (petIcon) { petIcon.style.display = 'none'; petIcon.textContent = ''; petIcon.classList.remove('show'); }
  const youIcon = $('rps-you-icon');
  if (youIcon) { youIcon.style.display = 'none'; youIcon.textContent = ''; youIcon.classList.remove('show'); }
  const result = $('rps-result');
  if (result) { result.style.display = 'none'; result.textContent = ''; }
}

function openRps() {
  clearRpsTimers();
  rpsBusy = false;
  resetRpsReveal();
  const choices = $('rps-choices');
  if (choices) choices.style.display = '';
  const backdrop = $('rps-backdrop');
  if (backdrop) backdrop.classList.add('open');
  const panel = $('rps-panel');
  if (panel) panel.classList.add('open');
}

function closeRps() {
  clearRpsTimers();
  rpsBusy = false;
  const panel = $('rps-panel');
  if (panel) panel.classList.remove('open');
  const backdrop = $('rps-backdrop');
  if (backdrop) backdrop.classList.remove('open');
  resetRpsReveal();
}

// 3 -> 2 -> 1 countdown over the pet area, then `done()`.
function runRpsCountdown(done) {
  const cd = $('rps-countdown');
  let n = 3;
  const step = () => {
    if (n <= 0) {
      if (cd) { cd.style.display = 'none'; cd.classList.remove('tick'); }
      done();
      return;
    }
    if (cd) {
      cd.style.display = '';
      cd.textContent = String(n);
      cd.classList.remove('tick');
      void cd.offsetWidth; // restart the pop animation each number
      cd.classList.add('tick');
    }
    n--;
    rpsTimers.push(setTimeout(step, RPS_COUNT_MS));
  };
  step();
}

export function playRps(choice) {
  if (!requirePet()) return;
  const pet = state.pet;
  if (!RPS_EMOJI[choice]) return;
  if (rpsBusy) return; // a round is already in flight
  rpsBusy = true;
  const choices = $('rps-choices');
  if (choices) choices.style.display = 'none';
  // v6: playing no longer costs or requires stamina.
  const opts = ['rock', 'paper', 'scissors'];
  const petChoice = opts[Math.floor(Math.random() * opts.length)];
  runRpsCountdown(() => revealRps(choice, petChoice));
}

// Show both icons + result, apply the happiness effect, then auto-close.
function revealRps(choice, petChoice) {
  const pet = state.pet;
  if (!pet) { closeRps(); return; }
  // Pet's icon below the pet SVG, rotated 180°, ~110% size.
  const petIcon = $('rps-pet-icon');
  if (petIcon) {
    petIcon.textContent = RPS_EMOJI[petChoice];
    petIcon.style.display = '';
    petIcon.classList.remove('show');
    void petIcon.offsetWidth;
    petIcon.classList.add('show');
  }
  // Player's icon just above the choice panel, ~110% size.
  const youIcon = $('rps-you-icon');
  if (youIcon) {
    youIcon.textContent = RPS_EMOJI[choice];
    youIcon.style.display = '';
    youIcon.classList.remove('show');
    void youIcon.offsetWidth;
    youIcon.classList.add('show');
  }
  const c = pet.care;
  let msg;
  if (choice === petChoice) {
    c.happiness = clamp(c.happiness + 6, 0, 100);
    msg = t('rps.tie');
  } else if (RPS_BEATS[choice] === petChoice) {
    // v14B: Giocoso gets extra happiness from a play (RPS) win.
    c.happiness = clamp(c.happiness + 12 + (isPersona(pet, 'playful') ? PLAYFUL_PLAY_HAPPY : 0), 0, 100);
    pet.rpsWins = (pet.rpsWins || 0) + 1; // feeds 'game' unlocks
    markAchievement();
    checkLearning(); // an RPS win may cross a 'game' unlock milestone
    msg = t('rps.win');
  } else {
    c.happiness = clamp(c.happiness + 4, 0, 100);
    msg = t('rps.lose', { name: pet.name });
  }
  const result = $('rps-result');
  if (result) { result.textContent = msg; result.style.display = ''; }
  refresh();
  save();
  rpsTimers.push(setTimeout(closeRps, RPS_REVEAL_HOLD_MS));
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

  // v14B — Personality line (emoji + localized name; description as a tooltip).
  const persona = petPersonality(pet);
  const personaEl = $('info-personality');
  if (personaEl) {
    personaEl.textContent = `${PERSONALITY_EMOJI[persona] || '🎲'} ${t('personality.' + persona)}`;
    personaEl.title = t('personality.' + persona + '.desc');
  }

  // Moveset: known moves highlighted, locked ones show an unlock hint.
  const movesEl = $('info-moves');
  if (movesEl) {
    const known = new Set(Array.isArray(pet.moves) ? pet.moves : ['attack']);
    movesEl.innerHTML = getLearnset(pet)
      .map((ab) => {
        const unlocked = known.has(ab.id);
        const ic = elementIcon(ab.element);
        // Locked moves reveal ONLY their element — name/power/effect hidden (???).
        if (!unlocked) {
          return `<div class="move-item locked"><span class="move-ico">${ic}</span><span class="move-name">${t('moves.unknownName')}</span><span class="move-hint">🔒 ${lockedHintText(pet, ab.unlock)}</span></div>`;
        }
        const tag = moveEffectTag(ab);
        const right = `<span class="move-pw">×${ab.power.toFixed(2)}${tag ? ' ' + tag : ''}</span>`;
        return `<div class="move-item"><span class="move-ico">${ic}</span><span class="move-name">${ab.name}</span>${right}</div>`;
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
  // On strike (after refusing to train) the pet sulks — show it ANGRY.
  const onStrike = pet.stage !== 'egg' && pet.state !== 'dead' && Date.now() < (pet.trainBlockUntil || 0);
  const sad = pet.care.happiness < 50 || dirty || isStarving(pet);
  let mood = pet.sleeping ? 'sleepy' : onStrike ? 'angry' : sad ? 'sad' : 'idle';
  // A fresh scold forces the sad face until the next action clears the flag.
  if (scoldSadPose && pet.stage !== 'egg' && pet.state !== 'dead') mood = 'sad';
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
    refreshHealCharges(pet);
    const label = healBtn.querySelector('.act-label');
    const charges = pet.healCharges || 0;
    if (charges <= 0) {
      healBtn.disabled = true;
      healBtn.classList.add('disabled');
      if (label) label.textContent = t('action.healCooldown', { time: fmtDuration(healChargeRemaining(pet)) });
    } else {
      healBtn.disabled = false;
      healBtn.classList.remove('disabled');
      if (label) label.textContent = t('action.healCharges', { n: charges, max: HEAL_MAX_CHARGES });
    }
  }
  // v12: Play (🎈) button mirrors Heal — "Play {n}/3" when charges are available,
  // disabled with a live "Play {time}" countdown when empty.
  const playBtn = $('btn-play');
  if (playBtn) {
    refreshPlayCharges(pet);
    const label = playBtn.querySelector('.act-label');
    const charges = pet.playCharges || 0;
    if (charges <= 0) {
      playBtn.disabled = true;
      playBtn.classList.add('disabled');
      if (label) label.textContent = t('action.playCooldown', { time: fmtDuration(playChargeRemaining(pet)) });
    } else {
      playBtn.disabled = false;
      playBtn.classList.remove('disabled');
      if (label) label.textContent = t('action.playCharges', { n: charges, max: PLAY_MAX_CHARGES });
    }
  }
  // v14B: Clean (🫧) button mirrors Play — "Clean {n}/3" when available, disabled
  // with a live "Clean {time}" countdown when empty.
  const cleanBtn = $('btn-clean');
  if (cleanBtn) {
    refreshCleanCharges(pet);
    const label = cleanBtn.querySelector('.act-label');
    const charges = pet.cleanCharges || 0;
    if (charges <= 0) {
      cleanBtn.disabled = true;
      cleanBtn.classList.add('disabled');
      if (label) label.textContent = t('action.cleanCooldown', { time: fmtDuration(cleanChargeRemaining(pet)) });
    } else {
      cleanBtn.disabled = false;
      cleanBtn.classList.remove('disabled');
      if (label) label.textContent = t('action.cleanCharges', { n: charges, max: CLEAN_MAX_CHARGES });
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

// Lazily refill heal charges: +1 every HEAL_FREE_COOLDOWN_MS, capped at max.
function refreshHealCharges(pet) {
  if (typeof pet.healCharges !== 'number') pet.healCharges = HEAL_MAX_CHARGES;
  if (pet.healCharges >= HEAL_MAX_CHARGES) { pet.healRefillAt = 0; return; }
  const now = Date.now();
  while (pet.healCharges < HEAL_MAX_CHARGES && pet.healRefillAt && now >= pet.healRefillAt) {
    pet.healCharges++;
    pet.healRefillAt = pet.healCharges < HEAL_MAX_CHARGES ? pet.healRefillAt + HEAL_FREE_COOLDOWN_MS : 0;
  }
}
// Milliseconds until the next heal charge (0 if a charge is available now).
function healChargeRemaining(pet) {
  refreshHealCharges(pet);
  if ((pet.healCharges || 0) > 0) return 0;
  return Math.max(0, (pet.healRefillAt || 0) - Date.now());
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
      // v11: Special needs child+, drains the whole bar, and is once-per-day.
      const lockedStage = stageIdx < STAGE_ORDER.indexOf('child');
      const sinceSpecial = Date.now() - (pet.lastSpecialAt || 0);
      const usedToday = sinceSpecial < ONE_DAY_MS;
      btn.classList.toggle('disabled', blocked || lockedStage || usedToday);
      // Cost label reflects the once-a-day gate (remaining time when spent).
      const costEl = btn.querySelector('.ex-cost');
      if (costEl) costEl.textContent = usedToday
        ? fmtDuration(ONE_DAY_MS - sinceSpecial)
        : t('train.oncePerDay');
      return;
    }
    const ex = EXERCISES[btn.dataset.ex];
    if (!ex) return;
    btn.classList.toggle('disabled', blocked || pet.stage === 'egg' || tooTired);
  });
}

// v12: both training animations play in a CENTERED MODAL overlay
// (#train-anim-overlay, full-screen dark backdrop) rather than inline on the
// training screen. show/hide is purely cosmetic and auto-dismisses.
function showTrainOverlay() {
  const ov = $('train-anim-overlay');
  if (ov) ov.classList.add('open');
}
function hideTrainOverlay() {
  const ov = $('train-anim-overlay');
  if (ov) ov.classList.remove('open');
  const stage = $('train-stage');
  if (stage) stage.classList.remove('perform', 'refuse', 'show');
  clearTimeout(trainTextTimer);
  const txt = $('train-anim-text');
  if (txt) { txt.classList.remove('show'); txt.textContent = ''; }
}

// v5.1: on a successful session, the pet trots onto the (now centered) stage,
// does a few workout reps, then trots off. Purely cosmetic (CSS-driven).
let trainAnimTimer = 0;
let trainTextTimer = 0;
function playTrainingAnim(name, message) {
  const stage = $('train-stage');
  const svg = $('train-svg');
  const pet = state.pet;
  if (!stage || !svg || !pet) return;
  renderPet(svg, pet.genome, pet.stage, { animate: true, element: pet.genome.element });
  const emo = $('train-emoji');
  const ex = EXERCISES[name];
  if (emo) emo.textContent = name === 'Special' ? '🌟' : (ex ? ex.emoji : '💪');
  // Result text starts hidden; the animation plays first and the text pops in
  // at the halfway point (below the animation, above the backdrop).
  const txt = $('train-anim-text');
  if (txt) { txt.textContent = ''; txt.classList.remove('show'); }
  showTrainOverlay();
  stage.classList.remove('perform');
  void stage.offsetWidth; // reflow so the animation restarts on rapid repeats
  stage.classList.add('show', 'perform');
  clearTimeout(trainTextTimer);
  clearTimeout(trainAnimTimer);
  if (message && txt) {
    trainTextTimer = setTimeout(() => {
      renderTrainText(txt, message);
      txt.classList.add('show');
    }, 1800); // ~halfway through the 3.6s animation
  }
  trainAnimTimer = setTimeout(hideTrainOverlay, 3600); // v14C: 1s longer
}

// Populate the result text. A plain string (Special) is shown as-is; a
// {headline, amount, stat} object renders two lines with the trained stat in
// pink (matching the +STAT labels) and a couple of exclamation marks. Built via
// DOM (not innerHTML) so the pet name can't inject markup.
function renderTrainText(txt, message) {
  txt.textContent = '';
  if (typeof message === 'string') { txt.textContent = message; return; }
  txt.appendChild(document.createTextNode(`${message.headline}\n+${message.amount} `));
  const statEl = document.createElement('span');
  statEl.className = 'train-anim-stat';
  statEl.textContent = `${message.stat}!!`;
  txt.appendChild(statEl);
}

// v11: on a training refusal the pet trots on, shakes its head "no no" (angry
// face), and trots off — with a 🙅 balloon. Purely cosmetic (CSS-driven).
let refuseAnimTimer = 0;
function playRefuseAnim() {
  const stage = $('train-stage');
  const svg = $('train-svg');
  const pet = state.pet;
  if (!stage || !svg || !pet) return;
  renderPet(svg, pet.genome, pet.stage, { animate: false, element: pet.genome.element, mood: 'angry' });
  const emo = $('train-emoji');
  if (emo) emo.textContent = '🙅';
  showTrainOverlay();
  stage.classList.remove('perform', 'refuse');
  void stage.offsetWidth; // reflow so the animation restarts on rapid repeats
  stage.classList.add('show', 'refuse');
  clearTimeout(refuseAnimTimer);
  refuseAnimTimer = setTimeout(hideTrainOverlay, 3200); // v14C: 1s longer
}

// ---------------------------------------------------------------------------
// v10 — Moves management screen. Lists KNOWN moves with an Equip/Unequip toggle
// (max 4 equipped, never below 1) and LOCKED moves greyed with their unlock hint.
// ---------------------------------------------------------------------------
function moveMetaLine(ab) {
  const parts = [`×${ab.power.toFixed(2)}`];
  if ((ab.cooldown | 0) > 0) parts.push(`⏳${ab.cooldown | 0}`);
  if ((ab.priority | 0) > 0) parts.push('⚡');
  const tag = moveEffectTag(ab);
  if (tag) parts.push(tag);
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
      // Locked moves reveal ONLY their element — name/power/effect hidden (???).
      row.innerHTML = `<span class="mm-ico">${elementIcon(ab.element)}</span>`
        + `<span class="mm-body"><span class="mm-name">${t('moves.unknownName')}</span></span>`
        + `<span class="mm-hint">🔒 ${lockedHintText(pet, ab.unlock)}</span>`;
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

// v14A (§3) — battle charges: lazily refill +1 every BATTLE_REFILL_MS, capped at
// max (mirrors refreshHealCharges / refreshPlayCharges).
function refreshBattleCharges(pet) {
  if (typeof pet.battleCharges !== 'number') pet.battleCharges = BATTLE_MAX_CHARGES;
  if (pet.battleCharges >= BATTLE_MAX_CHARGES) { pet.battleRefillAt = 0; return; }
  const now = Date.now();
  while (pet.battleCharges < BATTLE_MAX_CHARGES && pet.battleRefillAt && now >= pet.battleRefillAt) {
    pet.battleCharges++;
    pet.battleRefillAt = pet.battleCharges < BATTLE_MAX_CHARGES ? pet.battleRefillAt + BATTLE_REFILL_MS : 0;
  }
}
// Milliseconds until the next battle charge (0 if one is available now).
function battleChargeRemaining(pet) {
  refreshBattleCharges(pet);
  if ((pet.battleCharges || 0) > 0) return 0;
  return Math.max(0, (pet.battleRefillAt || 0) - Date.now());
}

// v14A (§3) — glue for battle-ui: consume a battle charge to START a wild/rival
// battle. Local QR PvP (kind 'pvp') is NEVER gated. Returns true if the battle
// may proceed; false (with a countdown toast) when out of charges.
function consumeBattleCharge(kind) {
  const pet = state.pet;
  if (!pet) return true;
  if (kind === 'pvp') return true; // local QR PvP is free
  refreshBattleCharges(pet);
  if ((pet.battleCharges || 0) <= 0) {
    toast(t('battle.noCharges', { time: fmtDuration(battleChargeRemaining(pet)) }));
    return false;
  }
  if (pet.battleCharges >= BATTLE_MAX_CHARGES) pet.battleRefillAt = Date.now() + BATTLE_REFILL_MS;
  pet.battleCharges--;
  save();
  return true;
}

// v14A (§3) — glue for battle-ui: current battle-charge status for the hub label.
function getBattleCharges() {
  const pet = state.pet;
  if (!pet) return { charges: 0, max: BATTLE_MAX_CHARGES, remaining: 0 };
  refreshBattleCharges(pet);
  return { charges: pet.battleCharges || 0, max: BATTLE_MAX_CHARGES, remaining: battleChargeRemaining(pet) };
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
  const hpBefore = (typeof pet.hpCurrent === 'number' && isFinite(pet.hpCurrent)) ? pet.hpCurrent : maxHp;

  // HP writeback (DESIGN v4 §4 — updated rule):
  //  win / draw ⇒ keep the ACTUAL in-battle HP the fighter walked away with.
  //  loss (faint) ⇒ 5% of max HP. Battles NEVER kill (5% > 0 ⇒ floor 1).
  if (won || info.draw) {
    if (typeof info.remainingHp === 'number' && isFinite(info.remainingHp)) {
      pet.hpCurrent = clamp(info.remainingHp, 1, maxHp);
    }
    // In-battle heal effects (Healing Pollen / Bloom) can leave the fighter with
    // MORE HP than it started; count that positive delta toward totalHealed.
    if (pet.hpCurrent > hpBefore) pet.totalHealed = (pet.totalHealed || 0) + (pet.hpCurrent - hpBefore);
    if (info.draw && !won) {
      // draw: no happiness penalty
    }
  } else {
    pet.hpCurrent = Math.max(1, Math.round(0.05 * maxHp));
    pet.care.happiness = clamp(pet.care.happiness - 15, 0, 100);
    pet.battleLosses = (pet.battleLosses || 0) + 1; // feeds 'losses' unlock (Explosion)
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
  // v12: version label (bottom-left of the Menu screen).
  setText('menu-version', GAME_VERSION);
}

// v12 — Changelog view (#screen-changelog). Renders CHANGELOG newest-first with
// localized headings; item text picks the active language (falls back to EN).
function renderChangelog() {
  setText('changelog-title', t('changelog.title'));
  const back = $('btn-changelog-back');
  if (back) back.textContent = t('changelog.back');
  const listEl = $('changelog-list');
  if (!listEl) return;
  const lang = getLang();
  listEl.innerHTML = '';
  for (const entry of CHANGELOG) {
    const block = document.createElement('div');
    block.className = 'changelog-entry';
    const head = document.createElement('div');
    head.className = 'changelog-version';
    head.textContent = entry.version;
    block.appendChild(head);
    for (const item of (entry.items || [])) {
      const line = document.createElement('div');
      line.className = 'changelog-item';
      line.textContent = item[lang] || item.en || '';
      block.appendChild(line);
    }
    listEl.appendChild(block);
  }
}

// ---------------------------------------------------------------------------
// v12 — Pet export / import (Menu). Export reveals a code + copies it to the
// clipboard; import validates a pasted code and (after an in-page confirm)
// OVERWRITES the current pet with it.
// ---------------------------------------------------------------------------
function doExportPet() {
  const pet = state.pet;
  if (!pet) return;
  const code = exportPetCode(pet);
  if (!code) { toast(t('menu.exportFailed')); return; }
  const field = $('export-code');
  if (field) {
    field.style.display = '';
    field.value = code;
    field.focus();
    field.select();
  }
  const done = () => toast(t('menu.petCopied'));
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(code).then(done).catch(() => {
      try { if (field) { field.select(); document.execCommand('copy'); } } catch (e) { /* ignore */ }
      done();
    });
  } else {
    try { if (field) { field.select(); document.execCommand('copy'); } } catch (e) { /* ignore */ }
    done();
  }
}

// Tapping "📥 Load Pet" reveals the paste input + a Load button (hidden by
// default), then focuses the input. The actual load runs from the Load button.
function revealImportPet() {
  const input = $('import-code');
  const loadBtn = $('btn-import-load');
  if (input) { input.style.display = ''; input.focus(); }
  if (loadBtn) loadBtn.style.display = '';
}

// Hide the import paste field + Load button and clear the pasted text.
function hideImportPet() {
  const input = $('import-code');
  const loadBtn = $('btn-import-load');
  if (input) { input.style.display = 'none'; input.value = ''; }
  if (loadBtn) loadBtn.style.display = 'none';
}

function doImportPet() {
  const input = $('import-code');
  const raw = input ? input.value.trim() : '';
  if (!raw) { toast(t('menu.importInvalid')); return; }
  const imported = importPetCode(raw);
  if (!imported) { toast(t('menu.importInvalid')); return; }
  // Importing OVERWRITES the current pet — require an in-page confirm first.
  openConfirm({
    title: t('menu.importConfirmTitle'),
    emoji: '📥',
    lines: [t('menu.importConfirmBody', { name: imported.name })],
    onConfirm: () => {
      state.pet = imported;
      save();
      hideImportPet();
      const field = $('export-code');
      if (field) { field.style.display = 'none'; field.value = ''; }
      showScreen('pet');
      refresh();
      toast(t('menu.petLoaded'));
    },
  });
}

// ---------------------------------------------------------------------------
// v5 — Shop (§6)
// ---------------------------------------------------------------------------
// v14C — buyable shop items (Daily Coins stays a separate free-claim card).
// Tapping one opens a description + confirm popup, like the food picker; only
// Confirm runs the actual buy. Reroll opens its own move picker instead.
function shopItems() {
  return [
    { id: 'cure', emoji: '❤️', cost: CURE_COST, nameKey: 'shop.curePotion', descKey: 'shop.curePotionDesc', buy: doBuyCure },
    { id: 'stamina', emoji: '⚡', cost: STAMINA_POTION_COST, nameKey: 'shop.staminaPotion', descKey: 'shop.staminaPotionDesc', buy: doBuyStamina },
    { id: 'syringe', emoji: '💉', cost: SYRINGE_COST, nameKey: 'shop.syringe', descKey: 'shop.syringeDesc', buy: doBuySyringe },
    { id: 'reroll', emoji: '🎲', cost: REROLL_COST, nameKey: 'shop.reroll', descKey: 'shop.rerollDesc', pick: openRerollPicker },
  ];
}

let shopGridLang = null; // rebuild the grid on first open and on a language switch
function renderShopGrid() {
  const grid = $('shop-grid');
  if (!grid) return;
  if (grid.children.length && shopGridLang === getLang()) return; // already built for this lang
  shopGridLang = getLang();
  grid.innerHTML = shopItems()
    .map((it) => `<button class="food-item" data-shop="${it.id}"><span class="f-ico">${it.emoji}</span><span class="f-name">${t(it.nameKey)}</span><span class="f-price">🪙 ${it.cost}</span></button>`)
    .join('');
  grid.querySelectorAll('[data-shop]').forEach((btn) => {
    btn.addEventListener('click', () => openShopConfirm(btn.dataset.shop));
  });
}

// Tapping a shop item: reroll opens its move picker; everything else shows a
// description + price confirm popup and only buys on Confirm.
function openShopConfirm(id) {
  const it = shopItems().find((x) => x.id === id);
  if (!it) return;
  if (it.pick) { it.pick(); return; }
  openConfirm({
    title: t('confirm.buyTitle', { item: t(it.nameKey) }),
    emoji: it.emoji,
    lines: [t(it.descKey), t('confirm.price', { coins: it.cost })],
    onConfirm: it.buy,
  });
}

function refreshShop() {
  const pet = state.pet;
  renderShopGrid();
  const c = $('shop-coins');
  if (c) c.textContent = `🪙 ${(pet && pet.coins) || 0}`;
  // v14A (§2): Daily Coins button — "Claim 50 🪙" when ready, else a countdown.
  const dailyBtn = $('btn-daily-coin');
  if (dailyBtn && pet) {
    const remaining = dailyCoinRemaining(pet);
    if (remaining > 0) {
      dailyBtn.disabled = true;
      dailyBtn.classList.add('disabled');
      dailyBtn.textContent = t('shop.dailyCooldown', { time: fmtDuration(remaining) });
    } else {
      dailyBtn.disabled = false;
      dailyBtn.classList.remove('disabled');
      dailyBtn.textContent = t('shop.dailyClaim', { coins: DAILY_COIN_AMOUNT });
    }
  }
}

// v14A (§2) — milliseconds until the daily free coins can be claimed (0 = now).
function dailyCoinRemaining(pet) {
  const last = (pet && pet.lastDailyCoinAt) || 0;
  return Math.max(0, DAILY_COIN_MS - (Date.now() - last));
}

// v14A (§2) — grant 50 free coins once per 24h; refuse (with a countdown) otherwise.
function doClaimDailyCoins() {
  const pet = state.pet;
  if (!pet) return;
  const remaining = dailyCoinRemaining(pet);
  if (remaining > 0) {
    toast(t('shop.dailyNotReady', { time: fmtDuration(remaining) }));
    refreshShop();
    return;
  }
  pet.coins = (pet.coins || 0) + DAILY_COIN_AMOUNT;
  pet.lastDailyCoinAt = Date.now();
  reaction('🪙');
  toast(t('shop.dailyClaimed', { coins: DAILY_COIN_AMOUNT }));
  refreshShop();
  refresh();
  save();
}

// Cure Potion — fully restores HP (no cooldown, unlike the free Heal).
function doBuyCure() {
  const pet = state.pet;
  if (!pet) return;
  if ((pet.coins || 0) < CURE_COST) { toast(t('shop.notEnough')); return; }
  const maxHp = computeStats(pet).hp;
  if (pet.hpCurrent >= maxHp) { toast(t('toast.fullHealth')); return; }
  pet.coins -= CURE_COST;
  const healed = Math.max(0, maxHp - (pet.hpCurrent || 0));
  pet.hpCurrent = maxHp;
  pet.totalHealed = (pet.totalHealed || 0) + healed; // feeds 'healed' unlock
  reaction('❤️');
  toast(t('shop.boughtCure', { name: pet.name }));
  checkLearning();
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
  pet.sickDeadline = 0; // v14A (§5): stop the death timer. Lost stats do NOT return.
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
  bindClick('rps-close', closeRps);
  bindClick('rps-backdrop', closeRps); // tap the dim backdrop to close the minigame
  bindSheetBackdrop('food-sheet');

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

  // v13: the training-animation overlay is NON-skippable — no backdrop-tap
  // dismiss. It swallows taps (the backdrop captures them) and auto-closes when
  // its full animation finishes (~2.6s workout / ~2.2s refusal).

  // v11 — Moves management screen is now opened from the BATTLE menu (battle-ui).
  // Its Back button returns to the battle menu (falls back to the pet screen).
  bindClick('btn-moves-back', () => {
    if (window.SlimeBattle && typeof window.SlimeBattle.openMenu === 'function') window.SlimeBattle.openMenu();
    else showScreen('pet');
  });

  // v8 — confirm popup (food + general). Confirm runs the stored action; Cancel
  // or a backdrop tap just closes (the picker underneath stays open).
  bindClick('confirm-ok', () => { const fn = confirmAction; closeConfirm(); if (fn) fn(); });
  bindClick('confirm-cancel', closeConfirm);
  const confirmPop = $('confirm-popup');
  if (confirmPop) confirmPop.addEventListener('click', (e) => { if (e.target === confirmPop) closeConfirm(); });

  // shop navigation + notifications toggle
  bindClick('btn-shop', () => showScreen('shop'));
  bindClick('btn-shop-back', () => showScreen('pet'));
  bindClick('btn-daily-coin', doClaimDailyCoins);
  // Buyable items are rendered as a grid (renderShopGrid) and routed through a
  // description+confirm popup; no per-button bindings needed here anymore.
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

  // v12: menu changelog ("📋 What's New") open/close.
  bindClick('btn-changelog', () => showScreen('changelog'));
  bindClick('btn-changelog-back', () => showScreen('menu'));

  // v12/v13: pet export / import. Export reveals + copies the code; the import
  // button only REVEALS the paste field + Load button (the Load button imports).
  bindClick('btn-export-pet', doExportPet);
  bindClick('btn-import-pet', revealImportPet);
  bindClick('btn-import-load', doImportPet);

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
    if (state.screen === 'changelog') renderChangelog(); // v12: relocalize changelog
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
  // v14A: make the pet sick now (optionally backdate the sickness start by
  // `hoursAgo` so the stat-penalty accrual / 24h deadline can be exercised).
  window.DEV.sick = (hoursAgo) => {
    if (!state.pet) return;
    const h = typeof hoursAgo === 'number' ? hoursAgo : 0;
    state.pet.sick = true;
    state.pet.illTimer = 0;
    state.pet.sickDeadline = Date.now() + SICK_DEADLINE_MS - h * 3600e3;
    refresh();
    save();
    return { sick: state.pet.sick, sickDeadline: state.pet.sickDeadline, statPenalty: state.pet.statPenalty };
  };
  // v14A: reset the daily-coin cooldown so the claim is available immediately.
  window.DEV.resetDaily = () => {
    if (!state.pet) return;
    state.pet.lastDailyCoinAt = 0;
    if (state.screen === 'shop') refreshShop();
    save();
    return state.pet.lastDailyCoinAt;
  };
  // v14A: set battle charges (default 0) to test the refuse / hub label.
  window.DEV.battleCharges = (n) => {
    if (!state.pet) return;
    state.pet.battleCharges = Math.max(0, Math.min(BATTLE_MAX_CHARGES, Math.floor(Number(n) || 0)));
    state.pet.battleRefillAt = state.pet.battleCharges < BATTLE_MAX_CHARGES ? Date.now() + BATTLE_REFILL_MS : 0;
    save();
    return state.pet.battleCharges;
  };
  // Force death (illness-style) to test the send-off / rebirth flow.
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
    consumeBattleCharge, // v14A (§3): wild/rival battle-charge gate
    getBattleCharges,    // v14A (§3): hub charge label
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
