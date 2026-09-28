import * as THREE from 'three';

function mat(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createFx(scene) {
  const sparks = [];
  const lines = [];
  const bits = [];
  for (let i = 0; i < 80; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), mat('#ffffff'));
    m.visible = false;
    scene.add(m);
    sparks.push({ m, life: 0, vel: new THREE.Vector3() });
  }
  const box = new THREE.BoxGeometry(0.04, 0.04, 1);
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(box, mat('#ffd1ea'));
    m.visible = false;
    scene.add(m);
    lines.push({ m, life: 0 });
  }
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), mat('#7dfff0'));
    m.visible = false;
    scene.add(m);
    bits.push({ m, life: 0, vel: new THREE.Vector3() });
  }
  const flash = new THREE.PointLight(0xfff0f6, 0, 6);
  scene.add(flash);
  let flashT = 0;

  /**
   * Tidal sigils — one pool, reused.
   *
   * A decree is not a particle: it is a big, long-lived sigil with an outer
   * ring, an inner crest, six rune shards and six water blades that coil around
   * its axis. Built once and parked hidden, because the pool lives for the
   * whole match and an add/remove per cast would churn the scene graph at
   * exactly the moment the frame budget is already tightest.
   */
  const SIGIL_LIFE = 2.6;
  const sigils = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.04, 6, 44), mat('#4fe3d0', 0.9));
    const crest = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.022, 6, 36), mat('#f2ece4', 0.8));
    const runes = new THREE.Group();
    for (let r = 0; r < 6; r++) {
      const a = (r / 6) * Math.PI * 2;
      const shard = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.02), mat('#d8b063', 0.9));
      shard.position.set(Math.cos(a) * 0.84, Math.sin(a) * 0.84, 0);
      shard.rotation.z = a;
      runes.add(shard);
    }
    const coil = new THREE.Group();
    const blades = [];
    for (let c = 0; c < 6; c++) {
      const blade = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 5, 14, Math.PI * 0.7), mat('#7dfff0', 0.9));
      blade.userData.i = c;
      coil.add(blade);
      blades.push(blade);
    }
    g.add(ring, crest, runes, coil);
    g.visible = false;
    scene.add(g);
    sigils.push({ g, ring, crest, runes, coil, blades, life: 0, kind: 'undertow' });
  }

  /**
   * Falling decrees — a shard and the mark it is falling on.
   *
   * A meteor needs a fuse, so it cannot be a sigil: this is a separate pair of
   * meshes that live for exactly as long as the fuse the sheet asked for. Both
   * are parked hidden and reused, like the sigils.
   */
  const meteors = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 6), mat('#ffffff', 0.95));
    shard.rotation.x = Math.PI;
    const mark = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 32), mat('#ffffff', 0.85));
    mark.rotation.x = Math.PI / 2;
    g.add(shard, mark);
    g.visible = false;
    scene.add(g);
    meteors.push({ g, shard, mark, life: 0, total: 1, top: 0, ground: 0, x: 0, z: 0, ring: 1, color: '#ffffff' });
  }

  /**
   * Release a falling shard onto a mark. `fuse` is the sheet's, so the player
   * reads the same number the damage is timed on.
   */
  function meteor(pos, color = '#9fe8ff', fuse = 1.6, ring = 4) {
    if (!usable(pos)) return;
    const m = meteors.find((x) => x.life <= 0) || meteors[0];
    m.total = Math.max(0.2, fuse);
    m.life = m.total;
    m.x = pos.x;
    m.z = pos.z;
    m.ground = pos.y;
    m.top = pos.y + 16;
    m.ring = Math.max(0.5, ring);
    m.color = color;
    m.g.visible = true;
    m.g.position.set(pos.x, pos.y, pos.z);
    m.shard.position.y = m.top - m.ground;
    m.shard.material.color.set(color);
    m.mark.material.color.set(color);
    m.mark.scale.setScalar(m.ring * 1.4);
  }

  function grab(pool) {
    return pool.find((p) => p.life <= 0) || pool[0];
  }

  /**
   * Reject non-finite positions before they reach the scene graph.
   *
   * A NaN in a particle transform is not visible in any log or test. It just
   * makes the mesh rasterise as a large black rectangle floating in the sky,
   * which looks like a broken map rather than a broken effect. The upstream
   * cause is always a one-off arithmetic slip, so the guard lives here where
   * every effect funnels through — cheap, and it cannot be forgotten.
   */
  const usable = (v) => !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

  function burst(pos, color, n = 10, speed = 4) {
    if (!usable(pos)) return;
    for (let i = 0; i < n; i++) {
      const s = grab(sparks);
      s.life = 0.35 + Math.random() * 0.25;
      s.m.visible = true;
      s.m.position.copy(pos);
      s.m.material.color.set(color);
      s.m.material.opacity = 1;
      s.vel.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
    }
  }

  function hearts(pos) {
    if (!usable(pos)) return;
    burst(pos, '#ff4f9a', 8, 3);
    const b = grab(bits);
    b.life = 0.6;
    b.m.visible = true;
    b.m.position.copy(pos);
    b.m.material.color.set('#ff4f9a');
    b.vel.set(0, 2.2, 0);
  }

  function tracer(a, b, color = '#ffe6f6') {
    if (!usable(a) || !usable(b)) return;
    const line = grab(lines);
    line.life = 0.08;
    line.m.visible = true;
    line.m.material.color.set(color);
    line.m.material.opacity = 0.9;
    const d = new THREE.Vector3().subVectors(b, a);
    const len = Math.max(0.05, d.length());
    line.m.position.copy(a).addScaledVector(d, 0.5);
    // lookAt is undefined when the eye and the target coincide, which fills the
    // matrix with NaN. Nudge a coincident tracer along the shot instead.
    if (len <= 0.05) line.m.position.addScaledVector(d, 0);
    else line.m.lookAt(b);
    line.m.scale.set(1, 1, len);
  }

  function muzzle(pos, color = '#fff6fb') {
    if (!usable(pos)) return;
    flash.position.copy(pos);
    flash.color.set(color);
    flash.intensity = 8;
    flashT = 0.04;
    burst(pos, color, 4, 2);
  }

  function confetti(origin) {
    if (!usable(origin)) return;
    for (let i = 0; i < 24; i++) {
      const b = grab(bits);
      b.life = 1.4;
      b.m.visible = true;
      b.m.position.copy(origin);
      b.m.material.color.set(['#ff4f9a', '#7dfff0', '#ffe566', '#c46bff'][i % 4]);
      b.vel.set((Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6);
    }
  }

  /**
   * ROYAL DECREE: the sigil every candidate's decree opens with.
   *
   * `color` comes from the caster's own palette chip, so the same call paints
   * Candidate A aquamarine and Candidate B amber without a branch here. Yaw is
   * the caster's facing: the ring is drawn across it, so the sigil sits behind
   * her rather than in her eyeline.
   *
   * `kind` changes how the blades behave, never how the sigil is built: one
   * pool, one set of meshes, and the shape of the decree is data. An undertow
   * coils its blades inward, a gale throws them outward, a cascade spins them
   * tight and fast, and a hunger pulls the whole ring in on itself.
   */
  const SIGIL_BEHAVIOUR = {
    undertow: { spin: 3.1, blades: 0.55, reach: 0.45, open: 6 },
    burst: { spin: 2.2, blades: 0.7, reach: 1.05, open: 9 },
    gale: { spin: 4.4, blades: 0.4, reach: 1.5, open: 7 },
    chain: { spin: 6.2, blades: 0.5, reach: 0.7, open: 12 },
    drain: { spin: 1.6, blades: 0.5, reach: 0.95, open: 5 },
  };

  function decree(pos, yaw = 0, color = '#4fe3d0', kind = 'undertow') {
    if (!usable(pos)) return;
    const s = sigils.find((x) => x.life <= 0) || sigils[0];
    s.life = SIGIL_LIFE;
    s.kind = SIGIL_BEHAVIOUR[kind] ? kind : 'undertow';
    s.g.visible = true;
    s.g.position.set(pos.x, pos.y + 1.15, pos.z);
    s.g.rotation.set(0, yaw, 0);
    s.g.scale.setScalar(0.3);
    s.ring.material.color.set(color);
    for (const bl of s.blades) bl.material.color.set(color);
    burst(new THREE.Vector3(pos.x, pos.y + 1.2, pos.z), color, 16, 5);
    burst(new THREE.Vector3(pos.x, pos.y + 1.7, pos.z), '#f2ece4', 8, 3);
  }

  /* ------------------------------------------------------------------ *
   * Impact rings and floating damage numbers
   *
   * A tracer and a spark burst tell you a shot went *somewhere*. Neither tells
   * you what it did. On the range that is the entire question — the whole point
   * of the place is reading a damage number off a target — and without a number
   * at the impact point the tester has to look away at the instrument panel,
   * which is the one thing that breaks the rhythm of shooting.
   *
   * Both pools are built once and reused. The number textures are rasterised
   * once per distinct string and cached, because the set of values a gun can
   * produce is small and bounded — redrawing a canvas per hit would be the
   * single most expensive thing in the frame.
   * ------------------------------------------------------------------ */

  const RING_POOL = 8;
  const rings = [];
  for (let i = 0; i < RING_POOL; i++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.3, 28),
      new THREE.MeshBasicMaterial({
        color: '#ffffff', transparent: true, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    m.visible = false;
    scene.add(m);
    rings.push({ m, life: 0, total: 0.32 });
  }

  const NUM_POOL = 14;
  const numbers = [];
  for (let i = 0; i < NUM_POOL; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false,
    }));
    s.visible = false;
    s.renderOrder = 20;
    scene.add(s);
    numbers.push({ s, life: 0, vy: 0, drift: 0 });
  }

  /** Rasterised text -> texture, memoised. Bounded so a long session cannot leak. */
  const numCache = new Map();
  const NUM_CACHE_MAX = 96;

  /**
   * Whether this environment can actually rasterise a damage number.
   *
   * The headless test harness runs the real match against a stub `document`
   * whose `createElement` returns an object that is shaped like a canvas and is
   * not one. A `typeof` check is not enough — the stub has the method — so the
   * capability is proven by *asking it for a context* and checking the result is
   * a real 2D context, and the whole build is wrapped anyway.
   *
   * The numbers are feedback, not simulation. A range that asserts its damage
   * maths and then throws on the feedback layer is strictly worse than a range
   * with no numbers at all, so the correct answer to "this environment cannot
   * draw text" is "draw nothing" rather than "take the match down with you".
   */
  const canRasterise = (() => {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false;
    try {
      const probe = document.createElement('canvas');
      const c = probe.getContext('2d');
      return !!(c && typeof c.measureText === 'function' && c.measureText('0').width >= 0);
    } catch {
      return false;
    }
  })();

  function numberTexture(text, color) {
    if (!canRasterise) return null;
    try {
      return buildNumberTexture(text, color);
    } catch (e) {
      // One bad raster must not poison the cache or the frame.
      console.error('damage number texture failed', e);
      return null;
    }
  }

  function buildNumberTexture(text, color) {
    const key = `${color}|${text}`;
    if (numCache.has(key)) return numCache.get(key);
    const pad = 8;
    const fontPx = 64;
    const canvas = document.createElement('canvas');
    const probe = canvas.getContext('2d');
    probe.font = `700 ${fontPx}px Outfit, "Trebuchet MS", sans-serif`;
    const w = Math.max(16, Math.ceil(probe.measureText(text).width) + pad * 2);
    const h = fontPx + pad * 2;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.font = `700 ${fontPx}px Outfit, "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // A hard dark outline rather than a soft shadow: the number has to stay
    // legible against a bright neon target *and* against the dark sky, and one
    // hard stroke does that where a blur would just read as dirt.
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(6,2,12,0.92)';
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    if (numCache.size >= NUM_CACHE_MAX) {
      const oldest = numCache.keys().next().value;
      const dead = numCache.get(oldest);
      if (dead) dead.dispose();
      numCache.delete(oldest);
    }
    numCache.set(key, tex);
    return tex;
  }

  /**
   * An expanding ring at an impact point.
   *
   * `flat` lays it on the ground (a shot that hit dirt) rather than standing it
   * up to face the shooter (a shot that hit a body). The two are visually very
   * different events, and conflating them is a large part of why "did that hit
   * or miss" was hard to read at a glance.
   */
  function ring(pos, color = '#ff4f9a', flat = false) {
    if (!usable(pos)) return;
    const r = grab(rings);
    r.life = r.total;
    r.m.visible = true;
    r.m.position.copy(pos);
    r.m.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    r.m.material.color.set(color);
    r.m.material.opacity = 1;
    r.m.scale.setScalar(0.35);
  }

  /**
   * A damage number that rises off the impact and fades.
   *
   * Sprite-based with `sizeAttenuation: false`, so it keeps a constant on-screen
   * size no matter how far away the target is — a 100m hit has to be as readable
   * as a 10m one, and that is exactly the case a perspective sprite gets wrong.
   */
  function number(pos, value, color = '#ffffff') {
    if (!usable(pos) || !canRasterise) return;
    const tex = numberTexture(value, color);
    if (!tex) return;
    const n = grab(numbers);
    n.life = 0.95;
    n.vy = 1.5;
    n.drift = (Math.random() - 0.5) * 0.35;
    n.s.visible = true;
    n.s.material.map = tex;
    n.s.material.needsUpdate = true;
    n.s.position.copy(pos);
    n.s.scale.set(0.11, 0.11, 1);
  }

  function updateNumbers(dt) {
    for (const r of rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const u = 1 - Math.max(0, r.life) / r.total;
      // Ease-out expansion: a ring that grows linearly reads as a scaling ball.
      r.m.scale.setScalar(0.35 + (1 - (1 - u) * (1 - u)) * 1.5);
      r.m.material.opacity = Math.max(0, 1 - u) * 0.9;
      if (r.life <= 0) r.m.visible = false;
    }
    for (const n of numbers) {
      if (n.life <= 0) continue;
      n.life -= dt;
      n.vy -= 2.2 * dt;
      n.s.position.y += n.vy * dt;
      n.s.position.x += n.drift * dt;
      // Pop in over the first 15% of the life, hold, then fade. A number that
      // fades in from nothing looks like it was never there.
      const u = 1 - Math.max(0, n.life) / 0.95;
      const pop = u < 0.15 ? 0.7 + (u / 0.15) * 0.42 : 1.12 - Math.min(0.12, (u - 0.15) * 0.9);
      n.s.scale.set(0.11 * pop, 0.11 * pop, 1);
      n.s.material.opacity = Math.max(0, Math.min(1, (1 - u) * 2.2));
      if (n.life <= 0) n.s.visible = false;
    }
  }

  function update(dt) {
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y -= 6 * dt;
      s.m.position.addScaledVector(s.vel, dt);
      s.m.material.opacity = Math.max(0, s.life * 2);
      if (s.life <= 0) s.m.visible = false;
    }
    for (const s of bits) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y -= 3 * dt;
      s.m.position.addScaledVector(s.vel, dt);
      s.m.rotation.y += dt * 4;
      s.m.material.opacity = Math.max(0, s.life);
      if (s.life <= 0) s.m.visible = false;
    }
    for (const s of lines) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.m.material.opacity = Math.max(0, s.life * 10);
      if (s.life <= 0) s.m.visible = false;
    }
    for (const s of sigils) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const b = SIGIL_BEHAVIOUR[s.kind] || SIGIL_BEHAVIOUR.undertow;
      const u = 1 - Math.max(0, s.life) / SIGIL_LIFE; // 0 opens, 1 spent
      const open = Math.min(1, u * b.open);
      const fade = Math.max(0, Math.min(1, s.life / (SIGIL_LIFE * 0.5)));
      s.g.scale.setScalar(0.3 + open * 1.5 - u * 0.35);
      s.ring.rotation.z -= dt * 0.9;
      s.crest.rotation.z += dt * 0.5;
      s.runes.rotation.z += dt * 0.7;
      s.coil.rotation.y += dt * b.spin;
      s.ring.material.opacity = 0.9 * fade;
      s.crest.material.opacity = 0.8 * fade;
      for (const bl of s.blades) {
        const a = u * 5.2 + bl.userData.i * (Math.PI * 2 / 6);
        // `reach` is how far the blades travel over the sigil's life: a gale
        // throws them wide, an undertow keeps them folded in.
        const r = b.blades + b.reach * Math.sin(u * Math.PI);
        bl.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.18);
        bl.rotation.z = a;
        bl.rotation.x = Math.sin(a) * 0.8;
        bl.material.opacity = 0.9 * fade;
      }
      if (s.life <= 0) s.g.visible = false;
    }
    for (const m of meteors) {
      if (m.life <= 0) continue;
      m.life -= dt;
      const u = 1 - Math.max(0, m.life) / m.total; // 0 released, 1 landed
      // A straight fall would read as a sliding box, so the shard is tipped
      // nose-down and spins as it drops.
      m.shard.position.y = m.top - (m.top - m.ground) * (u * u);
      m.shard.rotation.y += dt * 6;
      m.shard.material.opacity = 0.95;
      m.mark.rotation.z += dt * 1.6;
      m.mark.material.opacity = 0.85 * (0.35 + 0.65 * u);
      m.mark.scale.setScalar(m.ring * (1.4 - 0.4 * u));
      if (m.life <= 0) {
        m.g.visible = false;
        burst(new THREE.Vector3(m.x, m.ground + 0.2, m.z), m.color, 22, 7);
      }
    }
    if (flashT > 0) {
      flashT -= dt;
      flash.intensity = Math.max(0, flashT * 160);
    } else flash.intensity = 0;
    updateNumbers(dt);
  }

  return { burst, hearts, tracer, muzzle, confetti, decree, meteor, ring, number, update };
}
