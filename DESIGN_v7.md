# SlimePets — Design v7 (illness)

Small feature on top of v6. Built AFTER the v6 batch lands (shares game.js / pet.js / render.js / index.html / css / i18n.js).

## Illness
If the pet stays **sad OR hungry for too long**, it can get **sick**. You cure it by buying a **💉 Syringe (50 coins)** from the shop.

### Getting sick
- New pet fields: `pet.sick` (bool, default false), `pet.illTimer` (ms, default 0). Migrate old saves with these defaults.
- In the 1s care tick (only while `alive`, hatched, and NOT already sick): if `happiness < 20` **OR** `hunger < 15`, accumulate `illTimer += dt`. When healthy again, `illTimer` decays (e.g. −2× dt) toward 0.
- When `illTimer >= ILL_ONSET_MS` (**8 real minutes** of sustained bad state) ⇒ `pet.sick = true`, `illTimer = 0`, toast "{name} got sick! 🤒", and fire a notification (reuse the notif engine, debounced).

### While sick
- Happiness decays **~2× faster**.
- HP drains slowly: **~4%/hour**, floored at **1** — illness alone NEVER kills (only starvation floors at 0, per the v4 model). It just makes the pet miserable until cured.
- Pet screen shows a **🤒 Sick!** badge; render a subtle sickly tint (slight desaturation / pale-green cast) via a `opts.sick` flag in `renderPet`. Sad mouth still applies if unhappy.
- (Optional flavor: while sick, cuddle/play give reduced happiness — keep simple, skip unless easy.)

### Cure — 💉 Syringe (shop)
- New shop item **Syringe** (💉), **50 coins**: sets `pet.sick = false`, `illTimer = 0`, `+10 happiness`, toast "{name} feels better! 💉✨". If the pet isn't sick, toast "{name} isn't sick right now." and DON'T charge. If short on coins, the usual "Not enough coins!".
- Shop layout: add the Syringe card alongside Cure/Stamina potion + Ability Reroll.

### i18n
Add all new strings (sick badge, got-sick toast, syringe item name/desc, cured/notsick toasts, sick notification title/body) to EN + IT + JA. Natural kawaii JA.

### Files
- pet.js: `sick`, `illTimer` fields + migration.
- game.js: illness accrual + onset in tick; `doBuySyringe`; sick badge in refresh; faster happiness decay + slow HP drain while sick; sick notification.
- render.js: `opts.sick` sickly tint.
- index.html / css: Syringe shop card + 🤒 sick badge.
- i18n.js: new keys ×3 languages.

## Open tuning (defaults chosen, easy to change)
ILL_ONSET_MS = 8 min; thresholds happiness<20 / hunger<15; sick HP drain 4%/h (floor 1); syringe 50 coins; cure +10 happiness.
