// ui/chat.js - p0pc0rn v019: the Assistant tab (the conversation with the on-device assistant, assistant/agent.js) and the queue sheet
// (assistant/queue.js). Plain DOM, like app.js. The app owns the engines, the queue and the agent and hands them over in `api`
// (app.js chatApi()); this module only shows them and sends what the person types.
//   - bubbles from agent.session(id).messages + agent 'message' events; the assistant's words stream in while it answers
//   - a job card under each "making it" line: queue position, popcorn while it renders, phase, progress, time left, Cancel (two taps)
//   - results: the picture, the clip, the song (player, Save as .m4a, style + lyrics) or the music video, also saved in the Library
//   - the queue sheet: every job in the order it will run, progress, Cancel, move up / down, pause the queue, the finished ones
//   - v023: a landed song's bubble offers Animate (a music video, end-capped first/last frame: assistant/mvflf.js; the app opens its
//     sheet). There is no chat command for it. The music video's card and queue row open its storyboard; a cut's bubble offers Edit video.
import * as store from '../store.js';
import { $, ls, clock, about, reducedMotion, isAbort } from '../util.js';
import { researchList, lyricsEl } from './research.js';   // v026.2: the research list

const SUGGEST = [
  'Make me a song about the last train home, synthwave',
  'A picture of a red fox in fresh snow at sunrise',
  'A 5-second clip of waves rolling onto a black sand beach at dusk',
];
const SPECIAL = /<\|?(?:turn|tool_call|tool_response|"|channel|image|audio)\|?>|<eos>|<bos>|<turn\|>|<tool_call\|>|<\|turn>/g;
const nth = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const svg = (id, cls = 'ic') => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };
const btn = (label, cls = 'btn sm', icon = null) => { const b = mk('button', cls); b.type = 'button'; if (icon) b.append(svg(icon)); b.append(mk('span', null, label)); return b; };

export function createChat(api) {
  const C = { sid: ls.get('pf.app.chatSession', null), shown: false, urls: new Set(), cards: new Map(), stream: null, photo: null, typing: null,
    pop: null, popCanvas: null, popJob: null, unread: false, armed: new Map(), qopen: false, loadTok: 0 };
  const Q = () => api.Q, AG = () => api.AG;

  // ---------------------------------------------------------------------------------------------- the session
  async function ensureSession() {
    const ag = AG(); if (!ag) return null;
    if (C.sid && await ag.session(C.sid)) return C.sid;
    const s = await ag.newSession(); C.sid = s.id; ls.set('pf.app.chatSession', s.id); return s.id;
  }
  async function newChat() {
    const ag = AG(); if (!ag) return;
    const s = await ag.newSession(); C.sid = s.id; ls.set('pf.app.chatSession', s.id);
    await rebuild(); api.toast('New chat');
  }

  // ---------------------------------------------------------------------------------------------- the top cards + the composer
  function render() {
    if (!C.shown) { renderDot(); return; }
    renderNeed(); renderComposer(); renderPending(); renderDot();
    for (const b of document.querySelectorAll('#v-assistant .dl-btn')) paintDl(b);
    if (!$('as-hello').hidden) renderMusicHint();
    if (api.done('brain') && AG() && !C.built) { C.built = true; ensureSession().then(rebuild); }   // the assistant just arrived: say hello
  }
  function renderNeed() {
    const k = 'brain', m = api.MODELS[k], u = api.S.dl[k], ready = api.done(k), st = api.S.st[k] || {};
    const card = $('as-need'); card.hidden = ready;
    const ag = !api.consented() && ready; $('as-agree').hidden = !ag;
    const err = api.agentError(), ro = api.readOnly();
    $('as-note').hidden = !(err || ro);
    if (err || ro) $('as-note-text').textContent = ro ? 'p0pc0rn is open in another tab. Chat there, or close it and reopen this one.' : `The assistant couldn't start (${err}). Reload p0pc0rn to try again.`;
    if (ready) return;
    const live = u.sub !== 'idle' || u.have > 0;
    $('as-need-title').textContent = { downloading: 'Downloading the assistant', pausing: 'Pausing…', paused: 'Download paused', dropped: 'Paused — connection dropped', failed: 'Download stopped' }[u.sub] || 'Get the assistant';
    $('as-need-text').textContent = u.sub === 'failed' ? "Couldn't reach the model server. Check Wi-Fi (and that you are signed in to it), then Resume."
      : st.error && !u.have ? "Couldn't reach the model server. Connect to Wi-Fi, then try Download."
      : `The assistant (${m.what}) writes the prompts for you, and a song's style and lyrics, then makes them with the picture, video and music models. It runs on this phone: one-time download · ${api.fmtSize(u.total)} · Wi-Fi and a charger recommended; keep this screen open.`;
    $('as-need-bar').hidden = !live; $('as-need-fill').style.transform = `scaleX(${api.dlPct(u).toFixed(4)})`;
    $('as-need-line').hidden = !live; $('as-need-line').textContent = api.dlLine(u, true);
    const b = $('as-need-go'), dl = u.sub === 'downloading';
    b.disabled = u.sub === 'pausing';
    b.querySelector('use').setAttribute('href', dl ? '#i-pause' : u.have > 0 ? '#i-play' : '#i-download');
    b.querySelector('span').textContent = api.dlLabel(u);
  }
  function canSend() { return !!AG() && api.done('brain') && !api.readOnly() && !api.agentError(); }
  function renderComposer() {
    const ok = canSend();
    $('as-in').disabled = !api.done('brain') || !AG();
    $('as-send').setAttribute('aria-disabled', String(!ok || !$('as-in').value.trim() || (C.photo && !C.photo.attest)));
    $('as-photo').hidden = !C.photo;
  }
  /** the hello (an empty chat), and "thinking" while this chat's turn waits for the model or runs */
  async function renderPending() {
    const q = Q(); if (!q || !C.sid) return;
    const turns = q.list({ includeTerminal: false }).filter((j) => j.kind === 'chat' && j.session === C.sid && ((j.params && j.params.purpose) || 'turn') === 'turn' && (j.status === 'queued' || j.status === 'running' || j.status === 'blocked'));
    const t = turns[0], log = $('as-log');
    if (!t || (C.stream && C.stream.jobId === t.id)) { if (C.typing) { C.typing.remove(); C.typing = null; } return; }
    if (!C.typing) { C.typing = mk('div', 'msg bot typing'); C.typing.append(mk('span', 'dots', '•••'), mk('span', 'footnote dim tp-text')); log.append(C.typing); scrollDown(); }
    const a = q.active && q.active.job;
    // v026.2: the research list, live, under the activity line (from the event, else from the job's own state after a reload)
    const rows = (C.rl && C.rl.jid === t.id && C.rl.rows) || (t.state && t.state.rl) || null;
    let box = C.typing.querySelector('.rl-live'); if (!box) { box = mk('div', 'rl-live'); C.typing.append(box); }
    box.replaceChildren(); const live = rows && researchList(rows, { live: true }); if (live) box.append(live);
    C.typing.querySelector('.tp-text').textContent = t.status === 'running' && C.activity ? C.activity : t.status === 'blocked' ? (t.error && t.error.code === 'NO_CONSENT' ? 'Waiting for the agreement' : 'Waiting for a download')
      : t.status === 'running' ? 'Thinking…' : a && a.id !== t.id ? (a.kind === 'chat' ? 'Waiting for the other chat…' : 'Waiting for the graphics chip: a job is running') : 'Thinking…';
  }
  function renderDot() {
    const d = document.querySelector('.tab[data-tab="assistant"] .tab-dot'); if (d) d.classList.toggle('on', C.unread && !C.shown);
  }

  // ---------------------------------------------------------------------------------------------- show / hide the tab
  async function show() {
    C.shown = true; C.unread = false; renderDot();
    $('as-attest-text').textContent = api.rights.ATTEST;
    render();
    if (AG()) { C.built = api.done('brain'); await ensureSession(); await rebuild(); }
  }
  function hide() {
    C.shown = false; C.built = false; C.loadTok++;
    if (C.pop) C.pop.stop(); C.popJob = null;
    for (const u of C.urls) URL.revokeObjectURL(u); C.urls.clear();
    C.cards.clear(); C.stream = null; C.typing = null; $('as-log').textContent = '';
  }
  async function rebuild() {
    const tok = ++C.loadTok, ag = AG(), log = $('as-log');
    for (const u of C.urls) URL.revokeObjectURL(u); C.urls.clear(); C.cards.clear(); C.stream = null; C.typing = null;
    const s = ag && C.sid ? await ag.session(C.sid) : null;
    if (tok !== C.loadTok) return;
    log.textContent = '';
    const msgs = (s && s.messages) || [];
    $('as-hello').hidden = msgs.length > 0 || !api.done('brain'); $('as-new').hidden = !msgs.length;
    if (!$('as-hello').hidden) renderHello();
    for (const m of msgs.slice(-60)) log.append(bubble(m));
    renderPending(); syncPop(); scrollDown(true);
  }
  function renderHello() {
    const box = $('as-try'); if (box.childElementCount) return renderMusicHint();
    for (const t of SUGGEST) { const b = mk('button', 'as-chip', t); b.type = 'button'; b.onclick = () => { $('as-in').value = t; grow(); renderComposer(); $('as-in').focus(); }; box.append(b); }
    const extra = mk('div', 'as-musichint'); extra.id = 'as-musichint'; box.after(extra);
    renderMusicHint();
  }
  function renderMusicHint() {   // v021: one button for the music model + the lyrics planner (or the planner alone when music is already here)
    const el = $('as-musichint'); if (!el) return;
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
  function bubble(m) {
    if (m.role === 'user') {
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
    if (kind === 'error' || kind === 'refusal') b.prepend(svg(kind === 'error' ? 'i-alert' : 'i-shield', 'ic msg-ic'));
    b.append(textBlock(m.text));
    if (kind === 'question' && Array.isArray(m.options) && m.options.length) {
      const row = mk('div', 'as-opts');
      for (const o of m.options) { const c = mk('button', 'as-chip', o); c.type = 'button'; c.onclick = () => send(o); row.append(c); }
      b.append(row);
    }
    if (kind === 'refusal') { const r = btn('Rights & Copyright', 'btn sm', 'i-shield'); r.onclick = () => api.openSettings('rights'); b.append(r); }
    if (kind === 'needs-download' && m.model) {
      const k = { 'gemma4-e2b': 'brain', 'acestep15-turbo': 'music', 'flux2-klein-4b': 'image', 'sanavideo2-5b': 'video' }[m.model];
      if (k) { const row = mk('div', 'row-btns'); row.append(dlButton(k)); b.append(row); }   // music = ONE button for the model + the lyrics planner (v021)
    }
    if (kind === 'result' && m.media) b.append(result(m));
    if (Array.isArray(m.research) && m.research.length) { const rl = researchList(m.research); if (rl) b.append(rl); }   // v026.2: what was looked up, collapsed
    return b;
  }
  /** a Download button for a model (live: progress, Pause, then "Ready") */
  function dlButton(k) {
    const b = mk('button', 'btn sm dl-btn'); b.type = 'button'; b.dataset.k = k;
    b.append(svg('i-download'), mk('span')); b.onclick = () => { if (k === 'music') api.musicTap(); else if (!api.done(k)) api.dlTap(k); };
    if (k !== 'music') { paintDl(b); return b; }
    const box = mk('div', 'dl-music'), bar = mk('div', 'bar'); bar.append(mk('i'));   // one bar for the pair, both parts listed underneath
    box.append(b, bar, mk('p', 'footnote dim num dl-parts')); paintDl(b); return box;
  }
  function paintDl(b) {
    const k = b.dataset.k;
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
    const u = api.S.dl[k], m = api.MODELS[k], ready = api.done(k);
    const name = k === 'brain' ? 'the assistant' : k === 'planner' ? 'the lyrics planner' : `the ${m.noun} model`;
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
    const actions = mk('div', 'row-btns');
    const save = btn(kind === 'song' || kind === 'say' ? 'Save as .m4a' : 'Save', 'btn sm', 'i-share'), open = btn('Open in Library', 'btn sm ghost', 'i-grid');
    open.onclick = () => api.openLibraryItem('a-' + jobId);
    let blob = null;
    save.onclick = () => {   // v026.4: the copy that carries the AI label
      if (!blob) return api.toast('Still loading…');
      if (!save.item) { save.item = { blob, seed: P.seed != null ? P.seed : (j && j.result && j.result.seed) || 0, createdAt: Date.now() }; api.exportOf(save.item); }
      api.shareItem(save.item, (f) => api.saveFile(f));
    };
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
      loadBlob(m.media.blobKey, jobId).then((b) => { blob = b; if (b && b.size) { au.src = url(b); const ext = /wav/.test(b.type) ? 'wav' : /mp4|m4a|aac/.test(b.type) ? 'm4a' : ''; if (ext) save.lastChild.textContent = `Save as .${ext}`; } else { blob = null; gone('The song file is missing.'); } });
    } else if (kind === 'say') {   // p0pc0rn Cast: a Cast member's line, in their own voice
      const sc = mk('div', 'song-card');
      const au = mk('audio', 'song-audio'); au.controls = true; au.preload = 'metadata'; au.setAttribute('aria-label', `Play ${P.name || 'the line'}`);
      sc.append(svg('i-chat', 'ic song-ic'), mk('p', 'headline', `${P.name || 'Your cast'} says`), mk('p', 'footnote dim', `“${P.line || ''}”`), au); box.append(sc);
      const gone = (t) => { au.remove(); sc.append(mk('p', 'footnote dim', t)); };
      au.onerror = () => { if (au.getAttribute('src')) gone('This phone could not play the file.'); };
      loadBlob(m.media.blobKey, jobId).then((b) => { blob = b; if (b && b.size) { au.src = url(b); save.lastChild.textContent = /wav/.test(b.type) ? 'Save as .wav' : 'Save as .m4a'; } else { blob = null; gone('The audio file is missing.'); } });
    } else if (kind === 'picture' || kind === 'edit') {
      const im = mk('img', 'res-img'); im.alt = P.prompt || 'The picture'; im.onclick = () => api.openLibraryItem('a-' + jobId); box.append(im);
      if (P.width && P.height) im.style.aspectRatio = `${P.width} / ${P.height}`;
      loadBlob(m.media.blobKey, jobId).then((b) => { blob = b; if (b) im.src = url(b); });
    } else {   // a clip (muted loop) or a music video (with its song)
      const mv = kind === 'musicvideo' || kind === 'lipsync', v = mk('video', 'res-vid');   // Cast: a lip-sync clip plays with its sound v.playsInline = true; v.preload = 'metadata'; v.muted = !mv; v.loop = !mv; v.controls = mv;
      v.setAttribute('aria-label', mv ? 'Your music video' : P.prompt || 'The clip'); box.append(v);
      if (P.width && P.height) v.style.aspectRatio = `${P.width} / ${P.height}`;
      loadBlob(m.media.blobKey, jobId).then((b) => { blob = b; if (b) { v.src = url(b); if (!mv) v.play().catch(() => { v.controls = true; }); } });
    }
    actions.append(save, open);
    if (kind === 'say' && api.talkFromSay) { const ls2 = btn('Lip-sync · experimental', 'btn sm ghost', 'i-anim'); ls2.classList.add('cast-talk'); ls2.onclick = () => api.talkFromSay(jobId, C.sid); actions.append(ls2); }   // p0pc0rn Cast
    if (kind === 'lipsync') box.append(mk('p', 'footnote dim', 'Lip-sync is experimental.'));
    if (kind === 'song' && api.animateSong) { const an = btn('Animate', 'btn sm', 'i-anim'); an.classList.add('mv-animate'); an.onclick = () => api.animateSong(jobId); actions.append(an); }   // v023
    if (kind === 'musicvideo' && m.mvId && api.openBoard) { const ed = btn('Edit video', 'btn sm ghost', 'i-anim'); ed.classList.add('mv-edit'); ed.onclick = () => api.openBoard(m.mvId); actions.append(ed); }
    box.append(actions);
    return box;
  }

  // ---------------------------------------------------------------------------------------------- job cards
  const label = (j) => {
    const P = j.params || {};
    if (j.kind === 'say') return `Voice · ${P.name || 'Cast'} says`;   // p0pc0rn Cast
    if (j.kind === 'talk' || j.kind === 'lipsync') return `Lip-sync · ${P.name || 'Cast'} (experimental)`;
    if (j.kind === 'chat') return P.purpose && P.purpose !== 'turn' ? ({ songwrite: 'Writing the song', shotplan: 'Planning the shots', mvreview: 'Checking the shots', say: 'Voice' }[P.purpose] || 'Assistant') : `Assistant · “${(j.title || P.text || '').slice(0, 40)}”`;
    if (j.kind === 'song') return (P.title ? `Song · “${P.title}”` : 'Song') + (P.seconds ? ` · ${Math.round(P.seconds)} s` : '');   // v032: the length asked for
    if (j.kind === 'musicvideo' || j.kind === 'mvflf') return P.title ? `Music video · “${P.title}”` : 'Music video';
    if (j.kind === 'mvplan') return 'Writing the storyboard';
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
      if (f.kind === 'chat') return 'The assistant is thinking';
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
    if (C.shown) {
      for (const [id, c] of C.cards) { const x = Q().get(id); if (x) paintCard(c, x); }
      syncPop(); renderPending();
    }
    if (C.qopen) renderQueue();
  }
  function onMessage(sid, m) {
    if (sid !== C.sid) return;
    if (!C.shown) { if (m.role === 'assistant') { C.unread = true; renderDot(); } return; }
    if (m.role === 'assistant') { C.activity = ''; if (C.stream) { C.stream.el.remove(); C.stream = null; } if (C.typing) { C.typing.remove(); C.typing = null; } }
    $('as-hello').hidden = true; $('as-new').hidden = false;
    const stick = nearBottom() || m.role === 'user';
    $('as-log').append(bubble(m)); syncPop(); renderPending();
    if (stick) scrollDown();
  }
  /** the assistant's words as they come (agent.js's planning call); a tool call shows as "Planning…" */
  function stream(j, text, end) {
    if (!C.shown || j.session !== C.sid) return;
    const raw = String(text || ''), call = raw.indexOf('<|tool_call>'), vis = (call >= 0 ? raw.slice(0, call) : raw).replace(SPECIAL, '').replace(/^\s+/, '');
    if (!C.stream || C.stream.jobId !== j.id) {
      if (C.stream) C.stream.el.remove();
      const el = mk('div', 'msg bot streaming'); el.append(mk('p', 'msg-text'));
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
    if (!AG()) return api.toast(api.agentError() ? "The assistant couldn't start. Reload p0pc0rn." : 'The assistant is still starting.');
    if (!api.done('brain')) { api.toast('Get the assistant first.'); $('as-need').scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); return; }
    if (!api.consented()) return api.openLesson();
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
    if (!live.length) list.append(mk('p', 'li footnote dim', 'Nothing is waiting. Make something on Create, or ask the assistant.'));
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
  return { render, renderDl, show, hide, onMessage, stream, progress, queueChanged, openQueue, closeQueue, newChat, send, activity, research, get sid() { return C.sid; } };
}
