# Bikini Royale

A browser battle royale built on [three.js](https://threejs.org). Drop from the
ship, loot the island, fight 43 rivals, win the royale. Ships with a precision
shooting range for tuning gun feel.

```bash
npm install
npm start          # http://localhost:5173
```

Click **Play** for the island. Click **Range** from the menu for the shooting
range, which arms every gun with infinite ammo and publishes the real falloff
numbers to an instrument panel.

## Controls

| | |
|---|---|
| Move | `WASD` · sprint `Shift` |
| Look | mouse (click to lock) · gamepad supported |
| Fire | left mouse · aim/zoom right mouse |
| Jump / glide | `Space` (hold while dropping to open the chute) |
| Crouch / slide | `Ctrl` |
| Reload | `R` |
| Interact / pick up | `E` |
| Melee | `Q` |
| Ability | `Z` |
| Dash | `F` |
| Use item | `C` |
| Swap weapon | `X` or `1`–`3` |
| Inspect | `V` |
| Emote | `G` |
| Reset the range score | `Tab` (range only) |

All of these are rebindable in Settings.

Landing on the island starts you with **no weapon and no ammo** - finding a gun
is the first thing the game asks you to do. Guns are picked up with `E` while
looking at them; they are not collected by walking over them.

## Layout

```
src/
  main.js            app bootstrap, frame loop, debug hooks
  game/
    match.js         the whole simulation: drop, combat, bots, zone, loot
    weapons.js       gun/melee/item tables, damage falloff
    bots.js          rival AI
    collision.js     ray/box/height helpers
  world/
    map.js           the island: terrain, city, loot anchors, sea
    graybox.js       the shooting range
  avatar/            character rigs, viewmodel, weapon meshes
  data/              asset manifest, catalogs, candidates
  vfx/               tracers, muzzle flashes, damage numbers
  ui/                menus, HUD, settings
test/                headless test suite (node, no browser)
tools/               browser probes: render harnesses and diagnostics
```

## Tests

```bash
npm test             # frame, kit, rig, candidates, smoke
npm run test:assets  # audits weapon GLBs for NaN geometry
```

`npm test` runs entirely in node against a stubbed DOM, so it is fast and needs
no browser. The smoke test drives a real graybox match: it fires on the very
first frame after the world builds, because that is the one frame where the
camera rig has not been placed yet and a shot would leave from the wrong place.

## Probes

The probes drive a real browser against a running dev server. Start the server
first, then:

```bash
npm start                                  # in one terminal
npm run probe:island                       # full match: lobby -> bus -> drop -> loot -> shoot
npm run probe:gameplay -- 5173             # island screenshot + viewmodel check
npm run probe:recoil                       # per-gun recoil, measured not assumed
```

`probe:island` is the one that matters for "is the game actually playable". It
fast-forwards the sim clock rather than waiting on it, so the whole drop path
runs in seconds instead of the ten minutes it takes under SwiftShader.

## Assets

Runtime assets live in `public/assets/` and are tracked with
[Git LFS](https://git-lfs.github.com) - a couple of the character models are
over 100 MB, which is past GitHub's hard per-file limit for ordinary blobs.

```
git lfs install
git lfs pull
```

`character design/` and `weapons/` are 2 GB of art source and are **not**
tracked. They are not needed to build or run the game.

## Licence

Third-party art assets (Nikke, Genshin, Wuthering Waves, NIKKE, and other
franchise models) are included for personal, non-commercial use only. They
remain the property of their respective publishers. No affiliation or
endorsement.
