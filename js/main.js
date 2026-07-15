// js/main.js — boot + 1s care loop + lifecycle saves.
import { initGame, tick, save } from './game.js';

function boot() {
  initGame();

  // 1s care tick. Uses real elapsed time so a slow/throttled timer still decays
  // correctly; the tick handler clamps offline gaps itself is handled at load.
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    let dt = (now - last) / 1000;
    last = now;
    if (dt < 0) dt = 0;
    if (dt > 60) dt = 60; // background tab safety; big gaps handled by offline catch-up on reload
    tick(dt);
  }, 1000);

  // Save on page hide / unload.
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
