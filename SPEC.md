# SlimePets — Spec (v5)

Mobile-first HTML5 tamagotchi with procedurally-generated kawaii slime pets, life stages, training, and turn-based battles (vs AI now; PvP via QR/WebRTC).

**Stack:** plain HTML + ES modules + SVG rendering. No build step. localStorage persistence. English UI. Target: phone portrait (~380×800), but responsive.

**External libs (CDN, loaded in index.html):**
- PeerJS `https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js` (global `Peer`)
- qrcodejs `https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js` (global `QRCode`)
- jsQR `https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js` (global `jsQR`) — fallback when `BarcodeDetector` is unavailable

## File ownership

| File | Owner |
|---|---|
| `index.html`, `css/style.css` | Agent A |
| `js/main.js` (boot, screen router, game loop) | Agent A |
| `js/pet.js` (genome gen, pet model, stats, serialization) | Agent A |
| `js/render.js` (SVG pet renderer) | Agent A |
| `js/game.js` (care + training logic & UI bindings) | Agent A |
| `js/storage.js` (save/load, offline catch-up) | Agent A |
| `js/battle.js` (PURE battle engine, no DOM) | Agent B |
| `js/battle-ai.js` (AI opponent gen + action picker) | Agent B |
| `js/net.js` (PeerJS host/join, QR show/scan, protocol) | Agent B |
| `js/battle-ui.js` (battle screen DOM: reads engine events, renders) | Agent B |

Agent B renders pets in battle by calling `renderPet(svgEl, genome, stage, opts)` from `js/render.js` and must not duplicate the renderer. Agent B's screens live inside `<div id="screen-battle">` and `<div id="screen-link">` which Agent A creates (empty shells) in index.html.

## Shared data contracts (BOTH AGENTS MUST MATCH EXACTLY)

### Genome
```js
{
  seed: 123456789,            // uint32, drives everything deterministic
  bodyShape: 'blob'|'drop'|'square'|'spiky'|'mochi',
  hue: 0..359, hue2: 0..359,  // pastel palette base hues (primary body, accent)
  eyes: 'round'|'sparkle'|'sleepy'|'oval'|'star',
  mouth: 'smile'|'cat'|'open'|'w',
  ears: 'none'|'cat'|'bunny'|'floppy'|'round',
  horn: 'none'|'single'|'double'|'antlers',
  nose: 'none'|'dot'|'triangle',
  cheeks: true|false,          // blush
  tail: 'none'|'nub'|'curl'|'fox',
  pattern: 'none'|'spots'|'belly',
  // innate species traits (derived at generation time):
  maxStamina: 60..140,         // int
  laziness: 0.0..1.0,          // float, 2 decimals
  affinity: { str: 0.7..1.3, hp: 0.7..1.3, spd: 0.7..1.3, def: 0.7..1.3, crit: 0.7..1.3 }
}
```

### Stages
`'egg' | 'baby' | 'child' | 'teen' | 'adult'` — visual evolution: baby = pure slime blob (body+eyes+mouth+cheeks only); child adds ears+horn; teen adds nose+tail+leg stubs; adult = full animal-like (legs, arms/paws, tail, pattern, more defined silhouette). Always kawaii/pastel.

### Battle snapshot (what crosses the network / feeds the engine)
```js
{
  name: 'Mochi',
  genome: {...},               // full genome above
  stage: 'teen',
  level: 7,                    // int >= 1
  stats: { hp: 58, str: 14, spd: 11, def: 9, crit: 8 },  // ints; hp = MAX HP
  hpCurrent: 41                // int floor(pet.hpCurrent); a side's starting HP in battle
}
```
`pet.js` exports `battleSnapshot(pet)` producing exactly this. `stats.hp` is the
MAX (ceiling) HP; `hpCurrent` is the persistent current HP the fighter starts a
battle at. `createBattle` uses `hpCurrent` when present & valid (>0), otherwise
falls back to `stats.hp` (back-compat with older snapshots / wild opponents).

### Battle engine API (js/battle.js — pure functions, deterministic)
```js
createBattle(snapA, snapB, seed) -> state        // state is a plain serializable object
legalActions(state, side) -> ['attack','guard','charge','special']
applyTurn(state, actionA, actionB) -> { state, events: [...], winner: null|'A'|'B'|'draw' }
```
- Deterministic: same snapshots+seed+actions ⇒ same result (use a seeded PRNG, e.g. mulberry32; NEVER Math.random in the engine).
- Turn order by spd (tie → seeded coin flip). Damage ≈ str vs def with variance ±15%, crit chance from crit stat (crit ×1.6). `guard`: halve incoming damage this turn. `charge`: skip attack, next attack ×1.8. `special`: depends on bodyShape (blob=heal 20%, drop=spd buff, square=def buff, spiky=recoil heavy hit, mochi=lower enemy str), usable once per battle.
- `events` = ordered list of `{type:'hit'|'crit'|'guard'|'charge'|'special'|'faint'|'text', side:'A'|'B', dmg?, text}` for the UI to animate.
- Battles end ≤ 30 turns (then higher remaining HP% wins, tie = draw).

### Net protocol (js/net.js, PeerJS DataChannel, JSON messages)
Host creates peer, shows QR of its peer id (also shows the id as text for manual entry). Guest scans/enters, connects.
1. guest→host `{t:'hello', snap}` 2. host→guest `{t:'start', snap, seed}` (host picks seed; host is side A)
3. each turn both send `{t:'act', turn:n, action}` — a side's action is locked once sent; when both actions for turn n are known, BOTH clients call `applyTurn` locally (no result exchange needed — engine is deterministic)
4. `{t:'bye'}` on exit. Handle disconnect ⇒ show "opponent left", return to menu.

### Rewards (v2)
Winner +XP (level up = small all-stat gain via `pet.js` `grantBattleXp(pet, won)`), loser small XP. Battle costs **25 stamina + 8 hunger** (no energy stat anymore).
- **Coins** are earned ONLY by winning: **+15 for a wild win, +20 for a Rival win, +25 for a PvP win**. Shown on the result screen. There is no coin cost to battle.
- **HP is persistent.** After a battle the player's remaining HP is written back to `pet.hpCurrent`. On a **loss/faint** the pet is revived at `max(1, 10% of max HP)` and takes **-15 happiness**. On a **draw** the survivor keeps their remaining HP (no penalty, no coins).
- Glue: `window.SlimeGame.payBattleCost()` pays stamina+hunger; `grantBattleResult(won, {remainingHp, kind:'wild'|'rival'|'pvp', draw})` grants XP/coins, persists HP, and returns `{leveledUp, coins}`.

### Rivals — async battles vs registered pets (local ghosts)
A single-player mode to battle **snapshots of other pets stored locally**, piloted by the same AI (`pickAction`) as wild battles — the "battle vs non-live registered players" mode. **No backend**: the roster is pure localStorage.
- **Store:** `js/rivals.js` persists the roster under `slimepets_rivals_v1` (separate from the pet save key `slimepets.save.v1`). All `JSON.parse` is guarded — corrupt storage resets and re-seeds instead of crashing. Entry shape: `{id, name, snap, source:'qr'|'seed', savedAt, wins, losses}` where `wins/losses` = YOUR record vs that rival. API: `listRivals()`, `saveRival(snap, source)` (dedup by `name`+`genome.seed`; keeps record, refreshes snap), `recordResult(id, playerWon)`, `removeRival(id)`, `ensureSeeded()`.
- **Seed rivals:** on first run `ensureSeeded()` populates 4 generated rivals (Pixel Lv2, Waffle Lv4, Nimbus Lv6, Biscuit Lv9) via `generateWildOpponent` with **fixed** seeds, so the starter roster is stable and the roster is never empty.
- **UI (`js/battle-ui.js`):** a **Rivals** button on the battle menu opens a roster screen (per-rival: pet SVG thumbnail, name, `Lv N`, stage, `W-L`, a Battle button, and a 🗑 delete for `source:'qr'` rivals). Selecting one runs the **same battle flow as Wild** (side A = your live pet, side B = the rival's stored snapshot; the rival's `hpCurrent` is honored by the engine).
- **Rewards:** win = **+20 coins** + XP + HP persisted; loss = revive + -15 happiness. Result uses `grantBattleResult(won, {kind:'rival', ...})`; `recordResult` updates the W-L (draws don't count).
- **Auto-save QR opponents:** when a QR PvP battle ends, the opponent's snapshot is saved via `saveRival(opponentSnap, 'qr')` and a "‹name› joined your Rivals!" toast is shown, so you can rematch them offline as a ghost.

## Screens (index.html divs, router in main.js shows one at a time)
`#screen-pet` (main: pet view + care bars + a 4×2 action grid — see v3), `#screen-train` (5 exercises), `#screen-battle`, `#screen-link` (host/join QR), `#screen-menu` (new egg, pet name, reset). Bottom tab bar. Kawaii pastel theme, big rounded buttons, CSS only (no image assets).

## Care & training rules (Agent A) — v2
- **Care stats 0..100: hunger, happiness, hygiene** (Energy was removed in v2). Decay in real time (and offline catch-up capped at 12h; pet never dies, just gets sad). Ticks every second while open.
- **Persistent HP (the heart bar).** `pet.hpCurrent` (float), max = the computed `stats.hp`. When max HP grows (level/training), `hpCurrent` grows by the same amount, always clamped to `[1, max]` — the pet **never dies** (floors at 1). Passive healing runs in the 1s tick and the offline catch-up (same 12h cap): **awake +8%/hour, sleeping +32%/hour** of max.
- **Wounded** = `hpCurrent < 50% of max`: pet screen shows a `🩹 Needs care!` badge and **happiness decays at 3×** its normal (awake) rate.
- **Coins** (`pet.coins`, int, starts 0) shown in the pet screen top bar as `🪙 N`. Earned only by winning battles (see Rewards).
- **Heal action** (`🩹 Heal`): heals to full. **A free heal is available once every 4 real hours** (tracked via `pet.lastFreeHealAt` timestamp; works across sessions/offline — v3, replaces the old daily-calendar rule). While on cooldown a heal costs **25 coins**; the button shows the remaining cooldown compactly (e.g. `Heal 1h 47m`). Toast "Not enough coins!" if short, "Already at full health!" if HP is full.
- **Sleep mode** boosts HP healing (32%/h vs 8%/h) and stamina regen (2×), plus its happiness benefit.
- Stamina 0..maxStamina, regens ~1 per 30s (2× while sleeping). It is a first-class bar on the pet screen (⚡, yellow) alongside HP (❤️, red/pink); numeric stamina stays on the training screen.
- **Migration:** old saves (with `care.energy`) load cleanly — energy is dropped, and `hpCurrent = max HP`, `coins = 0`, `lastFreeCureDay = null` are added.
- **Dev helpers:** `window.DEV.hurt(pct)` sets HP to pct% of max; `window.DEV.coins(n)` sets the coin balance.
- Training: Lift=str, Run=spd, Swim=hp, Block=def, Focus=crit. Costs 15–25 stamina, small hunger/hygiene cost. Gain = base × affinity[stat] × diminishing(currentStat). If stamina < cost ⇒ refuse ("too tired"). Laziness = chance pet refuses anyway (max ~35% at laziness 1.0, funny message, still costs nothing).
- Stage progression: egg hatches after ~2 min of app-open time or 5 taps; then age-based (baby→child 1d, →teen 3d, →adult 7d of real time) BUT add a hidden dev accelerator: `window.DEV.grow()` forces next stage.
- Level: starts 1, from XP (training gives a little, battles more). Base stats at birth from affinity.

## v3 — lifestyle systems (Agent A)

New persistent pet fields (defaults; migrated onto older saves in `deserializePet`, `version` bumped to 3): `weight=30`, `education=20`, `spoiled=0`, `mealsSincePoop=0`, `poopNeedUntil=0`, `poopInRoom=false`, `poopScolded=false`, `lastAchievementAt=0`, `lastMisbehaviorAt=0`, and `lastFreeHealAt=0` (the old `lastFreeCureDay` is dropped).

### Pet-screen layout
- Top bar: pet name/stage on the left, the **🪙 coins pill on the far right**. The old XP/growth bar was **removed** from the top bar — XP progress now lives only in the info panel.
- An **ℹ️ info button at the top-right of the pet panel** toggles a slide-in info panel showing: level + XP progress, the 5 battle stats, lifestyle bars (Weight ⚖️, Education 🎓, Spoiled 😤), and species traits (max stamina, laziness). The always-visible stat chips were removed from the main screen.
- Action area is a **4×2 grid** in this exact order: top row Feed, Clean, Heal, Play; bottom row Potty, Cuddle, Scold, Sleep.

### Feed + Weight
- Feed opens a **food picker** bottom-sheet. Stage `baby`: only 🍼 Milk. Stage child+: 🍎 Apple, 🍖 Meat, 🍞 Bread, 🍦 Ice cream, 🍰 Cake (no milk).
- Effects (hunger / weight / happiness): Milk +30/0/+2; Apple +15/-1/0; Meat +35/+1/0; Bread +30/+3/0; Ice cream +12/+3/+8; Cake +15/+4/+12. Ice cream & cake are the "sweet" foods.
- `pet.weight` 0..100 (start 30). Each training session −1.5 weight (Run −2.5). Slow passive drift toward 30 at ±0.3/h. `renderPet` receives `opts.chubby` (0..1, mapped from weight 30..100) and scales the body subtly wider/squatter.
- Every food eaten counts as one meal for the poop counter.

### Poop (Potty button)
- After every **3 meals** (`mealsSincePoop`) the pet needs to potty: an urgent 💩 badge + ~90s countdown appears (`poopNeedUntil`).
- **Potty during the need** → success: need cleared, +4 happiness, no mess. Countdown **expires** → `poopInRoom=true`: a 💩 renders next to the pet and hygiene decays **3×** until cleaned. **Potty** then cleans it up (+8 hygiene).
- Education ≥ 60 → 50% chance the pet uses the potty by itself when the need would trigger (cute toast, no countdown).

### Cuddle + Spoiled
- `pet.spoiled` 0..100 (start 0, decays −1/h). "Achievements" set `pet.lastAchievementAt`: winning any battle, completing a training session, winning at Play.
- **Cuddle**: within 3 min of an achievement → +15 happiness, no spoil; otherwise +6 happiness and +8 spoiled.
- Spoiled consequences: (a) feeding a non-sweet food may be **refused** with chance `spoiled/150` (bratty toast, hunger not restored, meal not counted); (b) training refusal chance gains `+spoiled/300`. Education tempers **all** refusal chances by factor `(1 − education/200)`. Any refusal sets `pet.lastMisbehaviorAt`.

### Scold + Education
- `pet.education` 0..100 (start 20). **Scold is valid** when a poop is currently in the room and not yet scolded (`poopScolded`, one scold/accident), OR a refusal happened in the last 60s (one scold/misbehavior). Valid → +8 education, −10 spoiled, −3 happiness. Invalid → −10 happiness, sad toast.

### Play = Rock-Paper-Scissors
- Play opens a modal (✊✋✌️); the pet picks randomly (UI-side `Math.random`, never the battle engine). Win: +12 happiness + achievement; tie: +6; lose: +4. Costs 5 stamina (refuses if short).

### Training
- Each completed session additionally costs **−12 hygiene** ("all sweaty!"), burns weight, and counts as an achievement.

### Tickers & offline
- The 1s care tick advances the poop countdown, spoiled decay and weight drift. Offline catch-up applies the drifts and, if a potty need was pending, converts it straight into a poop in the room (no live countdown across sessions).

### Dev helpers (v3)
`window.DEV.meal()` (increment meals + maybe trigger need), `window.DEV.spoil(n)`, `window.DEV.edu(n)`, `window.DEV.weight(n)`.

## v5 — economy, shop, feedback, notifications (Agent A)

Serialization `version` bumped to **5**; `deserializePet` migrates all new fields cleanly onto older saves. New persistent pet fields: `lastEggAt=0`, `sameFoodStreak=0`, `lastFoodId=null`, `moveOverrides={}`.

### Coins / start (§1)
- A **fresh pet / new egg starts with 400 coins** (`createPet` sets `coins:400`). Rebirth after death still carries the current coins forward. **Migration leaves existing saved coins as-is** — a pre-economy save with no coins field defaults to 0 (it is NOT a brand-new pet, so it gets no 400 bonus).

### Food economy (§2)
Foods now **cost coins**, restore **less hunger**, and top up a little **HP + stamina** (clamped to max). If `coins < cost` ⇒ toast `shop.notEnough` and no feed. The Feed picker shows each food's price.

| id | cost | hunger | hp | stamina | weight | happy |
|---|---|---|---|---|---|---|
| milk (baby only) | 5 | +18 | +3 | +4 | 0 | 0 |
| apple | 5 | +10 | +2 | +3 | -1 | 0 |
| bread | 12 | +18 | +3 | +5 | +3 | 0 |
| ice cream | 12 | +8 | +2 | +3 | +3 | +8 |
| cake | 15 | +10 | +3 | +4 | +4 | +12 |
| meat | 20 | +22 | +6 | +8 | +1 | 0 |

Ice cream & cake add happiness. Feeding the **same food 3× in a row** (`sameFoodStreak≥3`, tracked with `lastFoodId`) applies **−8 happiness** and toasts `toast.boredFood`. A different food resets the streak to 1. Every feed still counts as a meal and resets the starvation clock.

### Ability unlocks (§3)
Fixed per-slot conditions (only conditions changed vs v4; move names/elements/powers are unchanged): slot0 **Attack** always; slot1 elemental **level 2**; slot2 (3rd) **win 10 battles** (`{type:'wins',value:10}`); slot3 (4th) **level 3** (`{type:'level',value:3}`).

### Clean / dirtiness / sadness (§4)
- **Clean (🫧) = partial bath:** hygiene **+75 (capped at 100)**, happiness **−8** (pets dislike baths). It does **NOT** clear poop — that stays the **Potty** button's job.
- **Dirty** (`hygiene < 35`): happiness decays **~1.6× faster** and the pet's mood is forced to **sad**.
- **Sad mood** (`happiness < 30` OR dirty OR starving) draws a downturned mouth regardless of the genome mouth.
- **Dirty visual:** `renderPet` overlays brown smudge dots (clipped to the body) + a small buzzing fly (`opts.dirty`).

### Sleep visual (§5)
While `pet.sleeping`, `#pet-stage` gets a `.night` class → a semi-transparent dark-blue layer (`rgba(30,40,90,0.45)`) + 🌙 over the stage, removed on wake.

### Shop (§6)
New **Shop** screen (`#screen-shop`), reached via the **🛒 Shop** button in the Menu. Shows current coins; each buy deducts coins (toast `shop.notEnough` if short):
- **Cure Potion — 50** → full HP (no cooldown).
- **Stamina Potion — 50** → full stamina.
- **Ability Reroll — 200** → opens a picker of currently-learned moves (Attack excluded, so Attack is always kept); the chosen slot is rerolled to a new random move (name/element/power) stored in `pet.moveOverrides[slotId]`. `getLearnset`/`battleSnapshot` apply the override so battle uses the new move; `pet.moves` ids are untouched.

### New-egg cooldown (§7)
The Menu "Hatch a New Egg" action is limited to **once every 4 real hours** (`pet.lastEggAt`, persisted). While cooling down the button is disabled and shows `menu.eggCooldown` ("New egg in {time}"). **Death→rebirth is exempt** (rebirth never stamps `lastEggAt`).

### Notifications (§8)
Web Notifications API, best-effort while the page is alive (open/backgrounded). An "Enable notifications" button in the Shop calls `Notification.requestPermission()`. When granted, a debounced `new Notification(...)` fires **once per state entry** (reset when the condition clears) for: needs-to-poop, starving, very hungry (`hunger<15`), low HP (`<25%` of max), dirty (`hygiene<35`). **Limitation (documented in code):** true push with the app fully closed needs an installed PWA + service worker + push backend — out of scope for v5.

### i18n (§9/§10)
All new user-facing strings (shop, potions, ability reroll, notifications, egg cooldown, bored-of-food toast, enable-notifications) added to EN + IT + JA. Move proper-names stay English.

## v6 — care/economy simplification & UI polish (Agent A)

Serialization `version` bumped to **6**; `deserializePet` migrates the new field. New persistent field: `nextPoopAt` (timestamp of the next potty need).

- **Heal (🩹) is always free, never charges coins.** The 4h free-heal cooldown stays (`pet.lastFreeHealAt`). **v7:** while cooling down the Heal button is **disabled** (`.disabled`, grey, `pointer-events:none`) and shows a live countdown label `action.healCooldown` ("Heal {time}", updated in the per-second `refreshBars`); it re-enables and relabels to `action.heal` ("Heal") the instant the cooldown expires. The on-cooldown toast (`toast.healNotReady`) remains as a safety fallback. Off-cooldown top-ups are the shop's **Cure Potion**.
- **Potion prices dropped to 30** (Cure Potion & Stamina Potion; were 50). Reroll unchanged (200).
- **ℹ️ info button moved to the TOP-LEFT** of `#pet-stage` (🛒 shop stays bottom-right).
- **Baby/milk boredom exemption:** the same-food-3× penalty never applies to `milk` or while `stage==='baby'` — a baby can only drink milk, so it never gets bored/sad from it.
- **No action consumes stamina.** Training (`doTrain`) and Rock-Paper-Scissors (`doPlay`/`playRps`) no longer cost or require stamina, and nothing is gated by low stamina (battles were already free). The stamina bar + Stamina Potion remain. The training-refusal 5-min strike (laziness/spoiled) stays. Exercise buttons no longer show a `⚡` cost.
- **Poop is a 30-minute timer (`POOP_INTERVAL_MS`).** ~30 min after the last relief (hatch, potty success, or floor cleanup) the need triggers; `nextPoopAt` is persisted. While active a cute comic **thought-bubble** (💩) shows near the pet — **no countdown number** anywhere. A hidden ~2 min grace (`POOP_GRACE_MS`, not shown) follows; ignored, it becomes a floor accident (`poopInRoom`). Pressing **Potty** during the need clears it and restarts the timer. Education ≥ 60 → 50% self-potty (also restarts the timer). The old meal-count trigger (`mealsSincePoop`) is retired.
- **Notifications toggle moved to the Menu** screen (out of the Shop); wired identically (`updateNotifyButton`/`requestNotifications`).
- **Language is a "🌐 Language" button** that opens an in-page chooser sheet (`#lang-sheet`, 🇮🇹/🇯🇵/🇬🇧), replacing the always-visible 3-flag selector. Live switching + persistence unchanged.
- **Reset is at the BOTTOM of the Menu with an in-page two-step confirm** (no native `confirm()`): first press arms it + shows a warning and a Cancel; a second press within ~4s (auto-disarm) runs the full `resetGame()` wipe.

## v7 — illness (Agent A)

Serialization `version` bumped to **7**; `deserializePet` migrates the new fields onto older saves. New persistent pet fields: `sick=false`, `illTimer=0` (ms).

- **Getting sick:** in the 1s care tick (and offline catch-up), while `alive`, hatched and NOT already sick, a sustained bad state (`happiness < 20` OR `hunger < 15`) fills `illTimer` (`+dt`); a healthy state drains it (`−2× dt`, floored at 0). When `illTimer ≥ ILL_ONSET_MS` (**8 real minutes**) the pet becomes `sick=true`, `illTimer=0`, a `toast.gotSick` fires, and a debounced sick notification (`notif.sickTitle`/`notif.sickBody`) fires via the existing notif engine (`notifiedFlags.sick`).
- **While sick:** happiness decays **~2×** faster (awake); HP drains **~4%/hour floored at 1** — illness NEVER kills (only starvation floors at 0; if awake+starving, starvation's drain to 0 takes over). The pet screen shows a **🤒 Sick!** badge (`#sick-badge`); `renderPet` receives `opts.sick` and casts a subtle pale-green sickly tint over the body. The sad mouth still applies via the existing mood logic.
- **Cure — 💉 Syringe (shop, 50 coins):** `doBuySyringe` — if not sick, toast `shop.notSick` and **don't charge**; if `coins < 50`, toast `shop.notEnough`; otherwise deduct 50, set `sick=false`/`illTimer=0`, `+10 happiness`, toast `shop.cured`. New shop card alongside Cure/Stamina/Reroll.
- **Tuning constants** (game.js, easy to change): `ILL_ONSET_MS = 8*60*1000`, thresholds `happiness<20`/`hunger<15`, `ILL_HP_PER_HR = 0.04` (floor 1), `SICK_HAPPY_MULT = 2`, `SYRINGE_COST = 50`, `CURE_HAPPY = 10`.
- **i18n:** `status.sick`, `toast.gotSick`, `shop.syringe`/`shop.syringeDesc`/`shop.cured`/`shop.notSick`, `notif.sickTitle`/`notif.sickBody` added to EN + IT + JA.

### v6.1 — training costs stamina again
Training costs a **flat 20 ⚡ stamina per session for all 5 exercises** (`TRAIN_STAMINA_COST = 20`, replacing the per-exercise `stam` values). `doTrain` refuses up front with `toast.tooTired` if `stamina < 20`; a successful session deducts 20. Exercise buttons are `.disabled` while too tired (and still while on strike / egg), and each shows a `20⚡` cost span. `train.hint` mentions the stamina cost. **Only training** costs stamina — RPS Play and battles remain free.

## v8 / v9 / v10 — confirm popups, cooldowns, moves management (UI = Agent B batch)

- **Food confirm (v8):** tapping a food in the picker no longer feeds immediately — it opens an in-page confirm popup (`#confirm-popup`, never native) showing the food emoji+name, `confirm.price` (🪙 N) and each nonzero effect (Hunger/Health/Stamina/Happiness/Weight, reusing `bar.*`/`life.weight` labels). Confirm → the existing `doFeedFood(id)`; Cancel/backdrop → close, picker stays open. Reusable helper `openConfirm({title, emoji, lines, onConfirm})` in `game.js`.
- **Battle move confirm (v8):** in `battle-ui.js`, tapping a move opens a small in-battle confirm card (own DOM/`bui-*` styles) with icon+name, element, `confirm.power`, `confirm.cooldown` (if cd>0), `confirm.fast` (if priority>0) and effectiveness vs the OPPONENT's element via `typeMult(move.element, oppElement)` → `battle.eff.super` / `battle.eff.weak` / `confirm.effNormal`. Confirm commits the turn; Cancel returns to selection (turn not spent).
- **Opponent element (v9):** each battle arena panel shows the fighter's element (`ELEMENT_ICON` + `element.*`) under the name — read from `snap.element`.
- **Cooldown + fast buttons (v9):** `renderActionButtons` renders ALL of the player's EQUIPPED moves (`snap.moves`), not just legal ones. A move on cooldown is disabled with a `⏳N` badge (turns from `state[mySide].cd[id]`); priority>0 moves show `⚡`. `legalActions` still gates usability; `setButtonsEnabled` stamps per-button `dataset.usable` so re-enabling never revives a cooldown move.
- **Moves screen (v10):** a **📖 Moves** button (`moves.button`) on Training opens `#screen-moves`. Lists KNOWN moves (`getKnownMoves`) with icon/element, power, `⏳`cooldown, `⚡`fast and an Equip/Unequip toggle (`equipMove`/`unequipMove`) — max 4 (disable further Equip at 4; can't unequip the last), header shows `moves.equipped` "Equipped {n}/4". LOCKED moves (learnset ids not yet known) are greyed with `unlockHint` (now incl. a `stage` → `unlock.stage` case). Persists + live-updates.
- **Special Training (v10):** a 6th `.exercise` **🌟 Special** (`data-ex="Special"`, `100⚡`), enabled only at stage child/teen/adult. `doTrain` uses a per-exercise stamina cost (20 basics, **100** Special); Special gates stage (egg/baby → `toast.specialLocked`) and stamina (`<100` → `toast.tooTired`), then applies 100 stamina + `happiness*=0.5` + `hpCurrent*=0.5` (floor 1) and calls `learnRandomMove(pet)`, toasting `toast.specialLearned` (auto-equipped if a slot is free, else `toast.moveNotEquipped` hint). No stat gain — the move is the reward.
- **i18n:** new `confirm.*`, `moves.*`, `train.special`, `unlock.stage`, `toast.specialLocked`/`specialLearned`/`moveNotEquipped` added to EN + IT + JA.

## v11 — rich moves table, effects, random learnset, counters (see DESIGN_v11.md)

Serialization `version` → **11**; `deserializePet` migrates cleanly (new fields default 0/{}; learnset recomputed; stale `moveOverrides` referencing unknown moves dropped; equipped falls back to first ≤4 known).

- **Moves table (`pet.js` `MOVE_STATS`, mirrored in `battle-ai.js`/engine):** each element has EXACTLY 4 moves — basic/mid/strong/special (33 total incl. universal Attack). Each carries a per-pet power RANGE `[powerMin,powerMax]` (seeded roll → fixed per pet), `cooldown` (NEGATIVE = charge: |n| turns — Wave -1, Beam -2), `priority` (only Scorch = 1), and an optional `effect`: `selfBuff`/`enemyDebuff` (fractional stat deltas, stack, floor 1), `heal` (frac of maxHP), `recoil` (frac of maxHP after damage, floor 1), `noDamage`, `guard` (Protect = 1.0). Move objects built for a pet carry `power` + `effect` + `cooldown`; `battleSnapshot` passes `effect` and the signed cooldown to the engine.
- **Random learnset (`getLearnset`, deterministic per seed):** Attack (always) + own-element BASIC (random EASY condition) + own-element MID (random MEDIUM condition) + ONE random move (random element, tier basic/mid/strong, random condition from that tier's pool) + own-element SPECIAL (its FIXED SPECIAL condition). `learnRandomMove`/`rerollMove` pick any non-Attack table move (rolled power, taught directly).
- **Condition pools + new types (`checkUnlocks`):** EASY/MEDIUM/HARD pools (one pulled per learnset build). New unlock types: `scold`,`cuddle`,`game`(rpsWins),`stat`(HP/STR/SPD/DEF/CRIT ≥ n via `computeStats`),`spoiledEdu`(spoiled==0 && education≥70),`healed`,`losses`; `weight` gained a `cmp` (`gte`/`lte`). SPECIAL conditions: Blaze STR≥30, Thunder SPD≥30, Wave/Sand Attack DEF≥30, Healing Pollen healed≥1000, Nightmare CRIT≥30, Beam spoiled0&edu≥70, Explosion losses≥50.
- **Counters (`game.js`, migrated default 0):** `scoldCount`++ (valid scold), `cuddleCount`++ (any cuddle), `rpsWins`++ (RPS win), `totalHealed` += HP restored (Heal action, Cure Potion, in-battle heal delta on writeback), `battleLosses`++ (loss).
- **Special training (v11):** ONCE PER DAY (`lastSpecialAt`, 24h gate; refuse `toast.specialDailyLimit`); stage child+ still required; consumes the WHOLE stamina bar (`stamina=0`) + `happiness*=0.5` + `hpCurrent*=0.5` (floor 1), then `learnRandomMove`. The 🌟 button label shows `train.oncePerDay` / a remaining-time countdown and disables while spent.
- **UI:** the Moves screen is opened from the **BATTLE ("Lotta") menu** (`battle-ui.js` `renderMenu`), no longer from Training; its Back returns to the battle menu. LOCKED moves reveal ONLY their element (name/power/effect hidden → `moves.unknownName` "???") in both the Moves screen and the info panel; the unlock HINT is time-gated on hatch time (`unlock.later` placeholder for the first 24h, real condition after). Move-confirm popup + Moves screen surface effects (`effect.*` labels — "ATK +10% (self)", "Enemy SPD −20%", "Heals 25% HP", "Recoil 20%", "🛡️ Blocks the hit", "⚡ Charge N"); the battle log renders the engine's `buff`/`debuff`/`heal`/`recoil`/`guard` events. New `effect.*`, `unlock.*`, `moves.unknownName`, `train.oncePerDay`, `toast.specialDailyLimit`, `battle.log.*` strings added to EN + IT + JA.

## v12 — play charges, battle-area restructure, menu changelog/version, pet export/import (see DESIGN_v12.md)

Serialization `version` → **12**; `deserializePet` migrates the new fields (`playCharges` default 3, `playRefillAt` default 0).

- **Play charges (game.js + pet.js):** the Play (🎈 RPS) action is limited to **3 charges, +1 every 5 min** (`PLAY_REFILL_MS`, `PLAY_MAX_CHARGES`), mirroring Heal's charge system (`refreshPlayCharges`/`playChargeRemaining`). `doPlay` refuses at 0 with `toast.playNotReady` (next-charge countdown); otherwise consumes a charge (starts the 5-min timer if we were full) then opens RPS — playing is otherwise free. `#btn-play` shows `action.playCharges` ("Play {n}/3") and, at 0, disables with `action.playCooldown` ("Play {time}"), updated live in `refreshBars`.
- **Battle hub (battle-ui.js):** the battle tab is a HUB — 🎲 **Random** (`battle.hub.random` → Wild), 📡 **Local** (`battle.hub.local` → a sub-panel with Host QR / Join QR / Join code), 🎒 **Prep** (`battle.hub.prep` → the moves-equip screen, now the ONLY entry — the standalone 📖 Moves button is gone). A **Rivals** button (👥) sits top-right (`.bui-rivals-btn`) and opens the roster. Every sub-panel has a Back-to-hub button.
- **Rivals = REAL local opponents only (rivals.js):** `ensureSeeded()` is a NO-OP; `load()` purges any legacy `source==='seed'` entries (and re-persists). The roster starts empty, grows only via `saveRival(oppSnap,'qr')` on a completed QR/local battle, and empty state shows `battle.noRivals` ("Fight someone locally (QR) to add rivals!").
- **Menu changelog + version (game.js + index.html):** `GAME_VERSION = 'v0.12'` shown small at the BOTTOM-LEFT of `#screen-menu` (`#menu-version`). A **📋 What's New** button (`menu.changelog`) opens `#screen-changelog` built from a `CHANGELOG` array (newest-first; localized headings; item text EN + IT, JA where easy).
- **Pet export/import (pet.js + game.js + Menu):** `exportPetCode(pet)` → `"SLM1:"` + unicode-safe base64 of `serializePet(pet)`; `importPetCode(code)` decodes/parses/`deserializePet`s (fully guarded, returns null on any error). Menu **📤 Copy Pet** reveals the code + copies via `navigator.clipboard`; **📥 Load Pet** validates a pasted code, then (in-page `openConfirm`) OVERWRITES `state.pet`, saves and returns to the pet screen.
- **Distinct moves (pet.js):** `getLearnset`'s random 4th move is re-rolled deterministically until distinct from the pet's other moves; `learnRandomMove`/`rerollMove` prefer a not-yet-owned move — a pet never owns the same move twice.
- **Centered training-animation modal:** `playTrainingAnim`/`playRefuseAnim` now play inside a full-screen fixed overlay (`#train-anim-overlay`, `rgba(0,0,0,0.5)` backdrop, high z-index) with the pet centered; auto-dismisses (~2.6s / ~2.2s), tap-backdrop dismisses early.
- **i18n:** all new strings in EN + IT + JA.

## Style
Pastel palette from genome hue (HSL: body `hsl(hue 70% 80%)`, darker outline same hue, accent hue2). Big glossy eyes with white highlights, blush circles, tiny mouth. Idle bounce/squish animation (CSS or SVG transform). Everything cute — think Kirby/slime mascots.
