import fs from 'node:fs';
import zlib from 'node:zlib';

function decodeImageBytes(bytes) {
  let p = 8;
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (p < bytes.length) {
    const len = bytes.readUInt32BE(p);
    const type = bytes.toString('ascii', p + 4, p + 8);
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);
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
  return { w, h, channels, data: out };
}

/** Decode PNG bytes to { w, h, data } in RGBA order. */
export function decodePng(bytes) {
  const img = decodeImageBytes(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  const { w, h, channels, data } = img;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * channels;
    const d = i * 4;
    if (channels === 4) {
      rgba[d] = data[s]; rgba[d + 1] = data[s + 1]; rgba[d + 2] = data[s + 2]; rgba[d + 3] = data[s + 3];
    } else if (channels === 3) {
      rgba[d] = data[s]; rgba[d + 1] = data[s + 1]; rgba[d + 2] = data[s + 2]; rgba[d + 3] = 255;
    } else if (channels === 2) {
      rgba[d] = data[s]; rgba[d + 1] = data[s]; rgba[d + 2] = data[s]; rgba[d + 3] = data[s + 1];
    } else {
      rgba[d] = data[s]; rgba[d + 1] = data[s]; rgba[d + 2] = data[s]; rgba[d + 3] = 255;
    }
  }
  return { w, h, data: rgba };
}

function hex(v) {
  return '#' + [v[0], v[1], v[2]].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** Mean colour + luminance + dark fraction over a stride-sampled grid. */
export function meanOf(img, stride = 8) {
  let r = 0; let g = 0; let b = 0; let n = 0; let dark = 0;
  for (let y = 0; y < img.h; y += stride) {
    for (let x = 0; x < img.w; x += stride) {
      const i = (y * img.w + x) * 4;
      const px = [img.data[i], img.data[i + 1], img.data[i + 2]];
      r += px[0]; g += px[1]; b += px[2]; n++;
      if (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2] < 24) dark++;
    }
  }
  const mean = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  const lum = +((0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2]) / 255).toFixed(3);
  return { mean: hex(mean), lum, darkFrac: +(dark / n).toFixed(3) };
}
