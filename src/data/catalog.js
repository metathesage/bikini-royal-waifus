export const MODELS = [
  { id: 'sofia_anime', name: 'Sofia', rarity: 'mythic', animated: true, blurb: '178 clips. Bow, sword, climb, cheer -- the best-equipped fighter here.' },
  { id: 'ual1_standard', name: 'Combatant', rarity: 'epic', animated: true, blurb: '43 combat clips: pistol shoot, reload, aim, sword combos, roll.' },
  { id: 'miyazawa_fighter', name: 'Miyazawa', rarity: 'epic', animated: true, blurb: '11 lobby clips with a real weapon-change transition.' },
  { id: 'dragon', name: 'Dragon', rarity: 'legendary', animated: true, blurb: 'Wings, and a glide that the drop actually uses.' },
  { id: 'bald_eagle', name: 'Eagle', rarity: 'epic', animated: true, blurb: 'Flap, glide, idle, walk. Reads clearly from a distance.' },
  { id: 'fox', name: 'Fox', rarity: 'rare', animated: true, blurb: '14 clips including run, sneak, alert and a bite.' },
  { id: 'soldier_rigged', name: 'Soldier', rarity: 'rare', animated: true, blurb: '32 clips, 0.21 MB. The one every cheap bot wears.' },
];

/**
 * Register the rigged roster with the locker.
 *
 * The PSX characters arrive as a generated manifest rather than a static list,
 * so the locker grows once the manifest lands and the UI is repainted. Each is
 * flagged `rigged` so the card can say so, which matters: a rigged model walks,
 * aims and reacts, a static import does not.
 */
export function addPsxModels(list) {
  let added = 0;
  for (const e of list) {
    if (MODELS.some((m) => m.id === e.id)) continue;
    MODELS.push({
      id: e.id,
      name: e.name,
      rarity: 'epic',
      rigged: true,
      blurb: 'Rigged import. Walks, aims and flinches.',
    });
    added += 1;
  }
  return added;
}

export const RARITY = {
  common: { label: 'Common', color: '#d5d8e6' },
  rare: { label: 'Rare', color: '#3ec5ff' },
  epic: { label: 'Epic', color: '#c46bff' },
  legendary: { label: 'Legendary', color: '#ffb020' },
  mythic: { label: 'Mythic Crystal', color: '#7dfff0' },
};

export const BODIES = [
  { id: 'darling', name: 'Darling Hourglass', rarity: 'rare', blurb: 'The poster figure. Tiny waist, long legs, glossy curves.', hip: 1.08, chest: 1.05, bust: 1.12, thigh: 1.1, height: 1 },
  { id: 'voluptuous', name: 'Velvet Idol', rarity: 'epic', blurb: 'Heavier curves, softer bounce, still all legs.', hip: 1.2, chest: 1.12, bust: 1.35, thigh: 1.22, height: 0.98 },
  { id: 'statuesque', name: 'Spire Muse', rarity: 'legendary', blurb: 'Tall, long-limbed, runway proportions.', hip: 1.02, chest: 1, bust: 1.05, thigh: 1.02, height: 1.08 },
  { id: 'athletic', name: 'Reef Dancer', rarity: 'rare', blurb: 'Toned thighs, high hips, fighter posture.', hip: 1.05, chest: 0.98, bust: 0.96, thigh: 1.08, height: 1.03 },
  { id: 'soft', name: 'Peach Cloud', rarity: 'epic', blurb: 'Round, plush, maximum jiggle.', hip: 1.16, chest: 1.08, bust: 1.28, thigh: 1.2, height: 0.97 },
  { id: 'doll', name: 'Crystal Doll', rarity: 'mythic', blurb: 'Huge eyes, tiny waist, gacha-poster silhouette.', hip: 1.1, chest: 1.02, bust: 1.18, thigh: 1.06, height: 1.01 },
];

export const FACES = [
  { id: 'doll', name: 'Doll', rarity: 'epic', blurb: 'Enormous eyes, tiny smile.', eye: 1.18, cheek: 1.05 },
  { id: 'heart', name: 'Heart', rarity: 'rare', blurb: 'Soft cheeks, bright stare.', eye: 1.08, cheek: 1.12 },
  { id: 'sharp', name: 'Sharp', rarity: 'legendary', blurb: 'Narrow chin, cool gaze.', eye: 1, cheek: 0.92 },
  { id: 'round', name: 'Round', rarity: 'common', blurb: 'Soft jaw, playful eyes.', eye: 1.1, cheek: 1.14 },
];

export const MAKEUP = [
  { id: 'blush', name: 'Heart Blush', rarity: 'common' },
  { id: 'wing', name: 'Winged Liner', rarity: 'rare' },
  { id: 'crystal', name: 'Crystal Liner', rarity: 'epic' },
  { id: 'freckle', name: 'Star Freckles', rarity: 'rare' },
  { id: 'none', name: 'Bare Glow', rarity: 'common' },
];

export const HAIR = [
  { id: 'long', name: 'Moonfall Lengths', rarity: 'rare' },
  { id: 'twintail', name: 'Twin Comets', rarity: 'epic' },
  { id: 'bob', name: 'Gloss Bob', rarity: 'common' },
  { id: 'pony', name: 'High Ribbon', rarity: 'rare' },
  { id: 'drills', name: 'Drill Sweets', rarity: 'legendary' },
  { id: 'wolf', name: 'Wolf Cut', rarity: 'epic' },
  { id: 'hime', name: 'Hime Crown', rarity: 'legendary' },
  { id: 'side', name: 'Side Sweep', rarity: 'common' },
];

export const TOPS = [
  { id: 'triangle', name: 'Tiny Triangle', rarity: 'common' },
  { id: 'sling', name: 'Sling Strap', rarity: 'epic' },
  { id: 'micro', name: 'Micro Band', rarity: 'rare' },
  { id: 'band', name: 'Strapless Band', rarity: 'common' },
  { id: 'crystal', name: 'Crystal Armor Bikini', rarity: 'mythic' },
  { id: 'ribbon', name: 'Ribbon Wrap', rarity: 'legendary' },
  { id: 'heart', name: 'Heart Cups', rarity: 'epic' },
  { id: 'strappy', name: 'Star Straps', rarity: 'rare' },
];

export const BOTTOMS = [
  { id: 'micro', name: 'Micro Cut', rarity: 'rare' },
  { id: 'sling', name: 'Sling Bottom', rarity: 'epic' },
  { id: 'shorts', name: 'Tiny Shorts', rarity: 'common' },
  { id: 'crystal', name: 'Crystal Hip Guard', rarity: 'mythic' },
  { id: 'ribbon', name: 'Side Ribbons', rarity: 'legendary' },
  { id: 'skirt', name: 'Pleat Micro', rarity: 'rare' },
];

export const PATTERNS = [
  { id: 'solid', name: 'Solid', rarity: 'common' },
  { id: 'stripes', name: 'Candy Stripes', rarity: 'rare' },
  { id: 'hearts', name: 'Hearts', rarity: 'epic' },
  { id: 'stars', name: 'Stars', rarity: 'rare' },
  { id: 'scales', name: 'Mermaid Scales', rarity: 'legendary' },
  { id: 'lattice', name: 'Crystal Lattice', rarity: 'mythic' },
];

export const ACCESSORIES = [
  { id: 'cat-ears', name: 'Cat Ears', rarity: 'rare', slot: 'head' },
  { id: 'fox-ears', name: 'Fox Ears', rarity: 'epic', slot: 'head' },
  { id: 'horns', name: 'Crystal Horns', rarity: 'epic', slot: 'head' },
  { id: 'halo', name: 'Halo', rarity: 'legendary', slot: 'head' },
  { id: 'flower', name: 'Plumeria', rarity: 'common', slot: 'head' },
  { id: 'glasses', name: 'Heart Frames', rarity: 'rare', slot: 'face' },
  { id: 'headphones', name: 'Neon Cans', rarity: 'epic', slot: 'head' },
  { id: 'choker', name: 'Heart Choker', rarity: 'common', slot: 'neck' },
  { id: 'earrings', name: 'Crystal Drops', rarity: 'rare', slot: 'face' },
  { id: 'tail', name: 'Cat Tail', rarity: 'rare', slot: 'tail' },
  { id: 'fox-tail', name: 'Fox Tail', rarity: 'epic', slot: 'tail' },
  { id: 'wings', name: 'Fairy Wings', rarity: 'legendary', slot: 'back' },
  { id: 'thigh', name: 'Thigh Straps', rarity: 'epic', slot: 'legs' },
  { id: 'armlets', name: 'Armlets', rarity: 'rare', slot: 'arms' },
  { id: 'jewelry', name: 'Crystal Jewelry', rarity: 'legendary', slot: 'body' },
  { id: 'navel', name: 'Navel Gem', rarity: 'rare', slot: 'body' },
  { id: 'anklets', name: 'Anklets', rarity: 'common', slot: 'legs' },
  { id: 'ribbons', name: 'Wrist Ribbons', rarity: 'common', slot: 'arms' },
];

export const WRAPS = [
  { id: 'sakura', name: 'Sakura Gloss', rarity: 'epic', color: '#ff4f9a', accent: '#ffd1ea' },
  { id: 'midnight', name: 'Midnight Rose', rarity: 'legendary', color: '#2a1248', accent: '#c46bff' },
  { id: 'neon', name: 'Neon Grove', rarity: 'rare', color: '#122028', accent: '#39ffd2' },
  { id: 'gold', name: 'Goddess Gold', rarity: 'legendary', color: '#ffd36a', accent: '#fff6d0' },
  { id: 'void', name: 'Void Pearl', rarity: 'mythic', color: '#14141f', accent: '#7dfff0' },
  { id: 'candy', name: 'Candy Stripe', rarity: 'common', color: '#ff7ab8', accent: '#ffffff' },
  { id: 'holo', name: 'Holo Reef', rarity: 'mythic', color: '#9ad7ff', accent: '#e7b0ff' },
];

export const CHARMS = [
  { id: 'heart', name: 'Heart Charm', rarity: 'common' },
  { id: 'star', name: 'Star Charm', rarity: 'rare' },
  { id: 'cat', name: 'Neko Bell', rarity: 'epic' },
  { id: 'moon', name: 'Moon Drop', rarity: 'rare' },
  { id: 'crystal', name: 'Mythic Shard', rarity: 'mythic' },
  { id: 'bow', name: 'Blossom Bow', rarity: 'legendary' },
];

export const EMOTES = [
  { id: 'blowkiss', name: 'Blow a Kiss', rarity: 'epic', blurb: 'Hands to lips, chest bounce, sparkle.' },
  { id: 'stretch', name: 'Morning Stretch', rarity: 'rare', blurb: 'Arms up, bikini shift, long breath.' },
  { id: 'spin', name: 'Idol Spin', rarity: 'legendary', blurb: 'Full turn with hair and tail whip.' },
  { id: 'wave', name: 'Cute Wave', rarity: 'common', blurb: 'One-hand wave, hip pop.' },
  { id: 'cheer', name: 'Victory Cheer', rarity: 'epic', blurb: 'Jump-clap with extra bounce.' },
  { id: 'shy', name: 'Shy Sway', rarity: 'rare', blurb: 'Knees in, glance aside, hair hide.' },
];

export const VICTORIES = [
  { id: 'sparkle', name: 'Sparkle Pop', rarity: 'epic' },
  { id: 'heart', name: 'Heart Arms', rarity: 'legendary' },
  { id: 'queen', name: 'Hands on Hips', rarity: 'rare' },
  { id: 'idol', name: 'Wink Peace', rarity: 'mythic' },
  { id: 'curtsey', name: 'Crystal Curtsey', rarity: 'epic' },
];

export const LOADINGS = [
  { id: 'stretch', name: 'Stretch Loop', rarity: 'rare', blurb: 'She stretches while the island loads.' },
  { id: 'adjust', name: 'Bikini Adjust', rarity: 'epic', blurb: 'A quick strap fix, then a smile.' },
  { id: 'beam', name: 'UFO Beam Pose', rarity: 'legendary', blurb: 'Floating in the drop beam.' },
  { id: 'idle', name: 'Studio Idle', rarity: 'common', blurb: 'Pedestal breathe and sway.' },
];

export const BANNERS = [
  { id: 'petal', name: 'Petal Pink', rarity: 'common', a: '#ff4f9a', b: '#ffd1ea' },
  { id: 'mythic', name: 'Mythic Crystal', rarity: 'mythic', a: '#7dfff0', b: '#c46bff' },
  { id: 'neon', name: 'Neon Grove', rarity: 'epic', a: '#39ffd2', b: '#ff2bd6' },
  { id: 'ocean', name: 'Sky Reef', rarity: 'rare', a: '#3ec5ff', b: '#d8f6ff' },
  { id: 'sunset', name: 'Oasis Sunset', rarity: 'legendary', a: '#ffb067', b: '#ff4f9a' },
  { id: 'midnight', name: 'Midnight', rarity: 'epic', a: '#2a1248', b: '#7a4bff' },
];

export const TITLES = [
  'Crystal Darling', 'Last Waifu Standing', 'Heartbreaker', 'Storm Siren',
  'Oasis Muse', 'Grove Neko', 'Reef Angel', 'Crater Queen', 'Beam Rider', 'Mythic Cutie',
];

export const SWATCHES = {
  skin: ['#ffd8cc', '#f3c1a8', '#e0a484', '#c6866a', '#8d5a44', '#ffc4d6', '#ffe8dc'],
  // The royal court sits at the end of each row — every candidate's hair, eye,
  // bikini and trim colour, in sheet order — so a court palette is pickable by
  // hand once a player has restyled her out of it.
  hair: ['#1b1b22', '#ff4f9a', '#ffd1ea', '#7af6ff', '#b388ff', '#ffe566', '#ff6a3d', '#4d6bff', '#f6f6f6', '#7dffb2', '#7a2cff', '#f2ece4', '#4fe3d0', '#ffb347', '#dfe6f2', '#eaf7ff', '#ff5ea8', '#e8e2f2'],
  eye: ['#3ee0ff', '#ff4f9a', '#ffe566', '#7dffb2', '#b388ff', '#ff7a3d', '#1b1b28', '#f2f2f2', '#4fe3d0', '#ff5a2b', '#a06bff', '#9fe8ff'],
  cloth: ['#ff3d8a', '#ff7ab8', '#1b1b28', '#7af6ff', '#b388ff', '#ffe566', '#ffffff', '#ff4d4d', '#3dffa6', '#6b4bff', '#101c34', '#1c1622', '#2a2f3d', '#16304a', '#1b3324', '#14141f'],
  trim: ['#7af6ff', '#ffd1ea', '#ffe566', '#ffffff', '#ff4f9a', '#b388ff', '#d8b063', '#fff2dc', '#f2f7ff', '#c3d4e6', '#f6e3b8', '#6f6a86'],
};

export const TABS = [
  { id: 'candidates', label: 'Candidates', hint: 'Royal court' },
  { id: 'model', label: 'Model', hint: 'Pick your waifu' },
  { id: 'wraps', label: 'Wraps', hint: 'Guns, charms' },
  { id: 'emotes', label: 'Emotes', hint: 'Full-body jiggle' },
  { id: 'victory', label: 'Victory', hint: 'Last-waifu pose' },
  { id: 'loading', label: 'Loading', hint: 'Drop-screen loop' },
  { id: 'banner', label: 'Banner', hint: 'Nameplate' },
];

export const DEFAULT_LOOK = {
  name: 'Yuna',
  title: 'Crystal Darling',
  /** Null for a hand-built locker waifu; a candidate id grants her ability. */
  candidate: null,
  model: 'sofia_anime',
  body: 'darling',
  face: 'doll',
  skin: '#ffd0c2',
  makeup: 'blush',
  hair: 'long',
  hairColor: '#ff4f9a',
  eye: '#3ee0ff',
  top: 'triangle',
  bottom: 'micro',
  cloth: '#ff3d8a',
  pattern: 'hearts',
  trim: '#7af6ff',
  wet: false,
  sheer: false,
  glow: true,
  accessories: ['choker', 'earrings', 'flower'],
  wrap: 'sakura',
  charm: 'heart',
  melee: 'katana',
  emote: 'blowkiss',
  victory: 'sparkle',
  loading: 'beam',
  banner: 'mythic',
};

export const DEFAULT_SETTINGS = {
  mouse: 0.0022,
  gamepad: 2.6,
  fov: 78,
  invert: false,
  volume: 0.75,
  music: 0.4,
  jiggle: 1,
  assist: true,
  shake: true,
  text: 1,
  touch: false,
  bloom: true,
  /**
   * Cheat: the player takes no damage.
   *
   * A settings entry rather than a console command because there is no console
   * -- this is how you actually turn it on. It lives with the rest of the
   * options and persists, so a tester can leave it on and forget about it,
   * which is also the trap: nothing warns you it is active except the HUD.
   */
  god: false,
  bindings: {
    sprint: 'ShiftLeft',
    jump: 'Space',
    crouch: 'ControlLeft',
    reload: 'KeyR',
    interact: 'KeyE',
    melee: 'KeyQ',
    ability: 'KeyZ',
    dash: 'KeyF',
    use: 'KeyC',
    swap: 'KeyX',
    inspect: 'KeyV',
    emote: 'KeyG',
    score: 'Tab',
  },
};

const BIND_LABELS = {
  sprint: 'Sprint',
  jump: 'Jump',
  crouch: 'Crouch / Slide',
  reload: 'Reload',
  interact: 'Interact',
  melee: 'Melee',
  ability: 'Signature Ability',
  dash: 'Dash',
  use: 'Use Item',
  swap: 'Swap Weapon',
  inspect: 'Inspect Waifu',
  emote: 'Emote',
  score: 'Scoreboard',
};

export function bindingLabel(action) {
  return BIND_LABELS[action] || action;
}

export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = {
    Space: 'Space', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', Tab: 'Tab',
    Mouse0: 'LMB', Mouse2: 'RMB',
  };
  return map[code] || code;
}

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

/**
 * Roll a random look. `modelPool` restricts which imported bodies may be drawn
 * (bots use the cheap pool so 44 actors never pull a 117 MB model); when it is
 * omitted every locker model is eligible — including the generated PSX roster,
 * whose ids resolve through the same model lookup.
 */
export function rollLook(rng, opts = {}) {
  const { modelPool = null, proceduralChance = 0.55 } = opts;
  const pool = modelPool
    ? modelPool.map((id) => MODELS.find((m) => m.id === id)).filter(Boolean)
    : MODELS.filter((m) => m.id !== 'procedural');
  const mythicGate = rng();
  const acc = [];
  const accessories = ACCESSORIES.slice();
  const n = 2 + Math.floor(rng() * 4);
  for (let i = 0; i < n && accessories.length; i++) {
    const idx = Math.floor(rng() * accessories.length);
    acc.push(accessories.splice(idx, 1)[0].id);
  }
  return {
    ...DEFAULT_LOOK,
    name: DEFAULT_LOOK.name,
    title: pick(TITLES, rng),
    model: pool.length && rng() > proceduralChance ? pick(pool, rng).id : 'procedural',
    body: pick(BODIES, rng).id,
    face: pick(FACES, rng).id,
    skin: pick(SWATCHES.skin, rng),
    makeup: pick(MAKEUP, rng).id,
    hair: pick(HAIR, rng).id,
    hairColor: pick(SWATCHES.hair, rng),
    eye: pick(SWATCHES.eye, rng),
    top: pick(TOPS, rng).id,
    bottom: pick(BOTTOMS, rng).id,
    cloth: pick(SWATCHES.cloth, rng),
    pattern: mythicGate > 0.85 ? 'lattice' : pick(PATTERNS, rng).id,
    trim: pick(SWATCHES.trim, rng),
    wet: rng() > 0.72,
    sheer: rng() > 0.82,
    glow: rng() > 0.35,
    accessories: acc,
    wrap: pick(WRAPS, rng).id,
    charm: pick(CHARMS, rng).id,
    melee: pick(['katana', 'blade', 'greatsword'], rng),
    emote: pick(EMOTES, rng).id,
    victory: pick(VICTORIES, rng).id,
    loading: pick(LOADINGS, rng).id,
    banner: pick(BANNERS, rng).id,
  };
}

export function findById(list, id) {
  return list.find((x) => x.id === id) || list[0];
}

export function bodyStats(id) {
  return findById(BODIES, id);
}

export function faceStats(id) {
  return findById(FACES, id);
}

export function wrapStats(id) {
  return findById(WRAPS, id);
}

export function bannerStats(id) {
  return findById(BANNERS, id);
}

export const BOT_NAMES = [
  'Nyx', 'Lumi', 'Kira', 'Aoi', 'Rei', 'Mio', 'Hana', 'Suki', 'Nami', 'Emi',
  'Rika', 'Chiyo', 'Akari', 'Faye', 'Luna', 'Nova', 'Iris', 'Momo', 'Yuki', 'Sora',
  'Hime', 'Nao', 'Ruri', 'Koko', 'Mei', 'Aya', 'Rin', 'Towa', 'Shiro', 'Coco',
  'Miki', 'Nana', 'Velvet', 'Star', 'Peach', 'Amber', 'Jade', 'Ruby', 'Pearl', 'Opal',
  'Lyra', 'Vivi', 'Ciel', 'Neko', 'Bunny', 'Mika', 'Sae', 'Yoru', 'Hina', 'Kanon',
];

export const POIS = [
  { id: 'downtown', name: 'Downtown', x: 0, z: 0, color: '#b388ff' },
  { id: 'pool', name: 'Lagoon', x: -40, z: 2, color: '#3dffa6' },
  { id: 'bazaar', name: 'Night Market', x: 6, z: 40, color: '#ff5ea8' },
  { id: 'grove', name: 'Neon Grove', x: 38, z: 12, color: '#39ffd2' },
  { id: 'rooftops', name: 'Skyline', x: 30, z: -24, color: '#67d4ff' },
  { id: 'crater', name: 'Heartfall', x: -34, z: 26, color: '#ff4d7a' },
];
