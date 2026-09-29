/**
 * Inventory rules test.
 *
 * The inventory is the one system a player touches constantly and the one with
 * the most off-by-one-shaped failure modes, so this drives the rules directly
 * rather than through the renderer: stacking order, capacity, slot identity
 * across an emptying, sorting determinism, merging, swap/move, and the
 * selection cursor's habit of landing on holes.
 */
import {
  createInventory, resetInventory, addItem, removeAt, removeId, swapSlots,
  moveSlot, sortInventory, mergeStacks, stepSelection, occupied, countOf,
  DEFAULT_CAPACITY,
} from '../src/game/inventory.js';
import { ITEMS } from '../src/game/weapons.js';

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}
const specOf = (id) => ITEMS[id] || null;

/* ---- shape ------------------------------------------------------------- */
{
  const inv = createInventory();
  check(inv.slots.length === DEFAULT_CAPACITY, `capacity is ${inv.slots.length}, want ${DEFAULT_CAPACITY}`);
  check(inv.slots.every((s) => s === null), 'a new bag is not empty');
  check(occupied(inv) === 0, 'a new bag reports occupied slots');
}

/* ---- stacking: partial before empty ------------------------------------ */
{
  const inv = createInventory();
  addItem(inv, 'bandage', 1, ITEMS.bandage);
  addItem(inv, 'bandage', 2, ITEMS.bandage);
  check(occupied(inv) === 1, `two pickups of a stackable item used ${occupied(inv)} slots, want 1`);
  check(countOf(inv, 'bandage') === 3, `stacked count is ${countOf(inv, 'bandage')}, want 3`);
}

/* ---- stacking respects the cap ----------------------------------------- */
{
  const inv = createInventory();
  // bandage stack is 6, so 8 has to split across two slots.
  const r = addItem(inv, 'bandage', 8, ITEMS.bandage);
  check(r.added === 8 && r.ok, `add of 8 reported ${JSON.stringify(r)}`);
  check(occupied(inv) === 2, `8 bandages at stack 6 used ${occupied(inv)} slots, want 2`);
  check(inv.slots[0].count === 6 && inv.slots[1].count === 2,
    `split is [${inv.slots[0]?.count}, ${inv.slots[1]?.count}], want [6, 2]`);
}

/* ---- overflow is reported, not silently dropped ------------------------ */
{
  const inv = createInventory(2);
  const r = addItem(inv, 'aegis', 3, { ...ITEMS.aegis, stack: 1 });
  check(!r.ok, 'overfilling a bag reported success');
  check(r.overflow > 0, 'overfill did not report an overflow count');
  check(occupied(inv) === 2, `a 2-slot bag held ${occupied(inv)} items`);
}

/* ---- an existing stack keeps its slot ---------------------------------- */
{
  // The reason partials are topped up before empties are used: picking up a
  // second bandage must not move the first one out from under the cursor.
  const inv = createInventory();
  addItem(inv, 'bandage', 1, ITEMS.bandage);
  addItem(inv, 'elixir', 1, ITEMS.elixir);
  const before = inv.slots[0];
  addItem(inv, 'bandage', 1, ITEMS.bandage);
  check(inv.slots[0] === before, 'topping up a stack reallocated it to a different slot');
  check(inv.slots[0].id === 'bandage' && inv.slots[0].count === 2, 'top-up did not land in slot 0');
}

/* ---- slot identity survives an earlier slot emptying -------------------- */
{
  const inv = createInventory();
  addItem(inv, 'bandage', 1, ITEMS.bandage);
  addItem(inv, 'elixir', 1, ITEMS.elixir);
  const elixirSlot = inv.slots[1];
  removeAt(inv, 0, 1);
  check(inv.slots[0] === null, 'emptied slot was not nulled');
  check(inv.slots[1] === elixirSlot, 'emptying slot 0 shifted slot 1');
  check(inv.slots[1].id === 'elixir', 'the survivor is no longer the elixir');
}

/* ---- removeAt / removeId ----------------------------------------------- */
{
  const inv = createInventory();
  addItem(inv, 'bandage', 4, ITEMS.bandage);
  const out = removeAt(inv, 0, 2);
  check(out && out.count === 2, `removeAt took ${out?.count}, want 2`);
  check(inv.slots[0].count === 2, `remaining is ${inv.slots[0].count}, want 2`);
  const took = removeId(inv, 'bandage', 9);
  check(took === 2, `removeId of 9 from a 2-stack took ${took}, want 2`);
  check(occupied(inv) === 0, 'the bag is not empty after draining it');
  check(removeAt(inv, 3, 1) === null, 'removing from an empty slot returned something');
}

/* ---- swap and move ------------------------------------------------------ */
{
  const inv = createInventory();
  addItem(inv, 'bandage', 1, ITEMS.bandage);
  addItem(inv, 'elixir', 1, ITEMS.elixir);
  swapSlots(inv, 0, 1);
  check(inv.slots[0].id === 'elixir' && inv.slots[1].id === 'bandage', 'swap did not exchange the two');
  swapSlots(inv, 0, 99);
  check(inv.slots[0].id !== 'bandage', 'an out-of-range swap corrupted the bag');
  // State after the above: elixir@0, bandage@1, rest empty.
  moveSlot(inv, 0, 2);
  check(inv.slots[2].id === 'elixir' && inv.slots[0] === null, 'move did not relocate the stack');
  // Now: bandage@1, elixir@2, slot 0 empty. Moving 1 -> 0 is legal (it is
  // empty); moving 1 -> 2 is not (elixir is there), and move must refuse
  // rather than silently overwrite the destination.
  check(moveSlot(inv, 1, 2) === false, 'move into an occupied slot was allowed');
  check(inv.slots[1].id === 'bandage' && inv.slots[2].id === 'elixir',
    'a refused move still disturbed the bag');
  check(moveSlot(inv, 1, 0) === true, 'move into an empty slot was refused');
}
/* ---- sort --------------------------------------------------------------- */
{
  const inv = createInventory();
  // Added worst-first: mythic shield, then common heal, then rare heal.
  addItem(inv, 'aegis', 1, ITEMS.aegis);
  addItem(inv, 'bandage', 1, ITEMS.bandage);
  addItem(inv, 'elixir', 1, ITEMS.elixir);
  sortInventory(inv, specOf);
  check(inv.slots[0].id === 'bandage', `sort put ${inv.slots[0].id} first; heals should lead`);
  check(inv.slots[1].id === 'elixir', `rarity order wrong: ${inv.slots[0].id}, ${inv.slots[1].id}`);
  check(inv.slots[2].id === 'aegis', 'shield sorted before heal');
  check(inv.slots.length === DEFAULT_CAPACITY, 'sort changed the bag size');
  check(inv.slots.slice(3).every((s) => s === null), 'sort left holes instead of padding');
}
{
  // Determinism: the same bag, sorted twice, must come out identical.
  const build = () => {
    const inv = createInventory();
    addItem(inv, 'aegis', 1, ITEMS.aegis);
    addItem(inv, 'bandage', 1, ITEMS.bandage);
    addItem(inv, 'veil', 1, ITEMS.veil);
    addItem(inv, 'elixir', 1, ITEMS.elixir);
    addItem(inv, 'star', 1, ITEMS.star);
    return inv;
  };
  const a = build();
  const b = build();
  sortInventory(a, specOf);
  sortInventory(b, specOf);
  sortInventory(a, specOf);
  check(JSON.stringify(a.slots) === JSON.stringify(b.slots), 'sort is not deterministic across two bags');
  check(JSON.stringify(a.slots) === JSON.stringify(b.slots), 'sorting an already-sorted bag changed it');
}

/* ---- merge -------------------------------------------------------------- */
{
  const inv = createInventory();
  addItem(inv, 'bandage', 6, ITEMS.bandage);
  addItem(inv, 'bandage', 6, ITEMS.bandage);
  check(occupied(inv) === 2, 'two full stacks did not occupy two slots');
  mergeStacks(inv, specOf);
  check(occupied(inv) === 2, `12 bandages at stack 6 merged into ${occupied(inv)} slots, want 2`);
  check(countOf(inv, 'bandage') === 12, `merge lost count: ${countOf(inv, 'bandage')}, want 12`);
  check(inv.slots[0].count === 6 && inv.slots[1].count === 6, 'merge did not respect the stack cap');
}
{
  // Merging must not destroy items, which is the failure a naive
  // "combine everything into slot 0" implementation would ship.
  const inv = createInventory();
  addItem(inv, 'bandage', 3, ITEMS.bandage);
  addItem(inv, 'elixir', 2, ITEMS.elixir);
  addItem(inv, 'aegis', 1, ITEMS.aegis);
  mergeStacks(inv, specOf);
  check(countOf(inv, 'bandage') === 3, 'merge lost bandages');
  check(countOf(inv, 'elixir') === 2, 'merge lost elixirs');
  check(countOf(inv, 'aegis') === 1, 'merge lost the aegis');
}

/* ---- selection never parks on a hole ----------------------------------- */
{
  const inv = createInventory();
  check(stepSelection(inv, 1) === 0, 'stepping an empty bag moved the cursor');
  addItem(inv, 'bandage', 1, ITEMS.bandage);
  addItem(inv, 'elixir', 1, ITEMS.elixir);
  inv.selected = 0;
  check(stepSelection(inv, 1) === 1, 'step skipped over an empty slot to a hole');
  check(stepSelection(inv, 1) === 0, 'step did not wrap back to the start');
  check(stepSelection(inv, -1) === 1, 'backwards step did not wrap');
}
{
  // The cursor must recover when the slot it is on empties out from under it.
  const inv = createInventory();
  addItem(inv, 'bandage', 1, ITEMS.bandage);
  addItem(inv, 'elixir', 1, ITEMS.elixir);
  inv.selected = 0;
  removeAt(inv, 0, 1);
  check(inv.slots[inv.selected] != null, 'the cursor was left on an empty slot');
  check(inv.selected === 1, `cursor landed on ${inv.selected}, want the surviving slot 1`);
}
{
  const inv = createInventory();
  addItem(inv, 'bandage', 1, ITEMS.bandage);
  removeAt(inv, 0, 1);
  check(inv.selected === 0, 'an emptied bag left the cursor out of range');
}

/* ---- reset -------------------------------------------------------------- */
{
  const inv = createInventory();
  addItem(inv, 'bandage', 1, ITEMS.bandage);
  addItem(inv, 'elixir', 1, ITEMS.elixir);
  resetInventory(inv);
  check(occupied(inv) === 0, 'reset left items behind');
  check(inv.selected === 0, 'reset left the cursor moved');
  check(inv.slots.length === DEFAULT_CAPACITY, 'reset changed the bag size');
}

if (failures.length) {
  for (const f of failures.slice(0, 40)) console.error(`inventory: ${f}`);
  console.error(`${failures.length} inventory problem(s)`);
  process.exit(1);
}
console.log('inventory ok');

