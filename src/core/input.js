/** Named actions. Gameplay never reads raw keys. */

const GAMEPAD_DEAD = 0.18;

function radial(x, y, dead) {
  const m = Math.hypot(x, y);
  if (m < dead) return { x: 0, y: 0, m: 0 };
  const s = (m - dead) / (1 - dead);
  return { x: (x / m) * s, y: (y / m) * s, m: s };
}

export function createInput(getSettings) {
  const keys = new Set();
  const mouse = new Set();
  let wheel = 0;
  let dx = 0;
  let dy = 0;
  let pointerLocked = false;
  const gpWas = new Array(20).fill(0);
  let virtual = {
    moveX: 0, moveY: 0, lookX: 0, lookY: 0,
    fire: false, aim: false, jump: false, crouch: false, reload: false, use: false, melee: false,
    ability: false,
  };
  let lastDevice = 'keyboard';
  let capture = false;

  const onKeyDown = (e) => {
    if (e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    lastDevice = 'keyboard';
  };
  const onKeyUp = (e) => keys.delete(e.code);
  const onMouseDown = (e) => {
    mouse.add(e.button);
    lastDevice = 'keyboard';
  };
  const onMouseUp = (e) => mouse.delete(e.button);
  const onMove = (e) => {
    if (document.pointerLockElement || capture) {
      dx += e.movementX || 0;
      dy += e.movementY || 0;
      lastDevice = 'keyboard';
    }
  };
  const onWheel = (e) => {
    wheel += Math.sign(e.deltaY);
  };
  const onLockChange = () => {
    pointerLocked = document.pointerLockElement != null;
  };
  const onBlur = () => {
    keys.clear();
    mouse.clear();
    dx = 0;
    dy = 0;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('wheel', onWheel, { passive: true });
  document.addEventListener('pointerlockchange', onLockChange);
  window.addEventListener('blur', onBlur);

  const prev = {};

  function edge(name, held) {
    const was = !!prev[name];
    prev[name] = held;
    return held && !was;
  }

  function pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of pads) if (g) return g;
    return null;
  }

  function typing() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  function update(dt) {
    const settings = getSettings();
    const g = pad();
    const typeLock = typing();
    const b = settings.bindings;

    let moveX = 0;
    let moveY = 0;
    let lookX = 0;
    let lookY = 0;
    let fire = false;
    let aim = false;
    let jump = false;
    let crouch = false;
    let sprint = false;
    let reload = false;
    let interact = false;
    let melee = false;
    let ability = false;
    let dash = false;
    let use = false;
    let swap = false;
    let inspect = false;
    let emote = false;
    let score = false;
    let pause = false;
    let confirm = false;
    let back = false;
    let uiX = 0;
    let uiY = 0;

    if (!typeLock) {
      const left = keys.has('KeyA') || keys.has('ArrowLeft');
      const right = keys.has('KeyD') || keys.has('ArrowRight');
      const forward = keys.has('KeyW') || keys.has('ArrowUp');
      const backK = keys.has('KeyS') || keys.has('ArrowDown');
      moveX += (right ? 1 : 0) - (left ? 1 : 0);
      moveY += (forward ? 1 : 0) - (backK ? 1 : 0);
      fire = mouse.has(0);
      aim = mouse.has(2);
      jump = keys.has(b.jump);
      crouch = keys.has(b.crouch);
      sprint = keys.has(b.sprint);
      reload = keys.has(b.reload);
      interact = keys.has(b.interact);
      melee = keys.has(b.melee);
      ability = keys.has(b.ability);
      dash = keys.has(b.dash);
      use = keys.has(b.use);
      swap = keys.has(b.swap);
      inspect = keys.has(b.inspect);
      emote = keys.has(b.emote);
      score = keys.has(b.score);
      pause = keys.has('Escape');
      confirm = keys.has('Enter');
      back = keys.has('Escape');
      if (keys.has('ArrowLeft')) uiX -= 1;
      if (keys.has('ArrowRight')) uiX += 1;
      if (keys.has('ArrowUp')) uiY -= 1;
      if (keys.has('ArrowDown')) uiY += 1;
      }

    const sens = settings.mouse ?? 0.0022;
    const invert = settings.invert ? -1 : 1;
    lookX += dx * sens;
    lookY += dy * sens * invert;
    dx = 0;
    dy = 0;

    if (wheel) {
      swap = true;
      wheel = 0;
    }

    let lt = 0;
    let rt = 0;
    let itemPrev = false;
    let itemNext = false;
    if (g) {
      lastDevice = 'gamepad';
      const mv = radial(g.axes[0] || 0, g.axes[1] || 0, GAMEPAD_DEAD);
      moveX += mv.x;
      moveY += -mv.y;
      const rsx = g.axes[2] || 0;
      const rsy = g.axes[3] || 0;
      const lk = radial(rsx, rsy, 0.12);
      const lookSpeed = (settings.gamepad ?? 2.6) * (dt || 0.016);
      const curve = Math.pow(lk.m, 1.35);
      if (lk.m > 0) {
        lookX += (lk.x / lk.m) * curve * lookSpeed;
        lookY += (settings.invert ? -1 : 1) * (lk.y / lk.m) * curve * lookSpeed;
      }
      const btn = (i) => (g.buttons[i] ? g.buttons[i].value || (g.buttons[i].pressed ? 1 : 0) : 0);
      const down = (i) => {
        const v = btn(i);
        const was = gpWas[i] || 0;
        gpWas[i] = v;
        return v > 0.5 && was <= 0.5;
      };
      const held = (i) => btn(i) > 0.5;
      lt = btn(6);
      rt = btn(7);
      if (rt > 0.45) fire = true;
      if (lt > 0.35) aim = true;
      if (held(0)) jump = true;
      if (held(1)) crouch = true;
      if (down(2)) { interact = true; reload = true; }
      if (down(3)) swap = true;
      if (down(4)) melee = true;
      if (down(5)) dash = true;
      // Right-stick click is the only gamepad button the rest of the layout
      // leaves free, and a signature ability is exactly the kind of thing that
      // wants a deliberate, hard-to-hit-by-accident input.
      if (down(11)) ability = true;
      if (held(10)) sprint = true;
      if (down(8)) inspect = true;
      if (down(9)) pause = true;
      if (down(12)) { uiY -= 1; itemPrev = true; }
      if (down(13)) { uiY += 1; itemNext = true; }
      if (down(14)) { uiX -= 1; emote = true; }
      if (down(15)) { uiX += 1; use = true; }
      if (down(0)) confirm = true;
      if (down(1)) back = true;
      const dpadX = (held(15) ? 1 : 0) - (held(14) ? 1 : 0);
      const dpadY = (held(13) ? 1 : 0) - (held(12) ? 1 : 0);
      if (Math.abs(dpadX) + Math.abs(dpadY) === 0) {
        if (Math.abs(mv.x) > 0.65) uiX += Math.sign(mv.x);
        if (Math.abs(mv.y) > 0.65) uiY += Math.sign(mv.y);
      }
    } else {
      gpWas.fill(0);
    }

    moveX += virtual.moveX;
    moveY += virtual.moveY;
    lookX += virtual.lookX;
    lookY += virtual.lookY;
    virtual.lookX = 0;
    virtual.lookY = 0;
    if (virtual.fire) fire = true;
    if (virtual.aim) aim = true;
    if (virtual.jump) jump = true;
    if (virtual.crouch) crouch = true;
    if (virtual.reload) { reload = true; interact = true; }
    if (virtual.use) use = true;
    if (virtual.melee) melee = true;
    if (virtual.ability) ability = true;

    const mlen = Math.hypot(moveX, moveY);
    if (mlen > 1) { moveX /= mlen; moveY /= mlen; }

    const weaponSlot = !typeLock && keys.has('Digit1') ? 1 : !typeLock && keys.has('Digit2') ? 2 : !typeLock && keys.has('Digit3') ? 3 : 0;

    return {
      moveX, moveY, lookX, lookY,
      fire, aim,
      jumpHeld: jump,
      jumpPressed: edge('jump', jump),
      crouchHeld: crouch,
      crouchPressed: edge('crouch', crouch),
      sprint,
      reloadPressed: edge('reload', reload),
      interactPressed: edge('interact', interact),
      interactHeld: interact,
      meleePressed: edge('melee', melee),
      abilityPressed: edge('ability', ability),
      dashPressed: edge('dash', dash),
      usePressed: edge('use', use),
      swapPressed: edge('swap', swap),
      inspectPressed: edge('inspect', inspect),
      emotePressed: edge('emote', emote),
      scoreHeld: score,
      pausePressed: edge('pause', pause),
      confirmPressed: edge('confirm', confirm),
      backPressed: edge('back', back),
      uiLeft: edge('uiL', uiX < -0.5),
      uiRight: edge('uiR', uiX > 0.5),
      uiUp: edge('uiU', uiY < -0.5),
      uiDown: edge('uiD', uiY > 0.5),
      weaponSlot,
      itemPrev: edge('itemPrev', itemPrev),
      itemNext: edge('itemNext', itemNext),
      device: lastDevice,
      pointerLocked,
      lt, rt,
      typing: typeLock,
    };
  }

  return {
    update,
    setVirtual(next) { virtual = { ...virtual, ...next }; },
    setCapture(v) { capture = !!v; },
    addLook(x, y) { virtual.lookX += x; virtual.lookY += y; },
    device() { return lastDevice; },
  };
}
