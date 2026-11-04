// tracks.js - a01's tyre tracks in the mud: each tyre rolling on the ground in mud leaves a print every `spacing` metres it travels
// (sampled by distance, never by time: a tyre standing still or spinning in place leaves nothing new). The prints go into one ring
// buffer of `cap` slots (world_view.js draws it as one InstancedMesh); they stay for the run, and only past the cap does the oldest
// slot get reused. Pure maths: the tests run it in Node.
export const TRACKS = { cap: 4096, spacing: 0.15, maxStep: 0.6 };

/** -> { update(wheels) -> new prints [{ slot, x, z, yaw, len }], reset(), count, total, cap } ; wheels: [{ id, x, z, mud, onGround }] */
export function createTrackSampler({ cap = TRACKS.cap, spacing = TRACKS.spacing, maxStep = TRACKS.maxStep } = {}) {
  const last = new Map(); let total = 0;
  function update(wheels) {
    const out = [];
    for (const w of wheels) {
      if (!w.mud || !w.onGround) { last.delete(w.id); continue; }
      const L = last.get(w.id);
      if (!L) { last.set(w.id, { x: w.x, z: w.z }); continue; }
      const dx = w.x - L.x, dz = w.z - L.z, d = Math.hypot(dx, dz);
      if (d > maxStep) { last.set(w.id, { x: w.x, z: w.z }); continue; }   // a reset or a jump: no print across it
      if (d < spacing) continue;
      out.push({ slot: total % cap, x: (w.x + L.x) / 2, z: (w.z + L.z) / 2, yaw: Math.atan2(-dz, dx), len: d });
      total++; last.set(w.id, { x: w.x, z: w.z });
    }
    return out;
  }
  function reset() { last.clear(); total = 0; }
  return { update, reset, get count() { return Math.min(total, cap); }, get total() { return total; }, cap, spacing };
}
