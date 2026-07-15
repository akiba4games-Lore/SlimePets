# SlimePets — Design v8 (confirm popups for food & battle moves)

Built AFTER the v7 (illness) + training-stamina batch lands (shares game.js / index.html / css / i18n.js; the battle part is in battle-ui.js which no other agent touches).

## Goal
Tapping a **food** (in the food picker) or a **move in battle** no longer acts immediately. Instead it opens an **in-page confirmation popup** (NOT native) that explains the details, with **Confirm** and **Cancel** buttons — so the player sees exactly what a food/move will do before committing. (This does NOT apply to the shop Ability-Reroll picker, and NOT to non-move battle needs; just food and battle-move selection.)

## Confirm popup component
A reusable centered modal / card (or bottom-sheet) with: a title, an emoji, a few detail lines, and two buttons (Confirm / Cancel). In-page only (no window.confirm). Kawaii pastel, matches existing sheets. Cancel closes it and returns to the picker it came from (the picker stays open). Confirm runs the action then closes both.

## Food confirm
- Tapping a food in the food picker opens the popup showing: food emoji + localized name, **price** (🪙 N), and its **effects** as +/- lines: Hunger +X, Health +X, Energy(stamina) +X, Happiness +X (only if >0), Weight +X/-X (only if ≠0). Pull these straight from the FOODS table.
- **Confirm** → run the existing `doFeedFood(id)` (which already handles cost/short-coins/boredom). **Cancel** → close popup, food picker stays open.
- If the pet can't afford it, still show the popup (Confirm will then hit the existing "Not enough coins!" path) — or grey out Confirm; simplest: let Confirm go through the existing guard.

## Battle move confirm (js/battle-ui.js)
- In a battle, tapping one of the player's move buttons no longer commits the action immediately. It opens a confirm popup showing the move's **icon + name**, **element**, **power**, and its **effectiveness vs the current opponent's element** — compute with `typeMult(move.element, opponentElement)` (exported from battle.js): ×1.5 → "Super effective!", ×0.7 → "Not very effective…", else "Normal damage". (Guard/Special no longer exist — only learned moves, so every battle button gets this.)
- **Confirm** → run the original action handler (commit / send the move). **Cancel** → close popup, back to move selection (turn not spent).
- Keep it snappy (small centered card over `#screen-battle`); battle-ui owns this UI. Works for wild / rival / net battles alike. The opponent's element is on the opponent fighter in the battle state / snapshot.

## i18n
Add keys (all 3 langs, natural JA): `confirm.confirm` ("Confirm"), `confirm.cancel` ("Cancel"), `confirm.feedTitle` ("Feed {food}?"), effect line labels (`confirm.hunger`/`confirm.health`/`confirm.energy`/`confirm.happiness`/`confirm.weight` or reuse bar.* labels), `confirm.price` ("Price: 🪙 {coins}"), `confirm.moveTitle` ("Use {move}?"), `confirm.power` ("Power: {power}"), and effectiveness lines (reuse the existing `battle.eff.super` / `battle.eff.weak`, plus a neutral `confirm.effNormal` "Normal damage"). No raw keys.

## Files
- index.html: a `#confirm-popup` element (backdrop + card + title + detail area + Confirm/Cancel buttons) for the FOOD confirm.
- css: styles for the popup(s).
- game.js: food picker item tap → open confirm (instead of feeding directly); a small `openConfirm({title, emoji, lines, onConfirm})` helper; Confirm/Cancel wiring.
- battle-ui.js: battle move button tap → open a small in-battle confirm card (element/power/effectiveness) → Confirm commits, Cancel returns. (battle-ui builds its own DOM/styles, as it already does.)
- i18n.js: new keys ×3.
- SPEC.md: short v8 note.
