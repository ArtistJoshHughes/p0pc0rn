// ui/chat.js - p0pc0rn v019: the Assistant tab (the conversation with the on-device assistant, assistant/agent.js) and the queue sheet
// (assistant/queue.js). Plain DOM, like app.js. The app owns the engines, the queue and the agent and hands them over in `api`
// (app.js chatApi()); this module only shows them and sends what the person types.
//   - bubbles from agent.session(id).messages + agent 'message' events; the assistant's words stream in while it answers
//   - a job card under each "making it" line: queue position, popcorn while it renders, phase, progress, time left, Cancel (two taps)
//   - results: the picture, the clip, the song (player, Save as .m4a, style + lyrics) or the music video, also saved in the Library
//   - the queue sheet: every job in the order it will run, progress, Cancel, move up / down, pause the queue, the finished ones
//   - v023: a landed song's bubble offers Animate (a music video, end-capped first/last frame: assistant/mvflf.js; the app opens its
//     sheet). There is no chat command for it. The music video's card and queue row open its storyboard; a cut's bubble offers Edit video.
//   - onboarding (Josh: "like Ollama does"): a new install opens here. Until the assistant is on the phone the chat runs on a script, in
//     code (no model, nothing is made): its first message ('welcome') offers the assistant + the starter knowledge as ONE download, with
//     the sizes the packs report; a typed message gets a scripted answer ('setup') that offers what it needs; 'ready' says when the
//     assistant has landed. With the assistant on the phone, a request for a model it has no tool for (lip-sync, Klein 9B) or a plain
//     "download the … model" is answered the same way while that model is missing; everything else goes to the assistant as before.
//     These messages stay in the chat but never reach the model (history: false).
//   - 3.9 (Josh: "chat with Juli should feel like a text message conversation ... with a "new chat button" and continuing the bubble
//     land with options"): bubbles in groups with a tail on the last one, a line between days, a bubble's time on a tap, a typing bubble
//     while Juli works; results as picture / clip / song bubbles with ACTION bubbles under them (ui/chatactions.js: only what p0pc0rn
//     already does; Make again = the same job with a new seed, its card and result posted in this conversation); Chats: every
//     conversation (one agent session each, so a plan still sees only its own turns) with its first question, last line, time and
//     unread count (ui/threads.js), New chat, swipe left or press and hold to delete. Juli's unread count also goes to the phone-OS
//     shell's badge when the shell is there (globalThis.SHELL).
import * as store from '../store.js';
import { $, ls, clock, about, reducedMotion, isAbort } from '../util.js';
import { researchList, lyricsEl } from './research.js';   // v026.2: the research list
import { createThreads, titleOf, groups, listLabel, clockOf } from './threads.js';   // 3.9: the conversations, listed
import { ACTIONS, actionsFor, againable, againParams } from './chatactions.js';   // 3.9: the action bubbles under a result
const JULI_ICON = new URL('../icons/ui/juli-120.png', import.meta.url).href;   // 3.9: Juli's avatar in Chats (ART's icon, part 8; else the letter J)

// 3.9 polish (Josh, Oct-26: "Juli chat is a general chat now with a research agent capabilities via Wikipedia and fandom. The chats
// instructions only say creation prompts."): what Juli does, an example of each (the start screen; "I'm ready" offers the same)
const HELLO = [
  { kind: 'ask', icon: 'i-chat', label: 'Ask me something', tries: ['Can dogs eat grapes?'] },
  { kind: 'look', icon: null, label: 'Look it up on Wikipedia or Fandom', tries: ['Who directed Spirited Away?'] },
  { kind: 'make', icon: 'i-sparkle', label: 'Make a song, a picture or a clip', tries: ['A picture of a red fox in fresh snow at sunrise', 'Make me a song about the last train home, synthwave'] },
];
const SUGGEST = HELLO.flatMap((h) => h.tries);
// ---- onboarding: what a message asks for (model keys of the app's MODELS; 'assist' = the assistant + the starter knowledge)
const SETUP = new Set(['welcome', 'ready', 'setup']);
const WANTS = [
  ['image', /\b(?:pictures?|photos?|images?|draw(?:ing)?|paint(?:ing)?|illustrations?|portraits?|posters?|wallpapers?)\b/i],
  ['music', /\b(?:songs?|music|sing(?:ing)?|lyrics|melody|tune)\b/i],
  ['video', /\b(?:clips?|videos?|animat(?:e|ion)|film|movie)\b/i],
  ['voice', /\b(?:voices?|clone)\b/i],
  ['lipsync', /\blip[\s-]?(?:sync|synch|dub)/i],
  ['k9b', /\b(?:klein[\s-]*)?9\s?b\b/i],
];
/** the models a message asks for (a music video needs pictures, clips and the song; lip-sync needs a Cast voice, not the video model) */
export function wants(text) {
  const t = String(text || '');
  let out = WANTS.filter(([, re]) => re.test(t)).map(([k]) => k);
  if (/\bmusic videos?\b/i.test(t)) for (const k of ['image', 'video']) if (!out.includes(k)) out.push(k);
  if (out.includes('lipsync')) { out = out.filter((k) => k !== 'video'); if (!out.includes('voice')) out.push('voice'); }   // "lip-sync my clip"
  return out;
}
const NAMED = [['assist', /\b(?:assistant|gemma)\b/i], ['starter', /\b(?:starter|knowledge)\b/i], ['k9b', /\b9\s?b\b/i], ['lipsync', /\blip[\s-]?sync/i], ['voice', /\bvoice\b/i],
  ['planner', /\blyrics planner\b/i], ['reader', /\bpicture reader\b/i], ['music', /\b(?:music|songs?)\b/i], ['video', /\b(?:videos?|clips?)\b/i], ['image', /\b(?:pictures?|images?|photos?)\b/i]];
/** a plain "download / get / install the … model" (or the assistant, the starter knowledge, the 9B) -> those keys, else []. Only a message
 *  that starts with the ask and makes nothing ("get the music model", not "get the assistant to write a song") */
export function explicitAsk(text) {
  const t = String(text || '');
  if (!/^\s*(?:please\s+|can you\s+|could you\s+|i want to\s+|i'd like to\s+)*(?:download|get|install)\b/i.test(t) || /\b(?:make|draw|paint|write|create|sing|compose|animate)\b/i.test(t)
    || !/\b(?:models?|assistant|starter|lyrics planner|picture reader|9\s?b)\b/i.test(t)) return [];
  let out = NAMED.filter(([, re]) => re.test(t)).map(([k]) => k).filter((k, i, a) => a.indexOf(k) === i);
  if (out.includes('reader')) out = out.filter((k) => k !== 'image');   // "the picture reader" is not the picture model
  if (out.includes('planner')) out = out.filter((k) => k !== 'music');
  if (out.includes('assist')) out = out.filter((k) => k !== 'starter');   // the assistant's download brings the starter knowledge too
  return out;
}
/** a request as a prompt for Create ("make me a picture of a red fox" -> "A red fox") */
export function promptOf(text) {
  const t = String(text || '').trim(), p = t.replace(/^(?:please\s+|can you\s+|could you\s+)*(?:make|draw|paint|create|generate|show|give)\s+(?:me\s+)?(?:(?:an?\s+|the\s+|some\s+)?(?:\d+[\s-]*seconds?\s+|short\s+)?(?:pictures?|photos?|images?|paintings?|drawings?|illustrations?|clips?|videos?|animations?)\s+(?:of\s+|showing\s+|with\s+)?)?/i, '').trim();
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : t;
}
const SPECIAL = /<\|?(?:turn|tool_call|tool_response|"|channel|image|audio)\|?>|<eos>|<bos>|<turn\|>|<tool_call\|>|<\|turn>/g;
const nth = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const svg = (id, cls = 'ic') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };
const btn = (label, cls = 'btn sm', icon = null) => { const b = mk('button', cls); b.type = 'button'; if (icon) b.append(svg(icon)); b.append(mk('span', null, label)); return b; };
const lens = (cls = 'ic') => { const N = 'http://www.w3.org/2000/svg', s = document.createElementNS(N, 'svg'), c = document.createElementNS(N, 'circle'), p = document.createElementNS(N, 'path');
  s.setAttribute('class', cls); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); c.setAttribute('cx', '10.5'); c.setAttribute('cy', '10.5'); c.setAttribute('r', '5.75');
  p.setAttribute('d', 'm15 15 4.5 4.5'); s.append(c, p); return s; };   // 3.9 polish: a magnifier (our own drawing; the sprite has none)

export function createChat(api) {
  const C = { sid: ls.get('pf.app.chatSession', null), shown: false, urls: new Set(), cards: new Map(), stream: null, photo: null, typing: null,
    pop: null, popCanvas: null, popJob: null, unread: false, armed: new Map(), qopen: false, loadTok: 0,
    declined: false, lastUser: '', setupBusy: null, brainWas: null,   // onboarding: "Not now" was tapped; the last thing the person asked
    list: false, th: null, thP: null, total: 0, last: null, landed: new Set(), icon: false, iconP: null, ensuring: null };   // 3.9: Chats is showing; the conversations' index; unread; the last bubble (groups); results made again, posted; Juli's icon
  const Q = () => api.Q, AG = () => api.AG;

  // ---------------------------------------------------------------------------------------------- 3.9: the conversations (ui/threads.js)
  /** the index of conversations, built once from the agent's sessions (null when Juli couldn't start) */
  const threads = () => C.thP || (C.thP = AG() ? createThreads({ agentDb: AG().db, currentId: C.sid }).then((t) => (C.th = t)).catch(() => null) : Promise.resolve(null));
  const onScreen = (sid) => C.shown && !C.list && sid === C.sid && document.visibilityState === 'visible';
  /** Juli's unread count: the Chats button, the tab's dot, and the phone-OS shell's badge when the shell is there */
  async function paintUnread() {
    const t = await threads(); C.total = t ? await t.total().catch(() => 0) : 0;
    const n = $('as-chats-n'); if (n) { n.hidden = !C.total; n.textContent = C.total > 99 ? '99+' : String(C.total); }
    renderDot();
    try { if (globalThis.SHELL && typeof SHELL.badge === 'function') SHELL.badge('assistant', C.total); } catch (e) { /* the shell is optional */ }
  }
  /** a message in any conversation: its line in Chats; unread while the person can't see it */
  async function track(sid, m) {
    const t = await threads(); if (!t) return;
    await t.touch(sid, m, { visible: onScreen(sid) }).catch(() => {});
    paintUnread(); if (C.list) renderList();
  }
  /** Chats: every conversation, newest first */
  async function openList() {
    if (!AG()) return;
    C.list = true; $('as-list').hidden = false; $('v-assistant').classList.add('listing'); $('chat-bar').classList.add('listing');
    await renderList(); const m = $('main'); if (m) m.scrollTo({ top: 0 });
  }
  function closeList() {
    C.list = false; $('as-list').hidden = true; $('v-assistant').classList.remove('listing'); $('chat-bar').classList.remove('listing');
  }
  /** Juli's avatar: ART's final icon (part 8 installs icons/ui/juli-120.png) when this build has it, else the letter J; loaded once */
  const juliIcon = () => C.iconP || (C.iconP = new Promise((res) => {
    const im = new Image(); im.onload = () => res(C.icon = im.naturalWidth > 0); im.onerror = () => res(C.icon = false); im.src = JULI_ICON;
  }));
  async function renderList() {
    const t = await threads(), box = $('as-threads'); if (!t || !box) return;
    await juliIcon();
    const all = await t.list().catch(() => []), now = Date.now();
    box.replaceChildren(...all.map((x) => threadRow(x, now)));
    $('as-threads-none').hidden = all.length > 0;
  }
  function threadRow(x, now) {
    const row = mk('div', 'as-thread'), title = x.title || 'New chat', when = listLabel(x.at || x.createdAt || now, now);
    row.setAttribute('role', 'listitem'); row.dataset.sid = x.id;
    const del = mk('button', 'as-thread-del', 'Delete'); del.type = 'button'; del.tabIndex = -1;
    const main = mk('button', 'as-thread-main'); main.type = 'button';
    main.classList.toggle('unread', !!x.unread); main.classList.toggle('current', x.id === C.sid);
    const av = mk('span', 'as-av'); av.setAttribute('aria-hidden', 'true');
    if (C.icon) { const im = mk('img', 'as-av-img'); im.alt = ''; im.draggable = false; im.src = JULI_ICON; av.classList.add('has-icon'); av.append(im); } else av.textContent = 'J';
    const top = mk('span', 'as-thread-top'); top.append(mk('span', 'as-thread-title headline', title), mk('span', 'as-thread-time footnote num', when));
    const txt = mk('span', 'as-thread-txt'); txt.append(top, mk('span', 'as-thread-prev footnote', x.preview || ' '));
    main.append(av, txt);
    if (x.unread) { const u = mk('span', 'as-thread-n num', x.unread > 99 ? '99+' : String(x.unread)); u.setAttribute('aria-hidden', 'true'); main.append(u); }
    main.setAttribute('aria-label', `${title}. ${x.preview || ''} ${when}${x.unread ? `. ${x.unread} unread` : ''}`);
    main.onclick = () => {
      if (main.dataset.held || main.dataset.swiped) return;
      if (row.classList.contains('open')) { row.classList.remove('open'); main.style.transform = ''; return; }
      openThread(x.id);
    };
    del.onclick = () => removeThread(x.id, title);
    main.addEventListener('keydown', (e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeThread(x.id, title); } });   // a keyboard's way to the same sheet
    row.append(del, main); swipeRow(row, main, () => removeThread(x.id, title));
    return row;
  }
  /** a row swiped left shows Delete; press and hold asks the same (so deleting never depends on a swipe) */
  function swipeRow(row, main, onHold) {
    const W = 88; let x0 = 0, y0 = 0, dx = 0, drag = false, pid = null, hold = null;
    const set = (v, ease) => { main.style.transition = ease ? '' : 'none'; main.style.transform = v ? `translateX(${v}px)` : ''; };
    main.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return; pid = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = row.classList.contains('open') ? -W : 0; drag = false;
      clearTimeout(hold); hold = setTimeout(() => { hold = null; if (drag || pid == null) return; pid = null; main.dataset.held = '1'; setTimeout(() => { delete main.dataset.held; }, 600); onHold(); }, 550);
    });
    main.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!drag && Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { clearTimeout(hold); pid = null; return; }   // a scroll
      if (!drag && Math.abs(mx) > 8) { drag = true; clearTimeout(hold); try { main.setPointerCapture(pid); } catch (x) { /* */ } }
      if (drag) { dx = Math.max(-W - 12, Math.min(0, mx + (row.classList.contains('open') ? -W : 0))); set(dx); }
    });
    const end = (e) => {
      if (e.pointerId !== pid) return; clearTimeout(hold); pid = null;
      if (!drag) return; drag = false;
      const open = dx < -W / 2; row.classList.toggle('open', open); set(open ? -W : 0, true);
      main.dataset.swiped = '1'; setTimeout(() => { delete main.dataset.swiped; }, 80);
    };
    main.addEventListener('pointerup', end); main.addEventListener('pointercancel', end);
  }
  async function openThread(sid) {
    const ag = AG(); if (!ag) return;
    if (!(await ag.session(sid))) { const t = await threads(); if (t) await t.remove(sid); return renderList(); }   // gone (another tab deleted it)
    C.sid = sid; ls.set('pf.app.chatSession', sid); C.unread = false;
    closeList(); await rebuild(); sweepAgain();
  }
  /** delete a conversation (its messages; what Juli made stays in the Library) - never one Juli is still working in */
  function removeThread(sid, title) {
    const q = Q();
    if (q && q.list({ includeTerminal: false }).some((j) => j.session === sid)) return api.toast('Juli is still working in that chat. Delete it when she is done.');
    const go = async () => {
      const t = await threads(); if (!t) return;
      await t.remove(sid).catch(() => {});
      if (sid === C.sid) { const rest = await t.list().catch(() => []); C.sid = rest.length ? rest[0].id : null; ls.set('pf.app.chatSession', C.sid); }
      await renderList(); paintUnread(); api.toast('Chat deleted');
    };
    if (api.confirm) api.confirm('Delete this chat?', `“${title}” and its messages go from this phone. What Juli made stays in the Library.`, 'Delete', go); else go();
  }

  // ---------------------------------------------------------------------------------------------- 3.9: Make again (ui/chatactions.js)
  const AGAIN = 'chat:again';   // the queue tag of a job made again from an action bubble
  /** the same job with a new seed (and its own copy of any picture it reads); its card here, its result posted here when it lands */
  async function again(m, el) {
    const q = Q(), ag = AG(), j = q && m && q.get(m.jobId);
    if (!q || !ag || !j || !againable(j.kind)) return api.toast("That can't be made again from here.");
    if (api.readOnly()) return api.toast('p0pc0rn is open in another tab.');
    if (el) el.disabled = true;
    try {
      const params = await againParams(j.params, { getBlob: (k) => q.getBlob(k), putBlob: (b) => q.putBlob(b, { role: 'again' }) });
      if (!params) return api.toast("Its picture isn't on this phone any more.");
      const sid = C.sid || await ensureSession();
      const nj = await q.add(j.kind, params, { session: sid, title: j.title || '', tag: AGAIN });
      await ag.say(sid, { kind: 'status', text: 'Making it again', jobId: nj.id, history: false });
    } catch (e) { api.toast("Couldn't start it. Try again."); }
    finally { if (el) setTimeout(() => { el.disabled = false; }, 1200); }
  }
  /** a job made again that finished: its result in its own conversation (so it goes to the Library like Juli's own) */
  async function landAgain(j) {
    if (!j || j.tag !== AGAIN || j.status !== 'done' || C.landed.has(j.id)) return;
    C.landed.add(j.id);
    const ag = AG(), sid = j.session; if (!ag || !sid) return;
    const s = await ag.session(sid); if (!s || s.messages.some((x) => x.kind === 'result' && x.jobId === j.id)) return;
    const r = j.result || {}, key = (r.image && r.image.blobKey) || (r.video && r.video.blobKey) || (r.audio && r.audio.blobKey);
    if (key) await ag.say(sid, { kind: 'result', text: 'Here it is again.', jobId: j.id, media: { kind: j.kind, blobKey: key }, history: false });
  }
  function sweepAgain() { const q = Q(); if (q) for (const j of q.list()) if (j.tag === AGAIN && j.status === 'done') landAgain(j).catch(() => {}); }

  // ---------------------------------------------------------------------------------------------- the session
  /** the open conversation, made when none is open. Callers at the same moment share one: when Juli's screen opens, render() and
   *  show() both ask (3.9: one "New chat", not two) */
  function ensureSession() { return C.ensuring || (C.ensuring = ensureOne().finally(() => { C.ensuring = null; })); }
  async function ensureOne() {
    const ag = AG(); if (!ag) return null;
    if (C.sid && await ag.session(C.sid)) return C.sid;
    const s = await ag.newSession(); C.sid = s.id; ls.set('pf.app.chatSession', s.id);
    const t = await threads(); if (t) await t.ensure(s).catch(() => {});   // 3.9: listed in Chats
    return s.id;
  }
  async function newChat() {
    const ag = AG(); if (!ag) return;
    const s = await ag.newSession(); C.sid = s.id; ls.set('pf.app.chatSession', s.id);
    const t = await threads(); if (t) await t.ensure(s).catch(() => {});
    closeList(); await rebuild();   // 3.9: the new conversation, empty, ready to type in (Chats lists it)
  }

  // ---------------------------------------------------------------------------------------------- the top cards + the composer
  function render() {
    const brain = api.done('brain'), arrived = C.brainWas === false && brain; C.brainWas = brain;
    if (!C.shown) { if (arrived && AG() && C.sid) ensureSetup(false).catch(() => {}); renderDot(); return; }   // onboarding: "I'm ready" waits in the chat (the tab's dot)
    renderNeed(); renderComposer(); renderPending(); renderDot();
    for (const b of document.querySelectorAll('#v-assistant .dl-btn')) paintDl(b);
    for (const e of document.querySelectorAll('#as-log .as-free')) e.textContent = freeLine();
    if (!$('as-hello').hidden) renderMusicHint();
    if (brain && AG() && !C.built) { C.built = true; ensureSession().then(rebuild); }   // the assistant just arrived: say hello
  }
  function renderNeed() {
    const k = 'brain', m = api.MODELS[k], u = api.S.dl[k], ready = api.done(k), st = api.S.st[k] || {};
    const card = $('as-need'); card.hidden = ready || !!AG();   // onboarding: with the chat working, its first message offers the assistant
    const ag = !api.consented() && ready; $('as-agree').hidden = !ag;
    const err = api.agentError(), ro = api.readOnly();
    $('as-note').hidden = !(err || ro);
    if (err || ro) $('as-note-text').textContent = ro ? 'p0pc0rn is open in another tab. Chat there, or close it and reopen this one.' : `Juli couldn't start (${err}). Reload p0pc0rn to try again.`;
    if (ready) return;
    const live = u.sub !== 'idle' || u.have > 0;
    $('as-need-title').textContent = { downloading: 'Downloading Juli', pausing: 'Pausing…', paused: 'Download paused', dropped: 'Paused — connection dropped', failed: 'Download stopped' }[u.sub] || 'Get Juli';
    $('as-need-text').textContent = u.sub === 'failed' ? "Couldn't reach the model server. Check Wi-Fi (and that you are signed in to it), then Resume."
      : st.error && !u.have ? "Couldn't reach the model server. Connect to Wi-Fi, then try Download."
      : `Juli (${m.what}) answers questions, looks things up on Wikipedia and Fandom, and makes songs, pictures and clips with the picture, video and music models. It runs on this phone: one-time download · ${api.fmtSize(u.total)} · Wi-Fi and a charger recommended; keep this screen open.`;
    $('as-need-bar').hidden = !live; $('as-need-fill').style.transform = `scaleX(${api.dlPct(u).toFixed(4)})`;
    $('as-need-line').hidden = !live; $('as-need-line').textContent = api.dlLine(u, true);
    const b = $('as-need-go'), dl = u.sub === 'downloading';
    b.disabled = u.sub === 'pausing';
    b.querySelector('use').setAttribute('href', dl ? '#i-pause' : u.have > 0 ? '#i-play' : '#i-download');
    b.querySelector('span').textContent = api.dlLabel(u);
  }
  function canSend() { return !!AG() && !api.readOnly() && !api.agentError(); }   // onboarding: without the assistant, the script answers
  function renderComposer() {
    const ok = canSend();
    $('as-in').disabled = !AG();
    $('as-add').hidden = !api.done('brain');   // a photo is for the assistant: no photo button before it is on the phone
    $('as-send').setAttribute('aria-disabled', String(!ok || !$('as-in').value.trim() || (C.photo && !C.photo.attest)));
    $('as-photo').hidden = !C.photo;
  }
  /** the hello (an empty chat), and "thinking" while this chat's turn waits for the model or runs */
  async function renderPending() {
    const q = Q(); if (!q || !C.sid) return;
    const turns = q.list({ includeTerminal: false }).filter((j) => j.kind === 'chat' && j.session === C.sid && ((j.params && j.params.purpose) || 'turn') === 'turn' && (j.status === 'queued' || j.status === 'running' || j.status === 'blocked'));
    const t = turns[0], log = $('as-log');
    if (!t || (C.stream && C.stream.jobId === t.id)) { if (C.typing) { C.typing.remove(); C.typing = null; } return; }
    if (!C.typing) {   // 3.9: Juli's typing bubble: three dots that bounce, what she is doing under it
      C.typing = mk('div', 'msg bot typing g-bot g-first g-last'); const d = mk('span', 'dots'); d.setAttribute('role', 'img'); d.setAttribute('aria-label', 'Juli is typing'); d.append(mk('i'), mk('i'), mk('i'));
      C.typing.append(d, mk('span', 'footnote dim tp-text')); log.append(C.typing); scrollDown();
    }
    const a = q.active && q.active.job;
    // v026.2: the research list, live, under the activity line (from the event, else from the job's own state after a reload)
    const rows = (C.rl && C.rl.jid === t.id && C.rl.rows) || (t.state && t.state.rl) || null;
    let box = C.typing.querySelector('.rl-live'); if (!box) { box = mk('div', 'rl-live'); C.typing.append(box); }
    box.replaceChildren(); const live = rows && researchList(rows, { live: true }); if (live) box.append(live);
    C.typing.querySelector('.tp-text').textContent = t.status === 'running' && C.activity ? C.activity : t.status === 'blocked' ? (t.error && t.error.code === 'NO_CONSENT' ? 'Waiting for the agreement' : 'Waiting for a download')
      : t.status === 'running' ? 'Thinking…' : a && a.id !== t.id ? (a.kind === 'chat' ? 'Waiting for the other chat…' : 'Waiting for the graphics chip: a job is running') : 'Thinking…';
  }
  function renderDot() {
    // 3.9: + unread in any conversation. With the phone-OS shell its badge shows the count (paintUnread) and this dot stays off (the
    // shell reads a lit dot as 1, which would hide the count)
    const d = document.querySelector('.tab[data-tab="assistant"] .tab-dot'), on = !(globalThis.SHELL && typeof SHELL.badge === 'function') && (C.unread || C.total > 0) && !C.shown;
    if (d && d.classList.contains('on') !== on) d.classList.toggle('on', on);
  }

  // ---------------------------------------------------------------------------------------------- show / hide the tab
  async function show() {
    C.shown = true; C.unread = false; renderDot();
    if (C.list) closeList();   // 3.9: Juli opens on the conversation that was open
    $('as-attest-text').textContent = api.rights.ATTEST;
    render();
    if (AG()) { C.built = api.done('brain'); await ensureSession(); await rebuild(); sweepAgain(); }
  }
  function hide() {
    C.shown = false; C.built = false; C.loadTok++;
    if (C.pop) C.pop.stop(); C.popJob = null;
    for (const u of C.urls) URL.revokeObjectURL(u); C.urls.clear();
    C.cards.clear(); C.stream = null; C.typing = null; C.last = null; $('as-log').textContent = '';
    if (C.list) closeList();
  }
  async function rebuild() {
    const tok = ++C.loadTok, ag = AG(), log = $('as-log');
    for (const u of C.urls) URL.revokeObjectURL(u); C.urls.clear(); C.cards.clear(); C.stream = null; C.typing = null;
    if (ag && C.sid) await ensureSetup(true).catch(() => {});   // onboarding: the first message (no assistant yet), or "I'm ready"
    const s = ag && C.sid ? await ag.session(C.sid) : null;
    if (tok !== C.loadTok) return;
    log.textContent = '';
    const msgs = (s && s.messages) || [], brain = api.done('brain');
    $('as-hello').hidden = msgs.length > 0 || !brain; $('as-new').hidden = !brain;   // no New chat before the assistant (3.9: also from a chat with messages)
    if (!$('as-hello').hidden) renderHello();
    const w = msgs.map((m) => m.kind).lastIndexOf('welcome');
    C.declined = w >= 0 && msgs.slice(w + 1).some((m) => m.later);
    C.lastUser = ''; C.last = null;
    const shown = msgs.slice(-60), g = groups(shown);   // 3.9: bubble groups, day lines, the time on a tap
    shown.forEach((m, i) => { place(log, bubble(m), m, g[i]); if (m.role === 'user') C.lastUser = m.text; });
    $('as-title').textContent = titleOf(msgs);
    if (s) threads().then((t) => t && t.refresh(s)).then(paintUnread).catch(() => {});   // on screen: read, and its line in Chats current
    renderPending(); syncPop(); scrollDown(true);
  }
  // ---------------------------------------------------------------------------------------------- onboarding: the scripted messages
  /** the chat's first message while the assistant is not on the phone ('welcome'), and 'ready' once it is; each at most once per stretch,
   *  so a chat whose assistant was deleted gets a new welcome, and its download a new 'ready'. welcome = false: only 'ready' (in the background) */
  async function ensureSetup(welcome = true) {
    if (C.setupBusy) return C.setupBusy;
    const ag = AG(); if (!ag || !C.sid) return;
    C.setupBusy = (async () => {
      const s = await ag.session(C.sid); if (!s) return;
      const kinds = s.messages.map((m) => m.kind), w = kinds.lastIndexOf('welcome'), r = kinds.lastIndexOf('ready');
      if (!api.done('brain')) { if (welcome && (w < 0 || r > w)) await ag.say(C.sid, { kind: 'welcome', text: WELCOME, history: false }); }
      else if (w >= 0 && r < w) await ag.say(C.sid, { kind: 'ready', text: READY, history: false });
    })();
    try { await C.setupBusy; } finally { C.setupBusy = null; }
  }
  const WELCOME = "Hi, I'm Juli, p0pc0rn's assistant. I answer questions, look things up on Wikipedia and Fandom, and make songs, pictures and clips with p0pc0rn's models, here on this phone. First I need a one-time download: Juli and the starter knowledge.";
  const READY = "I'm ready. Ask me something, have me look it up on Wikipedia or Fandom, or ask for a song, a picture or a clip.";
  const has = (k) => (k === 'assist' ? api.done('brain') : k === 'music' ? api.musicDl().ready : api.done(k));
  const offerable = (k) => k === 'assist' || k === 'music' || !!(api.E && api.E[k]);   // the models this phone's app can download
  const nameOf = (k) => (k === 'assist' || k === 'brain' ? 'Juli' : k === 'music' ? 'music' : ['planner', 'reader', 'starter'].includes(k) ? `the ${api.MODELS[k].noun}` : `the ${api.MODELS[k].noun} model`);
  const listOf = (ks) => ks.map(nameOf).join(' and ');
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const freeLine = () => { const p = api.phone ? api.phone() : {}; return `Wi-Fi and a charger recommended; keep this screen open.${p.free != null ? ` ${api.fmtSize(Math.max(0, p.free))} free for p0pc0rn on this phone.` : ''}`; };
  const NEEDS = { image: 'Pictures also need the picture model.', video: 'Clips also need the video model.', music: 'Songs also need the music model and its lyrics planner.',
    voice: 'Cast voices need the voice model, and the person added in Cast.', lipsync: 'Lip-sync (experimental) needs the lip-sync model.',
    k9b: 'Better pictures come from Klein 9B: once it is here, pick Better (9B) in Create › Picture.' };
  /** a message answered here, in code: {text, offer: [model keys], create?} | null (the assistant answers it, or the Cast's say does) */
  function localAnswer(text) {
    const brain = api.done('brain');
    if (C.photo && brain) return null;   // a photo goes to the assistant
    const named = explicitAsk(text).filter(offerable);
    if (named.length) {   // "download the music model": the button, with or without the assistant
      const miss = named.filter((k) => !has(k)), got = named.filter(has), out = [];
      if (got.length) out.push(`${cap1(listOf(got))} ${got.length > 1 ? 'are' : 'is'} already on this phone.`);
      if (miss.length) out.push(miss.length > 1 ? 'Here they are:' : 'Here it is:');
      return { text: out.join(' '), offer: miss };
    }
    const w = wants(text);
    if (brain) {   // the assistant answers everything else; it has no tool for lip-sync or Klein 9B, so their downloads are offered here
      if (w.includes('lipsync') && !has('lipsync')) { const miss = ['lipsync', 'voice'].filter((k) => !has(k)); return { text: `Lip-sync (experimental) needs ${listOf(miss)}. Then ask me to make someone in your Cast say a line, and tap Lip-sync · experimental on it.`, offer: miss }; }
      if (w.includes('k9b') && !has('k9b')) return { text: 'Klein 9B makes better, slower pictures. Download it, then pick Better (9B) in Create › Picture; I make my pictures with the 4B.', offer: ['k9b'] };
      return null;
    }
    if (api.isSayAsk && api.isSayAsk(text)) return null;   // "make <name> say …" is answered in code by the Cast, no assistant needed
    const mode = w.includes('music') ? null : w.includes('video') ? 'video' : w.includes('image') ? 'image' : null;   // Create makes pictures and clips without me
    const create = mode && has(mode) && api.toCreate ? { mode, prompt: promptOf(text) } : null, miss = w.filter((k) => !has(k) && offerable(k));
    const out = [`I'm not on this phone yet, so I can't answer that. Download me first (one time), then ask again${create ? ', or let Create make it without me' : ''}.`];
    for (const k of miss) out.push(NEEDS[k]);
    return { text: out.join(' '), offer: ['assist', ...miss], create };
  }
  /** the person's message and the scripted answer, kept in the chat (never in the model's history) */
  async function localTurn(text, ans, typed) {
    if (typed) { $('as-in').value = ''; grow(); }
    renderComposer();
    try {
      await ensureSession();
      await AG().say(C.sid, { role: 'user', text: text.slice(0, 4000) });
      await AG().say(C.sid, Object.assign({ kind: 'setup', history: false }, ans));
    } catch (e) { api.toast("Couldn't send that. Try again."); if (typed) { $('as-in').value = text; grow(); renderComposer(); } }
  }
  /** "Not now" on the first message: the offer stays (that button, Settings › Models); Create works without the assistant */
  async function notNow() {
    C.declined = true; for (const x of document.querySelectorAll('#as-log .as-later')) x.hidden = true;
    try {
      await ensureSession();
      const pic = has('image');
      await AG().say(C.sid, { kind: 'setup', later: true, history: false, offer: pic ? [] : ['image'],
        text: `OK. Download me any time, here or in Settings › Models. Create makes pictures without me${pic ? '.' : ' once the picture model is on the phone:'}` });
    } catch (e) { /* the button above still works */ }
  }
  /** the first message: what I do, the two parts with the sizes the packs report, the phone's notes, one button for both, Not now */
  function welcomeBody(b) {
    const M = api.MODELS, sz = (k) => api.fmtSize(api.S.dl[k].total || M[k].total), p = api.phone ? api.phone() : {};
    b.append(mk('p', 'msg-text', "Hi, I'm Juli, p0pc0rn's assistant. I answer questions, look things up on Wikipedia and Fandom, and make songs, pictures and clips with p0pc0rn's models, here on this phone."),
      mk('p', 'msg-text', 'First I need a one-time download:'));
    const ul = mk('ul', 'as-parts'); ul.append(mk('li', null, `Juli (${M.brain.what}) · ${sz('brain')}`));
    if (api.E && api.E.starter) ul.append(mk('li', null, `Starter knowledge (${M.starter.what}) · ${sz('starter')}${api.done('starter') ? ' · on this phone' : ''}`));
    b.append(ul, mk('p', 'footnote dim as-free', freeLine()));
    if (p.homeApp && !p.android) b.append(mk('p', 'footnote dim', "Already downloaded it in Safari? iPhone keeps the Home Screen app's storage separate, so this icon needs its own copy."));
    if (p.android) b.append(mk('p', 'footnote dim', 'Android (Chrome): experimental. Settings › About › Device check shows what this phone can run.'));
    const col = mk('div', 'as-offer'), later = btn('Not now', 'btn sm ghost as-later');
    later.onclick = () => notNow(); col.append(dlButton('assist'), later); b.append(col);
    paintDl(col.querySelector('.dl-btn'));
  }
  /** "I'm ready": the person's own last request first, the suggestions, and the models still to get (each offered once more when asked) */
  function readyBody(b) {
    b.append(mk('p', 'msg-text', READY));
    const row = mk('div', 'as-opts');
    const mine = C.lastUser && !explicitAsk(C.lastUser).length ? C.lastUser : '';   // what they asked before the assistant was here, one tap away
    for (const t of [mine, ...SUGGEST].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 4)) { const c = mk('button', 'as-chip', t); c.type = 'button'; c.onclick = () => fill(t); row.append(c); }
    b.append(row);
    const miss = ['image', 'music', 'video'].filter((k) => !has(k) && offerable(k));
    if (miss.length) { const col = mk('div', 'as-offer'); col.append(mk('p', 'footnote dim', 'Pictures, songs and clips each need their own model, once. I offer it when you ask, or get it now:'), ...miss.map(dlButton)); b.append(col); }
  }
  /** a scripted answer: its words, the downloads it offers, and Create when Create can make it without the assistant */
  function setupBody(b, m) {
    b.append(textBlock(m.text));
    const col = mk('div', 'as-offer');
    for (const k of m.offer || []) if (offerable(k)) col.append(dlButton(k));
    if (m.create && api.toCreate) { const c = btn('Open Create with this prompt', 'btn sm ghost', 'i-sparkle'); c.classList.add('as-create'); c.onclick = () => api.toCreate(m.create.prompt, m.create.mode); col.append(c); }
    if (col.childElementCount) b.append(col);
  }
  const fill = (t) => { $('as-in').value = t; grow(); renderComposer(); $('as-in').focus(); };
  function renderHello() {   // 3.9 polish: what Juli does, an example of each (a tap puts it in the composer, as before)
    const box = $('as-try'); if (box.childElementCount) return renderMusicHint();
    for (const h of HELLO) {
      const k = mk('div', 'as-kind'); k.dataset.kind = h.kind;
      const head = mk('p', 'as-kind-h'); head.append(h.icon ? svg(h.icon) : lens(), mk('span', null, h.label));
      if (h.kind === 'look') { const off = mk('span', 'as-kind-off', '· off in Settings'); off.hidden = true; head.append(off); }
      k.append(head);
      for (const t of h.tries) { const b = mk('button', 'as-chip', t); b.type = 'button'; b.onclick = () => { $('as-in').value = t; grow(); renderComposer(); $('as-in').focus(); }; k.append(b); }
      box.append(k);
    }
    const av = $('as-hello-av');   // ART's Juli icon; a build without it shows none
    if (av) { if (av.complete && !av.naturalWidth) av.hidden = true; else av.addEventListener('error', () => { av.hidden = true; }, { once: true }); }
    const extra = mk('div', 'as-musichint'); extra.id = 'as-musichint'; box.after(extra);
    renderMusicHint();
  }
  /** 3.9 polish: the start screen says when lookups are off (Settings › Juli) */
  function paintHello() { const o = document.querySelector('#as-try .as-kind-off'); if (o) o.hidden = !(api.AS && api.AS.research === false); }
  function renderMusicHint() {   // v021: one button for the music model + the lyrics planner (or the planner alone when music is already here)
    paintHello(); const el = $('as-musichint'); if (!el) return;   // 3.9 polish: + the start screen's lookups note
    const md = api.musicDl();
    if (md.ready) { el.textContent = ''; el.dataset.state = ''; return; }
    const state = md.addPlanner ? 'add' : 'get';
    if (el.dataset.state === state && el.childElementCount) { for (const b of el.querySelectorAll('.dl-btn')) paintDl(b); return; }
    el.textContent = ''; el.dataset.state = state;
    el.append(mk('p', 'footnote dim', md.addPlanner ? 'Songs are better with the lyrics planner: the singer follows the words more closely.'
      : `Songs need the music model and its lyrics planner (${api.fmtSize(md.total)}, one time, one tap).`), dlButton('music'));
  }
  const scrollDown = (now) => { const m = $('main'); if (!m) return; m.scrollTo({ top: m.scrollHeight, behavior: now || reducedMotion() ? 'auto' : 'smooth' }); };
  const nearBottom = () => { const m = $('main'); return !m || m.scrollHeight - m.scrollTop - m.clientHeight < 160; };

  // ---------------------------------------------------------------------------------------------- bubbles
  function textBlock(text, cls = 'msg-text') {
    const body = String(text || ''), i = body.search(/\n\nSources: \[1\]/);
    const wrap = mk('div'), p = mk('p', cls, i >= 0 ? body.slice(0, i) : body); wrap.append(p);
    if (i >= 0) wrap.append(sources(body.slice(i + 2)));
    return wrap;
  }
  /** "Sources: [1] "Title", Wikipedia, <permalink> (authors: <history>), CC BY-SA 4.0 <licence url> · [2] ..." -> real links (CC BY-SA attribution) */
  function sources(line) {
    const d = mk('details', 'srcs'), items = line.replace(/^Sources:\s*/, '').split(' · ');
    const sum = mk('summary'); sum.append(mk('span', null, `Sources (${items.length})`), svg('i-chevron', 'ic chev')); d.append(sum);
    const ol = mk('ol', 'src-list');
    for (const it of items) {
      const li = mk('li'), m = /^\[\d+\] "(.+?)", (.+?), (https?:\/\/\S+) \(authors: (https?:\/\/\S+)\), (.+?)(?: (https?:\/\/[^\s,]+))?(?:, ((?:as of|retrieved) [^·]+?))?$/.exec(it);
      if (!m) { li.textContent = it.replace(/^\[\d+\]\s*/, ''); ol.append(li); continue; }
      const a = mk('a', null, m[1]); a.href = m[3]; a.target = '_blank'; a.rel = 'noopener';
      const au = mk('a', null, 'authors'); au.href = m[4]; au.target = '_blank'; au.rel = 'noopener';
      const lic = m[6] ? Object.assign(mk('a', null, m[5]), { href: m[6], target: '_blank', rel: 'noopener' }) : mk('span', null, m[5]);
      li.append(a, ` · ${m[2]} · `, au, ' · ', lic); if (m[7]) li.append(` · ${m[7]}`); ol.append(li);
    }
    d.append(ol); return d;
  }
  /** 3.9 polish: an answer's Sources (where its facts came from: the links CC BY-SA asks for) and what Juli looked up, as one quiet row
   *  of small chips under its words instead of two loose lines; each opens under the row, full width */
  function tidyFoot(b) {
    const src = b.querySelector(':scope > div > details.srcs'), rl = b.querySelector(':scope > details.rl-sum');
    if (!src && !rl) return;
    if (src) { const s = src.querySelector('summary'); if (s) s.prepend(svg('i-sh-link', 'ic foot-ic')); }
    if (rl) { const s = rl.querySelector('summary'); if (s) { const t = s.textContent.replace(/^\s*\u{1F50E}\s*/u, ''); s.textContent = t.charAt(0).toUpperCase() + t.slice(1); s.prepend(lens('ic foot-ic')); s.append(svg('i-chevron', 'ic chev')); } }
    const foot = mk('div', 'msg-foot'); foot.append(...[src, rl].filter(Boolean)); b.append(foot);
  }
  /** 3.9: a bubble into the log like a text-message thread: its side, its place in its group (the tail goes on the last one), a line
   *  before it when the day changed, and its time (shown on a tap) */
  function place(log, el, m, gi) {
    if (gi.day) { const d = mk('p', 'as-day footnote', gi.day); d.setAttribute('role', 'separator'); log.append(d); }
    el.classList.add('g-' + gi.side); el.classList.toggle('g-first', !!gi.first); el.classList.toggle('g-last', !!gi.last);
    if (m.at) el.dataset.time = clockOf(m.at);
    log.append(el); C.last = { m, el };
  }
  function bubble(m) {
    if (m.role === 'user') {
      if (m.kind === 'routine' && api.routineCard) { const rc = api.routineCard(m); if (rc) return rc; }   // 3.9: a routine (Settings › Juli) as a card
      const b = mk('div', 'msg me'); b.dataset.mid = m.id;
      if (m.photoKey) { const img = mk('img', 'msg-photo'); img.alt = 'Your photo'; b.append(img); loadBlob(m.photoKey, null).then((x) => { if (x) img.src = url(x); }); }
      b.append(mk('p', 'msg-text', m.text)); return b;
    }
    const kind = m.kind || 'text', b = mk('div', `msg bot k-${kind}`); b.dataset.mid = m.id;
    if (kind === 'status') {
      b.append(mk('p', 'msg-text footnote', m.text));
      if (m.jobId) { const c = card(m.jobId); if (c) b.append(c); }
      return b;
    }
    if (kind === 'notice') {   // 3.8: a notice an app posted (Weather Alerts, Wildfire Watch...): plain text, labelled with the app; never sent to Juli's model
      b.classList.add('sev-' + (['warning', 'watch'].includes(m.severity) ? m.severity : 'info'));
      const h = mk('p', 'msg-notice-title'); h.append(svg(m.severity === 'info' ? 'i-apps' : 'i-alert', 'ic msg-ic'), mk('span', null, m.title || 'Notice'));
      b.append(h); if (m.text) b.append(mk('p', 'msg-text', m.text)); b.append(mk('p', 'footnote dim msg-from', 'From the app ' + (m.app || '') + ' · ' + new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
      return b;
    }
    if (kind === 'welcome') { welcomeBody(b); return b; }   // onboarding: drawn from the app's state, so the sizes and buttons stay current
    if (kind === 'ready') { readyBody(b); return b; }
    if (kind === 'setup') { setupBody(b, m); return b; }
    if (kind === 'error' || kind === 'refusal') b.prepend(svg(kind === 'error' ? 'i-alert' : 'i-shield', 'ic msg-ic'));
    b.append(textBlock(m.text));
    if (kind === 'question' && Array.isArray(m.options) && m.options.length) {
      const row = mk('div', 'as-opts');
      for (const o of m.options) { const c = mk('button', 'as-chip', o); c.type = 'button'; c.onclick = () => send(o); row.append(c); }
      b.append(row);
    }
    if (kind === 'refusal') { const r = btn('Rights & Copyright', 'btn sm', 'i-shield'); r.onclick = () => api.openSettings('rights'); b.append(r); }
    if (kind === 'needs-download' && m.model) {   // onboarding: + the Cast's voice, lip-sync, Klein 9B and the picture reader (the say path asks for Voice)
      const k = { 'gemma4-e2b': 'assist', 'acestep15-turbo': 'music', 'flux2-klein-4b': 'image', 'sanavideo2-5b': 'video', 'qwen3-tts-0.6b': 'voice', 'musetalk-1.5': 'lipsync', 'flux2-klein-9b': 'k9b', 'ltx23-still-enc': 'reader' }[m.model];
      if (k && offerable(k)) { const row = mk('div', 'row-btns'); row.append(dlButton(k)); b.append(row); }   // music = ONE button for the model + the lyrics planner (v021)
    }
    if (kind === 'result' && m.media) b.append(result(m));
    if (Array.isArray(m.research) && m.research.length) { const rl = researchList(m.research); if (rl) b.append(rl); }   // v026.2: what was looked up, collapsed
    tidyFoot(b);   // 3.9 polish: Sources + what was looked up, one quiet row of chips
    return b;
  }
  /** a Download button for a model (live: progress, Pause, then "Ready") */
  function dlButton(k) {
    const b = mk('button', 'btn sm dl-btn'); b.type = 'button'; b.dataset.k = k;
    let at = 0;   // a double tap on Download never flips straight into Pause (as in Settings)
    b.append(svg('i-download'), mk('span')); b.onclick = () => { const now = Date.now(); if (now - at < 300) return; at = now; if (k === 'music') api.musicTap(); else if (k === 'assist') api.assistTap(); else if (!api.done(k)) api.dlTap(k); };
    if (k !== 'music' && k !== 'assist') { paintDl(b); return b; }
    const box = mk('div', 'dl-music'), bar = mk('div', 'bar'); bar.append(mk('i'));   // one bar for the pair, both parts listed underneath
    box.append(b, bar, mk('p', 'footnote dim num dl-parts')); paintDl(b); return box;
  }
  function paintDl(b) {
    const k = b.dataset.k;
    if (k === 'assist') {   // onboarding: the assistant + the starter knowledge, one button (app.js assistDl)
      const a = api.assistDl(), box = b.parentElement;
      b.disabled = a.ready || a.pausing;
      b.querySelector('use').setAttribute('href', a.ready ? '#i-check' : a.running ? '#i-pause' : a.partial && !a.addStarter ? '#i-play' : '#i-download');
      b.querySelector('span').textContent = a.label;
      if (box && box.classList.contains('dl-music')) {
        const live = (a.partial || !!a.running || a.addStarter) && !a.ready;
        box.querySelector('.bar').hidden = !live; box.querySelector('.bar i').style.transform = `scaleX(${a.pct.toFixed(4)})`;
        const pr = box.querySelector('.dl-parts'); pr.hidden = !live && !a.running;
        pr.textContent = a.parts + (a.failed ? ' · stopped: tap to resume' : '') + (a.low ? ' · this phone may be short on space' : '');
      }
      const later = b.closest('.msg') && b.closest('.msg').querySelector('.as-later');
      if (later) later.hidden = C.declined || a.ready || a.partial || !!a.running || api.done('brain');   // "Not now" until it is answered or the download starts
      return;
    }
    if (k === 'music') {
      const md = api.musicDl(), box = b.parentElement;
      b.disabled = md.ready || md.pausing;
      b.querySelector('use').setAttribute('href', md.ready ? '#i-check' : md.running ? '#i-pause' : md.have > 0 && !md.addPlanner ? '#i-play' : '#i-download');
      b.querySelector('span').textContent = md.label;
      if (box && box.classList.contains('dl-music')) {
        const live = md.have > 0 && !md.ready && !md.addPlanner;
        box.querySelector('.bar').hidden = !live; box.querySelector('.bar i').style.transform = `scaleX(${md.pct.toFixed(4)})`;
        const pr = box.querySelector('.dl-parts'); pr.hidden = !live && !md.running; pr.textContent = md.parts + (md.failed ? ' · stopped: tap to resume' : '');
      }
      return;
    }
    const u = api.S.dl[k], ready = api.done(k), name = nameOf(k);   // "the picture model", "the lyrics planner", "the starter knowledge"
    b.disabled = ready || u.sub === 'pausing';
    b.querySelector('use').setAttribute('href', ready ? '#i-check' : u.sub === 'downloading' ? '#i-pause' : u.have > 0 ? '#i-play' : '#i-download');
    b.querySelector('span').textContent = ready ? `${name[0].toUpperCase()}${name.slice(1)} is ready` : u.sub === 'downloading' ? `Pause · ${Math.floor(api.dlPct(u) * 100)}%`
      : u.sub === 'pausing' ? 'Pausing…' : u.have > 0 ? `Resume ${name} · ${api.fmtSize(Math.max(0, u.total - u.have))} left` : `Download ${name} · ${api.fmtSize(u.total)}${k === 'planner' ? ' (recommended)' : ''}`;
  }
  function renderDl() { if (!C.shown) return; renderNeed(); for (const b of document.querySelectorAll('#v-assistant .dl-btn')) paintDl(b); if (!$('as-hello').hidden) renderMusicHint(); }

  // ---------------------------------------------------------------------------------------------- results
  const url = (blob) => { const u = URL.createObjectURL(blob); C.urls.add(u); return u; };
  async function loadBlob(key, jobId) {
    const q = Q(); let b = null;
    try { if (key && q) b = await q.getBlob(key); } catch (e) { b = null; }
    if (!b && jobId) { try { b = await store.getBlob('a-' + jobId); } catch (e) { b = null; } }
    return b;
  }
  function result(m) {
    const box = mk('div', 'res-media'), kind = m.media.kind, jobId = m.jobId, j = Q() && Q().get(jobId), P = (j && j.params) || {};
    box.classList.add('rm-' + kind);
    // 3.9: the action bubbles under it (ui/chatactions.js): what p0pc0rn already does with this kind of result, the creative ones first
    const caps = { picOK: !!(api.picOK && api.picOK()), animateSong: !!api.animateSong, board: !!api.openBoard, talk: !!api.talkFromSay };
    const ids = actionsFor({ kind, mvId: m.mvId }, caps).filter((id) => id !== 'again' || (j && againable(j.kind)));
    const acts = mk('div', 'as-acts'); acts.setAttribute('role', 'group'); acts.setAttribute('aria-label', 'What next');
    const OLD = { lipsync: 'cast-talk', board: 'mv-edit' };   // the classes these buttons had in 3.8
    let blob = null, save = null;
    for (const id of ids) {
      const a = ACTIONS[id], c = btn(id === 'save' && (kind === 'song' || kind === 'say') ? 'Save as .m4a' : a.label, 'as-act', a.icon);
      c.dataset.act = id; if (OLD[id]) c.classList.add(OLD[id]); if (id === 'animate' && kind === 'song') c.classList.add('mv-animate');
      if (id === 'save') save = c;
      c.onclick = () => act(id, m, () => blob, c);
      acts.append(c);
    }
    const saveLabel = (t) => { if (save) save.lastChild.textContent = t; };
    if (kind === 'song') {
      const sc = mk('div', 'song-card');
      // v032: the song's length as made (10-60 s; the result's length, then the job's, then the message's), never a guessed 30
      const secs = Math.round(Number((j && j.result && j.result.seconds) || P.seconds || m.media.seconds) || 0);
      const title = mk('p', 'headline', P.title || 'Your song'), meta = mk('p', 'footnote dim', [P.tags, P.bpm ? `${P.bpm} BPM` : '', P.key || '', secs ? `${secs} s` : ''].filter(Boolean).join(' · '));
      meta.classList.add('song-meta');
      const au = mk('audio', 'song-audio'); au.controls = true; au.preload = 'metadata'; au.setAttribute('aria-label', `Play ${P.title || 'the song'}`);
      const lyr = mk('details', 'srcs'); const s2 = mk('summary'); s2.append(mk('span', null, 'Lyrics'), svg('i-chevron', 'ic chev')); lyr.append(s2, lyricsEl((j && j.result && j.result.lyrics) || P.lyrics || 'Instrumental', m.research || P.research || []));   // v026.2: fact lines marked
      sc.append(svg('i-note', 'ic song-ic'), title, meta, au, lyr); box.append(sc);
      // v024.1: the Save button names the real file (.wav on an iPhone until it passed the AAC test); no player for a missing / unplayable file
      const gone = (t) => { au.remove(); sc.insertBefore(mk('p', 'footnote dim', t), lyr); };
      au.onerror = () => { if (au.getAttribute('src')) gone('This phone could not play the song file.'); };
      loadBlob(m.media.blobKey, jobId).then((b) => { blob = b; if (b && b.size) { au.src = url(b); const ext = /wav/.test(b.type) ? 'wav' : /mp4|m4a|aac/.test(b.type) ? 'm4a' : ''; if (ext) saveLabel(`Save as .${ext}`); } else { blob = null; gone('The song file is missing.'); } });
    } else if (kind === 'say') {   // p0pc0rn Cast: a Cast member's line, in their own voice
      const sc = mk('div', 'song-card');
      const au = mk('audio', 'song-audio'); au.controls = true; au.preload = 'metadata'; au.setAttribute('aria-label', `Play ${P.name || 'the line'}`);
      sc.append(svg('i-chat', 'ic song-ic'), mk('p', 'headline', `${P.name || 'Your cast'} says`), mk('p', 'footnote dim', `“${P.line || ''}”`), au); box.append(sc);
      const gone = (t) => { au.remove(); sc.append(mk('p', 'footnote dim', t)); };
      au.onerror = () => { if (au.getAttribute('src')) gone('This phone could not play the file.'); };
      loadBlob(m.media.blobKey, jobId).then((b) => { blob = b; if (b && b.size) { au.src = url(b); saveLabel(/wav/.test(b.type) ? 'Save as .wav' : 'Save as .m4a'); } else { blob = null; gone('The audio file is missing.'); } });
    } else if (kind === 'picture' || kind === 'edit') {
      const im = mk('img', 'res-img'); im.alt = P.prompt || 'The picture'; im.onclick = () => api.openLibraryItem('a-' + jobId); box.append(im);
      if (P.width && P.height) { im.style.aspectRatio = `${P.width} / ${P.height}`; im.style.setProperty('--ar', String(P.width / P.height)); }   // 3.9: its width from its shape (chat.css)
      loadBlob(m.media.blobKey, jobId).then((b) => { blob = b; if (b) im.src = url(b); });
    } else {   // a clip (muted loop) or a music video (with its song)
      const mv = kind === 'musicvideo' || kind === 'lipsync', v = mk('video', 'res-vid');   // Cast: a lip-sync clip plays with its sound
      v.playsInline = true; v.preload = 'metadata'; v.muted = !mv; v.loop = !mv; v.controls = mv;   // 3.9: these sat inside the comment above (since 3.7), so they never ran
      v.setAttribute('aria-label', mv ? 'Your music video' : P.prompt || 'The clip'); box.append(v);
      if (P.width && P.height) { v.style.aspectRatio = `${P.width} / ${P.height}`; v.style.setProperty('--ar', String(P.width / P.height)); }
      loadBlob(m.media.blobKey, jobId).then((b) => { blob = b; if (b) { v.src = url(b); if (!mv) v.play().catch(() => { v.controls = true; }); } });
    }
    if (kind === 'lipsync') box.append(mk('p', 'footnote dim', 'Lip-sync is experimental.'));
    box.append(acts);
    return box;
  }
  /** 3.9: an action bubble tapped, each on the path p0pc0rn already has for it */
  function act(id, m, blobOf, el) {
    const jobId = m.jobId, j = Q() && Q().get(jobId), P = (j && j.params) || {}, item = 'a-' + jobId;
    if (id === 'again') return again(m, el);
    if (id === 'save') {   // v026.4: the copy that carries the AI label
      const blob = blobOf(); if (!blob) return api.toast('Still loading…');
      if (!el.item) { el.item = { blob, seed: P.seed != null ? P.seed : (j && j.result && j.result.seed) || 0, createdAt: Date.now() }; api.exportOf(el.item); }
      return api.shareItem(el.item, (f) => api.saveFile(f));
    }
    if (id === 'open') return api.openLibraryItem(item);
    if (id === 'animate' && m.media.kind === 'song') return api.animateSong(jobId);   // v023: a music video from the song
    if (id === 'board') return api.openBoard(m.mvId);
    if (id === 'lipsync') return api.talkFromSay(jobId, C.sid);   // p0pc0rn Cast
    if (api.act) return api.act(item, id);   // edit / animate (a picture into a clip) / clip2: the Library viewer's own paths (app.js chatAct)
  }

  // ---------------------------------------------------------------------------------------------- job cards
  const label = (j) => {
    const P = j.params || {};
    if (j.kind === 'say') return `Voice · ${P.name || 'Cast'} says`;   // p0pc0rn Cast
    if (j.kind === 'talk' || j.kind === 'lipsync') return `Lip-sync · ${P.name || 'Cast'} (experimental)`;
    if (j.kind === 'chat') return P.purpose && P.purpose !== 'turn' ? ({ songwrite: 'Writing the song', shotplan: 'Planning the shots', mvreview: 'Checking the shots', say: 'Voice' }[P.purpose] || 'Juli') : `Juli · “${(j.title || P.text || '').slice(0, 40)}”`;
    if (j.kind === 'song') return (P.title ? `Song · “${P.title}”` : 'Song') + (P.seconds ? ` · ${Math.round(P.seconds)} s` : '');   // v032: the length asked for
    if (j.kind === 'musicvideo' || j.kind === 'mvflf') return P.title ? `Music video · “${P.title}”` : 'Music video';
    if (j.kind === 'mvplan') return 'Writing the storyboard';
    if (j.kind === 'makeapp') return `Make an app · “${(j.title || '').slice(0, 40)}”`;   // 3.8
    if (j.kind === 'appedit') return `Change an app · “${(j.title || '').slice(0, 40)}”`;   // H39
    if (j.kind === 'appask') return `Juli · a question from ${P.app || 'an app'}`;
    if (j.kind === 'bench') return `Benchmark · ${j.title || ''}`;
    const n = api.NOUN[j.kind] || j.kind; return `${n[0].toUpperCase()}${n.slice(1)}${typeof j.tag === 'string' && j.tag.startsWith('create:') ? ' · from Create' : ''}`;
  };
  /** the job a family is busy with now (a music video: its running or next part) */
  function focus(j) {
    const q = Q(); if (!q) return j;
    if (j.kind !== 'musicvideo' && j.kind !== 'mvflf' && !(j.kind === 'chat' && j.status === 'waiting')) return j;
    const kids = q.descendants(j.id), run = kids.find((x) => x.status === 'running'), next = kids.find((x) => x.status === 'queued');
    return run || next || j;
  }
  function viewOf(j) {
    const media = api.mediaOfKind(j.kind);
    return { id: j.id, kind: j.kind, media, sub: j.cancelRequested ? 'cancelling' : 'running', waiting: j.status !== 'running', p: j.progress || { phase: 'load', step: 0, steps: media === 'audio' ? 8 : 4 },
      frac: (j.progress && j.progress.frac) || 0, params: Object.assign({ media }, j.params || {}), origin: 'assistant' };
  }
  function statusText(j) {
    const q = Q(), f = focus(j);
    if (j.kind === 'mvflf' && api.mvStatus) { const ms = api.mvStatus(j); return ms.etaSeconds != null && ms.etaSeconds > 0 ? `${ms.text} · ${ms.etaText || about(ms.etaSeconds)} left` : ms.text; }   // v023: the whole video
    if (j.status === 'done') return 'Done';
    if (j.status === 'cancelled') return 'Stopped';
    if (j.status === 'failed') return `Didn't finish${j.error && j.error.code ? ` (${j.error.code})` : ''}`;
    if (j.status === 'blocked') return j.error && j.error.code === 'NO_CONSENT' ? 'Waiting for the agreement' : 'Waiting for a download';
    if (f.status === 'running') {
      if (f.kind === 'chat') return 'Juli is thinking';
      const v = viewOf(f); let t = api.caption(v);
      if (f !== j) { const kids = q.descendants(j.id).filter((x) => x.kind !== 'chat'), dn = kids.filter((x) => x.status === 'done').length; t = `${label(f)} · ${t} · ${dn} of ${kids.length} parts done`; }
      return t;
    }
    const pos = q ? q.positionOf(f.id) : null;
    if (f.status === 'queued' && pos) return pos === 1 ? 'Starts next' : `${nth(pos)} in line`;
    if (j.status === 'waiting') return 'Waiting for its parts';
    return 'Waiting';
  }
  function card(jobId) {
    const q = Q(), j = q && q.get(jobId); if (!j) return null;
    const c = mk('div', 'jcard'); c.dataset.job = jobId;
    const top = mk('div', 'jc-top'); top.append(mk('span', 'jc-title callout', label(j)), mk('span', 'jc-pos footnote dim num'));
    const art = mk('div', 'jc-art');
    const bar = mk('div', 'bar jc-bar'); bar.append(mk('i'));
    const row = mk('div', 'jc-row'); row.append(mk('span', 'jc-time footnote dim num'));
    if (j.kind === 'mvflf' && api.openBoard) { const sbb = mk('button', 'mini jc-board', 'Storyboard'); sbb.type = 'button'; sbb.onclick = () => api.openBoard(jobId); row.append(sbb); }   // v023
    const x = mk('button', 'mini jc-cancel', 'Cancel'); x.type = 'button'; x.onclick = () => cancelTap(jobId, x); row.append(x);
    c.append(top, art, mk('p', 'jc-phase footnote'), bar, row);
    C.cards.set(jobId, c); paintCard(c, j);
    return c;
  }
  function paintCard(c, j) {
    const live = !TERMINAL.has(j.status), f = focus(j), running = f.status === 'running' && f.kind !== 'chat';
    c.classList.toggle('live', live); c.classList.toggle('ended', !live); c.dataset.status = j.status;
    c.querySelector('.jc-phase').textContent = statusText(j);
    const pos = c.querySelector('.jc-pos'); pos.textContent = j.status === 'done' && j.endedAt && j.startedAt ? clock((j.endedAt - j.startedAt) / 1000) : '';
    const ms = j.kind === 'mvflf' && api.mvStatus ? api.mvStatus(j) : null;   // v023: a music video's bar = the whole video
    const frac = ms ? ms.frac : running ? Math.max(0, Math.min(1, (f.progress && f.progress.frac) || 0)) : j.status === 'done' ? 1 : 0;
    c.querySelector('.jc-bar').hidden = !live; c.querySelector('.jc-bar i').style.transform = `scaleX(${frac.toFixed(4)})`;
    const p = f.progress || {}, left = running && p.etaSeconds != null && ((p.phase === 'denoise' && p.step >= 2) || p.phase === 'decode' || p.phase === 'encode') ? p.etaSeconds - (Date.now() - (p.at || Date.now())) / 1000 : null;
    c.querySelector('.jc-time').textContent = ms ? (live ? `${Math.round(frac * 100)}%` : '') : running ? (left != null ? (left < 10 ? 'Almost done' : `${about(left)} left`) : `${Math.round(frac * 100)}%`) : '';
    const x = c.querySelector('.jc-cancel'); x.hidden = !live || api.readOnly();
    if (!C.armed.has(j.id)) x.textContent = j.cancelRequested ? 'Stopping…' : 'Cancel';
    c.querySelector('.jc-art').hidden = !(running && C.popJob === f.id);
  }
  function cancelTap(jobId, x) {
    const q = Q(); if (!q) return;
    if (!C.armed.has(jobId)) { x.textContent = 'Tap again to stop'; C.armed.set(jobId, setTimeout(() => { C.armed.delete(jobId); x.textContent = 'Cancel'; }, 3000)); return; }
    clearTimeout(C.armed.get(jobId)); C.armed.delete(jobId); x.textContent = 'Stopping…';
    q.cancel(jobId);
  }
  /** the chat's own popcorn: one canvas, moved into the card of the render that runs now (the stage on Create shows the same job) */
  function syncPop() {
    const q = Q(); if (!q || !C.shown) return;
    const run = q.list({ includeTerminal: false }).find((x) => x.status === 'running' && api.isStageKind(x.kind)) || null;   // (q.active is set just after the 'running' save)
    let target = null;
    if (run) for (const [id, c] of C.cards) { const j = q.get(id); if (j && !TERMINAL.has(j.status) && (id === run.id || focus(j).id === run.id) && c.isConnected) { target = c; break; } }
    if (!target || !run) { if (C.popJob) { if (C.pop) C.pop.stop(); C.popJob = null; } for (const c of C.cards.values()) c.querySelector('.jc-art').hidden = true; return; }
    if (!C.popCanvas) { C.popCanvas = mk('canvas', 'jc-pop'); C.popCanvas.setAttribute('aria-hidden', 'true'); C.pop = api.popcorn(C.popCanvas); }
    const art = target.querySelector('.jc-art'); art.hidden = false;
    if (C.popCanvas.parentElement !== art) art.append(C.popCanvas);
    if (C.popJob !== run.id) { C.popJob = run.id; C.pop.start(); }
    api.popTo(C.pop, viewOf(run));   // v026.9: the current stage
  }

  // ---------------------------------------------------------------------------------------------- live updates from the app
  function progress(j) {
    if (C.shown) {
      for (const [id, c] of C.cards) { const x = Q().get(id); if (x && (id === j.id || focus(x).id === j.id)) paintCard(c, x); }
      if (C.popJob === j.id && C.pop) api.popTo(C.pop, viewOf(j));
      else if (api.isStageKind(j.kind) && C.popJob !== j.id) syncPop();
    }
    if (C.qopen) paintQueueRow(j);
  }
  function queueChanged(j) {
    if (j && j.tag === AGAIN && j.status === 'done') landAgain(j).catch(() => {});   // 3.9: a result made again lands in its conversation
    if (C.shown) {
      for (const [id, c] of C.cards) { const x = Q().get(id); if (x) paintCard(c, x); }
      syncPop(); renderPending();
    }
    if (C.qopen) renderQueue();
  }
  function onMessage(sid, m) {
    track(sid, m).catch(() => {});   // 3.9: every conversation's line in Chats, and unread while it is not on screen
    if (sid !== C.sid) return;
    if (!C.shown) { if (m.role === 'assistant') { C.unread = true; renderDot(); } return; }
    if (m.role === 'assistant' && !SETUP.has(m.kind)) { C.activity = ''; if (C.stream) { C.stream.el.remove(); C.stream = null; } if (C.typing) { C.typing.remove(); C.typing = null; } }   // a scripted answer is not the end of a running turn
    $('as-hello').hidden = true; $('as-new').hidden = !api.done('brain');
    const stick = nearBottom() || m.role === 'user';
    const prev = C.last && C.last.el.isConnected ? C.last : null, g = groups(prev ? [prev.m, m] : [m]), gi = g[g.length - 1];   // 3.9: joins the bubbles above?
    if (prev && !gi.first) prev.el.classList.remove('g-last');
    place($('as-log'), bubble(m), m, gi); syncPop(); renderPending();
    if (m.role === 'user') { C.lastUser = m.text; if ($('as-title').textContent === 'New chat') $('as-title').textContent = titleOf([m]); }
    if (stick) scrollDown();
  }
  /** the assistant's words as they come (agent.js's planning call); a tool call shows as "Planning…" */
  function stream(j, text, end) {
    if (!C.shown || j.session !== C.sid) return;
    const raw = String(text || ''), call = raw.indexOf('<|tool_call>'), vis = (call >= 0 ? raw.slice(0, call) : raw).replace(SPECIAL, '').replace(/^\s+/, '');
    if (!C.stream || C.stream.jobId !== j.id) {
      if (C.stream) C.stream.el.remove();
      const el = mk('div', 'msg bot streaming g-bot g-first g-last'); el.append(mk('p', 'msg-text'));   // 3.9: a bubble of its own while the words come
      C.stream = { jobId: j.id, el }; if (C.typing) { C.typing.remove(); C.typing = null; }
      $('as-log').append(el);
    }
    const p = C.stream.el.querySelector('.msg-text');
    p.textContent = vis || (call >= 0 ? 'Planning…' : '…');
    C.stream.el.classList.toggle('planning', !vis && call >= 0);
    if (nearBottom()) scrollDown(true);
    if (end && !vis && call < 0) { C.stream.el.remove(); C.stream = null; }
  }

  // ---------------------------------------------------------------------------------------------- sending
  async function send(textArg) {
    const inp = $('as-in'), text = String(textArg != null ? textArg : inp.value).trim();
    if (!text) return;
    if (!AG()) return api.toast(api.agentError() ? "Juli couldn't start. Reload p0pc0rn." : 'Juli is still starting.');
    const local = localAnswer(text);   // onboarding: answered here, in code (no model; nothing is made)
    if (local) return localTurn(text, local, textArg == null);
    if (!api.consented()) return api.openLesson();   // anything that can make something waits for the agreement
    if (api.readOnly()) return api.toast('p0pc0rn is open in another tab.');
    if (C.photo && !C.photo.attest) { api.toast('Tick the box about your photo first.'); const b = $('as-attest-box'); b.classList.add('need'); setTimeout(() => b.classList.remove('need'), 2400); return; }
    const photo = C.photo;
    if (textArg == null) { inp.value = ''; grow(); }
    if (photo) clearPhoto(true);
    renderComposer();
    try {
      await ensureSession();
      const shape = photo ? (photo.w > photo.h * 1.1 ? 'wide' : photo.h > photo.w * 1.1 ? 'tall' : 'square') : null;
      await AG().ask(C.sid, text, photo ? { photoBlob: photo.blob, attested: !!photo.attest, shape } : {});
    } catch (e) { if (!isAbort(e)) api.toast("Couldn't send that. Try again."); if (textArg == null) { inp.value = text; grow(); } }
    finally { if (photo) URL.revokeObjectURL(photo.url); }
  }
  function grow() { const t = $('as-in'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 132) + 'px'; }
  function setPhoto(p) {
    clearPhoto(); C.photo = { blob: p.blob, w: p.w, h: p.h, url: URL.createObjectURL(p.blob), attest: false };   // a new photo is never pre-attested
    $('as-photo-img').src = C.photo.url; $('as-attest').checked = false; renderComposer();
  }
  function clearPhoto(keepUrl) { if (C.photo && !keepUrl) URL.revokeObjectURL(C.photo.url); C.photo = null; $('as-photo-img').removeAttribute('src'); $('as-attest').checked = false; renderComposer(); }

  // ---------------------------------------------------------------------------------------------- the queue sheet
  function families() {
    const q = Q(); if (!q) return { live: [], done: [] };
    const all = q.list(), tops = all.filter((j) => j.root === j.id);
    const order = q.runOrder(), rank = new Map(order.map((j, i) => [j.id, i]));
    const runRoot = q.active ? q.rootOf(q.active.job).id : null;
    const first = (t) => { if (t.id === runRoot) return -1; let r = rank.has(t.id) ? rank.get(t.id) : Infinity; for (const d of q.descendants(t.id)) if (rank.has(d.id)) r = Math.min(r, rank.get(d.id)); return r; };
    const live = tops.filter((t) => !TERMINAL.has(t.status) || q.descendants(t.id).some((d) => !TERMINAL.has(d.status))).sort((a, b) => first(a) - first(b) || a.order - b.order);
    const done = tops.filter((t) => !live.includes(t)).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0)).slice(0, 4);
    return { live, done, runRoot };
  }
  function renderQueue() {
    const q = Q(); if (!q) return;
    const { live, done, runRoot } = families(), list = $('q-list'), dn = $('q-done');
    list.textContent = ''; dn.textContent = '';
    if (!live.length) list.append(mk('p', 'li footnote dim', 'Nothing is waiting. Make something on Create, or ask Juli.'));
    const movable = live.filter((t) => t.id !== runRoot && t.kind !== 'chat');
    live.forEach((t) => {
      const r = mk('div', 'qrow'); r.dataset.job = t.id;
      const txt = mk('div', 'q-txt'); txt.append(mk('p', 'callout q-name', label(t)), mk('p', 'footnote dim q-st num'));
      const bar = mk('div', 'bar q-bar'); bar.append(mk('i')); txt.append(bar);
      const ctl = mk('div', 'q-ctl');
      const mi = movable.indexOf(t);
      if (mi >= 0) {
        const up = mk('button', 'icon-btn q-up'); up.type = 'button'; up.append(svg('i-up')); up.setAttribute('aria-label', `Move ${label(t)} up`); up.disabled = mi === 0;
        const down = mk('button', 'icon-btn q-down'); down.type = 'button'; down.append(svg('i-down')); down.setAttribute('aria-label', `Move ${label(t)} down`); down.disabled = mi === movable.length - 1;
        up.onclick = () => move(t, movable, -1); down.onclick = () => move(t, movable, 1); ctl.append(up, down);
      }
      if (t.kind === 'mvflf' && api.openBoard) { const sbb = mk('button', 'mini q-board', 'Storyboard'); sbb.type = 'button'; sbb.onclick = () => { closeQueue(); api.openBoard(t.id); }; ctl.append(sbb); }   // v023
      const x = mk('button', 'mini q-x', 'Cancel'); x.type = 'button'; x.onclick = () => cancelTap(t.id, x); x.hidden = q.readOnly; ctl.append(x);
      if (t.status === 'blocked' || q.descendants(t.id).some((d) => d.status === 'blocked')) {
        const bj = t.status === 'blocked' ? t : q.descendants(t.id).find((d) => d.status === 'blocked');
        const a = bj.error && bj.error.code === 'NO_CONSENT' ? btn('Agree', 'btn sm') : btn('Download', 'btn sm');
        a.onclick = () => { if (bj.error && bj.error.code === 'NO_CONSENT') { closeQueue(); api.openLesson(); } else { closeQueue(); api.openSettings('models'); } };
        txt.append(a);
      }
      r.append(txt, ctl); list.append(r); paintQueueRow(t);
    });
    for (const t of done) {
      const r = mk('div', 'qrow ended'), st = t.status === 'done' ? 'Done' : t.status === 'cancelled' ? 'Stopped' : "Didn't finish";
      r.append(mk('p', 'footnote q-name', `${st} · ${label(t)}`));
      const rm = mk('button', 'mini', 'Remove'); rm.type = 'button'; rm.onclick = async () => { await q.remove(t.id).catch(() => {}); renderQueue(); }; r.append(rm);
      dn.append(r);
    }
    if (done.length) dn.prepend(mk('p', 'label q-done-h', 'Finished'));
    const pb = $('q-pause'); pb.hidden = q.readOnly;
    pb.querySelector('use').setAttribute('href', q.paused ? '#i-play' : '#i-pause');
    pb.querySelector('span').textContent = q.paused ? 'Resume the queue' : 'Pause the queue';
    $('q-note').textContent = q.readOnly ? 'p0pc0rn is open in another tab: the queue runs there.' : q.paused ? 'Paused: the job that is running finishes; nothing new starts until you resume.'
      : 'One job at a time, in this order. A chat goes first; a job that has started is never stopped for another.';
  }
  function paintQueueRow(j) {
    const q = Q(); if (!q) return;
    const root = q.rootOf(j), r = document.querySelector(`#q-list .qrow[data-job="${root.id}"]`); if (!r) return;
    const f = focus(root), running = f.status === 'running' && f.kind !== 'chat', ms = root.kind === 'mvflf' && api.mvStatus ? api.mvStatus(root) : null;
    r.querySelector('.q-st').textContent = statusText(root);
    const bar = r.querySelector('.q-bar'); bar.hidden = !running && !ms; bar.firstElementChild.style.transform = `scaleX(${(ms ? ms.frac : running ? (f.progress && f.progress.frac) || 0 : 0).toFixed(4)})`;
  }
  async function move(t, movable, d) {
    const q = Q(), all = q.list({ includeTerminal: false }).filter((x) => x.root === x.id), runRoot = q.active ? q.rootOf(q.active.job).id : null;
    const rest = all.filter((x) => x.id !== runRoot).sort((a, b) => a.order - b.order);
    const target = movable[movable.indexOf(t) + d]; if (!target) return;
    await q.move(t.id, rest.indexOf(target)); renderQueue();
  }
  function openQueue() {
    C.qopen = true; renderQueue();
    const w = $('queue'); w.classList.remove('out'); w.hidden = false;
  }
  function closeQueue() {
    const w = $('queue'); if (w.hidden || w.classList.contains('out')) return;
    C.qopen = false; w.classList.add('out'); setTimeout(() => { w.hidden = true; w.classList.remove('out'); }, reducedMotion() ? 120 : 240);
  }

  // ---------------------------------------------------------------------------------------------- wiring
  $('as-send').onclick = () => send();
  $('as-new').onclick = () => newChat();
  $('as-chats').onclick = () => openList();   // 3.9: Chats
  $('as-list-new').onclick = () => newChat();
  $('as-log').addEventListener('click', (e) => {   // 3.9: a bubble's time under it on a tap (not on its buttons, links, players or pictures)
    const b = e.target.closest('.msg'); if (!b || !b.dataset.time || e.target.closest('button, a, audio, video, summary, details, input, textarea, label, img')) return;
    const n = b.nextElementSibling;
    if (n && n.classList.contains('as-time')) { n.remove(); return; }
    const t = mk('p', 'as-time footnote ' + (b.classList.contains('g-me') ? 'me' : 'bot'), b.dataset.time); b.after(t);
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && onScreen(C.sid)) threads().then((t) => t && t.read(C.sid)).then(paintUnread).catch(() => {}); });
  threads().then(paintUnread).catch(() => {});   // the count right away (unread from before this page)
  setTimeout(() => { paintUnread().catch(() => {}); }, 2500);   // and once more after the shell's own first paint
  $('as-in').addEventListener('input', () => { grow(); renderComposer(); });
  $('as-in').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $('as-need-go').onclick = () => api.dlTap('brain');
  $('as-agree-go').onclick = () => api.openLesson();
  $('as-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { setPhoto(await api.shrinkPhoto(f)); } catch (err) { api.toast("That photo couldn't be opened. Try another, or a screenshot of it."); }
  });
  $('as-photo-x').onclick = () => clearPhoto();
  $('as-attest').addEventListener('change', (e) => { if (!C.photo) return; C.photo.attest = e.target.checked; if (C.photo.attest) { api.rights.logUpload(C.photo.blob); $('as-attest-box').classList.remove('need'); } renderComposer(); });
  $('queue').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeQueue(); });
  $('q-pause').onclick = () => { const q = Q(); if (!q) return; if (q.paused) q.resume(); else q.pause(); renderQueue(); };
  setInterval(() => { if (document.hidden) return; if (C.shown) for (const [id, c] of C.cards) { const x = Q() && Q().get(id); if (x && !TERMINAL.has(x.status)) paintCard(c, x); } }, 1000);   // time left ticks (1 Hz, visible only)

  /** v021: what the assistant is doing right now ("Looking up “Golden Gate Bridge”…"), shown in the thinking bubble */
  function activity(sid, text) { if (sid !== C.sid) return; C.activity = text || ''; if (C.shown) renderPending(); }
  function research(sid, jid, rows) { if (sid !== C.sid) return; C.rl = { jid, rows }; if (C.shown) renderPending(); }   // v026.2
  return { render, renderDl, show, hide, onMessage, stream, progress, queueChanged, openQueue, closeQueue, newChat, send, activity, research, session: ensureSession, get sid() { return C.sid; },
    openList, openThread, unread: () => C.total };   // 3.9: Chats, a conversation by id, Juli's unread count (the shell's badge)
}
