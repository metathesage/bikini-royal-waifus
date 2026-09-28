/** Pure collision helpers. Positions are plain {x,y,z} or numbers. No Three.js. */

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return null;
  const thc = Math.sqrt(Math.max(0, r2 - d2));
  const t0 = tca - thc;
  const t1 = tca + thc;
  if (t1 < 0) return null;
  return t0 >= 0 ? t0 : t1;
}

export function rayAABB(ox, oy, oz, dx, dy, dz, box, maxT = 1e9) {
  let tmin = 0;
  let tmax = maxT;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [box.minX, box.minY, box.minZ];
  const mx = [box.maxX, box.maxY, box.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
      continue;
    }
    let t1 = (mn[i] - o[i]) / d[i];
    let t2 = (mx[i] - o[i]) / d[i];
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return null;
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}

export function pushOut(x, z, radius, feet, head, boxes) {
  for (let n = 0; n < boxes.length; n++) {
    const b = boxes[n];
    if (head < b.minY + 0.02 || feet > b.maxY - 0.05) continue;
    const cx = Math.max(b.minX, Math.min(b.maxX, x));
    const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
    let dx = x - cx;
    let dz = z - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 < 1e-8) {
      const left = x - b.minX;
      const right = b.maxX - x;
      const front = z - b.minZ;
      const back = b.maxZ - z;
      const m = Math.min(left, right, front, back);
      if (m === left) x = b.minX - radius - 0.001;
      else if (m === right) x = b.maxX + radius + 0.001;
      else if (m === front) z = b.minZ - radius - 0.001;
      else z = b.maxZ + radius + 0.001;
      continue;
    }
    const d = Math.sqrt(d2);
    const push = radius - d + 0.001;
    x += (dx / d) * push;
    z += (dz / d) * push;
  }
  return { x, z };
}

export function floorAt(x, z, radius, boxes, terrainY) {
  let y = terrainY;
  const inset = radius * 0.25;
  for (let n = 0; n < boxes.length; n++) {
    const b = boxes[n];
    if (x > b.minX - inset && x < b.maxX + inset && z > b.minZ - inset && z < b.maxZ + inset) {
      if (b.maxY > y) y = b.maxY;
    }
  }
  return y;
}

export function makeBox(cx, cy, cz, w, h, d, tag) {
  return {
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minY: cy - h / 2,
    maxY: cy + h / 2,
    minZ: cz - d / 2,
    maxZ: cz + d / 2,
    tag: tag || 'solid',
  };
}
