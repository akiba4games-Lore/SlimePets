// js/storage.js — localStorage persistence + offline catch-up support.
import { serializePet, deserializePet } from './pet.js';

const KEY = 'slimepets.save.v1';

export function saveGame(state) {
  try {
    const data = {
      pet: state && state.pet ? serializePet(state.pet) : null,
      settings: (state && state.settings) || {},
      savedAt: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('[SlimePets] save failed', e);
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      pet: data.pet ? deserializePet(data.pet) : null,
      settings: data.settings || {},
      savedAt: typeof data.savedAt === 'number' ? data.savedAt : Date.now(),
    };
  } catch (e) {
    console.warn('[SlimePets] load failed', e);
    return null;
  }
}

export function clearGame() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch (e) {
    console.warn('[SlimePets] clear failed', e);
    return false;
  }
}
