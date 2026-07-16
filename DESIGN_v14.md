# SlimePets — Design v14 roadmap (balance, economy, illness rework, personality, League, Album)

Big roadmap from the user. Built in SEQUENTIAL batches (heavy shared-file overlap). This doc records all of it; batch 14A is speced in full below.

## Batch 14A — balance + economy + illness rework + long-press moves (THIS batch)
1. **Shop Back → Menu.** The shop screen's Back button routes to the Menu screen (☰), not the pet/home.
2. **Daily 50 free coins (shop).** A "Claim 50 🪙" button in the shop, once per 24h (track `pet.lastDailyCoinAt`; if ≥24h since, grant 50 coins + toast; else show time remaining / disabled). This is the economy safety-net.
3. **Battle charges: 3, +1 every 5 min.** Add `pet.battleCharges` (3) + `pet.battleRefillAt` (0), lazy refill like heal/play (5 min per charge, max 3), migrate. Consumed when STARTING a **wild** or **rival** battle (NOT local QR PvP). If 0 → refuse with a toast (next-charge time). Show the remaining charges on the battle hub (e.g. on the Random/Rivals options or a small "⚔️ n/3" label).
4. **Protect nerf.** In the moves table (pet.js MOVE_STATS + the battle-ai.js mirror), change Protect's effect from `guard 1.0` (full block) to **`guard 0.5`** (blocks 50% of the incoming hit). Keep its power (1.0–1.2) and cd (2). Update the confirm/tooltip effect text ("blocks 50% of the hit").
5. **Illness BEFORE starvation death (rework).** Starvation no longer drains HP straight to 0/death. Instead prolonged neglect makes the pet **SICK**, and SICKNESS is the lethal path:
   - Getting sick (from the existing sad/hungry trigger OR from prolonged starvation — after the 2h starvation grace, set `sick=true` instead of draining HP) starts a **24h death timer** `sickDeadline = now + 24h`.
   - If not cured within 24h → the pet DIES (existing death/fly-away/rebirth flow).
   - **Cure** (Syringe, and optionally other heals) → `sick=false`, clear `sickDeadline`, stop the drain.
   - **While sick: every hour, −1 to ONE battle stat that is currently >0** (random among str/spd/def/crit/hp>0). Implement via a persistent `pet.statPenalty {str,spd,def,crit,hp}` that `computeStats` subtracts (result floored at 0, hp floored at 1). The penalty PERSISTS (real damage from neglect); training/leveling rebuild over time. (Runs in the 1s tick + offline catch-up, ~1 point per real hour.)
   - Keep the 🤒 badge; the death-by-illness path reuses the death overlay. Starvation HP-drain-to-0 is REMOVED (HP no longer the neglect-death cause; sickness+24h is). Update notifications (sick → "cure within 24h!").
6. **Long-press to inspect moves (replaces confirm-on-every-move).** In battle-ui.js, a battle move button: a normal TAP commits the move immediately (no confirm popup); a LONG-PRESS (~400ms) opens the move-details popup (element/power/effect/cooldown/effectiveness) WITHOUT committing. Remove the mandatory confirm step. (Keep the details content; just gate it behind long-press.)

## Batch 14B — Personality (next)
Assign a **personality** (from seed): **Pigro** (lazy), **Goloso** (glutton), **Coccolone** (cuddly), **Giocoso** (playful), **Disordinato** (messy — nicer than "sporco"), **Dormiglione** (sleepyhead — nicer than "narcolettico"). Each tweaks action outcomes and drives idle animations during the day. Suggested effects:
- Pigro: higher training-refusal chance; slower stamina regen.
- Goloso: hunger decays faster; +extra happiness from food; gains weight faster.
- Coccolone: +happiness from cuddle; happiness decays faster when idle/ignored.
- Giocoso: +happiness from play; play charges refill faster; wants to play.
- Disordinato: hygiene decays faster; poops more often.
- Dormiglione: randomly dozes off (idle animation: closed eyes + "z z z"); sleep restores more; gets sleepy often.
Idle animations: a periodic personality-flavored animation on the pet screen (dormiglione zzz, goloso 🤤, giocoso bounce, coccolone 💕, disordinato dust, pigro yawn). Show personality in the info panel. (pet.js + game.js + render.js + i18n.)

## Batch 14C — Slime League + Album (next)
- **Lega Slime**: a ladder/campaign of progressively harder opponents (tiers), beat them to become **Champion**. Bigger rewards; a visible progression track. New panel under the battle hub. (battle-ui.js + a league data/progress store + game.js.)
- **Album**: a collection that captures every discovered pet APPEARANCE — each look/stage (baby/child/teen/adult, per genome) recorded when first seen, so you build a gallery over time (across rebirths). New screen with thumbnails via renderPet. (game.js + a small store + index.html + css + i18n.)

## Also (my critique, partially addressed here)
14A's daily coins (#2) + illness-grace (#5, softer than sudden offline death) address the economy-deadlock and over-punishment concerns. League + Album (14C) address the "no goal / no collection" concern.
