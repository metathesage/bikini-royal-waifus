import { DEFAULT_LOOK, DEFAULT_SETTINGS } from '../data/catalog.js';

const KEY = 'bikini-royal-waifus-v1';

/**
 * Lifetime progression behind the menu's profile chip.
 *
 * The header shows a level, an XP bar and a wallet; those numbers are only worth
 * showing if they move, so they are derived from finished matches rather than
 * faked per screen. Everything here is prototype currency — there is no shop to
 * spend it in yet — but it is at least earned currency, which is what makes the
 * bar fill when you play well.
 */
export const DEFAULT_STATS = { level: 1, xp: 0, coins: 0, gems: 0, matches: 0, wins: 0, kills: 0 };

/** XP needed to clear `level`. Rises gently so early levels come quickly. */
export function xpToNext(level) {
  return 400 + (level - 1) * 240;
}

/**
 * Fold one finished match into the lifetime stats.
 *
 * Returns a new object rather than mutating, so a caller that has not decided to
 * persist yet cannot lose its previous state. Placement pays out over 22 squads
 * because the lobby is 22 squads: coming 2nd should be worth nearly as much as
 * winning, and coming last should still be worth showing up.
 */
export function progress(stats, result) {
  if (!result || !stats) return stats;
  const s = { ...stats };
  const kills = result.kills || 0;
  const damage = result.damage || 0;
  const placement = Math.max(1, Number(result.placement) || 22);
  s.matches += 1;
  s.kills += kills;
  if (result.win) s.wins += 1;
  s.xp += Math.round(120 + ((22 - placement) / 21) * 260 + kills * 45 + damage / 12);
  s.coins += 40 + kills * 12 + (result.win ? 250 : 0);
  if (result.win) s.gems += 15;
  // A single great match can clear several thresholds, so drain rather than
  // checking once and leaving the bar over-full.
  while (s.xp >= xpToNext(s.level)) {
    s.xp -= xpToNext(s.level);
    s.level += 1;
  }
  return s;
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function merge(base, saved) {
  if (!saved || typeof saved !== 'object') return clone(base);
  const out = clone(base);
  for (const k of Object.keys(base)) {
    if (saved[k] === undefined) continue;
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = merge(base[k], saved[k]);
    else out[k] = saved[k];
  }
  return out;
}

export function loadSave() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { raw = null; }
  const look = merge(DEFAULT_LOOK, raw?.look);
  const settings = merge(DEFAULT_SETTINGS, raw?.settings);
  let presets = Array.isArray(raw?.presets) ? raw.presets.slice(0, 4) : [null, null, null, null];
  while (presets.length < 4) presets.push(null);
  if (!presets[0]) presets[0] = { name: 'Starter', look: clone(look) };
  // Merged through the same helper as look/settings so a save written before
  // progression existed fills in the defaults instead of crashing paintPlate.
  const stats = merge(DEFAULT_STATS, raw?.stats);
  return { look, settings, presets, stats };
}

export function writeSave(data) {
  localStorage.setItem(KEY, JSON.stringify({
    look: data.look,
    settings: data.settings,
    presets: data.presets,
    stats: data.stats || DEFAULT_STATS,
  }));
}

export function snapshotLook(look) {
  const copy = clone(look);
  return copy;
}
