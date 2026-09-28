/**
 * Probe the colours in a rendered screenshot.
 *
 * "The map looks purple" is not actionable. This decodes the PNG and reports
 * the average RGB at named points, with a hue bucket, so colour problems get
 * a number and a regression gets caught instead of argued about.
 *
 *   node tools/probe-png.mjs shot-play-skyline.png [more.png ...]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

/** Decode a PNG (8-bit) and return an image with at()/avg() accessors. */
function readPng(file) {
  const b = fs.readFileSync(file);
  let p = 8;
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`${file}: unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`${file}: unsupported colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const up = prev[i];
      const ul = i >= channels ? prev[i - channels] : 0;
      const x = line[i];
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + up;
      else if (filter === 3) v = x + ((a + up) >> 1);
      else {
        const pa = Math.abs(up - ul);
        const pb = Math.abs(a - ul);
        const pc = Math.abs(a + up - 2 * ul);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul);
      }
      cur[i] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }

  return {
    w,
    h,
    at(x, y) {
      const i = y * stride + x * channels;
      return [out[i], out[i + 1], out[i + 2]];
    },
    /** Mean colour over a box — averages away HUD text and aliasing. */
    avg(x, y, r = 12) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let n = 0;
      for (let yy = Math.max(0, y - r); yy < Math.min(h, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx < Math.min(w, x + r); xx++) {
          const c = this.at(xx, yy);
          sr += c[0];
          sg += c[1];
          sb += c[2];
          n++;
        }
      }
      return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
    },
  };
}

function hueOf([r, g, b]) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  if (sat <= 0.08) return ['grey', sat];
  if (mx === r) return [b > g ? 'magenta/pink' : 'orange/red', sat];
  if (mx === g) return [r > b ? 'yellow/green' : 'green/cyan', sat];
  return [r > g ? 'purple' : 'cyan/blue', sat];
}

let worst = 0;
for (const file of process.argv.slice(2)) {
  const img = readPng(file);
  console.log(`\n${file}  ${img.w}x${img.h}`);
  const probes = [
    ['sky', 0.5, 0.02],
    ['sky left', 0.07, 0.12],
    ['horizon', 0.5, 0.3],
    ['midground', 0.5, 0.45],
    ['foreground', 0.5, 0.85],
    ['left low', 0.15, 0.75],
  ];
  for (const [name, fx, fy] of probes) {
    const x = Math.round(img.w * fx);
    const y = Math.round(img.h * fy);
    const c = img.avg(x, y);
    const [hue, sat] = hueOf(c);
    worst = Math.max(worst, sat);
    console.log(`  ${name.padEnd(10)} rgb(${c.map((v) => String(v).padStart(3)).join(',')})  ${hue.padEnd(14)} sat=${sat.toFixed(2)}`);
  }
}
console.log(`\nmost saturated probe: ${worst.toFixed(2)} (higher = more one-note)`);