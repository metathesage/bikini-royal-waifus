/**
 * Royal candidates.
 *
 * The locker dresses a waifu out of parts; a candidate is a *sheet* — a named
 * royal-court entry whose parts are already chosen, whose signature melee is
 * fixed, and who carries one ability nobody else has (`ROYAL DECREE: UNDERTOW`
 * is Candidate A's). Equipping a candidate writes a complete look, so every
 * downstream reader — the studio, the match, the bots' copy of `look()` —
 * keeps working off the one object it always did.
 *
 * The palette is not decoration either: the ability FX is tinted from it, so a
 * candidate's colours and her magic can never drift apart. `paletteRoles` is
 * the join between the two — it names the chip that feeds each painted slot, so
 * a sheet with five palettes can still be checked slot by slot.
 */
import { DEFAULT_LOOK } from './catalog.js';

/**
 * What each decree shape actually spends.
 *
 * A number on a sheet that the cast never reads is a lie the card tells, so
 * every kind declares the fields it consumes and both the match and the test
 * read this table rather than a hardcoded list. `undertow` drags victims
 * inward, `gale` blows them outward, `burst` trades the drag for a heal,
 * `chain` arcs between bodies, `meteor` lands a beat late, and `drain` pays
 * back what it takes.
 */
export const ABILITY_KINDS = {
  undertow: { fields: ['cooldown', 'radius', 'damage', 'pull', 'duration', 'shield'] },
  gale: { fields: ['cooldown', 'radius', 'damage', 'pull', 'duration', 'shield'] },
  burst: { fields: ['cooldown', 'radius', 'damage', 'duration', 'shield', 'heal'] },
  chain: { fields: ['cooldown', 'radius', 'damage', 'duration', 'shield', 'targets'] },
  meteor: { fields: ['cooldown', 'radius', 'damage', 'pull', 'duration', 'shield', 'fuse'] },
  drain: { fields: ['cooldown', 'radius', 'damage', 'duration', 'shield', 'leech'] },
};

/**
 * Weakness rules the match knows how to enforce.
 *
 * Each id is a condition, not flavour: the HUD refuses the cast and says why.
 * `em-storm` and `doused` need the island (a closing ring, open water), so they
 * are exercised in smoke.mjs; the rest are player state and are driven on the
 * graybox range.
 */
export const WEAKNESS_IDS = ['em-storm', 'doused', 'unshielded', 'airborne', 'surrounded', 'exhausted'];

export const CANDIDATES = [
  {
    id: 'thalassa',
    candidate: 'A',
    codename: 'THALASSA',
    name: 'Thalassa',
    title: 'Deep-Sea Royal Guard',
    rarity: 'mythic',
    clearance: 'S',
    /** The four chips on the card, in the order the sheet lists them. */
    palette: [
      { id: 'pearl', name: 'Pearl White', hex: '#f2ece4' },
      { id: 'navy', name: 'Deep Navy', hex: '#101c34' },
      { id: 'gold', name: 'Champagne Gold', hex: '#d8b063' },
      { id: 'aqua', name: 'Aquamarine', hex: '#4fe3d0' },
    ],
    /** Which chip paints which slot, so a look can be checked against the sheet. */
    paletteRoles: { hair: 'pearl', eye: 'aqua', cloth: 'navy', trim: 'gold' },
    background: 'Deep-Sea Royal Guard',
    hair: 'Platinum pearl-white, seafoam-aquamarine tips, long asymmetric high ponytail, braided crown, wave-crest hairpin.',
    outfit: 'Navy-and-pearl high-cut tactical one-piece, hard-light rib and hip plating, aqua-gel panels, asymmetric gold pauldron, iridescent half-skirt.',
    weapon: {
      melee: 'spear',
      name: 'Tide-Regalia Spear',
      blurb: 'Transformable regalia spear; its head splits off as a hydro sidearm.',
    },
    combat: 'Water blades coil her forearms.',
    ability: {
      id: 'undertow',
      kind: 'undertow',
      tint: 'aqua',
      name: 'ROYAL DECREE: UNDERTOW',
      cooldown: 24,
      radius: 9,
      damage: 34,
      pull: 5.5,
      duration: 1.6,
      shield: 35,
      blurb: 'A giant luminous tidal sigil opens behind her; everything inside the crest is dragged in and cut by the coiling blades.',
    },
    weakness: {
      id: 'em-storm',
      name: 'Electromagnetic storms',
      blurb: 'No sigil holds its shape inside an active storm wall, so the decree is suppressed out there.',
    },
    look: {
      name: 'Thalassa',
      title: 'Deep-Sea Royal Guard',
      candidate: 'thalassa',
      model: 'sofia_anime',
      body: 'athletic',
      face: 'sharp',
      skin: '#ffd8cc',
      makeup: 'crystal',
      hair: 'pony',
      hairColor: '#f2ece4',
      eye: '#4fe3d0',
      top: 'band',
      bottom: 'micro',
      cloth: '#101c34',
      pattern: 'lattice',
      trim: '#d8b063',
      wet: true,
      sheer: false,
      glow: true,
      accessories: ['armlets', 'thigh', 'earrings', 'anklets'],
      wrap: 'void',
      charm: 'moon',
      melee: 'spear',
      emote: 'spin',
      victory: 'curtsey',
      loading: 'beam',
      banner: 'ocean',
    },
  },
  {
    id: 'solara',
    candidate: 'B',
    codename: 'SOLARA',
    name: 'Solara',
    title: 'Gilded Court Regent',
    rarity: 'mythic',
    clearance: 'S',
    palette: [
      { id: 'amber', name: 'Solar Amber', hex: '#ffb347' },
      { id: 'ember', name: 'Ember Red', hex: '#ff5a2b' },
      { id: 'obsidian', name: 'Court Black', hex: '#1c1622' },
      { id: 'ivory', name: 'Court Ivory', hex: '#fff2dc' },
    ],
    paletteRoles: { hair: 'amber', eye: 'ember', cloth: 'obsidian', trim: 'ivory' },
    background: 'The Gilded Court',
    hair: 'Molten amber lengths braided into a sun crown, a gold circlet with a single amber drop at her brow, one long sidelock.',
    outfit: 'Obsidian-and-ivory bikini harness, gilded rib plating, sheer ember skirt panels, one sun-metal pauldron, gold hip chains.',
    weapon: {
      melee: 'sunlance',
      name: 'Sunspine Lance',
      blurb: 'A gilded lance whose head keeps burning after the swing has passed.',
    },
    combat: 'Her lance head sheds a spray of light on every cut.',
    ability: {
      id: 'solar-toll',
      kind: 'burst',
      tint: 'amber',
      name: 'ROYAL DECREE: SOLAR TOLL',
      cooldown: 28,
      radius: 12,
      damage: 42,
      duration: 1.8,
      shield: 30,
      heal: 22,
      blurb: 'A ring of white fire opens under her, burns everything standing in it, and knits her own wounds shut behind it.',
    },
    weakness: {
      id: 'doused',
      name: 'Open water',
      blurb: 'Sun-court regalia will not light underwater, so the toll is suppressed while she swims.',
    },
    look: {
      name: 'Solara',
      title: 'Gilded Court Regent',
      candidate: 'solara',
      model: 'ual1_standard',
      body: 'statuesque',
      face: 'sharp',
      skin: '#f3c1a8',
      makeup: 'wing',
      hair: 'hime',
      hairColor: '#ffb347',
      eye: '#ff5a2b',
      top: 'strappy',
      bottom: 'skirt',
      cloth: '#1c1622',
      pattern: 'scales',
      trim: '#fff2dc',
      wet: false,
      sheer: true,
      glow: true,
      accessories: ['horns', 'armlets', 'thigh', 'anklets'],
      wrap: 'gold',
      charm: 'star',
      melee: 'sunlance',
      emote: 'cheer',
      victory: 'queen',
      loading: 'adjust',
      banner: 'sunset',
    },
  },
  {
    id: 'vesper',
    candidate: 'C',
    codename: 'VESPER',
    name: 'Vesper',
    title: 'Storm Court Signalman',
    rarity: 'epic',
    clearance: 'A',
    palette: [
      { id: 'violet', name: 'Storm Violet', hex: '#a06bff' },
      { id: 'bolt', name: 'White Bolt', hex: '#f2f7ff' },
      { id: 'slate', name: 'Iron Slate', hex: '#2a2f3d' },
      { id: 'silver', name: 'Court Silver', hex: '#dfe6f2' },
    ],
    paletteRoles: { hair: 'silver', eye: 'violet', cloth: 'slate', trim: 'bolt' },
    background: 'The Storm Court',
    hair: 'Silver-white wolf cut, a violet braid crown, storm-glass pins along one temple, choppy ends that never settle.',
    outfit: 'Slate-and-silver strappy bikini, hard-light rib plating, sheer violet overskirt, an arclight wrap over one shoulder.',
    weapon: {
      melee: 'flail',
      name: 'Arclight Flail',
      blurb: 'A chained court flail. Slow to wind up, ruinous at full spin.',
    },
    combat: 'Violet arcs run down the chain as it swings.',
    ability: {
      id: 'arc-cascade',
      kind: 'chain',
      tint: 'violet',
      name: 'ROYAL DECREE: ARC CASCADE',
      cooldown: 22,
      radius: 11,
      damage: 34,
      duration: 1.4,
      shield: 18,
      targets: 4,
      blurb: 'A bolt leaps from her hand to the nearest body and then to the next, losing bite with every jump.',
    },
    weakness: {
      id: 'unshielded',
      name: 'A bare ward',
      blurb: 'With nothing on her shield the cascade has nothing to ground itself in, so it refuses to fire.',
    },
    look: {
      name: 'Vesper',
      title: 'Storm Court Signalman',
      candidate: 'vesper',
      model: 'miyazawa_fighter',
      body: 'athletic',
      face: 'round',
      skin: '#ffd8cc',
      makeup: 'crystal',
      hair: 'wolf',
      hairColor: '#dfe6f2',
      eye: '#a06bff',
      top: 'strappy',
      bottom: 'shorts',
      cloth: '#2a2f3d',
      pattern: 'stripes',
      trim: '#f2f7ff',
      wet: false,
      sheer: false,
      glow: true,
      accessories: ['horns', 'earrings', 'ribbons', 'anklets'],
      wrap: 'neon',
      charm: 'cat',
      melee: 'flail',
      emote: 'spin',
      victory: 'sparkle',
      loading: 'idle',
      banner: 'neon',
    },
  },
  {
    id: 'rime',
    candidate: 'D',
    codename: 'RIME',
    name: 'Rime',
    title: 'Glacier Court Ward',
    rarity: 'legendary',
    clearance: 'S',
    palette: [
      { id: 'frost', name: 'Frost White', hex: '#eaf7ff' },
      { id: 'ice', name: 'Glacier Blue', hex: '#9fe8ff' },
      { id: 'deep', name: 'Deep Ice', hex: '#16304a' },
      { id: 'silver', name: 'Rime Silver', hex: '#c3d4e6' },
    ],
    paletteRoles: { hair: 'frost', eye: 'ice', cloth: 'deep', trim: 'silver' },
    background: 'The Glacier Court',
    hair: 'Frost-white lengths fading to glacier blue at the ends, a shard crown, one ice-blue sidelock pinned over her ear.',
    outfit: 'Deep-blue and frost bikini armor, faceted hip guard, sheer snowflake overskirt, a silver throat chain and shoulder shards.',
    weapon: {
      melee: 'trident',
      name: 'Rimeglass Trident',
      blurb: 'Three prongs of pressed ice. The third thrust lands hardest.',
    },
    combat: 'Rime creeps up the tines and drips off the points.',
    ability: {
      id: 'rimefall',
      kind: 'meteor',
      tint: 'ice',
      name: 'ROYAL DECREE: RIMEFALL',
      cooldown: 30,
      radius: 8,
      damage: 52,
      pull: 4,
      duration: 1.2,
      shield: 22,
      fuse: 1.6,
      blurb: 'She marks the ground and a shard of the glacier drops onto the mark a beat later, dragging the splash back into the impact.',
    },
    weakness: {
      id: 'airborne',
      name: 'Both feet off the ground',
      blurb: 'The rime needs a planted stance to fall from, so the decree is suppressed while she is airborne.',
    },
    look: {
      name: 'Rime',
      title: 'Glacier Court Ward',
      candidate: 'rime',
      model: 'dragon',
      body: 'darling',
      face: 'doll',
      skin: '#ffe8dc',
      makeup: 'freckle',
      hair: 'long',
      hairColor: '#eaf7ff',
      eye: '#9fe8ff',
      top: 'crystal',
      bottom: 'crystal',
      cloth: '#16304a',
      pattern: 'lattice',
      trim: '#c3d4e6',
      wet: false,
      sheer: false,
      glow: true,
      accessories: ['halo', 'armlets', 'thigh', 'earrings'],
      wrap: 'holo',
      charm: 'crystal',
      melee: 'trident',
      emote: 'stretch',
      victory: 'heart',
      loading: 'stretch',
      banner: 'mythic',
    },
  },
  {
    id: 'amaranth',
    candidate: 'E',
    codename: 'AMARANTH',
    name: 'Amaranth',
    title: 'Vine Court Duelist',
    rarity: 'epic',
    clearance: 'A',
    palette: [
      { id: 'rose', name: 'Rose Quartz', hex: '#ff5ea8' },
      { id: 'jade', name: 'Vine Jade', hex: '#3dffa6' },
      { id: 'moss', name: 'Deep Moss', hex: '#1b3324' },
      { id: 'champagne', name: 'Court Champagne', hex: '#f6e3b8' },
    ],
    paletteRoles: { hair: 'rose', eye: 'jade', cloth: 'moss', trim: 'champagne' },
    background: 'The Vine Court',
    hair: 'Long rose-pink waves with jade-dyed ends, a blossom crown over a living vine circlet, petals caught in it.',
    outfit: 'Moss-and-rose strappy bikini, leaf-lattice hip guard, sheer petal overskirt, champagne anklets and a thorn cuff.',
    weapon: {
      melee: 'warfan',
      name: 'Court War-Fan',
      blurb: 'A folding fan of hardened petals. Four cuts, then a shove.',
    },
    combat: 'Petals spin off the fan and cut on the way home.',
    ability: {
      id: 'thornbreath',
      kind: 'gale',
      tint: 'rose',
      name: 'ROYAL DECREE: THORNBREATH',
      cooldown: 20,
      radius: 10,
      damage: 26,
      pull: 7,
      duration: 1,
      shield: 34,
      blurb: 'A wave of thorned air blows outward from her and shoves the whole crowd off her.',
    },
    weakness: {
      id: 'surrounded',
      name: 'A crowded ring',
      blurb: 'Three enemies inside eight metres and the petals have nowhere to go, so the breath will not blow.',
    },
    look: {
      name: 'Amaranth',
      title: 'Vine Court Duelist',
      candidate: 'amaranth',
      model: 'fox',
      body: 'soft',
      face: 'heart',
      skin: '#ffd0c2',
      makeup: 'blush',
      hair: 'twintail',
      hairColor: '#ff5ea8',
      eye: '#3dffa6',
      top: 'heart',
      bottom: 'skirt',
      cloth: '#1b3324',
      pattern: 'hearts',
      trim: '#f6e3b8',
      wet: true,
      sheer: false,
      glow: false,
      accessories: ['flower', 'ribbons', 'thigh', 'anklets'],
      wrap: 'sakura',
      charm: 'bow',
      melee: 'warfan',
      emote: 'blowkiss',
      victory: 'heart',
      loading: 'beam',
      banner: 'petal',
    },
  },
  {
    id: 'umbra',
    candidate: 'F',
    codename: 'UMBRA',
    name: 'Umbra',
    title: 'Hollow Court Sovereign',
    rarity: 'mythic',
    clearance: 'S',
    palette: [
      { id: 'void', name: 'Void Black', hex: '#14141f' },
      { id: 'amethyst', name: 'Amethyst', hex: '#b388ff' },
      { id: 'bone', name: 'Court Bone', hex: '#e8e2f2' },
      { id: 'ash', name: 'Silver Ash', hex: '#6f6a86' },
    ],
    paletteRoles: { hair: 'bone', eye: 'amethyst', cloth: 'void', trim: 'ash' },
    background: 'The Hollow Court',
    hair: 'Bone-white lengths with an amethyst inner sheet, a broken circlet, one black ribbon at her throat.',
    outfit: 'Void-black bikini harness, amethyst hip crystals, sheer ash gauze, a torn regalia mantle over one shoulder.',
    weapon: {
      melee: 'voidglaive',
      name: 'Hollowcurve Glaive',
      blurb: 'A long curved blade that drinks the light around it.',
    },
    combat: 'Amethyst light bleeds off the edge and hangs in the air after the cut.',
    ability: {
      id: 'hunger',
      kind: 'drain',
      tint: 'amethyst',
      name: 'ROYAL DECREE: HUNGER',
      cooldown: 26,
      radius: 9,
      damage: 36,
      duration: 1.6,
      shield: 26,
      leech: 0.5,
      blurb: 'Every wound the decree opens pays her back as shield, so she fights the longer she is hurt.',
    },
    weakness: {
      id: 'exhausted',
      name: 'Spent',
      blurb: 'Below half health the void has nothing left to take, so the hunger will not open.',
    },
    look: {
      name: 'Umbra',
      title: 'Hollow Court Sovereign',
      candidate: 'umbra',
      model: 'bald_eagle',
      body: 'voluptuous',
      face: 'doll',
      skin: '#e0a484',
      makeup: 'none',
      hair: 'side',
      hairColor: '#e8e2f2',
      eye: '#b388ff',
      top: 'sling',
      bottom: 'micro',
      cloth: '#14141f',
      pattern: 'solid',
      trim: '#6f6a86',
      wet: false,
      sheer: true,
      glow: true,
      accessories: ['horns', 'wings', 'jewelry', 'earrings'],
      wrap: 'void',
      charm: 'heart',
      melee: 'voidglaive',
      emote: 'shy',
      victory: 'curtsey',
      loading: 'adjust',
      banner: 'midnight',
    },
  },
];

export function candidateById(id) {
  if (!id) return null;
  return CANDIDATES.find((c) => c.id === id) || null;
}

/** The chip colour a candidate is painted with, e.g. `paletteColor(c, 'aqua')`. */
export function paletteColor(candidate, id, fallback = '#ffffff') {
  if (!candidate) return fallback;
  const chip = (candidate.palette || []).find((p) => p.id === id);
  return chip ? chip.hex : fallback;
}

/**
 * The colour one painted slot takes, read through the sheet's own role map.
 * A candidate with five palettes on the roster still resolves `hair` the same
 * way, and a look whose colour is not in her sheet cannot be painted at all.
 */
export function roleColor(candidate, role, fallback = '#ffffff') {
  if (!candidate || !candidate.paletteRoles) return fallback;
  return paletteColor(candidate, candidate.paletteRoles[role], fallback);
}

/** The colour a candidate's decree is tinted with, straight off her sheet. */
export function abilityTint(candidate, fallback = '#7dfff0') {
  const ab = candidate && candidate.ability;
  return ab ? paletteColor(candidate, ab.tint, fallback) : fallback;
}

/**
 * A full look for the locker, or null for an unknown id.
 *
 * Spread over `DEFAULT_LOOK` so a candidate added later cannot ship with a
 * missing field: whatever the sheet does not state, the default does.
 */
export function candidateLook(id) {
  const c = candidateById(id);
  if (!c) return null;
  return { ...DEFAULT_LOOK, ...c.look, name: c.name, title: c.title, candidate: c.id };
}
