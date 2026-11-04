// family.js - p0pc0rn v4 autotune: the KNOWN table (the second step of the fallback: a device that has not tuned yet, or whose result
// no longer applies, takes its GPU family's entry; else what ships). Each entry comes from a measured run (named in `source`); picks
// list only the 4-bit decode shapes where that run's best kernel beat what ships by 3% or more ('engine' = the engine's own kernel).
// Generated from the kernel tune's desk results (one JSON file per device); ad = the decode attention from the Phase 2 re-bench (the laptop Ada GPU: by heads, 64-key
// chunks: a sliding layer 113 -> 41 us, a full one at 512 keys 185 -> 59 us; the datacenter Turing GPU has no shader-f16 in that browser, so none).
export const FAMILY = [
  { vendor: 'nvidia', architecture: 'lovelace', name: 'NVIDIA Ada (RTX 40)', source: 'a laptop GPU (NVIDIA Ada), autotune bench Oct-31',
    picks: {'rms.geglu.6144x1536': 'n2.L4.d.u8', 'rms.geglu.12288x1536': 'n2.L4.d.mask', 'rms.store.3072x2560': 'n4.L16.d.mask', 'rms.store.6144x2560': 'n4.L8.d.u8', 'rms.store.2048x2560': 'n4.L16.d.mask', 'rms.store.4096x2560': 'n4.L16.d.mask', 'raw.store.2560x2048': 'n4.L16.d.mask', 'rms.geglu.10240x2560': 'n2.L4.d.u8', 'raw.store.2560x10240': 'n1.L2.d.mask', 'raw.store.256x2560': 'n4.L16.s.mask', 'raw.store.10752x2560': 'n1.L4.d.mask'}, ad: { name: 'h64' } },
  { vendor: 'nvidia', architecture: 'turing', name: 'NVIDIA Turing', source: 'a datacenter GPU (NVIDIA Turing; that browser had no shader-f16 there, so these apply where Turing has it), autotune bench Oct-31',
    picks: {'rms.geglu.6144x1536': 'n1.L4.d.u8', 'rms.geglu.12288x1536': 'n2.L4.d.shift', 'raw.store.1536x6144': 'n2.L8.d.u8', 'raw.store.1536x12288': 'n1.L4.d.shift', 'raw.store.8960x1536': 'n1.L4.d.shift', 'rms.softcap.262144x1536': 'engine', 'rms.store.3072x2560': 'n2.L8.d.u8', 'rms.store.6144x2560': 'n2.L8.d.u8', 'rms.store.2048x2560': 'n4.L16.d.shift', 'rms.store.4096x2560': 'n2.L8.d.shift', 'raw.store.2560x2048': 'engine', 'rms.geglu.10240x2560': 'n2.L4.d.shift', 'raw.store.2560x10240': 'n2.L4.d.shift', 'raw.store.10752x2560': 'n2.L4.d.mask', 'rms.softcap.262144x2560': 'n2.L8.d.shift'}, ad: null },
];
