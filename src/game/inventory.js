/**
 * Inventory: the player's carried loadout.
 *
 * Deliberately a plain-data module with no THREE, no DOM and no imports, so
 * test/ can drive every rule -- stacking, capacity, sorting, swapping, drop,
 * and the "can't use that right now" cases -- without a renderer.
 *
 * Shape: a fixed-length array of slots, each `null` or `{ id, count }`. Fixed
 * length is the whole point. An array that compacts itself has no identity, so
 * "the thing in slot 3" silently becomes "the thing in slot 2" the instant an
 * earlier slot empties, and the cursor jumps to the wrong item mid-fight.
 */

/** Consume order, used by the default sort: healing first, then survival. */
export const KIND_ORDER = {
  heal: 0,
  revive: 1,
  shield: 2,
  grenade: 3,
  ammo: 4,
  boost: 5,
};

export const RARITY_ORDER = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
};

export const DEFAULT_CAPACITY = 6;

export function createInventory(capacity = DEFAULT_CAPACITY) {
  return { slots: new Array(capacity).fill(null), capacity, selected: 0 };
}

export function resetInventory(inv) {
  inv.slots = new Array(inv.capacity).fill(null);
  inv.selected = 0;
  return inv;
}

export function clampSelected(inv) {
  if (inv.selected >= inv.capacity || inv.selected < 0) inv.selected = 0;
  // Never leave the cursor parked on a hole while the bag still holds something.
  if (inv.slots[inv.selected]) return;
  const first = inv.slots.findIndex(Boolean);
  inv.selected = first === -1 ? 0 : first;
}

export function occupied(inv) {
  return inv.slots.reduce((n, s) => n + (s ? 1 : 0), 0);
}

export function usedSlots(inv) {
  return inv.slots.filter(Boolean);
}

export function countOf(inv, id) {
  let n = 0;
  for (const s of inv.slots) if (s && s.id === id) n += s.count;
  return n;
}

/**
 * Add `count` of `id`, topping up any partial stack before opening a new one.
 *
 * Partial-before-empty is deliberate: topping up the stack you already carry
 * keeps it in its slot, so a player holding the cursor on it is not yanked to
 * a different slot by the act of picking up a second bandage.
 */
export function addItem(inv, id, count = 1, spec = null) {
  const max = spec?.stack ?? 99;
  let left = count;

  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    const s = inv.slots[i];
    if (!s || s.id !== id || s.count >= max) continue;
    const take = Math.min(max - s.count, left);
    s.count += take;
    left -= take;
  }
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    if (inv.slots[i]) continue;
    const take = Math.min(max, left);
    inv.slots[i] = { id, count: take };
    left -= take;
  }
  clampSelected(inv);
  return { ok: left === 0, added: count - left, overflow: left };
}

export function removeAt(inv, index, count = 1) {
  const s = inv.slots[index];
  if (!s) return null;
  const take = Math.min(s.count, count);
  const out = { id: s.id, count: take };
  s.count -= take;
  if (s.count <= 0) inv.slots[index] = null;
  clampSelected(inv);
  return out;
}

export function removeId(inv, id, count = 1) {
  let left = count;
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    const s = inv.slots[i];
    if (!s || s.id !== id) continue;
    left -= removeAt(inv, i, left).count;
  }
  return count - left;
}

export function swapSlots(inv, a, b) {
  if (a === b) return false;
  if (a < 0 || b < 0 || a >= inv.capacity || b >= inv.capacity) return false;
  const t = inv.slots[a];
  inv.slots[a] = inv.slots[b];
  inv.slots[b] = t;
  inv.selected = a;
  return true;
}

export function moveSlot(inv, from, to) {
  if (from < 0 || to < 0 || from >= inv.capacity || to >= inv.capacity) return false;
  const s = inv.slots[from];
  if (!s || inv.slots[to]) return false;
  inv.slots[to] = s;
  inv.slots[from] = null;
  inv.selected = to;
  return true;
}

/**
 * Default sort: kind, then rarity, then name.
 *
 * Total and deterministic -- every field is compared and the original index
 * breaks the final tie, so sorting the same bag twice gives byte-identical
 * output rather than depending on engine sort stability.
 *
 * Nulls are filtered out *before* the comparator runs, not handled inside it.
 * Decorating every slot and skipping nulls in the comparator reads fine, but
 * `a.slot.id` still evaluates on a null when the comparator is handed one --
 * and Array.sort is free to hand a null to the comparator against a non-null.
 * A bag with any hole in it threw on the first press of SORT.
 */
export function sortInventory(inv, specOf) {
  const present = [];
  inv.slots.forEach((slot, index) => {
    if (slot) present.push({ slot, index });
  });
  present.sort((a, b) => {
    const sa = specOf(a.slot.id);
    const sb = specOf(b.slot.id);
    const ka = KIND_ORDER[sa?.kind] ?? 99;
    const kb = KIND_ORDER[sb?.kind] ?? 99;
    if (ka !== kb) return ka - kb;
    const ra = RARITY_ORDER[sa?.rarity] ?? 99;
    const rb = RARITY_ORDER[sb?.rarity] ?? 99;
    if (ra !== rb) return ra - rb;
    const na = sa?.name || a.slot.id;
    const nb = sb?.name || b.slot.id;
    if (na !== nb) return na < nb ? -1 : 1;
    return a.index - b.index;
  });
  // Sorting keeps the bag dense: empties collect at the tail rather than
  // leaving holes for the player to click around.
  inv.slots = present.map((d) => d.slot).filter(Boolean);
  while (inv.slots.length < inv.capacity) inv.slots.push(null);
  clampSelected(inv);
  return inv;
}/**
 * Merge duplicate stacks. Sorting alone cannot do this: a sorted bag can still
 * hold three one-count bandages in three slots, which reads as nearly full
 * when the player is in fact carrying a hundred.
 *
 * Never loses count -- the overflow past a stack cap is pushed into the next
 * slot rather than truncated, which is the failure a naive "fold everything
 * into slot 0" implementation would ship.
 */
export function mergeStacks(inv, specOf) {
  const merged = [];
  for (const s of inv.slots) {
    if (!s) continue;
    const max = specOf(s.id)?.stack ?? 99;
    const hit = merged.find((m) => m.id === s.id && m.count < max);
    if (hit) {
      const take = Math.min(max - hit.count, s.count);
      hit.count += take;
      s.count -= take;
      if (s.count > 0) merged.push(s);
    } else {
      merged.push(s);
    }
  }
  inv.slots = merged.slice(0, inv.capacity);
  while (inv.slots.length < inv.capacity) inv.slots.push(null);
  clampSelected(inv);
  return inv;
}

/**
 * Step the cursor by `dir`, skipping empty slots so a D-pad press never parks
 * the selection on a hole. Wraps; returns the new index.
 */
export function stepSelection(inv, dir) {
  const n = inv.capacity;
  for (let step = 1; step <= n; step++) {
    const i = (((inv.selected + dir * step) % n) + n) % n;
    if (inv.slots[i]) {
      inv.selected = i;
      return i;
    }
  }
  return inv.selected;
}

/** Focus the first non-empty slot; used when the bag goes from empty to full. */
export function firstStackIndex(inv) {
  return inv.slots.findIndex(Boolean);
}

