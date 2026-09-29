
/**
 * HUD category icons.
 *
 * Inline SVG rather than files from the icon packs in public/assets/icons. Three
 * reasons, in order of how much they cost when wrong: the packs are folders of
 * loosely-named exports whose exact filenames are not something to depend on at
 * runtime; a missing icon on the HUD is a hole in the screen during a fight;
 * and these need to sit at 22px next to a magenta glow, which means owning the
 * colour rather than tinting a raster.
 *
 * Drawn on a 24x24 grid, `currentColor`, so a single CSS rule recolours the
 * whole set per rarity.
 */
const ICON = {
  heal: '<path d="M12 3.2c-1 0-1.7.7-1.7 1.6 0 .5.2.9.6 1.2l-4 3.8A2.6 2.6 0 0 0 6.2 11.5c0 .9.5 1.7 1.3 2.1l2.4 1.5-3.4 3.3a2.4 2.4 0 0 0 1.7 4.1 2.4 2.4 0 0 0 1.7-.7l2.1-2 2.1 2a2.4 2.4 0 0 0 1.7.7 2.4 2.4 0 0 0 1.7-4.1l-3.4-3.3 2.4-1.5c.8-.4 1.3-1.2 1.3-2.1a2.6 2.6 0 0 0-.7-1.7l-4-3.8c.4-.3.6-.7.6-1.2 0-.9-.7-1.6-1.7-1.6Z"/>',
  shield: '<path d="M12 2.6 4.4 5.4v6.1c0 4.6 3.1 8.4 7.6 9.9 4.5-1.5 7.6-5.3 7.6-9.9V5.4L12 2.6Z"/>',
  grenade: '<circle cx="12" cy="14.4" r="5.4"/><path d="M10.1 7.2h2.3v2.2h-2.3zM13.6 7.2h4.2v2.2h-4.2z"/><path d="M17.8 7.2a2.4 2.4 0 1 1 2.4 2.4"/>',
  revive: '<path d="M12 3.4 5.2 8.1v5.6c0 3.9 2.8 7 6.8 8.4 4-1.4 6.8-4.5 6.8-8.4V8.1L12 3.4Z" opacity=".45"/><path d="M11 7.2h2v4.4h3.6v2H11V7.2Z"/>',
  gun: '<path d="M2.4 8.4h12.2v2.3h-2.1l-1.4 2.6h-2.3l.9-2.6H8.2l-1 2.9H4.6l.7-2.9H2.4V8.4Z"/><path d="M14.6 9.9h7v1.6h-7z"/><path d="M16.4 12.6h1.5v4.1h-1.5z"/><path d="M8.9 14.2h2.1l-.7 5.2H8.2l.7-5.2Z"/>',
  ammo: '<path d="M12 2.4c1.9 2.3 3 4.9 3 7.6 0 3-1.3 5.2-3 5.2s-3-2.2-3-5.2c0-2.7 1.1-5.3 3-7.6Z"/><path d="M9 16.2h6v1.5H9zM9 18.6h6v1.5H9z"/>',
  melee: '<path d="M18.6 3.2 9.9 11.9l2.2 2.2 8.7-8.7-2.2-2.2Z"/><path d="m8.5 13.3 2.2 2.2-3.1 3.1a1.6 1.6 0 0 1-2.2-2.2l3.1-3.1Z"/><path d="m5.3 16.5 2.2 2.2-1.5 1.5a1.1 1.1 0 0 1-1.6-1.6l.9-.9Z"/>',
  boost: '<path d="M13.6 2.4 5.8 13.2h4.4l-1 8.4 8-11.2h-4.6l1-8Z"/>',
  crystal: '<path d="m12 2.6 6.4 6.1L12 21.4 5.6 8.7 12 2.6Z"/><path d="M5.6 8.7h12.8L12 21.4 5.6 8.7Z" opacity=".38"/>',
};

/** The icon for an item kind, falling back to a shield for anything unknown. */
export function iconFor(kind) {
  const body = ICON[kind] || ICON.shield;
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round">${body}</svg>`;
}

/**
 * Per-thing icons, keyed by id, falling back to the category set above.
 *
 * Fortnite's inventory is legible because every item has its own silhouette, not
 * because it has a category. Two shields you might want in a fight -- a 30-point
 * glitter mist and a 100-point divine shell -- cannot both be "a shield" at the
 * moment you are deciding whether to burn a slot, so each gets a distinct shape
 * and the category is what the *fallback* is for.
 *
 * Built from the same primitives as the category icons, so the set still reads
 * as one family at 22px.
 */
const ITEM_ART = {
  // --- guns: silhouette does the work, since that is what you recognise ---
  ar: '<path d="M2.6 9.2h11.4v2.1h-2.4l-1.3 2.4h-2.2l.8-2.4H8.1l-1.1 2.7H4.6l.8-2.7H2.6V9.2Z"/><path d="M14 10.3h7.2v1.5H14z"/><path d="M9 14h2l-.7 5H8.3L9 14Z"/>',
  smg: '<path d="M3.4 10h8.9v1.9H3.4z"/><path d="M12.3 10.4h8.5v1.3h-8.5z"/><path d="M6.4 12h1.8v4.4H6.4z"/><path d="M15.2 11.8h2.4v2.1h-2.4z"/>',
  shot: '<path d="M2.2 10.6h6.2v1.5H2.2z"/><path d="M8.4 9.6h12.8v1.5H8.4z"/><path d="M6.6 12.1h1.7l-.6 3.4H6z"/><path d="M13.4 12.1h1.7l-.6 3.4h-1.1z"/><path d="M9.4 12.2h1.5l-.5 3.1H8.9z"/>',
  snip: '<path d="M2 10.2h19v1.4H2z"/><path d="M6.6 11.6h2.2v4.1H6.6z"/><path d="M8.6 5.4h1.4v4.8H8.6z"/><path d="M19.4 11.4l2.4 2.6-2.4 1.2z"/><path d="M2 12.4h4.2v1.3H2z" opacity=".55"/>',
  pistol: '<path d="M4.4 8.6h10.2v2.4H4.4z"/><path d="M14.6 9.2h5.8v1.6h-5.8z"/><path d="M6.6 11h2.3l-.7 5.4H5.9z"/><path d="M15.8 10.9h1.6v2.6h-1.6z"/>',

  // --- heals: each is a different vessel, not the same cross ---
  bandage: '<g transform="rotate(-38 12 12)"><rect x="3.4" y="9.1" width="17.2" height="5.8" rx="1.4"/><rect x="8.4" y="9.1" width="2" height="5.8" fill="#000" opacity=".35"/><rect x="13.6" y="9.1" width="2" height="5.8" fill="#000" opacity=".35"/></g>',
  elixir: '<path d="M9.4 2.6h5.2v2.9l2.1 3.1c.6.9.9 1.9.9 2.9v7.1c0 1.6-1.3 2.9-2.9 2.9H9.3c-1.6 0-2.9-1.3-2.9-2.9v-7.1c0-1 .3-2 .9-2.9l2.1-3.1V2.6Z"/><path d="M6.9 13.4h10.2v1.5H6.9z" fill="#000" opacity=".3"/><path d="M6.9 17.4h10.2v1.5H6.9z" fill="#000" opacity=".3"/>',
  potion: '<path d="M10 2.4h4v3.3l3 4.4c.6.9 1 2 1 3.1v5.3c0 1.9-1.6 3.5-3.5 3.5h-5c-1.9 0-3.5-1.6-3.5-3.5v-5.3c0-1.1.4-2.2 1-3.1l3-4.4V2.4Z"/><path d="M6.4 14.6h11.2v1.6H6.4z" fill="#000" opacity=".28"/>',

  // --- shields: mist, faceted, then the full divine shell ---
  veil: '<path d="M12 2.8c2.6 2.7 5.6 5 5.6 8.6 0 1.3-.3 2.5-.9 3.5H7.3c-.6-1-1-2.2-1-3.5 0-3.6 3-5.9 5.7-8.6Z"/><path d="M6.6 16.6h10.8l1.6 2.6H5l1.6-2.6Z" opacity=".55"/>',
  barrier: '<path d="m12 2.6 7.6 3.4v5.6c0 3.3-1.9 6.3-4.7 7.5l-2.9-3.9 2.6-2.2c1-1 1.5-2.4 1.5-3.8V8.5L12 7.2 8.9 8.5v1.7c0 1.4.5 2.8 1.5 3.8l2.6 2.2-2.9 3.9A9.4 9.4 0 0 1 4.4 11.6V6L12 2.6Z"/><path d="m12 12.4 1.8 1.6-1.8 1.6-1.8-1.6z" opacity=".6"/>',
  aegis: '<path d="M12 1.9 3.6 5.1v6.6c0 5 3.4 9.2 8.4 10.8 5-1.6 8.4-5.8 8.4-10.8V5.1L12 1.9Z"/><path d="M12 6.1l1.5 3.2 3.5.5-2.5 2.4.6 3.5-3.1-1.7-3.1 1.7.6-3.5L7 9.8l3.5-.5z" fill="#000" opacity=".42"/>',

  // --- throwables and specials ---
  star: '<path d="m12 1.8 2.8 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17l-6 3.2 1.4-6.8L2.3 8.8l6.9-.7z"/><circle cx="12" cy="12.4" r="1.5" fill="#000" opacity=".35"/>',
  second: '<path d="M12 2.4 4.6 7v6.1c0 4.4 3.1 8 7.4 9.4 4.3-1.4 7.4-5 7.4-9.4V7L12 2.4Z" opacity=".4"/><path d="M11 6.4h2v5.1h4.2v2H11V6.4Z"/><path d="M9.4 17.4h5.2v1.5H9.4z" opacity=".5"/>',

  // --- melee ---
  katana: '<path d="M19.4 2.4 8.6 12.5l2.2 2.2L21 4.6l-1.6-2.2Z"/><path d="m7.2 13.9 2.2 2.2-2.6 2.6a1.5 1.5 0 0 1-2.2-2.2l2.6-2.6Z"/><path d="m4.4 16.7 2.2 2.2-1.2 1.2a1 1 0 0 1-1.4-1.4l.4-.4Z"/>',
};

/**
 * The icon for a specific thing: its own art if it has any, otherwise the
 * category it belongs to. `kind` is the fallback key, so an item added to
 * weapons.js tomorrow renders correctly on day one, before anyone has drawn it.
 */
export function iconForThing(id, kind) {
  const body = ITEM_ART[id] || ICON[kind] || ICON.shield;
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round">${body}</svg>`;
}
