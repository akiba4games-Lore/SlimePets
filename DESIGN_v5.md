# SlimePets — Design v5 (economy, shop, feedback, notifications)

Builds on v4. Everything below is the contract. Update SPEC.md/i18n to match. Battle engine (battle.js/battle-ai.js) is NOT affected except the ability UNLOCK conditions (which live in pet.js `getLearnset`).

## 1. Coins / start
- A **fresh pet / new egg starts with 400 coins** (was 0). Rebirth after death still carries the current coins forward (unchanged). Migration: leave existing saved coins as-is; only brand-new pets get 400.

## 2. Food — now costs coins, gives LESS hunger, restores a little HP + stamina
Feeding is now the main way to top up **HP and stamina** (the "recharge by eating" request), at a **coin cost**, with **reduced hunger** restore. Buying happens in the Feed picker (each item shows its price). If coins < price → toast `shop.notEnough` and no feed.

Food table (cost / hunger / hp / stamina / weight / happy):
| id | cost | hunger | hp | stamina | weight | happy |
|---|---|---|---|---|---|---|
| milk (baby only) | 5 | +18 | +3 | +4 | 0 | 0 |
| apple | 5 | +10 | +2 | +3 | -1 | 0 |
| bread | 12 | +18 | +3 | +5 | +3 | 0 |
| ice cream | 12 | +8 | +2 | +3 | +3 | +8 |
| cake | 15 | +10 | +3 | +4 | +4 | +12 |
| meat | 20 | +22 | +6 | +8 | +1 | 0 |
(hp/stamina restores are clamped to max; meat is the priciest because it gives the most hunger.)

- **Same food 3× in a row → the pet gets bored/sad.** Track `pet.sameFoodStreak` + `pet.lastFoodId`. Feeding the same id increments the streak; a different id resets it to 1. When the feed makes it **3 in a row (streak≥3)**, apply **-8 happiness** and toast `toast.boredFood` ("{name} is bored of eating {food}…"). (Still eats — just the mood hit.)
- Every feed still counts as a meal for the poop counter and resets `lastFedAt` (starvation clock).

## 3. Ability unlocks (revised — overrides v4 milestones)
Per-pet learnset slots become FIXED conditions:
- slot0 **Attack** — always.
- slot1 — own-element elemental — **level 2** (unchanged).
- slot2 (the "3rd ability") — **win 10 battles** (`{type:'wins', value:10}`).
- slot3 (the "4th ability") — **level 3** (`{type:'level', value:3}`).
Keep the move pools/elements from v4; only the unlock CONDITIONS change. `checkUnlocks` already reads `pet.battleWins` and `pet.level`.

## 4. Clean / bath, dirtiness, sadness
- **Clean (🫧) = bath (partial):** raises hygiene by **+75 (capped at 100)**. It does **NOT** clear poop in the room — clearing poop stays the job of Potty (🚽). Taking a bath **lowers happiness by 8** (pets dislike baths).
- **Dirty makes the pet sad:** while `hygiene < 35`, happiness decays ~1.6× faster AND the pet's mood is forced to `sad`.
- **Sad = sad mouth:** when mood is `sad` (happiness < 30, OR dirty, OR starving), `renderPet` draws a downturned/frowny mouth regardless of the genome mouth style. (Add a `mood:'sad'` path in render.js's mouth drawing.)
- **Dirty visual effect:** when `hygiene < 35`, `renderPet` overlays "dirty" marks — a few brown smudge dots on the body + a little fly (🪰-like) buzzing near the pet. Subtle, still kawaii. (opts.dirty boolean.)

## 5. Sleep visual
- When `pet.sleeping`, dim the pet stage with a **semi-transparent dark-blue night layer** over `#pet-stage` (e.g. `rgba(30,40,90,0.45)`), plus a small 🌙/💤. Remove it on wake. Pure CSS overlay toggled by a class on the stage.

## 6. Shop (new screen)
New **Shop** screen, reachable from the Menu (add a "🛒 Shop" button in `#screen-menu`; optionally also a shortcut). Items (coins deducted on buy; if short → toast `shop.notEnough`):
- **Cure Potion — 50** → fully restores HP (no cooldown, unlike the free Heal). Toast on use.
- **Stamina Potion — 50** → fully restores stamina.
- **Ability Reroll — 200** → opens a picker listing the pet's currently-learned moves; the player picks ONE, and that slot is **rerolled to a new random move** (new name/element/power via a fresh seed jitter; Attack slot may be excluded from rerolling, or allowed — allow all except keep at least Attack). Confirm + toast. Updates `pet.moves`/learnset so battle uses the new move.
Layout: cards with icon, name, price, Buy button; show current coins at top. Kawaii pastel, consistent with the rest.

## 7. New-egg cooldown
- The Menu "Hatch a New Egg" action is limited to **once every 4 real hours** (`pet` or global `lastEggAt` timestamp, persisted; survives reload). While on cooldown the button is disabled and shows the remaining time (`menu.eggCooldown` "New egg in {time}"). Death→rebirth is automatic and NOT subject to this cooldown.

## 8. Notifications (Web Notifications API — best-effort, app-open only)
- Add an "Enable notifications" toggle/button (in Menu or Shop). On click, `Notification.requestPermission()`.
- When permission granted, fire a `new Notification(...)` for events while the app is running (open or backgrounded): **needs to poop**, **starving**, **very hungry (hunger<15)**, **low HP (<25%)**, **dirty**. Debounce each event type (don't spam — fire once per state entry, e.g. track a `notified` flag per condition, reset when the condition clears).
- LIMITATION (document, don't fake): web notifications only fire while the page/tab is alive. True push with the app fully closed needs an installed PWA + service worker + push backend — out of scope for v5.
- Localize notification titles/bodies via i18n.

## 9. i18n
Add keys for ALL new strings (shop, items, food prices/labels already exist, potions, ability reroll, notification texts, egg cooldown, bored-of-food toast, enable-notifications) to EN + IT + JA dictionaries. No raw keys visible in any language. Keep move proper-names in English (as before).

## Files
- pet.js: start coins 400, unlock conditions (10 wins / level 3), `lastEggAt`, `sameFoodStreak`/`lastFoodId`, ability-reroll helper, migration (version bump 5).
- game.js: food economy (cost/less-hunger/hp+stamina/sweets/3x-bored), Clean full-bath, dirty→sad + faster happiness decay, new-egg 4h cooldown, shop buy logic (potions, ability reroll picker), notifications engine.
- render.js: sad mouth (mood), dirty overlay, (sleep handled in CSS).
- index.html/css: Shop screen + cards, sleep night overlay, dirty marks styling, notification button, egg-cooldown label.
- i18n.js: all new keys ×3 languages.
