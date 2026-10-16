// gpuclamp.js - p0pc0rn v026.9 (Android readiness): "clamp mode", Android-like WebGPU limits on any machine, for testing on a desktop.
// The WebGPU DEFAULT limits are the floor every device must meet and what a phone may well expose: 16 KB of workgroup memory,
// 128 MB storage bindings, 256 MB buffers. In clamp mode the adapter reports those limits (never more than the real ones), and the
// device is created with them, so the browser's own validation enforces them exactly as on such a phone.
//   ?clamp=1      the limits (shader-f16 kept)        ?clamp=nof16   the limits AND no shader-f16        ?clamp=0   off
// The choice is remembered (localStorage 'p0pc0rn:clamp') until ?clamp=0. A classic script: load it before anything that uses WebGPU.
// v027.3: only on this machine (localhost / 127.0.0.1). Anywhere else a ?clamp= link is ignored and never remembered (a value an older
// version remembered is cleared), so a shared link cannot make a phone say it cannot run. When on, Settings > About shows it.
(function () {
  'use strict';
  var mode = '';
  try {
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var m = local && /[?&]clamp=([a-z0-9]+)/i.exec(location.search);
    if (!local) localStorage.removeItem('p0pc0rn:clamp');
    else if (m) { mode = m[1] === '0' ? '' : m[1].toLowerCase(); if (mode) localStorage.setItem('p0pc0rn:clamp', mode); else localStorage.removeItem('p0pc0rn:clamp'); }
    else mode = localStorage.getItem('p0pc0rn:clamp') || '';
  } catch (e) { mode = ''; }
  var gpu = typeof navigator !== 'undefined' && navigator.gpu;
  if (!mode || !gpu) return;
  var noF16 = mode === 'nof16';
  var FLOOR = {   // the WebGPU spec's default limits (the ones a device gets unless it asks for more)
    maxTextureDimension1D: 8192, maxTextureDimension2D: 8192, maxTextureDimension3D: 2048, maxTextureArrayLayers: 256, maxBindGroups: 4,
    maxBindingsPerBindGroup: 1000, maxDynamicUniformBuffersPerPipelineLayout: 8, maxDynamicStorageBuffersPerPipelineLayout: 4,
    maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8, maxStorageTexturesPerShaderStage: 4,
    maxUniformBuffersPerShaderStage: 12, maxUniformBufferBindingSize: 65536, maxStorageBufferBindingSize: 134217728,
    minUniformBufferOffsetAlignment: 256, minStorageBufferOffsetAlignment: 256, maxVertexBuffers: 8, maxBufferSize: 268435456,
    maxVertexAttributes: 16, maxVertexBufferArrayStride: 2048, maxInterStageShaderVariables: 16, maxColorAttachments: 8,
    maxColorAttachmentBytesPerSample: 32, maxComputeWorkgroupStorageSize: 16384, maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupSizeX: 256, maxComputeWorkgroupSizeY: 256, maxComputeWorkgroupSizeZ: 64, maxComputeWorkgroupsPerDimension: 65535
  };
  var MIN_IS_BETTER = { minUniformBufferOffsetAlignment: 1, minStorageBufferOffsetAlignment: 1 };
  function clampLimits(real) {
    var out = {};
    for (var k in real) { var v = real[k]; if (typeof v !== 'number') continue; out[k] = v; }
    for (var f in FLOOR) {
      if (!(f in out)) continue;
      out[f] = MIN_IS_BETTER[f] ? Math.max(out[f], FLOOR[f]) : Math.min(out[f], FLOOR[f]);
    }
    return out;
  }
  var realRequestAdapter = gpu.requestAdapter.bind(gpu);
  gpu.requestAdapter = function (opts) {
    return realRequestAdapter(opts).then(function (ad) {
      if (!ad) return ad;
      var limits = clampLimits(ad.limits), feats = new Set();
      ad.features.forEach(function (x) { if (!(noF16 && x === 'shader-f16')) feats.add(x); });
      var proxy = {
        __clamp: mode, limits: limits, features: feats, info: ad.info, isFallbackAdapter: ad.isFallbackAdapter,
        requestAdapterInfo: ad.requestAdapterInfo ? ad.requestAdapterInfo.bind(ad) : undefined,
        requestDevice: function (desc) {
          desc = Object.assign({}, desc || {});
          var rf = (desc.requiredFeatures || []).slice();
          for (var i = 0; i < rf.length; i++) if (!feats.has(rf[i])) return Promise.reject(new TypeError('clamp mode: feature "' + rf[i] + '" is not available'));
          var rl = Object.assign({}, desc.requiredLimits || {}), use = {};
          for (var k in rl) {
            if (rl[k] === undefined) continue;
            if (k in limits && (MIN_IS_BETTER[k] ? rl[k] < limits[k] : rl[k] > limits[k])) {
              var e = new Error('clamp mode: ' + k + ' ' + rl[k] + ' is above this adapter\'s ' + limits[k]); e.name = 'OperationError'; return Promise.reject(e);
            }
            use[k] = rl[k];
          }
          for (var f in FLOOR) if (f in limits && !(f in use)) use[f] = limits[f];   // never more than the clamp, even if not asked
          desc.requiredLimits = use; desc.requiredFeatures = rf;
          return ad.requestDevice(desc);
        }
      };
      return proxy;
    });
  };
  gpu.__clamp = mode;
})();
