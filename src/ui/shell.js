import {
  TABS, RARITY, BODIES, FACES, MAKEUP, HAIR, TOPS, BOTTOMS, PATTERNS, ACCESSORIES,
  WRAPS, CHARMS, EMOTES, VICTORIES, LOADINGS, BANNERS, SWATCHES, POIS, MODELS,
  bindingLabel, keyLabel, DEFAULT_SETTINGS, findById, bannerStats,
} from '../data/catalog.js';
import { CANDIDATES } from '../data/candidates.js';
import { GUNS, MELEE, ITEMS } from '../game/weapons.js';
import { screenBearing } from '../core/basis.js';
import { xpToNext } from '../core/store.js';

const GLYPH = {
  keyboard: { interact: 'E', jump: 'Space', inspect: 'V', reload: 'R', melee: 'Q', dash: 'F', use: 'C' },
  gamepad: { interact: 'X', jump: 'A', inspect: 'View', reload: 'X', melee: 'LB', dash: 'RB', use: 'D-Right' },
};

const $ = (id) => document.getElementById(id);

export function createShell(bus) {
  const ui = document.getElementById('ui');
  let screen = 'splash';
  let focus = 0;
  let tab = 'outfit';
  let capture = null;
  let device = 'keyboard';
  const map = document.getElementById('minimap');
  const ctx = map.getContext('2d');
  /** The touch pad's ability key, which mirrors the HUD chip's state. */
  const touchAbility = document.querySelector('[data-touch="ability"]');
  /** Pooled directional hit indicators; see spawnDmg/updateDmg. */
  const dmgSlots = [];
  for (const el of $('dmg').children) {
    dmgSlots.push({ el, until: 0, dirX: 0, dirZ: -1 });
  }

  function setScreen(name) {
    screen = name;
    for (const el of ui.querySelectorAll('[data-screen]')) {
      el.classList.toggle('is-open', el.dataset.screen === name || (name === 'game' && el.dataset.screen === 'game' && !bus.paused() && !bus.ended()));
    }
    if (name === 'game' && bus.ended()) {
      ui.querySelector('[data-screen="game"]').classList.add('is-open');
      ui.querySelector('[data-screen="end"]').classList.add('is-open');
      paintEnd();
    }
    if (name === 'pause') {
      ui.querySelector('[data-screen="game"]').classList.add('is-open');
      ui.querySelector('[data-screen="pause"]').classList.add('is-open');
    }
    focus = 0;
    applyFocus();
    if (name === 'locker') paintLocker();
    if (name === 'settings') paintSettings();
    if (name === 'armory') paintArmory();
    // Both front screens carry the profile bar, so both repaint it — the splash
    // is the first thing anyone sees and must not show the markup's placeholder.
    if (name === 'menu' || name === 'splash') paintPlate();
    if (name === 'viewer') paintViewer();
  }

  function navItems() {
    const open = [...ui.querySelectorAll('.screen.is-open[data-nav-root]')].pop();
    if (!open) return [];
    return [...open.querySelectorAll('[data-nav]')].filter((el) => el.offsetParent !== null || open.contains(el));
  }

  function applyFocus() {
    const items = navItems();
    items.forEach((el, i) => el.classList.toggle('is-focused', i === focus));
  }

  function moveFocus(d) {
    const items = navItems();
    if (!items.length) return;
    focus = (focus + d + items.length) % items.length;
    applyFocus();
    items[focus].scrollIntoView({ block: 'nearest' });
  }

  function activate() {
    const items = navItems();
    const el = items[focus];
    if (!el) return;
    if (el.tagName === 'INPUT') el.focus();
    else el.click();
  }

  ui.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    bus.audio();
    const action = btn.dataset.action;
    if (action === 'focus') bus.focus(btn.dataset.part);
    else if (action === 'boot') bus.boot();
    else if (action === 'play' || action === 'again') bus.play();
    else if (action === 'locker') bus.locker();
    else if (action === 'viewer') bus.viewer();
    else if (action === 'armory') bus.armory();
    else if (action === 'range') bus.range();
    else if (action === 'settings') bus.openSettings();
    else if (action === 'back') bus.back();
    else if (action === 'resume') bus.resume();
    else if (action === 'menu') bus.menu();
    else if (action === 'random') bus.randomize();
    else if (action === 'reset-binds') bus.resetBinds();
    else if (action === 'tab') { tab = btn.dataset.tab; paintLocker(); }
    else if (action === 'equip') bus.equip(btn.dataset.kind, btn.dataset.id);
    else if (action === 'candidate') bus.candidate(btn.dataset.id);
    else if (action === 'preset') bus.preset(Number(btn.dataset.i), btn.dataset.mode);
    else if (action === 'light') bus.light(btn.dataset.id);
    else if (action === 'anim') bus.anim(btn.dataset.id);
    else if (action === 'melee') bus.equip('melee', btn.dataset.id);
    else if (action === 'bind') capture = btn.dataset.bind;
  });

  ui.addEventListener('pointerover', (e) => {
    const btn = e.target.closest('[data-nav]');
    if (!btn) return;
    const items = navItems();
    const i = items.indexOf(btn);
    if (i >= 0) { focus = i; applyFocus(); }
  });

  $('name-input').addEventListener('input', (e) => bus.rename(e.target.value, null));
  $('title-input').addEventListener('input', (e) => bus.rename(null, e.target.value));
  $('tog-wet').addEventListener('change', (e) => bus.toggle('wet', e.target.checked));
  $('tog-sheer').addEventListener('change', (e) => bus.toggle('sheer', e.target.checked));
  $('tog-glow').addEventListener('change', (e) => bus.toggle('glow', e.target.checked));
  $('jiggle-slider').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('jiggle-read').textContent = v > 1.3 ? 'Extra bounce' : v < 0.7 ? 'Soft' : 'Normal';
    bus.previewJiggle(v);
  });

  const settingMap = [
    ['set-mouse', 'mouse', 'number'],
    ['set-pad', 'gamepad', 'number'],
    ['set-fov', 'fov', 'number'],
    ['set-vol', 'volume', 'number'],
    ['set-music', 'music', 'number'],
    ['set-jiggle', 'jiggle', 'number'],
    ['set-text', 'text', 'number'],
    ['set-invert', 'invert', 'check'],
    ['set-assist', 'assist', 'check'],
    ['set-shake', 'shake', 'check'],
    ['set-touch', 'touch', 'check'],
  ];
  for (const [id, key, type] of settingMap) {
    $(id).addEventListener('input', (e) => {
      const value = type === 'check' ? e.target.checked : Number(e.target.value);
      bus.setting(key, value);
    });
  }

  window.addEventListener('keydown', (e) => {
    if (!capture) return;
    e.preventDefault();
    bus.bind(capture, e.code);
    capture = null;
    paintSettings();
  });

  /**
   * Fill the profile chip on splash and menu.
   *
   * Both screens carry an identical `.profile` / `.wallet` bar, so this walks
   * them all rather than holding one id — that keeps the markup free of
   * duplicate ids and means the splash and the menu can never drift apart. The
   * equipped banner still has a job: its two colours now tint the avatar disc,
   * so changing banner in the locker changes the chrome you see every boot.
   */
  function paintPlate() {
    const look = bus.look();
    const s = (bus.progression && bus.progression()) || null;
    const level = s ? s.level : 1;
    const pct = Math.min(100, ((s ? s.xp : 0) / xpToNext(level)) * 100);
    const b = bannerStats(look.banner);
    for (const plate of ui.querySelectorAll('.profile')) {
      plate.style.setProperty('--plate-a', b.a);
      plate.style.setProperty('--plate-b', b.b);
      const name = plate.querySelector('.pname');
      const title = plate.querySelector('.ptitle');
      const lvl = plate.querySelector('.plevel em');
      const bar = plate.querySelector('.xpbar u');
      if (name) name.textContent = look.name;
      if (title) title.textContent = look.title;
      if (lvl) lvl.textContent = `LV ${level}`;
      if (bar) bar.style.width = `${pct}%`;
    }
    if (!s) return;
    for (const wallet of ui.querySelectorAll('.wallet')) {
      const coins = wallet.querySelector('.coins b');
      const gems = wallet.querySelector('.gems b');
      if (coins) coins.textContent = s.coins.toLocaleString('en-US');
      if (gems) gems.textContent = s.gems.toLocaleString('en-US');
    }
  }

  function card(kind, item, on) {
    const btn = document.createElement('button');
    btn.className = 'card' + (on ? ' on' : '');
    btn.dataset.nav = '';
    btn.dataset.action = 'equip';
    btn.dataset.kind = kind;
    btn.dataset.id = item.id;
    btn.style.setProperty('--card', RARITY[item.rarity]?.color || '#fff');
    const name = document.createElement('strong');
    name.textContent = item.name;
    const small = document.createElement('small');
    small.textContent = RARITY[item.rarity]?.label || '';
    btn.append(name, small);
    return btn;
  }

  /**
   * A royal candidate card.
   *
   * Every other card in the locker is one asset; a candidate is a whole sheet,
   * so this one has to show what a player is actually choosing between: the
   * codename, the clearance, the palette and the two things that change the
   * match — her ability and her weakness. All of it is read from
   * `data/candidates.js`, so the card cannot drift from the gameplay.
   */
  function candidateCard(c, on) {
    const btn = document.createElement('button');
    btn.className = 'card candidate' + (on ? ' on' : '');
    btn.dataset.nav = '';
    btn.dataset.action = 'candidate';
    btn.dataset.id = c.id;
    btn.style.setProperty('--card', RARITY[c.rarity]?.color || '#fff');
    const name = document.createElement('strong');
    name.textContent = `Candidate ${c.candidate} · ${c.codename}`;
    const small = document.createElement('small');
    small.textContent = `Clearance ${c.clearance} · ${c.title}`;
    const chips = document.createElement('div');
    chips.className = 'palette';
    for (const p of c.palette) {
      const chip = document.createElement('i');
      chip.style.background = p.hex;
      chip.title = `${p.name} ${p.hex}`;
      chips.append(chip);
    }
    const ability = document.createElement('small');
    ability.className = 'ability';
    ability.textContent = `${c.ability.name} — ${c.ability.blurb}`;
    const weak = document.createElement('small');
    weak.className = 'weak';
    weak.textContent = `Weakness: ${c.weakness.name} — ${c.weakness.blurb}`;
    const kit = document.createElement('small');
    kit.textContent = `${c.weapon.name}. ${c.combat}`;
    btn.append(name, small, chips, ability, kit, weak);
    return btn;
  }

  function paintLocker() {
    const look = bus.look();
    $('name-input').value = look.name;
    $('title-input').value = look.title;
    $('tog-wet').checked = !!look.wet;
    $('tog-sheer').checked = !!look.sheer;
    $('tog-glow').checked = !!look.glow;
    const tabs = $('tabs');
    tabs.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.className = 'btn tiny' + (t.id === tab ? ' xl' : '');
      b.dataset.nav = '';
      b.dataset.action = 'tab';
      b.dataset.tab = t.id;
      b.textContent = t.label;
      tabs.append(b);
    }
    const grid = $('grid');
    grid.innerHTML = '';
    const lists = {
      outfit: [['body', BODIES, look.body], ['face', FACES, look.face], ['makeup', MAKEUP, look.makeup]],
      model: [['model', MODELS, look.model]],
      bikini: [['top', TOPS, look.top], ['bottom', BOTTOMS, look.bottom], ['pattern', PATTERNS, look.pattern]],
      accessories: [['accessory', ACCESSORIES, look.accessories]],
      hair: [['hair', HAIR, look.hair]],
      wraps: [['wrap', WRAPS, look.wrap], ['charm', CHARMS, look.charm]],
      emotes: [['emote', EMOTES, look.emote]],
      victory: [['victory', VICTORIES, look.victory]],
      loading: [['loading', LOADINGS, look.loading]],
      banner: [['banner', BANNERS, look.banner]],
    };
    for (const [kind, list, cur] of lists[tab] || []) {
      for (const item of list) {
        const on = Array.isArray(cur) ? cur.includes(item.id) : cur === item.id;
        grid.append(card(kind, item, on));
      }
    }
    if (tab === 'candidates') {
      grid.classList.add('wide');
      for (const c of CANDIDATES) grid.append(candidateCard(c, look.candidate === c.id));
    } else grid.classList.remove('wide');
    const sw = $('swatches');
    sw.innerHTML = '';
    if (tab === 'model') {
      const note = document.createElement('p');
      note.className = 'fine';
      note.textContent = 'Imported waifus wear their own look — Procedural Cutie uses every locker option.';
      sw.append(note);
    }
    if (tab === 'candidates') {
      const note = document.createElement('p');
      note.className = 'fine';
      note.textContent = 'A candidate fills every slot at once — body, bikini, hair, wrap, melee and her signature ability. Restyle her afterwards and she keeps the ability; pick another model and she loses it.';
      sw.append(note);
    }
    for (const [field, colors] of [['skin', SWATCHES.skin], ['hairColor', SWATCHES.hair], ['eye', SWATCHES.eye], ['cloth', SWATCHES.cloth], ['trim', SWATCHES.trim]]) {
      const label = document.createElement('div');
      label.textContent = field === 'hairColor' ? 'Hair color' : field === 'cloth' ? 'Bikini' : field[0].toUpperCase() + field.slice(1);
      const row = document.createElement('div');
      row.className = 'swatches';
      for (const c of colors) {
        const b = document.createElement('button');
        b.className = 'swatch' + (look[field] === c ? ' on' : '');
        b.style.background = c;
        b.dataset.nav = '';
        b.addEventListener('click', () => bus.color(field, c));
        row.append(b);
      }
      sw.append(label, row);
    }
    const presets = $('presets');
    presets.innerHTML = '';
    bus.presets().forEach((p, i) => {
      const load = document.createElement('button');
      load.className = 'btn tiny';
      load.dataset.nav = '';
      load.dataset.action = 'preset';
      load.dataset.mode = 'load';
      load.dataset.i = String(i);
      load.textContent = p ? `Load ${p.name}` : `Empty ${i + 1}`;
      const save = document.createElement('button');
      save.className = 'btn tiny';
      save.dataset.nav = '';
      save.dataset.action = 'preset';
      save.dataset.mode = 'save';
      save.dataset.i = String(i);
      save.textContent = `Save ${i + 1}`;
      presets.append(load, save);
    });
    applyFocus();
  }

  function paintViewer() {
    const lights = $('lights');
    lights.innerHTML = '';
    for (const id of ['lobby', 'sunset', 'neon', 'victory']) {
      const b = document.createElement('button');
      b.className = 'btn tiny';
      b.dataset.nav = '';
      b.dataset.action = 'light';
      b.dataset.id = id;
      b.textContent = id;
      lights.append(b);
    }
    const anims = $('anims');
    anims.innerHTML = '';
    for (const id of ['idle', 'walk', ...EMOTES.map((e) => e.id), ...VICTORIES.map((v) => v.id), ...LOADINGS.map((l) => l.id)]) {
      const b = document.createElement('button');
      b.className = 'btn tiny';
      b.dataset.nav = '';
      b.dataset.action = 'anim';
      b.dataset.id = id;
      b.textContent = id;
      anims.append(b);
    }
    $('jiggle-slider').value = bus.settings().jiggle || 1;
  }

  function paintArmory() {
    const root = $('armory');
    root.innerHTML = '';
    const look = bus.look();
    const panel = document.createElement('div');
    panel.className = 'panel';
    const h = document.createElement('h3');
    h.textContent = 'Signature melee — you drop with it';
    panel.append(h);
    for (const m of Object.values(MELEE)) {
      const b = document.createElement('button');
      b.className = 'card' + (look.melee === m.id ? ' on' : '');
      b.dataset.nav = '';
      b.dataset.action = 'melee';
      b.dataset.id = m.id;
      b.innerHTML = '';
      const strong = document.createElement('strong');
      strong.textContent = m.name;
      const small = document.createElement('small');
      small.textContent = `${RARITY[m.rarity].label} · ${m.blurb}`;
      b.append(strong, small);
      panel.append(b);
    }
    const guns = document.createElement('div');
    guns.className = 'panel';
    const h2 = document.createElement('h3');
    h2.textContent = 'Found on the island';
    guns.append(h2);
    for (const g of Object.values(GUNS)) {
      const row = document.createElement('div');
      row.className = 'card';
      const strong = document.createElement('strong');
      strong.textContent = g.name;
      const small = document.createElement('small');
      small.textContent = `${g.blurb} · ${g.dmg} dmg · ${g.rpm} rpm · ${g.mag} mag`;
      row.append(strong, small);
      guns.append(row);
    }
    const wrap = findById(WRAPS, look.wrap);
    const note = document.createElement('p');
    note.textContent = `Equipped wrap ${wrap.name} · charm ${look.charm}. Change them in the locker.`;
    guns.append(note);
    root.append(panel, guns);
  }

  function paintSettings() {
    const s = bus.settings();
    $('set-mouse').value = s.mouse;
    $('set-pad').value = s.gamepad;
    $('set-fov').value = s.fov;
    $('set-vol').value = s.volume;
    $('set-music').value = s.music;
    $('set-jiggle').value = s.jiggle;
    $('set-text').value = s.text;
    $('set-invert').checked = !!s.invert;
    $('set-assist').checked = s.assist !== false;
    $('set-shake').checked = s.shake !== false;
    $('set-touch').checked = !!s.touch;
    document.documentElement.style.setProperty('--text', s.text || 1);
    document.body.classList.toggle('touch-on', !!s.touch || matchMedia('(pointer: coarse)').matches);
    const box = $('rebinds');
    box.innerHTML = '';
    for (const action of Object.keys(DEFAULT_SETTINGS.bindings)) {
      const row = document.createElement('div');
      const b = document.createElement('button');
      b.className = 'btn tiny';
      b.dataset.nav = '';
      b.dataset.action = 'bind';
      b.dataset.bind = action;
      b.textContent = `${bindingLabel(action)}: ${keyLabel(s.bindings[action])}`;
      row.append(b);
      box.append(row);
    }
  }

  function paintEnd() {
    const r = bus.result();
    if (!r) return;
    $('end-kicker').textContent = r.win ? 'Victory Royale' : `Placed #${r.placement}`;
    $('end-title').textContent = r.win ? 'You are the last waifu' : `Eliminated by ${r.killer}`;
    const stats = bus.stats() || {};
    const box = $('end-stats');
    box.innerHTML = '';
    for (const [k, v] of [['Kills', stats.kills], ['Damage', stats.damage], ['Accuracy', `${stats.accuracy}%`], ['Revives', stats.revived]]) {
      const p = document.createElement('p');
      p.textContent = `${k}: ${v ?? 0}`;
      box.append(p);
    }
  }

  function toast(text) {
    const el = document.createElement('div');
    el.textContent = text;
    $('toasts').append(el);
    setTimeout(() => el.remove(), 2400);
  }

  function onEvent(e) {
    if (e.type === 'toast') toast(e.text);
    if (e.type === 'feed') {
      const row = document.createElement('div');
      const a = document.createElement('b');
      a.textContent = e.killer;
      a.style.color = e.kc || '#fff';
      const mid = document.createTextNode(e.knock ? ' knocked ' : ' eliminated ');
      const b = document.createElement('b');
      b.textContent = e.victim;
      b.style.color = e.vc || '#ffd1ea';
      row.append(a, mid, b);
      const feed = $('feed');
      feed.prepend(row);
      while (feed.children.length > 5) feed.lastChild.remove();
    }
    if (e.type === 'hit') {
      const hit = $('hit');
      hit.classList.add('on');
      hit.classList.toggle('head', !!e.head);
      setTimeout(() => hit.classList.remove('on', 'head'), 80);
    }
    if (e.type === 'hurt' && typeof e.dirX === 'number') spawnDmg(e);
  }

  /**
   * Directional hit indicators.
   *
   * Each slot remembers the world bearing of one hit and is re-aimed every frame
   * against the live camera yaw, so an indicator stays glued to the direction
   * the damage came from no matter how the player spins. Several slots are live
   * at once, so being shot from two sides reads correctly.
   */
  const DMG_LIFE = 900;

  function spawnDmg(e) {
    const now = performance.now();
    let slot = dmgSlots.find((d) => d.until <= now);
    if (!slot) slot = dmgSlots.reduce((a, b) => (a.until < b.until ? a : b));
    slot.until = now + DMG_LIFE;
    slot.dirX = e.dirX;
    slot.dirZ = e.dirZ;
    slot.el.className = [
      e.amount >= 26 ? 'big' : '',
      e.head ? 'head' : '',
      e.melee ? 'melee' : '',
      /storm|tide/i.test(e.source || '') ? 'storm' : '',
    ].filter(Boolean).join(' ');
    slot.el.style.opacity = '0.92';
  }

  function updateDmg() {
    if (!dmgSlots.length) return;
    const now = performance.now();
    const yaw = bus.playerYaw ? bus.playerYaw() : 0;
    const short = Math.min(window.innerWidth || 800, window.innerHeight || 600);
    const radius = Math.max(64, Math.min(150, short * 0.19));
    for (const d of dmgSlots) {
      const left = d.until - now;
      if (left <= 0) {
        d.el.style.opacity = '0';
        continue;
      }
      // Screen bearing of the hit, relative to where the player is looking now.
      // CSS rotation is clockwise-positive, the bearing is CCW-positive.
      const a = screenBearing(d.dirX, d.dirZ, yaw);
      d.el.style.transform = `rotate(${(-a * 180 / Math.PI).toFixed(1)}deg) translateY(${-radius}px)`;
      d.el.style.opacity = String(Math.min(1, left / 320) * 0.92);
    }
  }

  function hud(snap, dev) {
    device = dev || device;
    updateDmg();
    if (screen !== 'game' && screen !== 'pause') return;
    $('hp').style.width = `${snap.hp}%`;
    $('sh').style.width = `${snap.shield}%`;
    $('hp-n').textContent = Math.ceil(snap.knocked ? snap.knockHp : snap.hp);
    $('sh-n').textContent = Math.ceil(snap.shield);
    $('alive').textContent = `${snap.aliveCount} alive · ${snap.kills} kills`;
    $('zone').textContent = snap.zoneText;
    $('wname').textContent = snap.weaponName;
    $('ammo').textContent = snap.weaponKind === 'melee' ? 'Melee' : `${snap.mag} / ${snap.reserve}`;
    $('cross').className = 'cross' + (snap.weaponName === 'Blossom' ? ' shot' : '');
    $('cross').style.transform = `translate(-50%, -50%) scale(${1 + (snap.spread || 0) * 8})`;
    $('scope').classList.toggle('on', !!snap.scope);
    $('vignette').classList.toggle('low', !!snap.low);
    $('vignette').classList.toggle('storm', !!snap.zoneDanger);
    const prompt = $('prompt');
    if (snap.prompt) {
      const g = GLYPH[device] || GLYPH.keyboard;
      const key = snap.prompt.action ? g[snap.prompt.action] || '' : '';
      prompt.textContent = key ? `${key}  ${snap.prompt.text}` : snap.prompt.text;
      prompt.hidden = false;
    } else prompt.textContent = snap.phase === 'lobby' ? `Drop ship in ${Math.ceil(snap.lobby)}s` : snap.phase === 'bus' ? 'A / Space to drop — hold jump to glide' : '';
    const ch = $('channel');
    ch.classList.toggle('on', snap.channel > 0);
    ch.firstElementChild.style.width = `${snap.channel * 100}%`;
    const buffs = $('buffs');
    buffs.innerHTML = '';
    for (const b of snap.buffs) {
      const s = document.createElement('span');
      s.textContent = `${b.name} ${b.t.toFixed(0)}s`;
      s.style.color = b.color;
      buffs.append(s);
    }
    // The signature ability reads out like a crystal buff, because that is the
    // language the rest of this HUD already uses: name plus time remaining.
    const ab = $('ability');
    if (snap.ability) {
      ab.hidden = false;
      ab.className = `ability-read${snap.ability.ready ? ' ready' : ''}${snap.ability.locked ? ' locked' : ''}`;
      ab.textContent = snap.ability.locked
        ? `${snap.ability.name} · suppressed by ${snap.ability.lockReason}`
        : snap.ability.ready
          ? `${snap.ability.name} · READY`
          : `${snap.ability.name} · ${Math.ceil(snap.ability.cd)}s`;
    } else ab.hidden = true;
    // The touch pad gets the same readout in the only space it has: the Z key
    // glows when the decree is ready, counts its cooldown down, and dims when
    // the storm has swallowed it. A waifu without a signature has no key at all.
    if (snap.ability) {
      touchAbility.hidden = false;
      touchAbility.classList.toggle('ready', !!snap.ability.ready);
      touchAbility.classList.toggle('locked', !!snap.ability.locked);
      touchAbility.textContent = snap.ability.ready || snap.ability.locked
        ? 'Z'
        : String(Math.ceil(snap.ability.cd));
    } else touchAbility.hidden = true;
    const hot = $('hotbar');
    hot.innerHTML = '';
    if (!snap.items.length) {
      const s = document.createElement('b');
      s.textContent = 'No items';
      hot.append(s);
    }
    snap.items.forEach((item, i) => {
      const s = document.createElement('b');
      s.className = item.on ? 'on' : '';
      s.textContent = `${item.name} ×${item.count}`;
      s.addEventListener('click', () => bus.selectItem(i));
      hot.append(s);
    });
    const p = $('partner');
    p.innerHTML = '';
    if (snap.partner) {
      p.textContent = snap.partner.alive
        ? `${snap.partner.name}  ${Math.ceil(snap.partner.hp)}♥ ${Math.ceil(snap.partner.shield)}◆ ${snap.partner.knocked ? 'DOWN' : ''}`
        : `${snap.partner.name} eliminated`;
    }
    const comp = $('compass');
    comp.innerHTML = '';
    for (const c of snap.compass) {
      if (Math.abs(c.ang) > 1.2) continue;
      const el = document.createElement('b');
      el.textContent = c.name;
      el.style.left = `${50 + (c.ang / 1.2) * 50}%`;
      el.style.color = c.color;
      comp.append(el);
    }
    drawMap(snap);
    paintRange(snap.range);
    const labels = $('labels');
    labels.innerHTML = '';
    for (const l of snap.labels) {
      if (!l.on || l.x < 0 || l.x > 1 || l.y < 0 || l.y > 1) continue;
      const s = document.createElement('span');
      s.className = l.kind;
      s.textContent = l.name;
      s.style.left = `${l.x * 100}%`;
      s.style.top = `${l.y * 100}%`;
      labels.append(s);
    }
    updateDmg();
    if (snap.result && screen === 'game') {
      ui.querySelector('[data-screen="end"]').classList.add('is-open');
      paintEnd();
    }
  }

  /**
   * The range instrument panel.
   *
   * Only the graybox sends a `range` snapshot, so this is the sole place that
   * knows the panel exists — the island hides it by never unhiding the element.
   *
   * Rebuilt from innerHTML every frame like the rest of the HUD. That sounds
   * wasteful and is not: it is a dozen rows and a five-cell grid, and the codebase
   * already does exactly this for the hotbar and the compass. Matching the
   * surrounding code is worth more here than micro-optimising a panel that is
   * only ever on screen while someone is deliberately testing a gun.
   *
   * Two audiences share this one panel, and that is why it is split in two. The
   * top block is the *ballistics* readout — the arms table, the measured falloff
   * curve, the last shot's numbers — which is what a designer tunes against. The
   * bottom block is the *drill* readout: score, streak, per-lane hits. That is
   * what makes the place worth re-entering, and it is the part that was entirely
   * missing before, which is why the range felt like a spreadsheet you could
   * only stare at.
   */
  function paintRange(r) {
    const el = $('range');
    if (!r) { el.hidden = true; return; }
    el.hidden = false;
    const row = (k, v, cls = '') => `<div class="rrow${cls}"><span>${k}</span><b>${v}</b></div>`;

    // --- header: the drill's score, front and centre ------------------
    const streakCls = r.streak >= 10 ? ' hot' : '';
    const parts = [
      '<div class="rhead-block">',
      '<h3>Range<i>射場</i></h3>',
      `<div class="rscore"><b>${r.score}</b><span>score</span></div>`,
      row('Streak', r.streak ? `${r.streak}${r.bestStreak > r.streak ? ` · best ${r.bestStreak}` : ''}` : '—', `.rstreak${streakCls}`),
      '</div>',
    ];

    // --- ballistics ---------------------------------------------------
    parts.push(`<div class="rsec">${row('Weapon', r.gunName)}${row('Base / rpm', `${r.base} · ${r.rpm}`)}`);
    // Spread is the number the crosshair is already scaling off, so showing it
    // turns "why did the crosshair bloom" into a number instead of a guess.
    parts.push(row('Spread', r.spread.toFixed(3)));
    parts.push('</div>');

    // Damage the gun actually does at each measured gate. This is the falloff
    // curve read off the level rather than estimated by eye at 100m. The bar
    // under each cell is scaled to the gun's own base damage, so the shape of
    // the curve is visible at a glance instead of needing five numbers compared.
    if (r.curve.length) {
      parts.push('<div class="rgrid">');
      for (const c of r.curve) {
        const pct = r.base > 0 ? Math.max(4, Math.round((c.dmg / r.base) * 100)) : 0;
        parts.push(`<div><i>${c.m}m</i><b>${c.dmg}</b><u style="width:${pct}%"></u></div>`);
      }
      parts.push('</div>');
    }

    const l = r.last;
    if (l) {
      parts.push(`<div class="rlast">${row('Last hit', `${l.dmg} dmg @ ${l.dist}m`)}${row('% of max', `${l.pct}%`)}${l.head ? '<div class="rrow rhead"><span>Headshot</span><b>yes</b></div>' : ''}${l.score ? row('Points', `+${l.score}`) : ''}</div>`);
    } else {
      parts.push('<div class="rlast empty"><div class="rmiss">No hits yet</div></div>');
    }

    // --- the drill's own accounting -----------------------------------
    parts.push(`<div class="rsec">${row('Shots / hits', `${r.shots} / ${r.hits}`)}${row('Accuracy', `${r.accuracy}%`)}${row('Damage', r.damage)}`);
    if (r.headshots) parts.push(row('Headshots', r.headshots));
    if (r.furthest) parts.push(row('Longest hit', `${r.furthest}m`));
    parts.push('</div>');

    // Per-lane hit counts. This is the one that actually tells a designer
    // something they cannot see: which distances they are good at. Sorted by the
    // lane's own number where possible so 10/25/50/75/100 stay in order.
    if (r.lanes && r.lanes.length) {
      const order = ['10', '25', '50', '75', '100', 'hi', 'lo', 'crouch', 'tall', 'shield', 'tank'];
      const sorted = [...r.lanes].sort((a, b) => {
        const ia = order.indexOf(a.name);
        const ib = order.indexOf(b.name);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      parts.push('<div class="rlanes">');
      for (const l2 of sorted) {
        parts.push(`<div><i>${l2.name}</i><b>${l2.hits}</b></div>`);
      }
      parts.push('</div>');
    }

    // A downed target is a beat, and the only place it is announced. Without it
    // the tester cannot tell a working gun from one that stopped working.
    if (r.downed) parts.push(`<div class="rdown">${r.downed} DOWN</div>`);

    el.innerHTML = parts.join('');
  }

  function drawMap(snap) {
    const w = map.width;
    const h = map.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(40, 16, 48, 0.2)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2);
    ctx.fill();
    // The map is a fraction of its old size, so the minimap zooms in to match —
    // otherwise the whole island would fit inside a postage stamp.
    const scale = w / 130;
    const X = (x) => w / 2 + x * scale;
    const Z = (z) => h / 2 + z * scale;
    if (snap.zone) {
      ctx.strokeStyle = '#ff4fd8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(snap.zone.x), Z(snap.zone.z), snap.zone.r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    // The range replaces the island's landmarks with its own. POIS is a fixed
    // list of island places, and plotting them on the firing range drew four
    // markers for locations that do not exist — the same class of lie as a
    // storm ring on a map with no storm. Downrange lanes are what is actually
    // there, and a minimap of the range should show the range.
    if (snap.isRange) {
      ctx.strokeStyle = 'rgba(125, 255, 240, 0.55)';
      ctx.lineWidth = 1;
      for (const lane of snap.lanes || []) {
        const y = Z(lane.z);
        // A full-width tick, so the lanes read as measured stations across the
        // range rather than as a road running down it.
        ctx.beginPath();
        ctx.moveTo(6, y);
        ctx.lineTo(w - 6, y);
        ctx.stroke();
      }
    } else {
      for (const p of POIS) {
        ctx.fillStyle = p.color;
        ctx.fillRect(X(p.x) - 2, Z(p.z) - 2, 4, 4);
      }
    }
    for (const d of snap.dots) {
      ctx.fillStyle = d.kind === 'you' ? '#fff' : d.kind === 'ally' ? '#3ee0ff' : d.kind === 'drop' ? '#ffe566' : '#ff4f9a';
      ctx.beginPath();
      ctx.arc(X(d.x), Z(d.z), d.kind === 'you' ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(X(snap.px), Z(snap.pz));
    ctx.rotate(-snap.yaw);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.fill();
    ctx.restore();
  }

  function progress(p, caption) {
    $('load-fill').style.width = `${Math.round(p * 100)}%`;
    if (caption) $('load-title').textContent = caption;
    const look = bus.look();
    $('load-caption').textContent = look.name;
  }

  function pump(input) {
    if (input.typing && document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if (screen === 'splash' || screen === 'menu' || screen === 'locker' || screen === 'viewer' || screen === 'armory' || screen === 'settings' || screen === 'pause' || (screen === 'game' && bus.ended())) {
      if (input.uiDown || input.uiRight) moveFocus(1);
      if (input.uiUp || input.uiLeft) moveFocus(-1);
      if (input.confirmPressed) activate();
      if (input.backPressed && screen !== 'splash' && screen !== 'menu') bus.back();
    }
  }

  document.body.classList.toggle('touch-on', matchMedia('(pointer: coarse)').matches);
  setScreen('splash');

  return { setScreen, hud, onEvent, toast, paintLocker, paintSettings, progress, pump, screen: () => screen };
}
