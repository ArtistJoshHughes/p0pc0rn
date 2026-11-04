// assets.js - the models the game draws besides the trolley: the grab arm, the trash, the spare battery, the set dressing. All are
// NVIDIA SimReady props (CC BY 4.0), converted for the phone (assets/props/; the credits are in README.md and on the start and end
// cards). Each has a placeholder built on the physics' own sizes, drawn at once; the model replaces it once loaded, fitted into the same
// box (the physics never changes to suit a model). Swapping a model is one line here. The arm is bound node by node (props_view.js).
import { PROP_KINDS } from './world_spec.js';
export const ASSETS = {
  arm: 'assets/props/arm_cobot_claw.glb',
  soda: 'assets/props/trash_soda_can.glb', tin: 'assets/props/trash_tin_can.glb', water: 'assets/props/trash_water_bottle.glb',
  beer: 'assets/props/trash_beer_bottle.glb', carton: 'assets/props/trash_juice_carton.glb', chips: 'assets/props/trash_chips_bag.glb',
  diesel: 'assets/props/diesel_can.glb',
  battery: 'assets/props/battery.glb', drum: 'assets/props/drum_rusty.glb', bigbox: 'assets/props/trash_cardboard_box.glb',
  barricade: 'assets/props/barricade.glb', pallet: 'assets/props/pallet_wood.glb',
  armKit: null,   // the arm kit's crate is drawn in code
  // the world round the hall (world_view.js draws these instanced, a placeholder on the physics' box until the model loads, for every
  // instance at once; they load the first time a01 comes near their area). Each prop kind's file is its line in world_spec.js's
  // PROP_KINDS (assets/world/, NVIDIA SimReady, CC BY 4.0, modified). The forest's half-sunk drums are the hall's drum; the dead trees
  // are the kit's pieces by node. The lamp posts and the containers are the game's own (null: no model).
  ...Object.fromEntries(Object.entries(PROP_KINDS).map(([k, v]) => [k, `assets/world/${v.glb}.glb`])),
  treeKit: 'assets/world/dead_tree_kit.glb',
  lamp: null, container: null,
};

const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'bumpMap', 'alphaMap', 'specularMap'];
/** every texture under `root` wider or taller than `max` px drawn down to fit it (its aspect kept; mipmaps are still made from the
 *  smaller image), the decoded original let go (an ImageBitmap is closed). The phone's memory: a 3072 x 2048 map is 32 MB with its
 *  mipmaps, 3.7 MB at 1024 px. -> the number of textures drawn down */
export function shrinkTextures(root, max) {
  if (typeof document === 'undefined' || !(max > 0) || !Number.isFinite(max)) return 0;
  const seen = new Set(), done = new Map(); let n = 0;   // done: image -> its smaller canvas (one image may serve several maps)
  root.traverse((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const k of TEX_KEYS) {
    const t = m && m[k], im = t && t.image; if (!im || seen.has(t)) continue; seen.add(t);
    if (done.has(im)) { t.image = done.get(im); t.needsUpdate = true; n++; continue; }
    const w = im.width || 0, h = im.height || 0; if (!(Math.max(w, h) > max)) continue;
    const c = document.createElement('canvas'), s = max / Math.max(w, h); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    try { c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); done.set(im, c); t.image = c; t.needsUpdate = true; n++; } catch (e) { /* keep it as it is */ }
  } });
  for (const im of done.keys()) if (im.close) im.close();   // the decoded originals go once every map that used them has its canvas
  return n;
}
/** v4 (Nov 2, Josh: "memory first"): every texture under `root` lets go of its CPU copy (its canvas, its decoded ImageBitmap) once it is
 *  on the GPU. three.js keeps that copy only to upload it again, and nothing in the game uploads a model's textures twice (a released
 *  model is loaded again from its file). A lost WebGL context can't get them back: main.js saves and reloads the page then. One image
 *  may serve several maps: it goes after the last of them is uploaded. -> the number of textures marked */
export function releaseOnUpload(root) {
  const users = new Map(), tex = new Set();
  root.traverse((o) => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const k of TEX_KEYS) {
    const t = m && m[k]; if (!t || !t.image || tex.has(t) || (t.userData && t.userData.dropOnUpload)) continue;
    tex.add(t); users.set(t.image, (users.get(t.image) || 0) + 1);
  } });
  for (const t of tex) {
    t.userData.dropOnUpload = true;
    const prev = t.onUpdate;
    t.onUpdate = (x) => {
      if (prev) prev(x); x.onUpdate = prev || null;
      const im = x.image, n = (users.get(im) || 1) - 1; users.set(im, n); if (!im || n > 0) return; users.delete(im);
      try { if (typeof im.close === 'function') im.close(); else if (typeof im.getContext === 'function') { im.width = 0; im.height = 0; } } catch (e) { /* kept */ }
      x.userData.released = true;
    };
  }
  return tex.size;
}

/** let a decoded picture go: an ImageBitmap closed, a canvas emptied (its pixels freed at once, not when the GC gets to it) */
export const dropImage = (im) => { try { if (im && typeof im.close === 'function') im.close(); else if (im && typeof im.getContext === 'function') { im.width = 0; im.height = 0; } } catch (e) { /* */ } };
/** v4 (Nov 3: the phone's page ended in the dock zone; on the desk drawn as the phone draws, 80 MB of it was 2D canvases and 64 MB
 *  decoded pictures, CPU copies of textures already on the GPU among them: a01's own maps drawn down to 1024 px, the hall's and the
 *  world's textures drawn in code): every texture under `root` lets go of its CPU copy once it is on the GPU, the ones drawn in code
 *  (CanvasTexture) too. Nothing in the game draws on a texture's canvas again or uploads a texture twice: no texture is disposed and used
 *  again (a released model is loaded again from its file) and a lost WebGL context reloads the page. A picture shared by several textures
 *  goes once all of them are on the GPU; the rest wait for a later call. -> MB let go */
export function dropCpuCopies(root, renderer) {
  const P = renderer && renderer.properties; if (!P || !root) return 0;
  const byImage = new Map();
  root.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      for (const k of TEX_KEYS) {
        const t = m[k], im = t && t.isTexture && t.image; if (!im || !(im.width > 0) || (typeof im.getContext !== 'function' && typeof im.close !== 'function')) continue;
        let set = byImage.get(im); if (!set) byImage.set(im, set = new Set()); set.add(t);
      }
    }
  });
  let freed = 0;
  for (const [im, set] of byImage) {
    let up = true; for (const t of set) { const p = P.get(t); if (!(p && p.__webglTexture && p.__version === t.version)) { up = false; break; } }
    if (!up) continue;
    freed += im.width * im.height * 4; dropImage(im); for (const t of set) t.userData.released = true;
  }
  return Math.round(freed / 104857.6) / 10;
}
/** createAssets(THREE, GLTFLoader, mergeGeometries, { texMax, onBegin, onEnd }) -> { model(key) -> Promise<Object3D|null>, fit(obj, size),
 *  swapIn(key, group, size), swapInstanced(key, instancedMesh, size), busy() } (each file loads once; a failure leaves the placeholder).
 *  texMax: every model's textures at most this many px (main.js: 1024 on a phone); onBegin / onEnd(key): each file's load (the crash
 *  breadcrumbs, boot_crumbs.js); busy(): the files loading now */
export function createAssets(THREE, GLTFLoader, mergeGeometries = null, { texMax = Infinity, itemMax = Infinity, onBegin = null, onEnd = null, dropCopies = false } = {}) {
  const cache = new Map(), loader = GLTFLoader ? new GLTFLoader() : null, status = {};
  const owners = new Map();   // v4 (Nov 2): key -> the areas whose props use it ('core' = the hall, a01, the open world's items: never released)
  // the world's props are small on screen: their textures are drawn down to 512 px at load (a 1024 px map with its mipmaps is 5.6 MB
  // of GPU memory; there are 16 of them in the set); v5: the open world's models too (the collect bubble loads its own, full size)
  const WORLD_MAX = 512;
  // v4 (Nov 3): the open world's items (assets/survival/, assets/craft/) at itemMax on a phone (main.js: 256 px): the supply kinds' models
  // load for the zone whether any of that kind is out or not, and on the desk 99 of their textures were never drawn (42 MB of pictures)
  const maxFor = (url) => Math.min(texMax, /^assets\/(survival|craft)\//.test(url) ? Math.min(WORLD_MAX, itemMax) : /^assets\/world\//.test(url) ? WORLD_MAX : Infinity);
  let busy = 0;
  function model(key, owner = 'core') {
    const url = ASSETS[key]; if (!url || !loader) return Promise.resolve(null);
    if (!owners.has(key)) owners.set(key, new Set()); owners.get(key).add(owner);
    if (!cache.has(url)) {
      busy++; if (onBegin) onBegin(key);
      const done = () => { busy--; if (onEnd) onEnd(key); };
      cache.set(url, loader.loadAsync(url).then((g) => { shrinkTextures(g.scene, maxFor(url)); if (dropCopies) releaseOnUpload(g.scene); status[key] = 'loaded'; done(); return g.scene; })
        .catch((e) => { status[key] = 'failed: ' + ((e && e.message) || e); done(); return null; }));
    }
    return cache.get(url);
  }
  /** scale obj uniformly so its bounding box fits inside size [x, y, z], centred on the origin (the body's centre) */
  function fit(obj, size) {
    const b = new THREE.Box3().setFromObject(obj), d = new THREE.Vector3(), c = new THREE.Vector3(); b.getSize(d); b.getCenter(c);
    const k = Math.min(size[0] / Math.max(d.x, 1e-6), size[1] / Math.max(d.y, 1e-6), size[2] / Math.max(d.z, 1e-6));
    const g = new THREE.Group(); obj.position.sub(c); g.add(obj); g.scale.setScalar(k); return g;
  }
  /** put the real model into `group` (replacing its placeholder children) when it loads; a clone, so many items share one file */
  function swapIn(key, group, size) {
    return model(key).then((scene) => {
      if (!scene) return false;
      const obj = fit(scene.clone(true), size);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      for (const ch of [...group.children]) if (!ch.userData.keep) group.remove(ch);
      group.add(obj); group.userData.model = obj; return true;
    });
  }
  /** an InstancedMesh's placeholder replaced by the model: fitted into `size` round the instance's origin, or `native` (its own size,
   *  its origin on the ground), or one `node` of it; one InstancedMesh per material, all sharing the placeholder's instance matrices
   *  (and colours). -> Promise<the new meshes, or null> */
  function swapInstanced(key, imesh, size, { lift = 0, native = false, node = null, scale = 1, owner = 'core' } = {}) {
    if (!mergeGeometries) return Promise.resolve(null);
    return model(key, owner).then((scene) => {
      if (!scene || !imesh.parent) return null;
      let src = scene; if (node) { src = scene.getObjectByName(node); if (!src) return null; }
      src = src.clone(true); if (node) src.position.set(0, 0, 0);
      let g; if (native) { g = new THREE.Group(); g.add(src); g.scale.setScalar(scale); } else g = fit(src, size);
      g.position.y += lift; g.updateMatrixWorld(true);
      const byMat = new Map();
      g.traverse((o) => {
        if (!o.isMesh || Array.isArray(o.material)) return;
        let geo = o.geometry.clone().applyMatrix4(o.matrixWorld); if (geo.index) geo = geo.toNonIndexed();
        for (const n of Object.keys(geo.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') geo.deleteAttribute(n);
        if (!geo.attributes.normal) geo.computeVertexNormals();
        if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
        if (!byMat.has(o.material)) byMat.set(o.material, []); byMat.get(o.material).push(geo);
      });
      if (!byMat.size) return null;
      let first = true; const out = [imesh];
      for (const [mat, geos] of byMat) {
        const geo = geos.length > 1 ? mergeGeometries(geos) : geos[0]; if (!geo) continue;
        if (first) { imesh.geometry.dispose(); imesh.geometry = geo; imesh.material = mat; first = false; }
        else { const m2 = new THREE.InstancedMesh(geo, mat, imesh.count); m2.instanceMatrix = imesh.instanceMatrix; m2.instanceColor = imesh.instanceColor; m2.castShadow = imesh.castShadow; m2.receiveShadow = imesh.receiveShadow; m2.frustumCulled = imesh.frustumCulled; m2.name = imesh.name; imesh.parent.add(m2); out.push(m2); }
      }
      for (const m of out) { m.boundingSphere = null; if (m.frustumCulled) m.computeBoundingSphere(); }
      status[key] = 'loaded (instanced)'; return out;
    });
  }
  /** v5: one more model under a key (the open world's: assets/survival/, assets/craft/) */
  const register = (k, url) => { if (!ASSETS[k]) ASSETS[k] = url; };
  /** v4 (Nov 2): an area no longer uses this model (its props unloaded): once no area and nothing else does, its file's meshes,
   *  materials and textures are freed and it is loaded again from its file the next time. -> true when freed */
  // v4 (Nov 3; the long-session desk: +48 MB of decoded pictures each round of zones): a released model's pictures are let go too, drawn
  // or not (a texture never drawn, e.g. the tree kit's unused trees, kept its decoded ImageBitmap until the GC got to it)
  function release(key, owner) {
    const set = owners.get(key); if (set) set.delete(owner);
    if (set && set.size) return false;
    const url = ASSETS[key], p = url && cache.get(url); if (!p) return false;
    cache.delete(url); owners.delete(key); status[key] = 'released';
    p.then((scene) => { if (!scene) return; const seen = new Set();
      scene.traverse((o) => { if (!o.isMesh) return; if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (!m || seen.has(m)) continue; seen.add(m); for (const k of TEX_KEYS) if (m[k] && !seen.has(m[k])) { seen.add(m[k]); dropImage(m[k].image); m[k].dispose(); } m.dispose(); } });
    }).catch(() => {});
    return true;
  }
  return { model, fit, swapIn, swapInstanced, release, owners, status, ASSETS, register, busy: () => busy, shrink: (scene) => shrinkTextures(scene, texMax) };
}
