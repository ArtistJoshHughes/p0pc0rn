// devcheck.js - p0pc0rn v026.9 (Android readiness): the Device check. What this phone or browser offers p0pc0rn: the WebGPU adapter
// (every feature and limit), what each model needs and whether it fits, the video / sound encoders, storage (quota, persistence, the
// private file storage the models live in), and a correctness + speed test of the GPU kernel classes the models use, each against a
// small CPU reference. "Copy report" puts it all on the clipboard as text. Standalone (devcheck.html), linked from Settings › About.
import { NEEDS, fitOf } from './engine/caps.js';

const $ = (id) => document.getElementById(id);
const out = $('out'), REPORT = {}; window.__devcheck = REPORT;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const MB = (b) => (b >= 1048576 ? (b / 1048576).toFixed(b >= 1073741824 ? 0 : 0) + ' MB' : b + ' B');
function section(title, html) { const d = document.createElement('section'); d.innerHTML = `<h2>${esc(title)}</h2><div class="card">${html}</div>`; out.appendChild(d); return d; }
function table(rows) { return '<table>' + rows.map((r) => '<tr>' + r.map((c, i) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('') + '</tr>').join('') + '</table>'; }
const yes = (b, t = b ? 'yes' : 'no') => `<span class="${b ? 'ok' : 'bad'}">${esc(t)}</span>`;
const state = (t) => { $('state').textContent = t; };

const LIMIT_KEYS = ['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY', 'maxComputeWorkgroupSizeZ', 'maxComputeWorkgroupsPerDimension', 'maxStorageBuffersPerShaderStage',
  'maxUniformBufferBindingSize', 'maxBindGroups', 'maxBindingsPerBindGroup', 'minStorageBufferOffsetAlignment', 'minUniformBufferOffsetAlignment',
  'maxTextureDimension2D', 'maxDynamicStorageBuffersPerPipelineLayout', 'maxSamplersPerShaderStage', 'maxStorageTexturesPerShaderStage', 'maxColorAttachments'];

// ------------------------------------------------------------------------------------------------ 1. the browser and the device
async function envInfo() {
  const ua = navigator.userAgent, d = { userAgent: ua, android: /Android/i.test(ua), ios: /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) };
  d.chrome = (/Chrome\/(\d+[\d.]*)/.exec(ua) || [])[1] || null;
  d.deviceMemoryGB = navigator.deviceMemory || null; d.cores = navigator.hardwareConcurrency || null;
  d.screen = `${screen.width}x${screen.height} @${devicePixelRatio}x`;
  try { if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) { const h = await navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion', 'fullVersionList']); d.model = h.model || null; d.platform = navigator.userAgentData.platform + ' ' + (h.platformVersion || ''); d.browsers = (h.fullVersionList || []).map((b) => b.brand + ' ' + b.version).join(', '); } } catch (e) { /* */ }
  d.standalone = matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
  d.clamp = (navigator.gpu && navigator.gpu.__clamp) || null;
  try { const e = await navigator.storage.estimate(); d.quotaGB = +((e.quota || 0) / 1e9).toFixed(1); d.usedGB = +((e.usage || 0) / 1e9).toFixed(2); } catch (e) { d.quotaGB = null; }
  try { d.persisted = await navigator.storage.persisted(); } catch (e) { d.persisted = null; }
  d.opfs = await opfsCheck();
  REPORT.device = d;
  section('This device', table([
    ['Browser', esc(d.browsers || d.chrome ? 'Chrome ' + (d.chrome || '') : ua.slice(0, 80))], ['System', esc(d.platform || (d.android ? 'Android' : d.ios ? 'iOS' : 'other'))],
    ['Model', esc(d.model || '—')], ['Memory (as the browser reports it)', d.deviceMemoryGB ? d.deviceMemoryGB + ' GB' : '—'], ['Screen', esc(d.screen)],
    ['Installed as an app', d.standalone ? 'yes' : 'no (Chrome: menu › Add to Home screen)'],
    ['Storage quota for this site', d.quotaGB != null ? d.quotaGB + ' GB (used ' + d.usedGB + ' GB)' : '—'],
    ['Storage kept when space runs low', d.persisted == null ? '—' : yes(d.persisted, d.persisted ? 'yes' : 'not yet (asked when a model downloads)')],
    ['Private file storage (where the models live)', d.opfs.ok ? yes(true, 'yes, ' + d.opfs.mbps + ' MB/s write, ' + d.opfs.rbps + ' MB/s read') : yes(false, d.opfs.error || 'no')],
    ['Test mode', d.clamp ? `<span class="warn">clamp mode "${esc(d.clamp)}": Android-like limits (open ?clamp=0 to turn it off)</span>` : 'off']]));
}
async function opfsCheck() {
  if (!(navigator.storage && navigator.storage.getDirectory)) return { ok: false, error: 'this browser has no private file storage (OPFS)' };
  let w;
  try {
    w = new Worker(new URL('./engine/core/opfs_worker.js', import.meta.url), { type: 'module' });
    let id = 0; const pend = new Map();
    w.onmessage = (ev) => { const m = ev.data, p = pend.get(m.id); if (p) { pend.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m.result); } };
    const call = (op, a = {}, tr = []) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); w.postMessage(Object.assign({ id: i, op }, a), tr); });
    const h = await call('hello'); if (!h.sync) return { ok: false, error: 'no fast file access in workers (sync access handles)' };
    const N = 8 * 1048576, name = 'pocketflux/devcheck.bin', buf = new Uint8Array(N); for (let i = 0; i < N; i += 4096) buf[i] = i & 255;
    let t0 = performance.now(); await call('write', { name, at: 0, buf: buf.buffer, truncate: 0 }, [buf.buffer]); await call('flush', { name }); const tw = performance.now() - t0;
    t0 = performance.now(); const r = await call('read', { name, at: 0, len: N }); const tr = performance.now() - t0;
    const ok = new Uint8Array(r.buf)[4096] === (4096 & 255);
    await call('remove', { name });
    return { ok, mbps: Math.round(N / 1048576 / (tw / 1000)), rbps: Math.round(N / 1048576 / (tr / 1000)), error: ok ? null : 'read back differs' };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; } finally { if (w) w.terminate(); }
}

// ------------------------------------------------------------------------------------------------ 2. WebGPU
async function gpuInfo() {
  if (!navigator.gpu) {
    REPORT.gpu = { available: false };
    section('Graphics (WebGPU)', `<p class="bad">This browser has no WebGPU, so the models can't run here.</p>${howToEnable()}`);
    return null;
  }
  const res = {};
  for (const pp of ['high-performance', 'low-power']) {
    let ad = null; try { ad = await navigator.gpu.requestAdapter({ powerPreference: pp }); } catch (e) { res[pp] = { error: String(e.message || e) }; continue; }
    if (!ad) { res[pp] = { error: 'no adapter' }; continue; }
    const info = ad.info || {}, lim = {};
    for (const k of LIMIT_KEYS) if (ad.limits[k] !== undefined) lim[k] = ad.limits[k];
    for (const k in ad.limits) if (typeof ad.limits[k] === 'number' && !(k in lim)) lim[k] = ad.limits[k];
    res[pp] = { vendor: info.vendor || '', architecture: info.architecture || '', device: info.device || '', description: info.description || '',
      subgroupMinSize: info.subgroupMinSize || null, subgroupMaxSize: info.subgroupMaxSize || null, fallback: !!ad.isFallbackAdapter,
      features: [...ad.features].sort(), limits: lim, _ad: ad };
  }
  const a = res['high-performance'] && !res['high-performance'].error ? res['high-performance'] : res['low-power'];
  REPORT.gpu = { available: !!(a && !a.error), adapters: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, Object.assign({}, v, { _ad: undefined })])) };
  if (!a || a.error) { section('Graphics (WebGPU)', `<p class="bad">WebGPU is present but no graphics adapter was offered (${esc((a && a.error) || 'none')}).</p>${howToEnable()}`); return null; }
  const L = a.limits, f = new Set(a.features);
  // a device as the models ask for one: their features + the adapter's own limits
  let dev = null, devErr = null;
  try { dev = await a._ad.requestDevice({ requiredFeatures: ['shader-f16', 'subgroups'].filter((x) => f.has(x)), requiredLimits: { maxBufferSize: L.maxBufferSize, maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxComputeWorkgroupStorageSize: L.maxComputeWorkgroupStorageSize, maxComputeInvocationsPerWorkgroup: L.maxComputeInvocationsPerWorkgroup } }); }
  catch (e) { devErr = String(e.message || e); }
  REPORT.gpu.device = dev ? 'ok' : devErr; if (dev) dev.destroy();
  section('Graphics (WebGPU)', table([
    ['Chip', esc([a.vendor, a.architecture, a.device, a.description].filter(Boolean).join(' · ') || '(the browser hides the name)')],
    ['Software fallback', a.fallback ? yes(false, 'yes: a CPU emulation, far too slow for the models') : 'no'],
    ['16-bit floats in shaders (shader-f16)', yes(f.has('shader-f16'))], ['Subgroups', f.has('subgroups') ? `yes (${a.subgroupMinSize || '?'}–${a.subgroupMaxSize || '?'} lanes)` : 'no'],
    ['Timestamp queries', f.has('timestamp-query') ? 'yes' : 'no'],
    ['Largest buffer (maxBufferSize)', MB(L.maxBufferSize)], ['Largest binding (maxStorageBufferBindingSize)', MB(L.maxStorageBufferBindingSize)],
    ['Workgroup memory (maxComputeWorkgroupStorageSize)', (L.maxComputeWorkgroupStorageSize / 1024) + ' KB'],
    ['Threads per workgroup (maxComputeInvocationsPerWorkgroup)', L.maxComputeInvocationsPerWorkgroup], ['Workgroups per dimension', L.maxComputeWorkgroupsPerDimension],
    ['Storage buffers per shader', L.maxStorageBuffersPerShaderStage],
    ['A device like the models ask for', dev ? yes(true, 'created') : yes(false, devErr)],
    ['All features', `<code>${esc([...f].join(', '))}</code>`], ['All limits', `<code>${esc(Object.entries(L).map(([k, v]) => k + '=' + v).join(', '))}</code>`]]));
  return a;
}
function howToEnable() {
  return `<div class="note"><p><b>To try:</b> update Chrome (Play Store › Chrome › Update), restart the phone, and open this page again.</p>
  <p>Last resort, for testing only: open <code>chrome://flags/#enable-unsafe-webgpu</code>, set it to Enabled, and relaunch Chrome. This turns on
  WebGPU on graphics chips Chrome has not approved yet; it can crash Chrome or the phone's graphics driver. Turn it off again after testing.</p></div>`;
}

// ------------------------------------------------------------------------------------------------ 3. what each model needs, and whether this chip has it
function verdicts(a) {
  const caps = a ? { f16: a.features.includes('shader-f16'), wgMem: a.limits.maxComputeWorkgroupStorageSize, maxBind: a.limits.maxStorageBufferBindingSize, maxBuf: a.limits.maxBufferSize, wgInv: a.limits.maxComputeInvocationsPerWorkgroup } : null;
  const rows = [['Model', 'Needs', 'This device']];
  REPORT.models = {};
  for (const [id, n] of Object.entries(NEEDS)) {
    const v = caps ? fitOf(n, caps) : { ok: false, why: ['no WebGPU'] };
    REPORT.models[id] = v.ok ? 'fits' : v.why.join('; ');
    rows.push([esc(n.name), esc(n.text), v.ok ? yes(true, 'fits') : yes(false, v.why.join('; '))]);
  }
  section('The models on this device', table(rows) + '<p class="dim">"Fits" means the chip offers what the model asks for. Whether the phone has the memory for it shows only when it runs.</p>');
}

// ------------------------------------------------------------------------------------------------ 4. encoders (WebCodecs) and playback
async function codecs() {
  const V = [['H.264 baseline 832×480', 'avc1.42001f', 832, 480], ['H.264 main 480×832', 'avc1.4d401f', 480, 832], ['H.264 high 1280×720', 'avc1.640028', 1280, 720],
    ['VP9 832×480', 'vp09.00.10.08', 832, 480], ['AV1 832×480', 'av01.0.04M.08', 832, 480]];
  const A = [['AAC 48 kHz stereo', 'mp4a.40.2'], ['Opus 48 kHz stereo', 'opus']];
  const rows = [['Encoder', 'Supported']], R = { video: {}, audio: {}, play: {} };
  for (const [n, codec, width, height] of V) {
    let ok = false; try { ok = typeof VideoEncoder !== 'undefined' && (await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 2e6, framerate: 16, avc: codec.startsWith('avc') ? { format: 'avc' } : undefined })).supported; } catch (e) { ok = false; }
    R.video[codec] = ok; rows.push([esc(n), yes(ok)]);
  }
  for (const [n, codec] of A) {
    let ok = false; try { ok = typeof AudioEncoder !== 'undefined' && (await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported; } catch (e) { ok = false; }
    R.audio[codec] = ok; rows.push([esc(n), yes(ok)]);
  }
  const vEl = document.createElement('video'), aEl = document.createElement('audio');
  for (const [n, t, el] of [['Play MP4 (H.264 + AAC)', 'video/mp4; codecs="avc1.42001f, mp4a.40.2"', vEl], ['Play MP4 (VP9)', 'video/mp4; codecs="vp09.00.10.08"', vEl], ['Play WebM (VP9 + Opus)', 'video/webm; codecs="vp9, opus"', vEl],
    ['Play M4A (AAC)', 'audio/mp4; codecs="mp4a.40.2"', aEl], ['Play M4A (Opus)', 'audio/mp4; codecs="opus"', aEl], ['Play WAV', 'audio/wav', aEl]]) {
    const r = el.canPlayType(t); R.play[t] = r; rows.push([esc(n), r ? yes(true, r) : yes(false, 'no')]);
  }
  REPORT.codecs = R;
  const out = section('Video and sound', table(rows));
  const p = document.createElement('p'); p.className = 'dim';
  p.textContent = R.video['avc1.42001f'] && R.audio['mp4a.40.2'] ? 'Clips save as MP4 (H.264) with AAC sound, as on iPhone.'
    : `Clips save as ${R.video['avc1.42001f'] ? 'H.264' : R.video['vp09.00.10.08'] ? 'VP9' : 'no supported video codec'} and sound as ${R.audio['mp4a.40.2'] ? 'AAC' : R.audio['opus'] ? 'Opus' : 'WAV'} here.`;
  out.querySelector('.card').appendChild(p);
}

// ------------------------------------------------------------------------------------------------ 5. the kernel classes, against CPU references
async function kernels(a) {
  const sec = section('GPU maths test (the kernel classes the models use)', '<p class="dim">Running…</p>');
  const card = sec.querySelector('.card');
  if (!a) { card.innerHTML = '<p class="bad">Skipped: no WebGPU adapter.</p>'; REPORT.kernels = 'skipped'; return; }
  let K;
  try { K = await import('./engine/kcheck.js'); } catch (e) { card.innerHTML = `<p class="bad">The test could not load: ${esc(e.message || e)}</p>`; return; }
  const rows = [['Kernel', 'Variant', 'Correct', 'Speed']]; REPORT.kernels = [];
  const render = () => { card.innerHTML = table(rows) + '<p class="dim">Correct = the GPU result matches a CPU reference (cosine similarity, worst error). Speed is a rough throughput on small sizes.</p>'; };
  render();
  for await (const r of K.runAll((t) => state('GPU maths: ' + t))) {
    REPORT.kernels.push(r);
    rows.push([esc(r.name), esc(r.variant || ''), r.error ? yes(false, r.error) : yes(r.ok, (r.ok ? 'yes' : 'NO') + ` (cos ${r.cos != null ? r.cos.toFixed(5) : '—'}, max err ${r.maxErr != null ? r.maxErr.toExponential(1) : '—'})`), esc(r.speed || '')]);
    render();
  }
}

// ------------------------------------------------------------------------------------------------ run + copy
function reportText() {
  const L = [];
  L.push(`p0pc0rn device check · ${new Date().toISOString()}`);
  L.push(JSON.stringify(REPORT, (k, v) => (k === '_ad' ? undefined : v), 1));
  return L.join('\n');
}
$('run').onclick = async () => {
  $('run').disabled = true; out.innerHTML = ''; for (const k in REPORT) delete REPORT[k];
  try {
    state('The device…'); await envInfo();
    state('Graphics…'); const a = await gpuInfo();
    verdicts(a);
    state('Encoders…'); await codecs();
    state('GPU maths…'); await kernels(a);
    state('Done. Copy the report and send it to Josh.');
  } catch (e) { state('Stopped: ' + (e.message || e)); REPORT.error = String(e.stack || e); }
  $('run').disabled = false; $('copy').disabled = false;
};
$('copy').onclick = async () => {
  const t = reportText();
  try { await navigator.clipboard.writeText(t); state('Copied.'); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); state('Copied.'); } catch (x) { state('Select the text below and copy it.'); } }
};
if (/[?&]run=1/.test(location.search)) $('run').click();
