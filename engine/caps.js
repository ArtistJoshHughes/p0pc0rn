// caps.js - p0pc0rn v026.9 (Android readiness): what a device offers, and what each model needs from it. The engines choose their
// kernel variants from the device's own limits at init (never the iPhone's); this table is what they need AFTER that choice, i.e. the
// floor each one was built and tested for (clamp mode: the WebGPU default limits on a desktop test GPU). The Device check shows it per model.
export const KB = 1024, MB = 1048576;
/** the device's capabilities from a GPUAdapter or GPUDevice */
export function capsOf(x) {
  const L = x.limits, f = x.features;
  return { f16: f.has('shader-f16'), subgroups: f.has('subgroups'), wgMem: L.maxComputeWorkgroupStorageSize, maxBind: L.maxStorageBufferBindingSize,
    maxBuf: L.maxBufferSize, wgInv: L.maxComputeInvocationsPerWorkgroup, wgPerDim: L.maxComputeWorkgroupsPerDimension };
}
const need = (name, o) => Object.assign({ name, f16: true, wgMem: 16 * KB, bind: 128 * MB, buf: 256 * MB, wgInv: 256 }, o);
export const NEEDS = {
  'flux2-klein-4b': need('Pictures (Klein 4B)'),
  'flux2-klein-9b': need('Better pictures (Klein 9B)'),
  'sanavideo2-5b': need('Clips (SANA-Video 2B + the LTX decoder)'),
  'ltx23-still-enc': need('The picture reader (LTX encoder)'),
  'gemma4-e2b': need('The assistant (Gemma 4 E2B)'),
  'acestep15-turbo': need('Songs (ACE-Step 1.5 + the lyrics planner)'),
  'qwen3-tts-0.6b': need('Cast voices (Qwen3-TTS)'),
  'musetalk-1.5': need('Lip-sync, experimental (MuseTalk)'),
  'face': need('Face finding for Cast photos (BlazeFace)', { f16: false })
};
for (const n of Object.values(NEEDS)) n.text = [n.f16 ? 'shader-f16' : 'no shader-f16 needed', `${n.wgMem / KB} KB workgroup memory`, `${n.bind / MB} MB bindings`, `${n.buf / MB} MB buffers`].join(' · ');
/** {ok, why[]} for one model's needs on a device's caps */
export function fitOf(n, c) {
  const why = [];
  if (n.f16 && !c.f16) why.push('no shader-f16');
  if (c.wgMem < n.wgMem) why.push(`workgroup memory ${c.wgMem / KB} KB < ${n.wgMem / KB} KB`);
  if (c.maxBind < n.bind) why.push(`bindings ${Math.round(c.maxBind / MB)} MB < ${n.bind / MB} MB`);
  if (c.maxBuf < n.buf) why.push(`buffers ${Math.round(c.maxBuf / MB)} MB < ${n.buf / MB} MB`);
  if (c.wgInv < n.wgInv) why.push(`${c.wgInv} threads per workgroup < ${n.wgInv}`);
  return { ok: !why.length, why };
}
/** the largest storage binding a kernel may use on this device (a view is cut to it; never more than the buffer) */
export const bindCap = (gpu) => (gpu && gpu.limits && gpu.limits.maxStorageBufferBindingSize) || 128 * MB;
