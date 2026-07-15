# SlimePets — Design v12 (Play charges, battle-area restructure, menu changelog+version)

Touches: js/game.js, js/pet.js, js/battle-ui.js, js/rivals.js, index.html, css/style.css, js/i18n.js.

## 1. Play (rock-paper-scissors) limited: 3 charges, +1 every 5 min
Mirror the Heal-charge system but for the Play (🎈) action:
- `pet.playCharges` (0-3, start 3) + `pet.playRefillAt` (ms). Refill +1 every **5 min** up to 3 (lazy compute like `refreshHealCharges`). Migrate (default 3 / 0), bump serialize version.
- `doPlay`: if `playCharges<=0` → refuse with a toast (show time to next, e.g. "No plays left — back in {time}") and return; else consume a charge (if was full, start the 5-min timer) and open RPS as today. Keep it otherwise free (no stamina change).
- Button label: show charges "Play {n}/3" when available; when 0, disabled + next-charge timer (reuse the heal-button pattern). Add i18n `action.playCharges` / reuse a cooldown-style key.

## 2. Battle area (Lotta) restructured into panels + Rivals top-right
The battle tab (`#screen-battle`, built by js/battle-ui.js) becomes a HUB with three big buttons, plus a Rivals button in the TOP-RIGHT corner.
- Hub buttons (each opens its own sub-panel inside #screen-battle, with a Back to hub):
  - **🎲 Battaglia casuale** (Random) → the current Wild AI battle flow.
  - **📡 Battaglia locale** (Local) → Host QR / Join by QR / Join by code (the current PvP/QR options).
  - **🎒 Preparazione** (Prep) → the MOVES equip screen (the current 📖 Moves management: equip up to 4, see known/locked). Move moves-management here (remove the separate 📖 button; the only entry to move-equip is now the Preparazione panel).
- **Rivali** = a small button in the top-right of the battle hub (icon 👥). Opens the rivals roster.
- **Rivals roster = REAL local opponents ONLY.** In js/rivals.js REMOVE the seeded rivals: `ensureSeeded()` becomes a no-op (or is dropped); the roster starts EMPTY and only grows via `saveRival(oppSnap, 'qr')` when a LOCAL (QR/PvP) battle actually completes. Empty state shows a friendly "Fight someone locally (QR) to add rivals!" message. (Existing seeded entries in a save: purge entries with `source==='seed'` on load.)

## 3. Menu: changelog + version
- **Version** shown BOTTOM-LEFT of the Menu screen, small/subtle. Define `GAME_VERSION = 'v0.12'` (single source; also usable elsewhere).
- **Changelog** ("📋 Novità"): a button/section in the Menu that opens a changelog view listing updates newest-first. Data = an array of `{version, date?, items:[...]}` in code (game.js or a small data file). Seed it with the history below (localized headings ok; keep item text concise, English base + IT/JA where easy — at minimum EN + IT).

### Changelog seed content (newest first)
- v0.12 — Battle area split into Random / Local / Prep panels; Rivals moved top-right (local opponents only); Play limited to 3 charges (refills every 5 min); changelog + version in the menu.
- v0.11 — Full move system: per-move stats table with effects (buffs, debuffs, heal, recoil, guard, charge), cooldowns & priority (fast moves); random learnset; special training teaches a random move; move-equip screen.
- v0.10 — Heal reworked to 3 charges of 50%; illness + Syringe cure; sad face below 50% happiness; rounder "drop" body.
- v0.9 — Elements & type chart; body color follows the element; persistent HP; death & rebirth; starvation.
- v0.8 — Shop, potions, paid foods, weight.
- v0.7 — Poop/potty, cuddle/spoiled, education/scold, rock-paper-scissors, info panel.
- v0.6 — QR PvP battles, Rivals, coins, persistent HP economy.
- v0.5 — Egg→adult growth, care loop, training, first battles.

## Defaults chosen (flag to user)
- "Preparazione" = the move-equip management screen (+ it's fine to also show the pet's battle stats there).
- Changelog is auto-seeded from our build history (editable); version string v0.12.
- Rivals: seeded/fake rivals removed; roster only real QR/local opponents.

## i18n
All new strings (hub buttons, panel titles/back, Rivals button, empty-rivals message, changelog title + items, version label, play-charges) in EN + IT (+ JA where straightforward). No raw keys.
