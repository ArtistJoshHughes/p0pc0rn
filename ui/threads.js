// ui/threads.js - p0pc0rn 3.9: Juli's conversations, listed like a phone's messages app. A conversation IS one of the agent's sessions
// (assistant/agent.js: IndexedDB 'p0pc0rn-assistant', store 'sessions'): its own messages and its own short history, so a plan only
// ever sees the turns of its own conversation. This module keeps a small index beside them in its own IndexedDB ('p0pc0rn-chats',
// store 'threads': {id, title, preview, at, n, unread, createdAt}) so the list never loads every session's messages, and the agent's
// database keeps its 3.8 version (an older page or a second tab still opens it). The index is built ONCE from the sessions 3.8 left
// (the chat that was open, and every earlier one that has messages; an empty "New chat" is not listed) and is then kept current by
// touch() for every message. Pure helpers first (node-tested), then the store.
import { openDB } from '../assistant/idb.js';

export const IDX = 'p0pc0rn-chats', TITLE_MAX = 40, PREVIEW_MAX = 80;
const QUIET = new Set(['status', 'welcome', 'ready', 'setup', 'routine']);   // never unread: progress lines, the scripted onboarding, a routine's card (Juli's answer to it counts)
const WIDE = new Set(['status', 'result', 'notice', 'routine']);              // full-width items: they stand alone, never in a bubble group
const MEDIA = { picture: 'A picture', edit: 'A picture', clip: 'A clip', animate: 'A clip', between: 'A clip', song: 'A song', musicvideo: 'A music video',
  mvflf: 'A music video', say: 'A voice line', lipsync: 'A lip-sync clip', talk: 'A lip-sync clip', foley: 'A sound' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GAP = 5 * 60e3;   // two bubbles from the same side more than 5 minutes apart start a new group

/** one line of text, at most max characters: whitespace collapsed, cut at a word with an ellipsis (one long word: a hard cut) */
export function oneLine(text, max = TITLE_MAX) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1), sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}
/** the conversation's name: the first thing the person asked (a photo alone: "A photo"); none yet: "New chat" */
export function titleOf(messages) {
  const first = (messages || []).find((m) => m && m.role === 'user');
  if (!first) return 'New chat';
  return first.text ? oneLine(first.text, TITLE_MAX) : first.photoKey ? 'A photo' : 'New chat';
}
/** a message as the list's second line */
export function previewOf(m) {
  if (!m) return '';
  if (m.role === 'user') return m.text ? oneLine(m.text, PREVIEW_MAX) : m.photoKey ? 'A photo' : '';
  const t = oneLine(m.text || '', PREVIEW_MAX);
  if (m.kind === 'result') { const w = MEDIA[(m.media && m.media.kind) || ''] || 'A result'; return t ? oneLine(`${w} · ${t}`, PREVIEW_MAX) : w; }
  if (m.kind === 'notice') { const h = oneLine(m.title || 'Notice', PREVIEW_MAX); return t ? oneLine(`${h} · ${t}`, PREVIEW_MAX) : h; }
  return t;
}
/** does this message make the conversation unread while it is not on screen? Juli's answers, results and app notices do */
export const counts = (m) => !!m && m.role === 'assistant' && !QUIET.has(m.kind || 'text');
/** a session -> its index record (migrated chats start read) */
export function metaOf(s) {
  const msgs = (s && s.messages) || [], last = msgs[msgs.length - 1];
  return { id: s.id, title: titleOf(msgs), preview: previewOf(last), at: (last && last.at) || s.createdAt || 0, n: msgs.length, unread: 0, createdAt: s.createdAt || 0 };
}
/** a new message in a conversation: its preview and time; unread +1 while the person can't see it, 0 once they do */
export function touch(meta, m, { visible = false } = {}) {
  const x = Object.assign({}, meta);
  if (x.title === 'New chat' && m && m.role === 'user') x.title = titleOf([m]);
  x.preview = previewOf(m) || x.preview; x.at = (m && m.at) || Date.now(); x.n = (x.n || 0) + 1;
  x.unread = visible ? 0 : (x.unread || 0) + (counts(m) ? 1 : 0);
  return x;
}
export const ordered = (list) => [...list].sort((a, b) => (b.at || 0) - (a.at || 0) || (b.createdAt || 0) - (a.createdAt || 0));
export const unreadTotal = (list) => list.reduce((n, x) => n + (x.unread || 0), 0);

// ---- times, in words (p0pc0rn's UI is English; the clock follows the phone's own format)
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const daysAgo = (at, now) => Math.round((startOfDay(now) - startOfDay(at)) / 864e5);
export const clockOf = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** the list's time column: 10:12 today, Yesterday, a weekday this week, 12 Oct, 30 Dec 2025 */
export function listLabel(at, now = Date.now()) {
  const n = daysAgo(at, now), d = new Date(at);
  if (n <= 0) return clockOf(at);
  if (n === 1) return 'Yesterday';
  if (n < 7) return DAYS[d.getDay()];
  return `${d.getDate()} ${MONTHS[d.getMonth()]}` + (d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : '');
}
/** the line between days in a conversation: Today, Yesterday, a weekday this week, Thu 3 Sep, Wed 3 Sep 2025 */
export function dayLabel(at, now = Date.now()) {
  const n = daysAgo(at, now), d = new Date(at);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n < 7) return DAYS[d.getDay()];
  return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()]}` + (d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : '');
}
/** how each message sits in the conversation: side ('me' | 'bot' | 'wide'), first / last of its group (the tail goes on the last), and
 *  a day line before it when the day changed */
export function groups(messages, { now = Date.now(), gap = GAP } = {}) {
  const out = [], list = messages || [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i], p = list[i - 1], side = sideOf(m);
    const day = !p || startOfDay(p.at || 0) !== startOfDay(m.at || 0) ? dayLabel(m.at || 0, now) : null;
    const joins = !!p && side !== 'wide' && sideOf(p) === side && !day && (m.at || 0) - (p.at || 0) <= gap;
    out.push({ side, first: !joins, last: true, day });
    if (joins) out[i - 1].last = false;
  }
  return out;
}
// the kind first: a routine (part 4) is sent as the person's turn but drawn as a card of its own
export const sideOf = (m) => (m && WIDE.has(m.kind) ? 'wide' : m && m.role === 'user' ? 'me' : 'bot');

// ---- the index (IndexedDB 'p0pc0rn-chats') over the agent's sessions
/** agentDb: the agent's database handle (agent.db: get / all / del on 'sessions'); indexDb: optional (tests), else opened here;
 *  currentId: the conversation that was open (3.8's chat) -> the store */
export async function createThreads({ agentDb, indexDb = null, currentId = null } = {}) {
  const db = indexDb || await openDB(IDX, 1, { threads: { keyPath: 'id' } });
  const MARK = '_built';
  if (!(await db.get('threads', MARK))) {   // once: every 3.8 session with messages (and the chat that was open) becomes a conversation
    const sessions = agentDb ? await agentDb.all('sessions').catch(() => []) : [];
    await db.putMany('threads', sessions.filter((s) => s && (s.messages || []).length || (s && s.id === currentId)).map(metaOf));
    await db.put('threads', { id: MARK, at: Date.now(), v: 1 });
  }
  const isRec = (x) => x && typeof x.id === 'string' && !x.id.startsWith('_');
  // one read-change-write at a time: a result and Juli's line posted in the same moment both count (no lost update)
  let chain = Promise.resolve();
  const one = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  const T = {
    persistent: db.persistent !== false,
    async list() { return ordered((await db.all('threads')).filter(isRec)); },
    get: (id) => db.get('threads', id),
    /** a conversation that just started (agent.newSession()) */
    ensure: (s) => one(async () => { if (!(await db.get('threads', s.id))) await db.put('threads', metaOf(s)); }),
    /** a message in conversation sid (any conversation, on screen or not) */
    touch: (sid, m, opts = {}) => one(async () => {
      let meta = await db.get('threads', sid);
      if (!meta) {   // a conversation the index never saw (made before it, or by another tab): from its session, which already holds m
        const s = agentDb ? await agentDb.get('sessions', sid).catch(() => null) : null;
        if (s) { meta = metaOf(s); meta.unread = !opts.visible && counts(m) ? 1 : 0; await db.put('threads', meta); return meta; }
        meta = metaOf({ id: sid, createdAt: (m && m.at) || Date.now(), messages: [] });
      }
      meta = touch(meta, m, opts); await db.put('threads', meta); return meta;
    }),
    read: (sid) => one(async () => { const m = await db.get('threads', sid); if (m && m.unread) { m.unread = 0; await db.put('threads', m); } }),
    /** the conversation goes: its index record and the session itself (results stay in the Library) */
    remove: (sid) => one(async () => { await db.del('threads', sid); if (agentDb) await agentDb.del('sessions', sid).catch(() => {}); }),
    async total() { return unreadTotal((await db.all('threads')).filter(isRec)); },
    /** the open conversation, re-read from its session (its record may have missed messages made before this page listened) */
    refresh: (s) => one(async () => { const old = await db.get('threads', s.id), m = metaOf(s); if (old) m.unread = 0; await db.put('threads', m); return m; }),
  };
  return T;
}
