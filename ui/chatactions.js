// ui/chatactions.js - p0pc0rn 3.9: the action bubbles under a result in Juli's chat (Josh: "continuing the bubble land with options",
// "I meant like rerender things like that" + "we don't have all of those features in popcorn but yes the same concept").
// Only what p0pc0rn already does, each on its existing path:
//   again   - "Make again": the same job through the queue with a new seed (the queue gives a seeded kind one); the result comes back
//             into this conversation and goes to the Library like Juli's own (ui/chat.js posts it)
//   edit / animate / clip2 - the Library viewer's "Edit this", "Animate" and "Clip to another picture" (app.js chatAct: Create opens
//             with the picture in place)
//   animate on a song - the music video (app.js animateSong), board - its storyboard (openBoard), lipsync - a Cast voice line's lip-sync
//   save / open - the labelled copy (shareItem) and the Library viewer
// Pure: which actions a result gets, and the parameters of a job made again. Node-tested.
export const ACTIONS = {
  again: { label: 'Make again', icon: 'i-dice' },
  edit: { label: 'Edit this', icon: 'i-pencil' },
  animate: { label: 'Animate', icon: 'i-anim' },
  clip2: { label: 'Clip to another picture', icon: 'i-frames' },
  board: { label: 'Edit video', icon: 'i-film' },
  lipsync: { label: 'Lip-sync · experimental', icon: 'i-anim' },
  save: { label: 'Save', icon: 'i-share' },
  open: { label: 'Open in Library', icon: 'i-grid' },
};
const AGAIN = new Set(['picture', 'edit', 'clip', 'animate', 'between', 'song']);   // render jobs that run again as they are (a music video has a storyboard)
const PICS = new Set(['picture', 'edit']), CLIPS = new Set(['clip', 'animate', 'between']);
/** can this job kind simply run again (same parameters, new seed)? */
export const againable = (kind) => AGAIN.has(kind);
/** the actions for a result: media = {kind, mvId}; caps = {picOK (the picture reader: a picture can become a clip), animateSong, board,
 *  talk} -> action ids, creative ones first */
export function actionsFor(media, caps = {}) {
  if (!media) return [];
  const k = media.kind;
  if (PICS.has(k)) return ['again', 'edit', ...(caps.picOK ? ['animate', 'clip2'] : []), 'save', 'open'];
  if (CLIPS.has(k)) return ['again', 'save', 'open'];
  if (k === 'song') return ['again', ...(caps.animateSong !== false ? ['animate'] : []), 'save', 'open'];
  if (k === 'musicvideo') return [...(media.mvId && caps.board !== false ? ['board'] : []), 'save', 'open'];
  if (k === 'say') return [...(caps.talk !== false ? ['lipsync'] : []), 'save'];
  return ['save', 'open'];
}
/** a job made again: its parameters without the seed (the queue picks a new one) and with its OWN copy of every stored input (a key
 *  ending in Key / Keys: queue.remove() deletes the blobs a job's parameters name, so two jobs must never share one). null when an
 *  input is gone (the job could not run). io = {getBlob(key), putBlob(blob)} (the queue's) */
export async function againParams(params, io) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k === 'seed') continue;
    if (/Key$/.test(k) && typeof v === 'string') { const b = await io.getBlob(v); if (!b) return null; out[k] = await io.putBlob(b); continue; }
    if (/Keys$/.test(k) && Array.isArray(v)) {
      const keys = [];
      for (const x of v) { if (typeof x !== 'string') { keys.push(x); continue; } const b = await io.getBlob(x); if (!b) return null; keys.push(await io.putBlob(b)); }
      out[k] = keys; continue;
    }
    out[k] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  return out;
}
