// settings_core.js - p0pc0rn 3.9: Settings' pure parts (no DOM, node-testable). Josh (Oct-26): "settings is not optimized for reading.
// It's an endless scroll which would be better if each section expanded for those that make sense and those that need to be grouped
// then should be together." Settings keeps every 3.8 section (a label, its list, its notes), each in one of six groups that open and
// close; ui/settings.js draws them. Settings opens as an overview, every group closed, each time it is shown (readability first); a row
// something points to opens its own group, and the Benchmark group opens for a run. Which group a section goes to: an id inside it,
// else its label's words, else the group of the section before it (a row or section another part of p0pc0rn adds next to an old one
// stays with it).

export const GROUPS = [
  { id: 'models', title: 'Models & downloads', sub: 'Download or delete each model' },
  { id: 'juli', title: 'Juli', sub: 'Lookups, About me, routines, memory' },
  { id: 'making', title: 'Making', sub: 'Cast, clip memory, heat' },
  { id: 'bench', title: 'Benchmark', sub: 'How fast this phone runs p0pc0rn' },
  { id: 'storage', title: 'Storage & data', sub: 'Space and files on this phone' },
  { id: 'about', title: 'Rights, licences & About', sub: 'Your agreement, licences, version' },
];

/** group -> the ids (anywhere inside a section) and the label words that put a section there */
export const PARTS = {
  models: { ids: ['models', 's-android', 's-models-why'], labels: ['models'] },
  juli: { ids: ['s-assistant', 'l-assistant', 'brainmode', 'l-brainmode', 's-qclear'], labels: ['juli', 'juli’s memory', "juli's memory"] },
  making: { ids: ['s-cast', 'l-cast', 'budget', 'l-budget', 's-heat'], labels: ['cast', 'video decode memory', 'heat'] },
  bench: { ids: ['l-bench', 's-bench-quick', 's-bench-full', 's-bench-out'], labels: ['benchmark'] },
  storage: { ids: ['s-persist', 's-used', 'files', 's-clean'], labels: ['storage', 'on this phone'] },
  about: { ids: ['rights', 'r-agreed', 's-ver', 's-lic', 's-roadmap', 's-x'], labels: ['rights & copyright', 'about', 'road map', 'connect'] },
};

const norm = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().toLowerCase();

/** a section ({ ids: [every id in it], label: its label's text }) -> its group's id, or null when nothing names it */
export function groupOf(part) {
  const ids = new Set((part && part.ids) || []), label = norm(part && part.label);
  for (const g of GROUPS) if (PARTS[g.id].ids.some((id) => ids.has(id))) return g.id;
  for (const g of GROUPS) if (label && PARTS[g.id].labels.includes(label)) return g.id;
  return null;
}

/** every section's group, in order: a section nothing names joins the section before it (the first one: the first group) */
export function assign(parts) {
  const out = [];
  for (const p of parts || []) out.push(groupOf(p) || (out.length ? out[out.length - 1] : GROUPS[0].id));
  return out;
}

/** one group open at a time: a tap on a closed group opens it (the others close), a tap on the open one closes it (null = none) */
export function toggled(open, tapped) {
  if (!GROUPS.some((g) => g.id === tapped)) return open;
  return open === tapped ? null : tapped;
}

/** the group open when Settings is shown: none (the overview), except the Benchmark group while a run is on, or once after its results
 *  landed while Settings was not on screen */
export function openOnShow({ running = false, landed = false } = {}) {
  return running || landed ? 'bench' : null;
}

/** the benchmark's card (#s-bench-out): its group opens when a run starts and when its results land, so the person sees them; not on
 *  each step of a run (a person who closed the group keeps it closed), and not for an earlier run's card shown when the page opens.
 *  text = the card's words now ('' = hidden), wasRunning = it said "Running" before -> { open, running } */
export function benchOpens(text, wasRunning) {
  const running = /^\s*Running\b/.test(String(text || ''));
  return { open: running ? !wasRunning : !!wasRunning && !!norm(text), running };
}
// 3.9 settingschat 1e99a47a202d
