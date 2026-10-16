// opfs.js - the Settings storage inspector: what this site keeps in its private file storage (OPFS), and removal of what
// nothing uses. `keep` lists the model folders from the engine's registry (MODELS[*].wipe, e.g. 'pocketflux/pack',
// 'engine/sanavideo2-5b'): they and everything inside them are NEVER offered for removal; folders above them are walked so their
// other children can be. `leftovers` are files inside a model folder that the app knows are stale ({path, why}), checked one by one.

async function sizeOf(h) {   // -> {bytes, unknown}: a file the engine's worker holds open may refuse getFile()
  if (h.kind === 'file') { try { return { bytes: (await h.getFile()).size, unknown: false }; } catch (e) { return { bytes: 0, unknown: true }; } }
  let bytes = 0, unknown = false;
  for await (const c of h.values()) { const s = await sizeOf(c); bytes += s.bytes; unknown = unknown || s.unknown; }
  return { bytes, unknown };
}
async function handleAt(root, path) {
  const parts = path.split('/').filter(Boolean); let d = root;
  for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i]);
  const last = parts[parts.length - 1];
  try { return { parent: d, name: last, h: await d.getFileHandle(last) }; } catch (e) { return { parent: d, name: last, h: await d.getDirectoryHandle(last) }; }
}

/** -> {top: [{name, dir, bytes, unknown, uses: [modelKey]}], remove: [{path, bytes, why}]}
 *  keep: {modelKey: [path, ...]}; leftovers: [{path, why}] */
export async function scan(keep, leftovers = []) {
  const root = await navigator.storage.getDirectory();
  const kept = Object.values(keep).flat();
  const isKept = (p) => kept.some((k) => p === k || p.startsWith(k + '/'));
  const isAbove = (p) => kept.some((k) => k.startsWith(p + '/'));
  const top = [], remove = [];
  async function walk(dir, path) {
    for await (const [name, h] of dir.entries()) {
      const p = path ? `${path}/${name}` : name;
      if (isKept(p)) continue;
      if (h.kind === 'directory' && isAbove(p)) { await walk(h, p); continue; }
      const s = await sizeOf(h);
      remove.push({ path: p + (h.kind === 'directory' ? '/' : ''), bytes: s.bytes, why: 'not used by p0pc0rn' });
    }
  }
  for await (const [name, h] of root.entries()) {
    const s = await sizeOf(h);
    top.push({ name, dir: h.kind === 'directory', bytes: s.bytes, unknown: s.unknown,
      uses: Object.keys(keep).filter((m) => keep[m].some((k) => k === name || k.startsWith(name + '/'))) });
    if (isKept(name)) continue;
    if (h.kind === 'directory' && isAbove(name)) await walk(h, name);
    else remove.push({ path: name + (h.kind === 'directory' ? '/' : ''), bytes: s.bytes, why: 'not used by p0pc0rn' });
  }
  for (const l of leftovers) {
    try { const { h } = await handleAt(root, l.path); const s = await sizeOf(h); if (s.bytes > 0) remove.push({ path: l.path, bytes: s.bytes, why: l.why, engine: true }); }
    catch (e) { /* not there */ }
  }
  top.sort((a, b) => b.bytes - a.bytes);
  return { top, remove };
}

/** Remove the given scan items. `viaEngine(path)` (optional) removes a file inside a model folder through that engine's own
 *  storage worker (it holds the file open). Model folders are refused here too, whatever the caller passes. */
export async function removeItems(items, keep, viaEngine) {
  const root = await navigator.storage.getDirectory(), kept = Object.values(keep).flat();
  let freed = 0; const failed = [];
  for (const it of items) {
    const p = it.path.replace(/\/$/, '');
    if (!it.engine && kept.some((k) => p === k || p.startsWith(k + '/') || k.startsWith(p + '/'))) { failed.push(it.path); continue; }
    try {
      const plain = async () => { const { parent, name } = await handleAt(root, p); await parent.removeEntry(name, { recursive: true }); };
      if (it.engine && viaEngine) { try { await viaEngine(p); } catch (e) { await plain(); } } else await plain();
      freed += it.bytes;
    } catch (e) { failed.push(it.path); }
  }
  return { freed, failed };
}
