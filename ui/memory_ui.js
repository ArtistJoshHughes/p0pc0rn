// memory_ui.js - 3.9: Settings › Juli › About me and Routines, the heartbeat that runs the routines while p0pc0rn is open, and a routine's
// card in Juli's chat. The rules live in assistant/memory.js; this file is the screens and the wiring. app.js calls startMemory(api) once,
// after Juli, her chat and the Apps tab exist (their database holds the store `memory`), and gives About me to Juli (agent hooks.about)
// and to the Apps tab's make and change prompts (api.about in makeapp/host.js).
import { createMemory, createHeartbeat, aboutFile, parseWhen, whenText, routineProblems, ABOUT, ROUTINE } from '../assistant/memory.js';

const TEST_MS = 'p0pc0rn:test:heartbeat';   // desk tests only: the heartbeat's period in ms (500-600000); unset on phones = 60 s
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = (t) => { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
const dayClock = (t, now = Date.now()) => {
  const d = new Date(t), n = new Date(now), same = d.toDateString() === n.toDateString();
  const tom = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).toDateString() === d.toDateString();
  return same ? clock(t) : tom ? 'tomorrow ' + clock(t) : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + clock(t);
};
const short = (s, n = 40) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

/** the heartbeat's gates: on screen, the only tab, Juli ready and downloaded, the person has agreed to the terms (before that every job
 *  waits for the agreement), no app open (it keeps the phone's memory), nothing using a model (running, held for a follow-up, or next in
 *  the queue), and the last routine's job done (one never piles up behind another that waits) -> () => {ok, why} */
export function memoryGates(api, { doc = typeof document !== 'undefined' ? document : null, pending = () => false } = {}) {
  return () => {
    if (doc && doc.visibilityState !== 'visible') return { ok: false, why: 'p0pc0rn is in the background' };
    if (api.readOnly()) return { ok: false, why: 'p0pc0rn is open in another tab' };
    if (!api.AG() || !api.CH()) return { ok: false, why: 'Juli is not ready' };
    if (!api.installed()) return { ok: false, why: 'Juli is not downloaded yet' };
    if (!api.consented()) return { ok: false, why: 'the terms are not agreed yet' };
    if (api.appOpen()) return { ok: false, why: 'an app is open' };
    if (api.modelBusy()) return { ok: false, why: 'Juli or a render is busy' };
    if (pending()) return { ok: false, why: 'the last routine is still waiting' };
    return { ok: true };
  };
}

/** startMemory(api) -> {mem, hb, render(), card(message), about(budgetTokens)}. api: {db() (the Apps tab's database or null), AG(), CH(),
 *  installed() (Juli's model is on the phone), consented() (the terms), modelBusy(), appOpen(), readOnly(), jobOpen(id) (a queue job not
 *  done, failed or cancelled), toast, sheet (app.js mvSheet), el, btn, confirm, share, saveFile, diag, openChat()} */
export function startMemory(api) {
  const el = (tag, cls, text) => api.el(tag, cls, text), btn = (label, cls) => api.btn(label, cls);
  const mem = createMemory({ db: api.db });
  const gates = memoryGates(api, { pending: () => { const id = mem.state().lastJob; return !!(id && api.jobOpen && api.jobOpen(id)); } });
  /** a routine is the person's own message to Juli (kind 'routine': its card), in the chat that is open */
  const ask = async (r) => {
    const CH = api.CH(), AG = api.AG(); if (!CH || !AG) throw new Error('Juli is not ready');
    const sid = await CH.session(); if (!sid) throw new Error('no chat');
    const job = await AG.ask(sid, r.text, { kind: 'routine' });
    await mem.setLastJob(job && job.id);
    api.diag('memory: a routine ran', { when: (parseWhen(r.when) || {}).kind || '?' });   // never its words
  };
  let every = 60e3;
  try { const t = Number(localStorage.getItem(TEST_MS)); if (t >= 500 && t <= 600000) every = t; } catch (e) { /* 60 s */ }
  const hb = createHeartbeat({ mem, gates, run: async (r) => { await ask(r); render(); }, every });
  const hookAgent = () => { const ag = api.AG(); if (ag && ag.hooks) ag.hooks.about = (budget) => mem.aboutBlock(budget); };
  hookAgent();
  // the database opens with the Apps tab (makeapp/host.js init): load, count this as an opening of p0pc0rn, then the timer
  (async () => {
    for (let i = 0; i < 240 && !api.db(); i++) await sleep(250);
    await mem.load(); mem.opened(); render();
    hb.start(); await sleep(Math.min(every, 8000)); await hb.tick(); render();
  })().catch((e) => api.diag('memory: load failed', { message: String((e && e.message) || e).slice(0, 160) }));
  // back on screen after ROUTINE.reopenMin minutes away = another opening ('open' routines)
  let hiddenAt = 0;
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= ROUTINE.reopenMin * 60e3) { mem.opened(); setTimeout(() => hb.tick().then(render), 3000); }
      hiddenAt = 0;
    });
  } catch (e) { /* no document */ }

  // ---- Settings › Juli: the two rows and the heartbeat line
  let wired = false;
  function render() {
    const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
    if (!wired && $('s-about') && $('s-routines')) { wired = true; $('s-about').onclick = () => openAbout(); $('s-routines').onclick = () => openRoutines(); }
    const a = mem.about(), list = mem.routines();
    if ($('s-about-state')) $('s-about-state').textContent = a ? `${a.length} characters` : 'Not set';
    if ($('s-routines-state')) $('s-routines-state').textContent = list.length ? `${list.length} of ${ROUTINE.max}` : 'None';
    if ($('s-heartbeat')) $('s-heartbeat').textContent = heartbeatText();
  }
  function heartbeatText() {
    const list = mem.routines();
    if (!list.length) return 'Things to ask Juli again and again, while p0pc0rn is open.';
    const L = mem.line(), parts = [];
    if (L.last) parts.push(`Last: “${short(L.last.text, 28)}” at ${dayClock(L.last.at)}`);
    if (L.next) parts.push(L.next.open ? `Next: “${short(L.next.text, 28)}” when p0pc0rn opens` : `Next: “${short(L.next.text, 28)}” ${dayClock(L.next.at)}`);
    const h = hb.last; if (h && h.did === 'skip') parts.push(`Waiting: ${h.why}`);
    return parts.join(' · ') + ' · They run while p0pc0rn is open.';
  }

  // ---- About me
  function openAbout() {
    const { sheet, close } = api.sheet('mh-about', 'About me');
    sheet.append(el('p', 'callout', 'A few lines about you: what you do, what you like, how you like answers. Juli reads them when she plans, so what she says and makes fits you. They stay on this phone and are never given to an app.'));
    const ta = el('textarea'); ta.id = 'mh-about-text'; ta.maxLength = ABOUT.chars; ta.rows = 6; ta.value = mem.about();
    ta.placeholder = 'e.g. I teach third grade. I use metric units. Short answers, please.'; ta.setAttribute('aria-label', 'About me');
    const n = el('p', 'footnote dim'); const count = () => { n.textContent = `${ta.value.length} of ${ABOUT.chars} characters`; }; ta.addEventListener('input', count); count();
    const save = btn('Save', 'btn sm'), exp = btn('Export', 'btn sm ghost'), wipe = btn('Wipe', 'btn sm ghost');
    save.id = 'mh-about-save'; exp.id = 'mh-about-export'; wipe.id = 'mh-about-wipe';
    save.onclick = async () => { try { await mem.setAbout(ta.value); api.toast(mem.about() ? 'Saved' : 'About me is empty'); } catch (e) { api.toast("Couldn't save it"); } render(); close(); };
    exp.onclick = () => {   // inside the tap: the share sheet needs it
      const f = aboutFile(ta.value || mem.about()); if (!f.text.trim()) return api.toast('Nothing to export yet');
      const file = new File([f.text], f.name, { type: f.type }); api.share(file, () => api.saveFile(file));
    };
    wipe.onclick = () => api.confirm('Wipe About me?', 'Juli will no longer know these lines. This can’t be undone.', 'Wipe', async () => {
      try { await mem.wipeAbout(); } catch (e) { /* */ } ta.value = ''; count(); render(); api.toast('Wiped');
    });
    const row = el('div', 'row-btns'); row.append(save, exp, wipe);
    sheet.append(ta, n, row);
  }

  // ---- Routines
  function openRoutines() {
    const { sheet, close } = api.sheet('mh-routines', 'Routines');
    sheet.append(el('p', 'callout', `Things to ask Juli again and again: each time p0pc0rn opens, every few hours, or every day at a time. They run only while p0pc0rn is open and nothing else is using Juli, at most ${ROUTINE.perDay} a day. Each one shows in Juli’s chat as a Routine.`));
    const list = el('div', 'mh-list'); list.id = 'mh-list';
    const form = el('div', 'mh-form'); let editing = null, kind = 'open';
    const ta = el('textarea'); ta.id = 'mh-r-text'; ta.maxLength = ROUTINE.chars; ta.rows = 2; ta.placeholder = 'e.g. Tell me one fun science fact for my class'; ta.setAttribute('aria-label', 'What to ask Juli');
    const seg = el('div', 'mv-seg mh-when'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'When');
    const opts = [['open', 'On open'], ['every', 'Every few hours'], ['daily', 'Daily at']].map(([k, label]) => { const b = btn(label, 'btn sm'); b.dataset.kind = k; b.onclick = () => setKind(k); seg.append(b); return b; });
    const hours = el('input', 'input mh-hours'); hours.type = 'number'; hours.min = '1'; hours.max = String(ROUTINE.everyMax); hours.step = '1'; hours.value = '4'; hours.id = 'mh-r-hours'; hours.setAttribute('aria-label', 'Hours');
    const time = el('input', 'input mh-time'); time.type = 'time'; time.value = '08:00'; time.id = 'mh-r-time'; time.setAttribute('aria-label', 'Time');
    const save = btn('Add routine', 'btn sm'); save.id = 'mh-r-save';
    const cancel = btn('Cancel', 'btn sm ghost'); cancel.hidden = true;
    function setKind(k) { kind = k; for (const b of opts) b.setAttribute('aria-pressed', String(b.dataset.kind === k)); hours.hidden = k !== 'every'; time.hidden = k !== 'daily'; }
    function edit(r) {
      editing = r ? r.id : null; ta.value = r ? r.text : ''; const w = r ? parseWhen(r.when) : null;
      setKind(w ? w.kind : 'open'); if (w && w.kind === 'every') hours.value = String(w.hours); if (w && w.kind === 'daily') time.value = `${String(w.hh).padStart(2, '0')}:${String(w.mm).padStart(2, '0')}`;
      save.textContent = r ? 'Save changes' : 'Add routine'; cancel.hidden = !r; if (r) ta.focus();
    }
    function draw() {
      list.replaceChildren();
      const L = mem.routines();
      if (!L.length) list.append(el('p', 'footnote dim', 'No routines yet.'));
      for (const r of L) {
        const row = el('div', 'mh-row'); row.dataset.rid = r.id;
        const t = el('div', 'mh-text'); t.append(el('p', null, r.text), el('p', 'footnote dim', whenText(r.when) + (r.last ? ' · last ran ' + dayClock(r.last) : '')));
        const go = btn('Run now', 'btn sm'), ed = btn('Edit', 'btn sm ghost'), del = btn('Delete', 'btn sm ghost');
        go.dataset.act = 'run'; ed.dataset.act = 'edit'; del.dataset.act = 'delete';
        go.onclick = async () => {
          if (!api.installed()) return api.toast('Download Juli first: Settings › Models');
          try { const k = await mem.markRun(r); await ask(k); close(); render(); if (api.openChat) api.openChat(); } catch (e) { api.toast("Couldn't run it: " + String((e && e.message) || e).slice(0, 80)); }
        };
        ed.onclick = () => edit(r);
        del.onclick = () => api.confirm('Delete this routine?', `“${short(r.text, 80)}” will not run again.`, 'Delete', async () => { await mem.removeRoutine(r.id); if (editing === r.id) edit(null); draw(); render(); });
        const b = el('div', 'row-btns'); b.append(go, ed, del); row.append(t, b); list.append(row);
      }
      save.disabled = !editing && L.length >= ROUTINE.max;
      form.hidden = !editing && L.length >= ROUTINE.max;
    }
    save.onclick = async () => {
      const when = kind === 'open' ? 'open' : kind === 'every' ? `every:${Math.round(Number(hours.value) || 0)}` : `daily:${time.value}`;
      const r = Object.assign(editing ? { id: editing } : {}, { text: ta.value, when }), p = routineProblems(r);
      if (p.length) return api.toast(p[0].charAt(0).toUpperCase() + p[0].slice(1));
      try { await mem.saveRoutine(r); } catch (e) { return api.toast(String((e && e.message) || e)); }
      api.toast(editing ? 'Saved' : 'Routine added'); edit(null); draw(); render();
    };
    cancel.onclick = () => edit(null);
    const whenRow = el('div', 'mh-when-extra'); whenRow.append(hours, time);
    const btns = el('div', 'row-btns'); btns.append(save, cancel);
    form.append(el('p', 'label', 'A routine'), ta, seg, whenRow, btns);
    sheet.append(list, form);
    edit(null); draw();
  }

  // ---- a routine in Juli's chat (ui/chat.js asks for it: api.routineCard): the notice card's look, labelled Routine
  function card(m) {
    if (typeof document === 'undefined') return null;
    const b = el('div', 'msg bot k-notice sev-info k-routine'); b.dataset.mid = m.id;
    const h = el('p', 'msg-notice-title'), ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    ic.setAttribute('class', 'ic msg-ic'); use.setAttribute('href', '#i-queue'); ic.append(use);
    h.append(ic, el('span', null, 'Routine'));
    b.append(h, el('p', 'msg-text', m.text), el('p', 'footnote dim msg-from', 'Your routine · ' + clock(m.at)));
    return b;
  }

  return { mem, hb, render, card, about: (budget) => mem.aboutBlock(budget) };
}
