global.browser = null;
process.on('exit', () => { if (global.browser) { try { global.browser.process().kill(); } catch { /* gone */ } } });

import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = process.argv[2] || '5180';

/**
 * Find a Chromium to drive.
 *
 * Do not hard-code Chrome. `puppeteer-core` launches no browser of its own, and
 * this probe originally passed `undefined` whenever the Chrome path was missing
 * -- which produced the unhelpful "An `executablePath` or `channel` must be
 * specified" abort rather than "no browser on this machine". Chrome also simply
 * disappears from a dev box often enough that a harness pinned to one install
 * path stops working for reasons that have nothing to do with the code under
 * test. Prefer whichever of the usual Chromium builds is actually present.
 */
function findChromium() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    process.env['ProgramFiles(x86)'] && `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  const hit = candidates.find((c) => c && fs.existsSync(c));
  if (!hit) throw new Error('no chromium browser found (tried Chrome, Brave, Edge)');
  return hit;
}

global.browser = await puppeteer.launch({
  executablePath: findChromium(),
  headless: 'shell',
  // One page.evaluate() that renders hundreds of SwiftShader frames runs for
  // many minutes, and the default 180s protocol timeout kills it mid-sweep and
  // throws away all the work. The probe is legitimately slow, so say so.
  protocolTimeout: 1800000,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // Small on purpose. This probe is fill-rate bound, not geometry bound, and
    // 800x600 SwiftShader frames took ~40s each -- a 334-child sweep was going to
    // take hours. A 128x96 framebuffer answers the same question far faster, and
    // "is this subtree painting the frame black" does not need pixels to tell it
    // apart from its neighbour.
    '--window-size=128,96',
  ],
});

const page = await global.browser.newPage();
await page.setViewport({ width: 128, height: 96 });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

const click = (a) => page.evaluate((x) => {
  const b = document.querySelector(`[data-action="${x}"]`);
  if (b) b.click();
  return !!b;
}, a);

// splash -> menu -> match -> play. This mirrors render.mjs deliberately: an
// earlier version skipped the drop the instant it saw 'bus' and polled only 40s,
// and it silently never reached the island at all -- the probe went on to report
// a confident diagnosis of the *lobby deck* while claiming to audit the city.
// Assert the phase instead of assuming it.
const phase = () => page.evaluate(() => (window.__brDiag ? window.__brDiag() : null));
await click('boot');
await new Promise((r) => setTimeout(r, 800));
await click('play');
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const p = await phase();
  if (p && (p.phase === 'bus' || p.phase === 'play')) break;
}
if (await page.evaluate(() => (window.__brDiag() || {}).phase) !== 'play') {
  await new Promise((r) => setTimeout(r, 4000));
  await page.evaluate(() => { if (window.__brSkipBus) window.__brSkipBus(); });
}
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const p = await phase();
  if (p && p.phase === 'play' && i > 2) break;
}

const where = await page.evaluate(() => {
  const d = (window.__brDiag && window.__brDiag()) || {};
  const p = d.player || {};
  // debugState() publishes px/py/pz, not x/y/z.
  return { phase: d.phase, screen: d.screen, px: p.px, py: p.py, pz: p.pz };
});
if (where.phase !== 'play') {
  console.error(`ABORT: expected phase "play", got "${where.phase}" -- the view below would be the wrong place entirely.`);
  process.exit(3);
}
console.error(`in play at (${where.px}, ${where.py}, ${where.pz})`);

/**
 * Which meshes are dark and/or big enough to be the offending slab?
 *
 * Read the scene graph, do not render it. Every fact this question needs --
 * material type, base colour, whether a map is attached, metalness, world-space
 * size -- is already sitting in the graph, and none of it needs a pixel.
 *
 * Two earlier attempts got this wrong in instructive ways. The raycast version
 * reported the player avatar, because the camera sits *inside* the hero mesh and
 * every crosshair ray hits it at distance 0; it still returned an object, so it
 * looked like it had worked. The framebuffer version hid one child at a time and
 * re-rendered, which is correct in principle and hopeless in practice: at 128x96
 * a SwiftShader frame is still ~15s, and 334 children is over an hour. On a
 * software rasteriser, the cheap question is the right question.
 *
 * A map is the other half of the trap. `material.color` multiplies the texture,
 * so a perfectly white base colour says nothing about how the surface will
 * actually look -- which is exactly why tinting downtown toward pink left it
 * brick red. Dark rows and textured rows are therefore reported separately,
 * because they have different fixes.
 */
const out = await page.evaluate(async () => {
  const scene = window.__brScene();
  if (!scene) return { err: 'no scene hook' };
  const THREE = await import('/node_modules/.vite/deps/three.js');

  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const rows = [];

  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.visible === false) return;
    box.setFromObject(o);
    if (box.isEmpty()) return;
    box.getSize(size);
    box.getCenter(centre);
    const span = Math.max(size.x, size.y, size.z);
    if (!(span > 2)) return; // too small to own a slab in a wide shot
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const col = m.color;
      const lum = col ? 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b : null;

      // A vertex-coloured surface is invisible to a `material.color` audit: the
      // ground is a Lambert material with a white base colour, and every bit of
      // its hue lives in the `color` attribute. That is precisely how a #6f7a99
      // plaza disc hid in plain sight while the probe insisted nothing large was
      // dark. Average the attribute so these rows are judged on what they draw.
      let vcol = null;
      let vlum = null;
      const ca = m.vertexColors ? o.geometry.attributes.color : null;
      if (ca && ca.count) {
        let r = 0, g = 0, b = 0;
        const n = Math.min(ca.count, 4096);
        for (let i = 0; i < n; i++) { r += ca.getX(i); g += ca.getY(i); b += ca.getZ(i); }
        const s = new THREE.Color(r / n, g / n, b / n);
        vcol = `#${s.getHexString()}`;
        vlum = +(0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b).toFixed(3);
      }

      rows.push({
        name: o.name || '',
        mat: m.type,
        color: col ? `#${col.getHexString()}` : null,
        map: !!m.map,
        lum: lum == null ? null : +lum.toFixed(3),
        vcol,
        vlum,
        metalness: 'metalness' in m ? m.metalness : null,
        roughness: 'roughness' in m ? m.roughness : null,
        transparent: !!m.transparent,
        side: m.side,
        span: +span.toFixed(1),
        size: [size.x, size.y, size.z].map((n) => +n.toFixed(1)),
        at: [centre.x, centre.y, centre.z].map((n) => +n.toFixed(1)),
      });
    }
  });

  // Judge a row on what it actually draws: the vertex colour when there is one,
  // otherwise the base colour. Keeping these separate would let every
  // vertex-coloured surface report as white and sail past the dark filter.
  const score = (r) => r.span * (r.vlum != null ? r.vlum : (r.lum == null ? 1 : r.lum));
  const darkLarge = rows
    .filter((r) => score(r) / r.span < 0.25 && r.span > 2)
    .sort((a, b) => score(b) - score(a)).slice(0, 12);
  // Big, wide and thin is a floor, roof or slab -- the shape that reads as a
  // hole in the world when its material is wrong.
  const bigFlat = rows.filter((r) => r.size[1] < r.span * 0.25 && r.span > 8).sort((a, b) => b.span - a.span).slice(0, 12);
  // Largest surface by drawn area, whatever its colour. The slab is defined by
  // size and flatness first; a mid-grey one still needs naming.
  const bigSurfaces = rows.sort((a, b) => (b.size[0] * b.size[2]) - (a.size[0] * a.size[2])).slice(0, 8);

  // For a dark mesh that still carries a map, report what that map actually is.
  // "is it black?" is the whole question, and answering it here beats guessing
  // from the filename.
  const withMap = [];
  for (const o of scene.children) {
    o.traverse((n) => {
      if (!n.isMesh || !n.material) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) {
        if (!m || !m.map) continue;
        const img = m.map.image;
        let maxLum = null;
        if (img && img.width) {
          const N = 4;
          const cv = document.createElement('canvas');
          cv.width = N; cv.height = N;
          const cx = cv.getContext('2d');
          try {
            cx.drawImage(img, 0, 0, N, N);
            const d = cx.getImageData(0, 0, N, N).data;
            let mx = 0;
            for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i], d[i + 1], d[i + 2]);
            maxLum = mx;
          } catch (e) { maxLum = 'tainted'; }
        }
        withMap.push({
          name: n.name || '',
          imgTag: img ? (img.tagName || img.constructor.name) : 'none',
          w: img ? img.width : null,
          h: img ? img.height : null,
          complete: img ? !!img.complete : null,
          src: img && img.src ? String(img.src).split('/').slice(-2).join('/') : null,
          maxChannel: maxLum,
          color: m.color ? `#${m.color.getHexString()}` : null,
        });
        break; // one row per mesh is enough
      }
    });
  }

  return {
    meshes: rows.length,
    darkLarge,
    bigFlat,
    bigSurfaces,
    // Everything sitting over downtown, regardless of size or colour. The slab
    // in the city centre did not qualify for any size- or darkness-based filter
    // above, so naming the whole neighbourhood is the only way to catch a mesh
    // that is large enough to own a third of the frame but reports unremarkable.
    downtown: rows
      .filter((r) => Math.hypot(r.at[0], r.at[2]) < 34 && r.at[1] > -2 && r.at[1] < 30)
      .sort((a, b) => (b.size[0] * b.size[2]) - (a.size[0] * a.size[2]))
      .slice(0, 20),
    withMap: withMap.slice(0, 10),
    withMapTotal: withMap.length,
  };
});

process.stdout.write(`${JSON.stringify({ out }, null, 1)}\n`);

/**
 * What is actually under those pixels?
 *
 * The scene audit above answers "what is dark and big". It cannot answer "what
 * is the grey slab in the middle of the frame", because that object may be
 * perfectly ordinary in every property the audit measures -- and in this case it
 * was: nothing downtown was dark, and nothing downtown was large and flat. The
 * remaining suspect is a *shadow* or a compositing effect, neither of which is a
 * mesh at all, so no amount of walking the scene graph will find it.
 *
 * Raycasting from the free camera is the way to settle it. The earlier raycast
 * attempt was invalid because it used the player camera, which sits inside the
 * hero mesh, so every ray hit the avatar at distance 0. __brFreeCam parks a
 * detached camera at the exact inspection pose, so a ray from it means what it
 * says. Sample a grid and tally what the centre of the frame is actually
 * resting on.
 */
// Park the camera at the same pose the harness used for `fix-check-plaza.png`,
// then let a real frame run so the override is actually applied. Raycasting with
// the player camera instead would hit the avatar at distance 0, which is how the
// first version of this probe confidently named the wrong object.
const VIEWS = {
  plaza: { eye: [0, 10, 23], target: [0, 2.5, 0] },
  overview: { eye: [0, 51, 59], target: [0, 1, 0] },
  // No override at all: the live player camera, exactly as a person sees it.
  // Every other view is a pose this tool invented, and diagnosing "the game
  // looks wrong" from an invented pose is how a wall two units from the lens got
  // mistaken for a map defect. This is the only view that answers the question
  // a player is actually asking.
  player: null,
};
const which = process.argv[3] || 'plaza';
const view = which in VIEWS ? VIEWS[which] : VIEWS.plaza;
await page.evaluate((v) => window.__brFreeCam(v ? v.eye : null, v ? v.target : null), view);
await new Promise((r) => setTimeout(r, 2500));
const slab = await page.evaluate(async (cfg) => {
  const scene = window.__brScene();
  if (!scene) return { error: 'no scene' };
  const THREE = await import('/node_modules/.vite/deps/three.js');

  // Use the game's own camera, not one built from scratch at the requested pose.
  // Two things make a from-scratch camera wrong here. `activeCamera()` returns
  // the real `camera`, which is a *child of pitchPivot* -- so its world
  // orientation comes from the pivot, and __brFreeCam's position/lookAt are
  // applied in the pivot's local space. And its fov is lerped toward the
  // player's setting every frame. Guessing either put the probe's camera
  // somewhere the game never renders from, and it duly reported a wall filling
  // the entire frame while the screenshot showed a whole city.
  // The free-cam override mutates this same object each frame, so after a frame
  // has run, its world matrix *is* the view the harness photographs.
  const cam = window.__brCamera();
  cam.updateMatrixWorld(true);

  const rc = new THREE.Raycaster();

  const tally = new Map();
  const GRID = [];
  for (let iy = 0; iy < 7; iy++) {
    for (let ix = 0; ix < 9; ix++) {
      GRID.push([(ix / 8) * 2 - 1, 1 - (iy / 6) * 2]);
    }
  }

  const samples = [];
  for (const [nx, ny] of GRID) {
    rc.setFromCamera({ x: nx, y: ny }, cam);
    const hits = rc.intersectObject(scene, true).filter((h) => h.object.visible && h.object.isMesh);
    if (!hits.length) { samples.push(null); continue; }
    // Skip the storm: it is a full-screen translucent box that every ray meets
    // first, and it is not what the eye is complaining about.
    const h = hits.find((k) => {
      const m = Array.isArray(k.object.material) ? k.object.material[0] : k.object.material;
      return m && m.color && m.color.getHexString() !== 'c45bff' && m.color.getHexString() !== 'ff4fd8';
    }) || hits[0];
    const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
    const key = `${h.object.name || '(unnamed)'} | ${m.type} | ${m.color ? '#' + m.color.getHexString() : '-'}`;
    tally.set(key, (tally.get(key) || 0) + 1);
    samples.push({
      ndc: [+nx.toFixed(2), +ny.toFixed(2)],
      name: h.object.name || '(unnamed)',
      mat: m.type,
      color: m.color ? '#' + m.color.getHexString() : null,
      map: !!m.map,
      dist: +h.distance.toFixed(1),
      point: [h.point.x, h.point.y, h.point.z].map((n) => +n.toFixed(1)),
    });
  }

  return {
    view: cfg.name,
    camera: [cam.position.x, cam.position.y, cam.position.z].map((n) => +n.toFixed(1)),
    ranked: [...tally.entries()].sort((a, b) => b[1] - a[1]),
    samples,
  };
}, { name: which, ...(view || {}) });

/**
 * Is the dark region a mesh, or is it the *lighting* on a correct mesh?
 *
 * The raycast already answered that: every sample in the middle of the frame
 * lands on a city facade whose material is the right pale pink and carries no
 * map. The pixels come out dark grey-purple anyway, so the material cannot be
 * the cause and recolouring it would achieve nothing. What is left is how that
 * surface is lit.
 *
 * This renders the pose twice from a camera we control -- once normally, once
 * with every shadow caster disabled -- and reads the centre pixel back out of
 * the framebuffer. `__brNoShadows` had only ever been sampled from the player's
 * camera in the lobby, which is why the harness's `-noshadow` shot looked fine
 * while downtown stayed dark: it was never pointed at the city.
 */
const lighting = await page.evaluate(async (cfg) => {
  const scene = window.__brScene();
  const renderer = window.__brRenderer();
  if (!scene || !renderer) return { error: 'no renderer' };
  const THREE = await import('/node_modules/.vite/deps/three.js');

  const cam = window.__brCamera();
  cam.updateMatrixWorld(true);
  // Report where the camera *actually* ended up in world space. If this differs
  // from the pose we asked for, the parent pivot moved it and every conclusion
  // drawn from it has to be rechecked.
  const wp = new THREE.Vector3();
  cam.getWorldPosition(wp);

  const W = 160, H = 120;

  // Render into an offscreen target, not the default framebuffer. Reading the
  // default framebuffer with readPixels outside the draw call returns cleared
  // black -- the first version of this probe reported #000000 with shadows on
  // AND off and looked, for one glorious moment, like a definitive result.
  // A render target is a real texture with a real framebuffer behind it.
  const rt = new THREE.WebGLRenderTarget(W, H);
  const buf = new Uint8Array(W * H * 4);

  // Sample the middle of the frame: that is the slab, in every inspection view.
  const at = (x, y) => {
    const i = (y * W + x) * 4;
    return [buf[i], buf[i + 1], buf[i + 2]];
  };
  const lum = (c) => +(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]).toFixed(1);
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

  const probe = () => {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    renderer.setRenderTarget(prev);
    const c = at(W >> 1, H >> 1);
    // A coarse grid as well as the centre. The slab covers a large contiguous
    // area, so one pixel can easily land on a lit rooftop next to it; five rows
    // of samples say whether the dark region is really uniform.
    const grid = [];
    for (let gy = 1; gy <= 5; gy++) {
      const row = [];
      for (let gx = 1; gx <= 5; gx++) {
        const x = Math.floor((gx / 6) * (W - 1));
        const y = Math.floor((1 - gy / 6) * (H - 1));
        row.push(hex(at(x, y)));
      }
      grid.push(row);
    }
    return { center: { hex: hex(c), rgb: c, lum: lum(c) }, grid };
  };

  const withShadows = probe();
  const casters = window.__brNoShadows();
  const withoutShadows = probe();
  rt.dispose();

  return {
    asked: cfg,
    actualWorldPos: [wp.x, wp.y, wp.z].map((n) => +n.toFixed(1)),
    fov: cam.fov,
    aspect: +(cam.aspect || 0).toFixed(3),
    size: [W, H],
    center: [W >> 1, H >> 1],
    withShadows,
    withoutShadows,
    castersDisabled: casters,
  };
}, { name: which, ...(view || {}) });

process.stdout.write(`\n--- LIGHTING ---\n${JSON.stringify(lighting, null, 1)}\n`);

process.stdout.write(`\n--- RAYCAST ---\n${JSON.stringify(slab, null, 1)}\n`);


