export const AMMO = {
  light: { name: 'Light Cells', color: '#ffe566' },
  medium: { name: 'Heart Rounds', color: '#ff4f9a' },
  heavy: { name: 'Lunar Mags', color: '#b388ff' },
  shells: { name: 'Blossom Shells', color: '#ffb067' },
};

export const GUNS = {
  ar: {
    id: 'ar', name: 'Heartbreaker', kind: 'gun', rarity: 'epic',
    dmg: 16, rpm: 540, mag: 30, reload: 2.05, spread: 0.008, spreadAdd: 0.0065,
    ammo: 'medium', near: 28, far: 78, pellets: 1, auto: true, head: 1.75,
    recoil: [0.012, 0.014, 0.016, 0.013, 0.01, 0.012], yaw: 0.004,
    glb: 'ak47.glb',
    blurb: 'Love hurts. Steady automatic.',
  },
  smg: {
    id: 'smg', name: 'Neko Spray', kind: 'gun', rarity: 'rare',
    dmg: 11, rpm: 860, mag: 32, reload: 1.65, spread: 0.016, spreadAdd: 0.009,
    ammo: 'light', near: 16, far: 38, pellets: 1, auto: true, head: 1.55,
    recoil: [0.008, 0.009, 0.01, 0.008], yaw: 0.007,
    glb: 'mac10.glb',
    blurb: 'Purr. Spray. Repeat.',
  },
  shot: {
    id: 'shot', name: 'Blossom', kind: 'gun', rarity: 'rare',
    dmg: 10, rpm: 78, mag: 5, reload: 3.1, spread: 0.085, spreadAdd: 0,
    ammo: 'shells', near: 7, far: 20, pellets: 8, auto: false, head: 1.2,
    recoil: [0.045], yaw: 0.01,
    glb: 'shotgun.glb',
    blurb: 'Close. Personal. Fatal.',
  },
  snip: {
    id: 'snip', name: 'Lunar Veil', kind: 'gun', rarity: 'legendary',
    dmg: 90, rpm: 46, mag: 4, reload: 2.7, spread: 0.0008, spreadAdd: 0,
    ammo: 'heavy', near: 70, far: 160, pellets: 1, auto: false, head: 1.85, bolt: 0.72,
    recoil: [0.06], yaw: 0,
    glb: 'awp.glb',
    blurb: 'Silence is my aim.',
  },
  pistol: {
    id: 'pistol', name: 'Kiss Mark', kind: 'gun', rarity: 'common',
    dmg: 28, rpm: 360, mag: 12, reload: 1.45, spread: 0.01, spreadAdd: 0.005,
    ammo: 'light', near: 20, far: 48, pellets: 1, auto: false, head: 1.7,
    recoil: [0.016], yaw: 0.003,
    glb: 'pew.glb',
    blurb: 'A sidearm with lipstick on the slide.',
  },
};

export const MELEE = {
  katana: {
    id: 'katana', name: 'Ribbon Katana', kind: 'melee', rarity: 'epic',
    combo: [34, 42, 70], range: 2.35, step: 0.34, gap: 0.48, lunge: 0.55,
    blurb: 'Three-cut ribbon. The last slash finishes.',
  },
  blade: {
    id: 'blade', name: 'Sugar Edge', kind: 'melee', rarity: 'legendary',
    combo: [24, 26, 28, 58], range: 2.15, step: 0.22, gap: 0.4, lunge: 0.4,
    blurb: 'A humming energy blade. Fast, bright, rude.',
  },
  greatsword: {
    id: 'greatsword', name: 'Heartcleaver', kind: 'melee', rarity: 'mythic',
    combo: [62, 108], range: 2.85, step: 0.62, gap: 0.7, lunge: 0.35,
    blurb: 'Crystal greatsword. Slow. The second hit ruins people.',
  },
  // Candidate A's signature. Longest reach in the locker, and the only melee
  // whose head splits off — the viewmodel unfolds the hydro sidearm mid-cut.
  spear: {
    id: 'spear', name: 'Tide-Regalia Spear', kind: 'melee', rarity: 'mythic',
    combo: [30, 38, 62], range: 2.9, step: 0.3, gap: 0.55, lunge: 0.5,
    blurb: 'Royal regalia. Longest reach; the head splits off as a hydro sidearm.',
  },
  // Candidate B. A duelling lance: slower than the spear but it hits harder,
  // and the reach is second only to Candidate A's regalia.
  sunlance: {
    id: 'sunlance', name: 'Sunspine Lance', kind: 'melee', rarity: 'mythic',
    combo: [36, 46, 82], range: 2.8, step: 0.34, gap: 0.5, lunge: 0.55,
    blurb: 'Gilded duelling lance. The third drive lands hardest.',
  },
  // Candidate C. The flail trades all of its damage for a short, vicious
  // window: four fast cuts, and a chain that reaches wider than it looks.
  flail: {
    id: 'flail', name: 'Arclight Flail', kind: 'melee', rarity: 'epic',
    combo: [24, 28, 30, 62], range: 2.45, step: 0.2, gap: 0.32, lunge: 0.3,
    blurb: 'Chained court flail. Four cuts, then the chain comes around.',
  },
  // Candidate D. A glacier trident: long, patient, and it does not stop.
  trident: {
    id: 'trident', name: 'Rimeglass Trident', kind: 'melee', rarity: 'legendary',
    combo: [28, 36, 58, 76], range: 2.6, step: 0.28, gap: 0.42, lunge: 0.6,
    blurb: 'Three prongs of pressed ice. Patient reach, relentless fourth thrust.',
  },
  // Candidate E. The war-fan is the fastest melee in the locker and the
  // shortest, so it wins by being swung more than it wins by connecting.
  warfan: {
    id: 'warfan', name: 'Court War-Fan', kind: 'melee', rarity: 'epic',
    combo: [16, 18, 20, 44], range: 1.95, step: 0.14, gap: 0.24, lunge: 0.28,
    blurb: 'A fan of hardened petals. Very fast, very short.',
  },
  // Candidate F. A draining curved blade: slow arcs, heavy bites, and it is
  // the only melee that looks like it is taking something from the air.
  voidglaive: {
    id: 'voidglaive', name: 'Hollowcurve Glaive', kind: 'melee', rarity: 'mythic',
    combo: [44, 56, 96], range: 2.7, step: 0.42, gap: 0.6, lunge: 0.38,
    blurb: 'A curved blade that drinks the light around it. The third arc ruins people.',
  },
};

export const ITEMS = {
  bandage: { id: 'bandage', name: 'Kiss Bandage', kind: 'heal', rarity: 'common', hp: 30, time: 1.6, stack: 6, blurb: 'A smooch-shaped plaster.' },
  elixir: { id: 'elixir', name: 'Heart Elixir', kind: 'heal', rarity: 'rare', hp: 55, time: 3.1, stack: 3, blurb: 'Bubbly pink. Tastes like victory.' },
  potion: { id: 'potion', name: 'Love Potion', kind: 'heal', rarity: 'epic', hp: 100, time: 4.2, stack: 2, blurb: 'Full heart. Do not chug while shot.' },
  veil: { id: 'veil', name: 'Sake Shield', kind: 'shield', rarity: 'common', shield: 30, time: 1.9, stack: 5, blurb: 'Drink up. Liquid courage hardens into armor.' },
  barrier: { id: 'barrier', name: 'Crystal Bikini Barrier', kind: 'shield', rarity: 'rare', shield: 55, time: 3.2, stack: 3, blurb: 'Faceted light, strapped on fast.' },
  aegis: { id: 'aegis', name: 'Goddess Aegis', kind: 'shield', rarity: 'legendary', shield: 100, time: 4.4, stack: 1, blurb: 'The full divine shell.' },
  star: { id: 'star', name: 'Star Grenade', kind: 'grenade', rarity: 'epic', time: 0.15, stack: 4, blurb: 'Throw a star. It disagrees with cover.' },
  second: { id: 'second', name: 'Second Heart', kind: 'revive', rarity: 'mythic', time: 0.2, stack: 1, blurb: 'One self-revive. Supply drops only.' },
};

export const CRYSTALS = {
  speed: { id: 'speed', name: 'Speed Crystal', color: '#7dffb2', time: 12, blurb: 'Legs go sparkly.' },
  regen: { id: 'regen', name: 'Regen Crystal', color: '#7af6ff', time: 10, blurb: 'Shield knits itself.' },
  jump: { id: 'jump', name: 'Double-Jump Crystal', color: '#ffd1ea', time: 20, blurb: 'One extra hop.' },
  magnet: { id: 'magnet', name: 'Loot Magnet', color: '#ffe566', time: 15, blurb: 'Pretty things come to you.' },
};

export function falloffDamage(gun, dist) {
  if (dist <= gun.near) return gun.dmg;
  if (dist >= gun.far) return gun.dmg * 0.42;
  const u = (dist - gun.near) / (gun.far - gun.near);
  return gun.dmg * (1 - u * 0.58);
}

export function gunById(id) {
  return GUNS[id] || null;
}

export function meleeById(id) {
  return MELEE[id] || MELEE.katana;
}

export function itemById(id) {
  return ITEMS[id] || null;
}

export const PICK_GUNS = ['ar', 'smg', 'shot', 'snip', 'pistol'];
export const PICK_HEALS = ['bandage', 'bandage', 'elixir', 'potion', 'veil', 'veil', 'barrier', 'aegis', 'star'];
