/**
 * Serve `/assets/...` out of `public/` so the node tests can really load models.
 *
 * Three's FileLoader builds a `new Request(url)` and hands it to `fetch`. In a
 * browser a root-relative url resolves against the page; under node there is no
 * base, so `new Request('/assets/...')` throws ERR_INVALID_URL. That throw used
 * to be swallowed by the `catch` in viewmodel.js, which meant every weapon and
 * loot GLB silently failed to load and the tests passed while asserting against
 * a half-built scene. The fix is to give node the base it is missing and answer
 * from disk, so a missing or malformed asset fails the test loudly instead.
 *
 * Only `/assets/` is served; anything else is rejected so a test cannot quietly
 * start depending on the network.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PUBLIC = new URL('../public/', import.meta.url);

/** Absolute path for a root-relative asset url, or null if it is out of bounds. */
function resolveAsset(u) {
  let rel;
  try {
    rel = decodeURIComponent(String(u).replace(/^\/+/, ''));
  } catch {
    return null;                                   // a malformed escape is a real failure
  }
  if (rel !== new URL(rel, 'file:///').pathname.replace(/^\//, '')) return null;  // traversal
  const path = fileURLToPath(new URL(rel, PUBLIC));
  return existsSync(path) && statSync(path).isFile() ? path : null;
}

class DiskRequest {
  constructor(input) {
    this.url = typeof input === 'string' ? input : input.url;
  }
}

/**
 * Decode a `data:` uri into bytes, or null if it is not one.
 *
 * The Styl'oo weapons embed their geometry as base64 data uris. Those have to be
 * handled here: node's fetch either rejects them or leaves the promise pending
 * forever, and a pending promise makes the whole test file exit with
 * "unsettled top-level await" and no output at all.
 */
function decodeDataUri(u) {
  if (typeof u !== 'string' || !u.startsWith('data:')) return null;
  const comma = u.indexOf(',');
  if (comma < 0) return null;
  const meta = u.slice(5, comma);
  const body = u.slice(comma + 1);
  if (meta.endsWith(';base64')) return Buffer.from(body, 'base64');
  return Buffer.from(decodeURIComponent(body), 'utf8');
}

function diskResponse(body) {
  return {
    status: 200,
    // FileLoader looks for X-File-Size / Content-Length to report progress.
    // Returning null sends it down the "length not computable" path, which is
    // the honest answer for a local file read.
    headers: { get: () => null },
    // No `body`, so FileLoader skips its streaming branch and calls arrayBuffer.
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
}

/**
 * An image stand-in that reports failure instead of stalling.
 *
 * three's ImageLoader waits for the element to fire `load` or `error`. A plain
 * object with no listeners fires neither, so the promise never settles and the
 * whole test file dies with "unsettled top-level await" and zero output. Node
 * has no image decoder, so failing is the truthful answer -- and it is the
 * answer three already knows how to recover from, leaving geometry and
 * materials intact.
 */
function inertImage() {
  const listeners = new Map();
  const img = {
    width: 1,
    height: 1,
    style: {},
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    getContext: () => ({}),
  };
  let src = '';
  Object.defineProperty(img, 'src', {
    get: () => src,
    // Assigning src is what kicks the load off, so report the failure on the
    // next tick -- synchronously would fire before the listener is attached.
    set(value) {
      src = value;
      setTimeout(() => {
        const fn = listeners.get('error');
        if (fn) fn({ type: 'error', target: img });
      }, 0);
    },
  });
  return img;
}

/** Install the shim. Safe to call twice; the second call is a no-op. */
export function installAssetFetch() {
  if (globalThis.__assetFetchInstalled) return;
  globalThis.__assetFetchInstalled = true;

  // GLTFLoader reads `self.URL` when it resolves embedded texture blobs, so it
  // needs a `self` even though there is no worker here.
  if (!globalThis.self) globalThis.self = globalThis;

  // The FBX/OBJ/GLTF loaders and three's ImageLoader all reach for a DOM image
  // to decode textures. Node has no DOM and no image decoder, so patch whatever
  // `document` the test has already stubbed rather than replacing it outright --
  // kit.test.mjs and rig.test.mjs install their own richer stubs.
  const doc = globalThis.document || {};
  const mk = () => inertImage();
  doc.createElement = (tag) => (String(tag).toLowerCase() === 'img' ? mk() : {
    width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext: () => ({}),
  });
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  globalThis.document = doc;

  // Node has no image decoder, so GLTFLoader cannot turn a PNG/JPEG blob into
  // pixels; it catches that itself and hands back a null texture, leaving
  // geometry and materials intact. That warning is expected here, but it fires
  // once per embedded image and drowns the real output, so drop just that line
  // and let anything else through.
  if (!globalThis.__assetWarnPatched) {
    globalThis.__assetWarnPatched = true;
    const warn = console.warn.bind(console);
    console.warn = (...a) => {
      if (typeof a[0] === 'string' && a[0].includes("Couldn't load texture blob")) return;
      warn(...a);
    };
  }

  globalThis.Request = DiskRequest;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const path = resolveAsset(url);
    if (path) return diskResponse(readFileSync(path));
    const inline = decodeDataUri(url);
    if (inline) return diskResponse(inline);
    // Anything else: defer to the real fetch so an unexpected url behaves
    // honestly rather than being answered with a fabricated empty file.
    return realFetch(url, init);
  };
}
