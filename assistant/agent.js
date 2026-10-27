// agent.js - the assistant inside p0pc0rn: a small model (Gemma 4 E2B) driving the picture, clip, sound and song models
// through the ONE job queue.
//
// Loop (one 'chat' job per message, a coordinator in the queue so it survives a page kill):
//   plan  -> the model answers with ONE native Gemma 4 tool call (or plain text): research / a render tool / ask_user / reply
//   research -> the airlocked lane (research.js); the model sees only rendered FACTS lines, then plans again (max 3 lookups a turn)
//   render -> code checks the call (closed validator, safety screen, real-person lookup, consent), queues it as a CHILD job and the
//             turn job waits; the GPU goes to the picture / clip / song model
//   look   -> woken when the child finishes: the model is shown the result (picture, or 3 frames of a clip) and must call
//             look_at_result; it decides reroll or accept, code caps rerolls at 2 (3 attempts)
//   reply  -> code writes the short status replies; the model writes answers; code appends the research citations (CC BY-SA)
// Malformed output is repaired (gemma4.parseResponse) or answered with a tool error and retried (max 2 per turn).
// Music videos: a 'musicvideo' coordinator (runners.js) asks this agent for the song words (songwrite), the shot prompts
// (shotplan) and one review of all clips (mvreview) as their own chat jobs.
import { parseResponse, STOP } from './gemma4.js';
import { MAIN_TOOLS, CLIP_KINDS, decls, validate, toJob, screenRequest, screenRender, properNames, normalizeLyrics, lyricsTooLong, lyricBudget, termsHit, getSafetyTerms, MODEL, SONG_DEFAULTS, songSecondsFrom, SONG_LENGTH_SRC, SONG_SECONDS, clampSongSeconds } from './tools.js';
import { renderBlock, citationFooter, relevant, asOf, numberWords } from './research.js';
import { blockTerms, scanPrompt, stripPrompt, isProtected, fnv } from './likeness.js';
import { openDB, uid } from './idb.js';
import { clipFrames, shrinkForModel } from './media.js';
import { estTokens, promptTokens, EST_LOW } from './fit.js';   // 3.8 (v040): prompt sizes for the Bigger brain's context
import { pickSkill, skillText } from './skills.js';   // H39: a 'for: chat' skill (know-how the person added) in the plan prompt, where it fits
import { helpAsk, selfAsk, selfPicture, howToAsk, jokeAsk, dangerAsk, cleanTopics, stripPointer, shouldNudge, refusalLike, factsAnswer, taskAsk, MAKE_TOOLS, HELP_NOTE, HELP_IDS, SELF_PIC_NOTE, ANSWER_NOTE, ANSWER_NOTE_OWN, NUDGE, HELP_NOTES,
  safetyAsk, safetyCovered, safetyTopic, safetyFound, assertsSafe, cautionLine, harmLine, stripYes, safetyNote, howToNote } from './answers.js';   // 3.9 (juliqa): how-to and self questions, Juli never looked up, plain answers (round 4: how-tos, safety, sure facts)

export const LIMITS = { steps: 6, research: 3, badCalls: 2, rerolls: 2, mvRerolls: 3, history: 4, historyKeep: 16, planNotes: 1000, songNotes: 650 };   // v026.8: the last 4 turns in full + a summary of the 12 before
// 3.8 (10-24): the structured calls (reviews, checks, the prompt rewrite, the research reader) ask for EXACT (greedy) words; the chat
// turn and the creative calls (write_song, plan_shots) ask for sampling. The app's adapter (app.js brainChat) passes no temperature
// today, so every call decodes greedily with the "Faster replies" drafter; the engine samples (with the drafter) when one is passed.
export const SAMPLING = { tool: { temperature: 0.3, topP: 0.95, topK: 64 }, review: {}, exact: {} };
// 3.8 (v040, Josh 10-24): chat stays fast on Juli's own model; for a writing task or any agent task E2B is the research agent and
// E4B is the brain; E2B (it has vision) reviews pictures. When the Bigger brain (NVIDIA Nemotron 3.5 Bolt E4B, text only;
// hooks.brainModel() -> its model id) can be used, such a turn runs in PHASES with one model in memory at a time: Juli's own model
// looks things up first (gather), then the Bigger brain plans and writes (one model swap; it never looks anything up itself), and Juli
// reviews what was made. Chat turns, turns with a photo, the reviews, the music video's shot plans and storyboards (longer than the
// Bigger brain's context) and an app's own questions stay on E2B. The Bigger brain loads with 2,048 tokens on the phone (the iOS 27
// split): its prompts are fitted first (fitPlan / fitSong: fewer earlier turns, shorter fact lists, fewer notes, older tool
// exchanges, a shorter answer, in that order; recorded in st.trimmed), a request too long for even its smallest prompt stays with
// Juli (fitsBigFloor), and a job whose Bigger brain could not load, ran out of memory or got a prompt too long goes to Juli's own
// model once (queue.js runner.fallback).
// H39: the tokens a chat skill's text may take in Juli's plan prompt (her own model) and in the Bigger brain's (fitted: it goes first)
export const SKILL_TOKENS = { plan: 500, big: 250 };
// 3.9: the tokens About me (Settings › Juli; hooks.about(budget) -> the framed block) may take in Juli's plan prompt and in the Bigger
// brain's (fitted: it goes after a skill, before any earlier turn)
export const ABOUT_TOKENS = { plan: 200, big: 120 };
export const BRAIN = { ctx: 2048, reserve: 8, planMax: 600, planMin: 400, writeMax: 900, writeMin: 600, songMax: 700, songMin: 500, notes: 400, history: 2, historyChars: 300, factLines: 6, retryNote: 80 };

export const SYSTEM_CORE = [
  'You are Juli, the creative assistant inside p0pc0rn, an iPhone app that makes pictures, short video clips and songs on the phone itself.',
  'How you work:',
  '- To make something, call ONE tool and write its prompt yourself, in English, following the NOTES. Never ask the person to write the prompt.',
  '- Before drawing or describing a real place, thing or event you are not sure about, or anything from a film, game, show or comic, call research. Use only the FACTS it returns; never invent facts.',
  '- If the request is unclear in a way that changes the result, call ask_user with one short question. Otherwise pick sensible defaults.',
  '- A song request that names a subject is clear: call make_song (pick the style yourself; the length is 60 seconds unless stated).',
  '- Every job waits in one queue and takes minutes. Do not promise speed.',
  '- Follow the SAFETY notes. If a tool call is refused, tell the person in one or two sentences, offer an original alternative, and mention Settings > Rights & Copyright.',
  '- To answer without making anything, reply in two to four plain sentences.',
].join('\n');
const REVIEW_SYS = 'You check results made on this phone. Look at the image(s) and the prompt that made them, then call look_at_result. '
  + 'accept when the result shows what was asked, even with small flaws. reroll only for a real problem (wrong subject, broken anatomy, garbled text, '
  + 'missing action, the subject melting between frames), and write fix_prompt: the whole prompt again, changed to remove the cause.';

const isAbort = (e) => !!e && (e.name === 'AbortError' || e.code === 'ABORTED');
const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z]{4,}/g) || []);
const jaccard = (a, b) => { const A = words(a), B = words(b); let i = 0; for (const w of A) if (B.has(w)) i++; return i / Math.max(1, A.size + B.size - i); };
const NOUN = { picture: 'picture', edit: 'edited picture', clip: 'clip', animate: 'clip', between: 'clip', foley: 'sound', song: 'song', musicvideo: 'music video' };

// ------------------------------------------------------------------------------------------------ cookbooks
/** cookbooks: {index (index.json), files: {'klein4b.md': text, ...}} -> {sections: Map(id -> text), pick(text, tools), ids(list)} */
export function loadCookbooks({ index, files }) {
  const sections = new Map();
  for (const s of index.sections) {
    const body = (files[s.file] || '').split('\n---\n')[0];
    const part = body.split(/\n(?=## )/).find((p) => p.startsWith('## ' + s.heading));
    if (part) sections.set(s.id, `[${s.book}] ${part.trim()}`);
  }
  const tokensOf = (id) => (index.sections.find((s) => s.id === id) || {}).tokens || 200;
  return {
    index, sections,
    ids(list, budget = index.budgetTokens) {
      const out = []; let used = 0;
      for (const id of list) { if (!sections.has(id) || out.includes(id)) continue; const t = tokensOf(id); if (used + t > budget && out.length) continue; out.push(id); used += t; }
      return out;
    },
    /** retrieval: the always-on safety sections + the sections whose keywords appear in the text (scored), within the token budget */
    pick(text, extraTools = [], budget = index.budgetTokens) {   // v026.8: + the budget (the plan's is smaller); sections of other tools only on a keyword hit
      const t = ' ' + String(text || '').toLowerCase() + ' ', narrow = extraTools.length > 0 && extraTools.length < 8;
      const scored = index.sections.map((s) => ({ id: s.id, other: narrow && s.tools.length > 0 && !s.tools.some((x) => extraTools.includes(x)),
        score: s.keywords.filter((k) => t.includes(k.includes(' ') ? k : ' ' + k)).length + (s.tools.some((x) => extraTools.includes(x)) ? 3 + (/writing|ends-with|animating|between-two/.test(s.id) ? 2 : 0) : 0) }))
        .filter((x) => x.score > 0 && !x.other).sort((a, b) => b.score - a.score);
      return this.ids([...index.always, ...scored.map((x) => x.id)], budget);
    },
    text(ids) { return ids.map((id) => sections.get(id)).filter(Boolean).join('\n\n'); },
  };
}

// ------------------------------------------------------------------------------------------------ the agent
export async function createAgent(opts) { const a = new Agent(opts); await a.init(); return a; }

export class Agent {
  /**
   * queue: the JobQueue (queue.js); research: a Research (research.js) whose reader is set per job; cookbooks: loadCookbooks(...);
   * hooks: {consent(): bool, isInstalled(modelId): bool|Promise<bool>, review: true}
   */
  constructor({ queue, research = null, cookbooks, hooks = {}, dbName = 'p0pc0rn-assistant', limits = {} }) {
    Object.assign(this, { queue, research, cookbooks, dbName });
    this.likeLog = [];   // v022: every likeness hit (rewrite / strip / check / regenerate), for the tests and the record
    this.hooks = Object.assign({ consent: () => true, isInstalled: () => true, review: true, frames: clipFrames, shrink: shrinkForModel }, hooks);
    this.limits = Object.assign({}, LIMITS, limits);
    this.listeners = new Map();
  }
  async init() {
    this.db = await openDB(this.dbName, 1, { sessions: { keyPath: 'id' } });
    // a chat job that fails (the model crashed, the page ran out of memory twice) still answers the person
    this.queue.on('failed', (j) => { if (j.kind === 'chat' && j.session && (j.params.purpose || 'turn') === 'turn') this.say(j.session, { text: `Sorry, I couldn't finish that: ${failReason(j)}. Please try again.`, kind: 'error' }); });   // v024: a plain reason (the full error is in Settings > Diagnostics)
  }
  on(n, fn) { if (!this.listeners.has(n)) this.listeners.set(n, []); this.listeners.get(n).push(fn); }
  emit(n, ...a) { for (const fn of this.listeners.get(n) || []) { try { fn(...a); } catch (e) { console.error(e); } } }

  // ---- sessions (the conversation the UI shows + the compact history the model sees)
  async session(id) { return (await this.db.get('sessions', id)) || null; }
  async newSession() { const s = { id: uid('s'), createdAt: Date.now(), messages: [], history: [], last: {}, photo: null }; await this.db.put('sessions', s); return s; }
  async say(sid, msg) {
    const s = await this.session(sid); if (!s) return;
    const m = Object.assign({ id: uid('m'), role: 'assistant', at: Date.now() }, msg);
    s.messages.push(m);
    if (m.role === 'assistant' && m.history !== false && m.text) s.history.push({ role: 'assistant', content: m.history || m.text, mid: m.id });
    s.history = s.history.slice(-this.limits.historyKeep);
    await this.db.put('sessions', s); this.emit('message', sid, m);
    return m;
  }
  /** the person's message (and optionally a photo they added, with its rights-box state) -> the queued chat job */
  async ask(sid, text, { photoBlob = null, attested = false, shape = null, kind = null } = {}) {   // 3.9: kind 'routine' (Settings › Juli › Routines)
    const s = await this.session(sid); if (!s) throw new Error('no session ' + sid);
    let photoKey = null;
    if (photoBlob) { photoKey = await this.queue.putBlob(photoBlob, { role: 'user-photo' }); s.photo = { blobKey: photoKey, attested: !!attested, shape: shape || 'wide' }; }
    const m = Object.assign({ id: uid('m'), role: 'user', at: Date.now(), text: String(text || '').slice(0, 4000), photoKey }, kind ? { kind: String(kind) } : {});
    s.messages.push(m); s.history.push({ role: 'user', content: m.text, mid: m.id }); s.history = s.history.slice(-this.limits.historyKeep);
    await this.db.put('sessions', s); this.emit('message', sid, m);
    const follow = s.brainLast && Date.now() - s.brainLast.at < 30 * 60e3 ? s.brainLast.kind : null;   // 3.8 (v040): the last Bigger brain turn's kind (route)
    return this.queue.add('chat', Object.assign({ purpose: 'turn', text: m.text, photoKey, message: m.id }, follow ? { follow } : {}), { session: sid, title: m.text.slice(0, 60) });   // chat jumps the queue (queue.js runOrder)
  }
  async remember(sid, kind, rec) {
    const s = await this.session(sid); if (!s) return;
    const prev = kind === 'picture' && s.last && s.last.picture ? { picture_prev: s.last.picture } : {};   // two pictures for clip_between
    s.last = Object.assign({}, s.last, prev, { [kind]: rec }); await this.db.put('sessions', s);
  }

  // ---- the runner for 'chat' jobs (runners.js wires it)
  runner() { return { model: (j) => this.modelFor(j), fallback: (j, m, e) => this.fallbackFor(j, m, e), needsConsent: false, consentBeforeLoad: true, run: (ctx) => this.run(ctx) }; }   // 3.9: blocked before Juli loads

  // ---- 3.8 (v040): which model runs a chat job, and the Bigger brain's prompts (BRAIN)
  /** the Bigger brain's model id when it can be used now (on the phone, can run here, on in Settings › Juli), else null */
  bigModel() { try { return (this.hooks.brainModel && this.hooks.brainModel()) || null; } catch (e) { return null; } }
  /** this job runs on the Bigger brain (any model but Juli's own: its prompts must fit BRAIN.ctx) */
  onBig(ctx) { return !!(ctx && ctx.engine && ctx.engine.id && ctx.engine.id !== MODEL.chat); }
  /** a turn's route, from its words alone (the same answer before and during its run): kind chat | writing | agent; brain = the
   *  Bigger brain plans and writes it; gather = Juli looks things up for it first */
  route(j) {
    const P = (j && j.params) || {}, text = String(P.text || ''), kind = taskKind(text, P.follow || null);
    const brain = kind !== 'chat' && !P.photoKey && !screenRequest(text) && !!this.bigModel() && this.fitsBigFloor(text, kind);
    return { kind, brain, gather: brain && !!this.research && lookupWorthy(text) };
  }
  /** the queue's model for a chat job (runner.model) */
  modelFor(j) {
    const big = this.bigModel(), p = (j && j.params && j.params.purpose) || 'turn';
    if (!big) return MODEL.chat;
    if (p === 'turn') {
      const st = j.state;
      if (!st) { const r = this.route(j); return r.brain && !r.gather ? big : MODEL.chat; }   // nothing to look up: straight to the Bigger brain
      return st.stage === 'plan' && st.route && st.route.brain && st.brainPhase ? big : MODEL.chat;   // after a render: Juli reviews it (vision)
    }
    return p === 'songwrite' ? big : MODEL.chat;   // the song's words: writing. The shot plan (longer than its context) and the reviews (pictures): Juli
  }
  /** the queue's fallback (runner.fallback): the Bigger brain could not load, ran out of memory or got a prompt too long -> Juli, once */
  fallbackFor(j, model, e) {
    if (!model || model === MODEL.chat) return null;
    this.rlDiag('assistant: the Bigger brain could not do this one, Juli takes over', { code: (e && e.code) || null, purpose: (j && j.params && j.params.purpose) || 'turn' });
    return MODEL.chat;
  }
  /** the smallest prompt the Bigger brain's plan can have (no earlier turns, no facts, the always-on notes) can fit with its shortest
   *  answer (the low estimate: decided before any model is loaded): a request surely too long for it (a long pasted text) stays with
   *  Juli. Kept per text (the queue asks often). */
  fitsBigFloor(text, kind) {
    const key = kind + '|' + text; this._floor = this._floor || new Map();
    if (!this._floor.has(key)) {
      const sys = SYSTEM_CORE + '\n' + (kind === 'writing' ? BRAIN_WRITE : BRAIN_PLAN) + '\n\nNOTES:\n' + this.cookbooks.text(this.cookbooks.ids(this.cookbooks.index.always));
      const n = estTokens([{ role: 'system', content: sys }, { role: 'user', content: text }], { tools: decls(kind === 'writing' ? ['ask_user'] : planToolNames(text, false)) }) / EST_LOW;
      if (this._floor.size > 64) this._floor.clear();
      this._floor.set(key, n + (kind === 'writing' ? BRAIN.writeMin : BRAIN.planMin) + BRAIN.reserve <= BRAIN.ctx);
    }
    return this._floor.get(key);
  }
  /** H39: the 'for: chat' skill that fits this message (assistant/skills.js pickSkill: the words it shares with the skill's name and
   *  description; no model), chosen once per turn (st.skill) -> the skill or null. hooks.skills(kind) -> the skills that are on. */
  chatSkill(st, text) {
    let list = []; try { list = (this.hooks.skills && this.hooks.skills('chat')) || []; } catch (e) { list = []; }
    if (st.skill === undefined) {
      st.skill = pickSkill(text, list, 'chat');
      if (st.skill) this.rlDiag('assistant: a skill fits the message', { from: String((list.find((k) => k.name === st.skill) || {}).from || '').replace(/:.*/, '') });   // never its name
    }
    return (st.skill && list.find((k) => k.name === st.skill)) || null;
  }
  /** 3.9: About me for a prompt (hooks.about(budget) -> the framed block; '' when there is none); its size goes to Diagnostics once a
   *  turn, never its words */
  aboutFor(st, budget, where) {
    let b = ''; try { b = String((this.hooks.about && this.hooks.about(budget)) || ''); } catch (e) { b = ''; }
    if (b && st && !st.aboutSeen) { st.aboutSeen = true; const d = (b.match(/\d/g) || []).length; this.rlDiag('assistant: about me in the plan', { tokens: Math.ceil((b.length - d) / 3.3) + d, where }); }
    return b;
  }
  /** the Bigger brain's plan prompt before it is fitted (plan() and the check before the swap): its tools (a writing task: ask_user
   *  only), its system prompt (the notes within BRAIN.notes; sysLean: the always-on ones), the last BRAIN.history turns, the request */
  async planPrompt(ctx, st) {
    const text = ctx.params.text || '', s = await this.session(ctx.job.session), writing = !!st.route && st.route.kind === 'writing';
    const names = writing ? ['ask_user'] : planToolNames(text, false), cb = this.cookbooks.pick(text, names, BRAIN.notes);
    const sk = this.chatSkill(st, text), skb = sk ? skillText([sk], SKILL_TOKENS.big) : '';   // H39: fitPlan drops it first
    const ab = this.aboutFor(st, ABOUT_TOKENS.big, 'bigger brain');   // 3.9: About me (fitPlan drops it after the skill)
    const sysFor = (lean, skill = !lean, about = !lean) => SYSTEM_CORE + '\n' + (writing ? BRAIN_WRITE : BRAIN_PLAN) + (!writing && selfPicture(text) ? '\n' + SELF_PIC_NOTE : '') + '\n\nNOTES:\n' + this.cookbooks.text(lean ? this.cookbooks.ids(this.cookbooks.index.always) : cb) + (skill && skb ? '\n\n' + skb : '') + (about && ab ? '\n\n' + ab : '');
    const history = ((s && s.history) || []).filter((h) => h.mid !== ctx.params.message).slice(-BRAIN.history).map((h) => ({ role: h.role, content: clipText(h.content, BRAIN.historyChars) }));
    return { system: sysFor(false), sysNoSkill: sysFor(false, false), sysNoAbout: sysFor(false, false, false), sysLean: sysFor(true), history, user: { role: 'user', content: text }, tools: decls(names), writing };
  }
  /** the plan call fitted to the Bigger brain's context -> {messages, maxTokens} | null (it cannot fit). While the prompt and its answer
   *  are too long, in order: a skill's text (H39), one earlier turn, then none; the fact lists cut to 3 lines, the notes to the always-on ones, the fact lists
   *  to 1 line; older tool exchanges dropped (the lookups stay); the shortest answer. Each step taken is recorded once in st.trimmed
   *  (dry: a check before the swap, nothing recorded). */
  async fitPlan(ctx, st, { system, sysNoSkill = system, sysNoAbout = sysNoSkill, sysLean, history, user, tools, writing }, dry = false) {   // 3.9: + sysNoAbout
    const cap = BRAIN.ctx - BRAIN.reserve, had = (st.trimmed || []).length;
    let hist = history, sys = system, facts = BRAIN.factLines, msgs = st.msgs, maxTokens = writing ? BRAIN.writeMax : BRAIN.planMax;
    const steps = [
      ['no skill', () => { if (sys !== system || sysNoSkill === system) return false; sys = sysNoSkill; return true; }],   // H39: before anything of the person's
      ['no about me', () => { if (sys === sysNoAbout) return false; sys = sysNoAbout; return true; }],   // 3.9: then About me, still before any earlier turn
      ['one earlier turn', () => { if (hist.length <= 1) return false; hist = hist.slice(-1); return true; }],
      ['no earlier turns', () => { if (!hist.length) return false; hist = []; return true; }],
      ['facts: 3 lines each', () => { if (facts <= 3) return false; facts = 3; return true; }],
      ['notes: the always-on ones', () => { if (sys === sysLean) return false; sys = sysLean; return true; }],
      ['facts: 1 line each', () => { if (facts <= 1) return false; facts = 1; return true; }],
      ['older tool exchanges', () => { const k = keepRecent(msgs); if (k.length >= msgs.length) return false; msgs = k; return true; }],
      ['a shorter answer', () => { const m = writing ? BRAIN.writeMin : BRAIN.planMin; if (maxTokens <= m) return false; maxTokens = m; return true; }],
    ];
    const build = () => [{ role: 'system', content: sys }, ...hist, user, ...cutFacts(msgs, facts)];
    let messages = build(), n = await promptTokens(ctx.engine, messages, { tools });
    for (const [what, step] of steps) {
      if (n + maxTokens <= cap) break;
      if (!step()) continue;
      if (!dry && !(st.trimmed || []).includes(what)) st.trimmed = (st.trimmed || []).concat(what);
      messages = build(); n = await promptTokens(ctx.engine, messages, { tools });
    }
    if (dry) return n + maxTokens <= cap ? { messages, maxTokens } : null;
    st.fit = { tokens: n, maxTokens };
    if (n + maxTokens > cap) return null;
    if ((st.trimmed || []).length > had) this.rlDiag('assistant: fitted for the Bigger brain', { trimmed: st.trimmed, tokens: n, maxTokens });
    return { messages, maxTokens };
  }
  /** the song writer's prompt fitted to the Bigger brain's context with room for one retry note -> {messages, maxTokens, facts}; too
   *  long even with the always-on notes alone and two fact lines: TOO_LONG (the queue gives the job to Juli) */
  async fitSong(ctx, sysOf, userOf) {
    const cap = BRAIN.ctx - BRAIN.reserve - BRAIN.retryNote, tools = decls(['write_song']), prefix = '<|tool_call>call:write_song{';
    for (const [notes, facts, maxTokens] of [[600, 8, BRAIN.songMax], [400, 8, BRAIN.songMax], [200, 6, BRAIN.songMax], [0, 6, BRAIN.songMax], [0, 4, BRAIN.songMax], [0, 2, BRAIN.songMax], [0, 2, BRAIN.songMin]]) {
      const messages = [{ role: 'system', content: sysOf(notes) }, userOf(facts)];
      if (await promptTokens(ctx.engine, messages, { tools, prefix }) + maxTokens <= cap) return { messages, maxTokens, facts };
    }
    throw Object.assign(new Error('the song request is too long for the Bigger brain'), { code: 'TOO_LONG' });
  }
  async run(ctx) {
    const p = ctx.params.purpose || 'turn';
    if (p === 'turn') return this.turn(ctx);
    if (p === 'shotplan') return this.shotplan(ctx);
    if (p === 'mvreview') return this.mvreview(ctx);
    if (p === 'songwrite') return this.songwrite(ctx);
    throw Object.assign(new Error('unknown chat purpose ' + p), { code: 'BAD_PURPOSE' });
  }
  /** one model call: engine.chat(messages, opts) -> parsed */
  async llm(ctx, messages, opts) {
    const r = await ctx.engine.chat(messages, Object.assign({ stop: STOP, signal: ctx.signal }, opts));
    const raw = typeof r === 'string' ? r : (r.raw != null ? r.raw : r.text || '');
    return Object.assign(parseResponse(raw), { raw, usage: r && r.usage });
  }
  /** the quarantined reader for research.js: a separate stateless call on the loaded model - no tools, no history */
  readerFor(ctx) {
    return async (messages, o = {}) => {
      const r = await ctx.engine.chat(messages, Object.assign({ maxTokens: o.maxTokens || 600, stop: STOP, signal: o.signal || ctx.signal },
        o.temperature ? { temperature: o.temperature, topP: 0.95, topK: 64 } : {}, o.prefix ? { prefix: o.prefix } : {}));   // 3.8: exact unless a temperature is asked for   // v022: the reader's forced start
      return typeof r === 'string' ? r : (r.raw != null ? r.raw : r.text || '');
    };
  }

  // ================================================================================================ a turn
  async turn(ctx) {
    const sid = ctx.job.session;
    const st = ctx.state || { stage: 'plan', msgs: [], research: [], bad: 0, steps: 0, pending: null, refused: 0 };
    const save = () => ctx.setState(st);
    if (st.stage === 'plan') {
      const hard = screenRequest(ctx.params.text);                   // the absolute cases never reach a model
      if (hard) { await this.say(sid, { text: hard.reply, kind: 'refusal', code: hard.code }); st.stage = 'done'; await save(); return { reply: hard.reply, refused: hard.code }; }
      // 3.8 (v040): the two-model route (BRAIN): Juli looks things up on her own model, then the Bigger brain plans and writes
      if (!st.route) { st.route = this.route(ctx.job); if (this.onBig(ctx)) Object.assign(st.route, { brain: true, gather: false }); await save(); }
      if (st.route.brain && !st.brainPhase) {
        if (st.route.gather && !this.onBig(ctx)) {
          await this.gather(ctx, st, save);
          if (st.chatGround && st.chatGround.ask) return this.finish(ctx, st, save, st.chatGround.ask, { kind: 'question', options: [] });
        }
        st.chatGround = st.chatGround || { skip: true };
        // with an exact count here (the engine's tokenizer: the same for both models) a prompt that cannot fit stays with Juli: no swap for nothing
        if (!this.onBig(ctx) && ctx.engine && typeof ctx.engine.countTokens === 'function' && !(await this.fitPlan(ctx, st, await this.planPrompt(ctx, st), true))) {
          st.route.brain = false; await save(); this.rlDiag('assistant: too long for the Bigger brain, Juli keeps it', { kind: st.route.kind });
          return this.plan(ctx, st, save);
        }
        st.brainPhase = true; await save();
        if (!this.onBig(ctx) && this.bigModel()) {   // the queue loads the Bigger brain for this job (modelFor) and runs it again
          this.rlDiag('assistant: the Bigger brain takes over', { kind: st.route.kind, facts: (st.research || []).filter((r) => r.status === 'hit').length });
          this.emit('activity', sid, ctx.job.id, 'Handing this to the Bigger brain…');
          return { wait: 'all' };
        }
      }
      return this.plan(ctx, st, save);
    }
    if (st.stage === 'wait') return this.afterChild(ctx, st, save);
    return { reply: st.reply || '' };
  }

  /** 3.8 (v040): the research phase of a writing or agent turn, on Juli's own model: the lookup planner and the lookups (groundChat),
   *  and a song's subject (groundSong), so the Bigger brain plans and writes from the facts with no swap back */
  async gather(ctx, st, save) {
    const sid = ctx.job.session, text = ctx.params.text || '', s = await this.session(sid);
    st.chatGround = (await this.groundChat(ctx, st, text, s, { force: true })) || { skip: true }; await save();
    if (st.chatGround.ask || st.ground || !songMakeAsk(text)) return;
    st.ground = (await this.groundSong(ctx, st, text, { tags: /instrumental/i.test(text) ? 'instrumental' : '' })) || { skip: true }; await save();
    if (st.ground.hit === false) await this.say(sid, { text: `No facts found for “${st.ground.topic}” (${st.ground.reason}), so the words come from your request alone.`, kind: 'status', history: `(no facts for ${st.ground.topic})` });
  }

  async plan(ctx, st, save) {
    const sid = ctx.job.session, s = await this.session(sid), text = ctx.params.text || '';
    // v026.8: the plan prompt carries only what this request needs (v033's real smoke: 2,937 of the 3,096 tokens that fit): its tools
    // (planToolNames) and the notes for them, within planNotes tokens; earlier turns beyond the last few go in as a one-line summary.
    // v021: a TOO_LONG plan call is retried with only the always-on notes; v026.8: then once more without the earlier turns
    // 3.8 (v040): the Bigger brain's turn (BRAIN): no lookups (Juli did them first) and, for a writing task, no tools to make things with
    const big = !!st.brainPhase, onBig = this.onBig(ctx), writing = big && !!st.route && st.route.kind === 'writing';
    const selfWrite = !big && !!st.route && st.route.kind === 'writing';   // 3.9: a piece of writing Juli plans herself: she writes it (JULI_WRITE)
    const help = !big && !onBig && !ctx.params.photoKey && (helpAsk(text) || selfAsk(text)), selfPic = !help && selfPicture(text);   // 3.9 (juliqa): Juli answers a how-to or self question herself
    // 3.9 (juliqa): a how-to ("how do i remove a red wine stain", or a terse task: "tie a bowline knot") in a chat with nothing made yet
    // (no edit can be meant): steps from what Juli knows (HOWTO_NOTE); nothing is looked up or made (the farm looked up "Port-wine stain")
    const howTo = !help && !big && !onBig && !selfWrite && !ctx.params.photoKey && !(s && s.last && Object.keys(s.last).length) && (taskAsk(text) || howToAsk(text)) && !INTENT.pic.test(text) && !INTENT.clip.test(text) && !INTENT.song.test(text) && !dangerAsk(text) && !screenRequest(text);   // never a picture, clip or song request ("make a lullaby for my baby")
    const toolNames = help || howTo ? [] : writing || selfWrite ? ['ask_user'] : planToolNames(text, !!this.research && !big);   // 3.9 (juliqa): no tool at all for a question about the app or a how-to (the desk round: "keep basil alive" -> "What kind of basil?")
    const songOnly = toolNames.includes('make_song') && !toolNames.some((n) => /picture|clip|sound/.test(n));   // a song's words are written later, by the song writer
    const cb = help ? this.cookbooks.ids([...this.cookbooks.pick(text, [], HELP_NOTES).filter((id) => /^faq#/.test(id)), ...HELP_IDS], HELP_NOTES) : this.cookbooks.pick(text, toolNames, onBig ? BRAIN.notes : songOnly || toolNames.length >= 7 ? this.limits.songNotes : this.limits.planNotes);   // a follow-up with no clear kind: the short budget (3.8: the Bigger brain's, shorter)
    const hist0 = (s.history || []).filter((h) => h.mid !== ctx.params.message), recentN = this.limits.history;
    const earlier = earlierSummary(hist0.slice(0, Math.max(0, hist0.length - recentN)));
    const sk = onBig ? null : this.chatSkill(st, text), skb = sk ? skillText([sk], SKILL_TOKENS.plan) : '';   // H39: a TOO_LONG drops it first
    const ab = onBig ? '' : this.aboutFor(st, ABOUT_TOKENS.plan, 'juli');   // 3.9: About me (a TOO_LONG drops it after the skill)
    // 3.9 (juliqa): an everyday question (no tool can make anything here, lookups on): ANSWER_NOTE (from the facts looked up for it, or
    // ANSWER_NOTE_OWN when none were found), and the notes lose the render-only safety sections; never for a request that could hurt
    // someone or one the safety screen holds
    const answerMode = () => !help && !big && !selfWrite && !!this.research && !ctx.params.photoKey && !toolNames.some((n) => MAKE_TOOLS.has(n)) && !dangerAsk(text) && !screenRequest(text);   // not a question about a photo
    const cautious = () => !howTo && safetyAsk(text) && !safetyCovered(st.research);   // round 4: a safety question that nothing looked up answers
    const answerNote = () => (howTo ? howToNote(text) : cautious() ? safetyNote(text) : (st.research || []).some((r) => r.status === 'hit') ? ANSWER_NOTE : ANSWER_NOTE_OWN);
    const sysFor = (lean) => SYSTEM_CORE + (big ? '\n' + (writing ? BRAIN_WRITE : BRAIN_PLAN) : (this.research ? '' : '\n' + LOOKUPS_OFF) + (selfWrite ? '\n' + JULI_WRITE : '')) + (help ? '\n' + HELP_NOTE : selfPic ? '\n' + SELF_PIC_NOTE : answerMode() ? '\n' + answerNote() : '') + '\n\nNOTES:\n'
      + this.cookbooks.text(lean ? this.cookbooks.ids(help ? HELP_IDS : answerMode() ? [] : this.cookbooks.index.always) : answerMode() ? cb.filter((id) => !this.cookbooks.index.always.includes(id)) : cb)   // 3.9 (juliqa)
      + (skb && !lean && !st.noSkill ? '\n\n' + skb : '')
      + (ab && !lean && !st.noAbout ? '\n\n' + ab : '')   // 3.9: About me, after the skill
      + (earlier && !st.noHistory && !onBig ? '\n\n' + earlier : '');   // 3.8: no room for the summary in the Bigger brain's context
    let system = sysFor(!!st.leanNotes);
    // v021: a song's subject is looked up by code (groundSong: song_subject -> research -> the writer with the facts), so the planner
    // of a song request is not offered research (the desktop smoke test: Gemma called research itself, then the plan overflowed)
    const songAsk = !!songAbout(text) && !/music video/i.test(text);
    const planTools = decls(toolNames);
    const forceSong = !selfWrite && !help && songMakeAsk(text);   // v026.8: a song request with a subject is made, never asked back (3.9 juliqa: a how-to question is no request)
    // p0pc0rn v021 (Josh: "chat with Wikipedia and Fandom grounding"): a plain chat turn that asks about something the lane can look up
    // is looked up HERE, in code, before the first planning call; the answer is then written from the airlocked fact lines
    if (!st.chatGround) {
      st.chatGround = howTo ? { skip: true } : (await this.groundChat(ctx, st, text, s)) || { skip: true }; await save();   // 3.9 (juliqa r4): a how-to is not looked up
      if (st.chatGround.ask) return this.finish(ctx, st, save, st.chatGround.ask, { kind: 'question', options: [] });
    }
    // 3.9 (juliqa r4): a safety question whose facts say nothing about safety: one more lookup, "<the thing> toxicity" (the farm's
    // avocado for cats: "Avocado toxicity" finds "Persin", the avocado's toxin); still nothing: the cautious answer
    if (!st.safetyLooked && !big && !help && !howTo && this.research && cautious() && (st.research || []).length < this.limits.research) {
      st.safetyLooked = true; const topic = safetyTopic(text, st.research);
      if (topic) {
        this.emit('activity', sid, ctx.job.id, `Looking up “${topic}”…`);
        const id = uid('c'), args = { topic, kind: 'real' };
        st.msgs.push({ role: 'assistant', tool_calls: [{ id, type: 'function', function: { name: 'research', arguments: args } }] });
        st.msgs.push({ role: 'tool', tool_call_id: id, name: 'research', content: await this.doResearch(ctx, st, args, text, 'auto') });
        const r = st.research[st.research.length - 1];
        if (safetyFound(r, topic)) await this.keepFacts(sid, r);
        else { st.research.pop(); st.msgs.splice(-2, 2); this.rlSet(ctx, st, { topic, status: 'miss', reason: 'nothing on whether it is safe' }); }   // ("The Peanut Butter Conspiracy", a band): not used, not cited
        this.emit('activity', sid, ctx.job.id, '');
      }
      await save();
    }
    for (;;) {
      system = sysFor(!!st.leanNotes);   // 3.9 (juliqa): with the facts looked up so far (an everyday question they answer gets ANSWER_NOTE)
      if (st.steps >= this.limits.steps) return this.finish(ctx, st, save, "I couldn't settle on a plan for that. Could you say it another way?");
      st.steps++;
      const history = st.noHistory ? [] : hist0.slice(-(onBig ? BRAIN.history : recentN)).map((h) => ({ role: h.role, content: clipText(h.content, onBig ? BRAIN.historyChars : 600) }));   // v026.8: the last turns, each at most 600 characters (3.8: the Bigger brain: 2, 300)
      const user = { role: 'user', content: text };
      if (ctx.params.photoKey && st.steps === 1) {
        const ph = await ctx.getBlob(ctx.params.photoKey);
        if (ph) user.content = [{ type: 'image', image: await this.hooks.shrink(ph) }, { type: 'text', text: text + '\n(The person added the photo above.)' }];
      }
      let messages = [{ role: 'system', content: system }, ...history, user, ...(st.shortFacts ? cutFacts(keepRecent(st.msgs), 3) : st.msgs)], maxTokens = 1000, tools = planTools;
      if (onBig) {   // 3.8 (v040): fitted to the Bigger brain's context; a turn that cannot fit goes to Juli (the queue's fallback)
        const bp = await this.planPrompt(ctx, st), f = await this.fitPlan(ctx, st, bp); await save();
        if (!f) throw Object.assign(new Error('the request is too long for the Bigger brain'), { code: 'TOO_LONG' });
        messages = f.messages; maxTokens = f.maxTokens; tools = bp.tools;
        const ksk = this.chatSkill(st, text), kin = !!ksk && bp.system !== bp.sysNoSkill && messages[0].content === bp.system;   // H39: a skill went in
        this.emit('activity', sid, ctx.job.id, (writing ? 'The Bigger brain is writing' : 'The Bigger brain is planning') + (kin ? ` with the “${ksk.name}” skill…` : '…'));
      }
      if (!onBig && skb && !st.noSkill && !st.leanNotes) this.emit('activity', sid, ctx.job.id, `Using the “${sk.name}” skill…`);   // H39
      let out;
      try { out = await this.llm(ctx, messages, Object.assign({ tools, maxTokens, stream: true }, SAMPLING.tool)); }   // 3.8: stream = the plan call (its words show in the chat)
      catch (e) {
        if (onBig || !e || e.code !== 'TOO_LONG' || (st.leanNotes && st.noHistory && st.shortFacts)) throw e;   // 3.8: the Bigger brain's TOO_LONG: the queue gives the turn to Juli
        // v021 / v026.8: a TOO_LONG plan call is retried with only the always-on notes, then without the earlier turns; 3.8 (v040): then with
        // each fact list cut to 3 lines and only the lookups and the last tool exchange kept (a long turn the Bigger brain handed back)
        for (;;) {
          if (skb && !st.noSkill) st.noSkill = true; else if (ab && !st.noAbout) st.noAbout = true; else if (!st.leanNotes) st.leanNotes = true; else if (!st.noHistory) st.noHistory = true; else if (!st.shortFacts) st.shortFacts = true; else throw e;
          system = sysFor(!!st.leanNotes);   // H39: the first step may be the skill alone (the notes stay)
          messages = [{ role: 'system', content: system }, ...(st.noHistory ? [] : history), user, ...(st.shortFacts ? cutFacts(keepRecent(st.msgs), 3) : st.msgs)];
          await save();
          try { out = await this.llm(ctx, messages, Object.assign({ tools: planTools, maxTokens: 1000 }, SAMPLING.tool)); break; }
          catch (e2) { if (!e2 || e2.code !== 'TOO_LONG') throw e2; e = e2; }
        }
      }
      if (onBig || skb) this.emit('activity', sid, ctx.job.id, '');
      // v026.8: a tool call that came back unreadable (v033's long-chat smoke: "expected , or } at 333") is asked for once more, plainly
      if (!out.toolCalls.length && ((out.errors && out.errors.length) || /<\|tool_call>|call:\s*\w+\s*\{/.test(out.raw || '')) && !st.parseRetry) {
        st.parseRetry = true; st.msgs.push({ role: 'user', content: 'Your last tool call could not be read. Call the tool again: every text value inside <|"|> quotes, nothing else.' });
        this.rlDiag('assistant: unreadable tool call, asked again', { errors: (out.errors || []).slice(0, 2) });
        await save(); continue;
      }
      // v026.8 (the coordinator, Oct 15): "make me a song about X" just makes the song. A question back (ask_user, or plain words with no
      // call) is overruled in code: make_song with defaults; the writer picks the words, the style and the tempo
      const askedBack = out.toolCalls.length ? out.toolCalls.every((x) => x.name === 'ask_user') : /\?\s*$/.test(String(out.content || '').trim());
      if (forceSong && askedBack && !st.longCall) {
        this.rlDiag('assistant: a song with a subject, made without asking back', { asked: out.toolCalls.length ? 'ask_user' : (out.content ? 'words' : 'nothing') });
        out.toolCalls = [forcedSongCall(text)];
      }
      // p0pc0rn v019 (the real smoke, Oct 13): told its lyrics were too long, Gemma 4 E2B answered "I will create a shorter version now" in
      // words instead of calling again. The hand-off trims lyrics to the line budget anyway (normalizeLyrics), so the first call goes ahead.
      if (!out.toolCalls.length && st.longCall && !st.longUsed) { st.longUsed = true; out.toolCalls.push(st.longCall); }
      if (!out.toolCalls.length) {
        if (out.content && (help || howTo) && !st.bareRetry && /^\W*(?:research|ask_user|make_[a-z_]+|edit_picture|animate_picture|clip_between|add_sound)\W*$/i.test(out.content)) {   // 3.9 (juliqa r4): a bare tool name as the reply ("research" for "keep basil alive")
          st.bareRetry = true; st.msgs.push({ role: 'assistant', content: out.content }, { role: 'user', content: help ? 'Answer in words, from the HOW TO ASK notes.' : 'Answer in words, with the steps.' }); await save(); continue;
        }
        if (out.content && !big && !help && !selfWrite && cautious() && (assertsSafe(out.content) || refusalLike(out.content))) {   // 3.9 (juliqa r4): never "safe" with nothing that says so
          this.rlDiag('assistant: a safety question that nothing looked up answers: the cautious line', { reply: assertsSafe(out.content) ? 'said safe' : 'refused' });
          return this.finish(ctx, st, save, cautionLine(text), { modelText: true });
        }
        if (out.content && !big && !help && !selfWrite && !howTo && safetyAsk(text) && !cautious() && assertsSafe(out.content) && !refusalLike(out.content) && harmLine(text, st.research)) {   // 3.9 (juliqa r4): never "safe" against facts that say harmful
          this.rlDiag('assistant: "safe" against facts that say it is harmful: their own words', {});
          return this.finish(ctx, st, save, harmLine(text, st.research), { modelText: true });
        }
        if (out.content && !st.nudged && !big && !help && !selfWrite && shouldNudge(text, out.content, { offeredRender: toolNames.some((n) => MAKE_TOOLS.has(n)), refused: st.refused, held: !!screenRequest(text) || cautious() })) {   // 3.9 (juliqa)
          st.nudged = true; this.rlDiag('assistant: a refusal of an everyday question, asked again', {});
          st.msgs.push({ role: 'assistant', content: out.content }, { role: 'user', content: NUDGE }); await save(); continue;
        }
        if (out.content && st.nudged && refusalLike(out.content) && factsAnswer(st.research, text)) return this.finish(ctx, st, save, factsAnswer(st.research, text), { modelText: true });   // 3.9 (juliqa): the facts' own words
        if (out.content) return this.finish(ctx, st, save, out.content, { modelText: true });
        if (++st.bad > this.limits.badCalls) return this.finish(ctx, st, save, "Sorry, I lost my train of thought. Could you ask again?");
        st.msgs.push({ role: 'user', content: 'Reply to the person, or call one tool.' }); await save(); continue;
      }
      // research calls first (up to 2 at once), then at most one other call
      const calls = out.toolCalls.slice(0, 3);
      // research always runs first; a render call in the same answer is dropped and the model plans again WITH the facts
      const research = calls.filter((c) => c.name === 'research').slice(0, 2), other = calls.find((c) => c.name !== 'research');
      if (research.length) {
        for (const c of research) {
          const id = uid('c'), v = validate('research', c.arguments);
          st.msgs.push({ role: 'assistant', tool_calls: [{ id, type: 'function', function: { name: 'research', arguments: v.args } }] });
          let content;
          if (!v.ok) { content = 'error: ' + v.errors.join('; '); st.bad++; }
          else if (st.research.length >= this.limits.research) content = 'research limit reached for this message: answer with the facts you have.';
          else if (big || help || howTo) content = big ? 'the lookups for this message are done: answer with the facts you have.' : help ? 'there is nothing to look up for this: answer it from the HOW TO ASK notes.' : 'there is nothing to look up for this: answer with the steps, from what you know.';   // 3.9 (juliqa): + a how-to question   // 3.8 (v040): the Bigger brain never looks things up
          else content = await this.doResearch(ctx, st, v.args, text);
          st.msgs.push({ role: 'tool', tool_call_id: id, name: 'research', content });
        }
        await save(); continue;
      }
      const c = other || calls[0];
      const id = uid('c'), v = c.forced ? { ok: true, args: Object.assign({}, c.arguments), errors: [], repairs: [] }   // v026.8: the code's own make_song (the writer fills the rest)
        : validate(c.name, c.arguments, c.name === 'make_song' ? { seconds: songSecondsFrom(text) } : {});   // v032: the song length asked for wins
      st.msgs.push({ role: 'assistant', tool_calls: [{ id, type: 'function', function: { name: c.name, arguments: Object.keys(v.args).length ? v.args : (c.arguments || {}) } }] });
      const toolErr = async (msg) => { st.msgs.push({ role: 'tool', tool_call_id: id, name: c.name, content: msg }); st.bad++; await save(); };
      if ((selfWrite || help || howTo) && c.name !== 'ask_user') {   // 3.9: a piece of writing: a call to make something is turned back into words (juliqa: and a how-to question)
        if (st.bad >= this.limits.badCalls) return this.finish(ctx, st, save, help || howTo ? "Ask me again in other words, and I'll explain." : "I couldn't write that one. Could you ask again?");
        await toolErr(help ? `error: "${c.name}" is not offered here: answer the question in words, from the HOW TO ASK notes.` : howTo ? `error: "${c.name}" is not offered here: answer in words, with the steps.` : `error: "${c.name}" is not offered here: this is a piece of writing. Write it yourself as your reply, in plain text.`); continue;
      }
      if (!v.ok || !MAIN_TOOLS.includes(c.name)) {
        if (st.bad >= this.limits.badCalls) return this.finish(ctx, st, save, "I couldn't work out how to do that. Could you say it another way?");
        await toolErr('error: ' + (v.errors.length ? v.errors.join('; ') : `"${c.name}" is not available here`) + '. Call the tool again, fixed.'); continue;
      }
      if (c.name === 'ask_user') {
        const q = v.args.question + (v.args.options && v.args.options.length ? '\n' + v.args.options.map((o) => '- ' + o).join('\n') : '');
        return this.finish(ctx, st, save, q, { kind: 'question', options: v.args.options || [] });
      }
      // a render call: closed checks in code, then the queue
      const gate = await this.gateRender(ctx, c.name, v.args, text, s);
      if (gate && gate.final) return this.finish(ctx, st, save, gate.final, { kind: 'refusal', code: gate.code });
      if (gate) {
        if (gate.action === 'refuse') st.refused++;
        if (st.refused > 1 || st.bad >= this.limits.badCalls + 1) return this.finish(ctx, st, save, gate.fallback || "I can't make that one. Settings > Rights & Copyright explains why.", { kind: 'refusal', code: gate.code });
        st.msgs.push({ role: 'tool', tool_call_id: id, name: c.name, content: gate.message });
        if (gate.action === 'rewrite') st.bad++;
        await save(); continue;
      }
      // p0pc0rn v021 (Josh): a song ABOUT a real or pop-culture subject is grounded on facts. Code runs the research step here, every
      // time (not left to the model): sort the subject (a focused, forced song_subject call), look it up through the airlocked lane,
      // then write the lyrics FROM the rendered facts. Personal or abstract topics skip it and nothing is said; a miss gets one line.
      if (c.name === 'make_song' && !st.ground) {
        st.ground = (big ? null : await this.groundSong(ctx, st, text, v.args)) || { skip: true }; await save();   // 3.8 (v040): the Bigger brain looks nothing up (Juli did, first: gather)
        if (st.ground.hit === false) await this.say(sid, { text: `No facts found for “${st.ground.topic}” (${st.ground.reason}), so the words come from your request alone.`, kind: 'status', history: `(no facts for ${st.ground.topic})` });
      }
      if ((c.name === 'make_song' || c.name === 'make_music_video') && v.args.tags) v.args.tags = cleanTags(v.args.tags);   // v022: never an artist name
      const grounded = c.name === 'make_song' && !!(st.ground && st.ground.hit) && !/instrumental/i.test(v.args.tags || '');
      if (grounded) st.shortAsked = true;   // the facts-led write_song keeps to the line budget itself
      // the line budget (music probe v002): too many lines -> ask ONCE for a shorter version; after that the hand-off trims
      if ((c.name === 'make_song' || c.name === 'make_music_video') && v.args.lyrics && !st.shortAsked) {
        const long = lyricsTooLong(v.args.lyrics, v.args.seconds, v.args.bpm || SONG_DEFAULTS.bpm);
        if (long) { st.shortAsked = true; st.longCall = { name: c.name, arguments: c.arguments }; st.msgs.push({ role: 'tool', tool_call_id: id, name: c.name, content: `error: ${long}. Call ${c.name} again.` }); await save(); continue; }
      }
      if (c.name === 'make_song' && (grounded || (!v.args.lyrics && !/instrumental/i.test(v.args.tags || '')))) {
        // a vocal song without words: a focused, forced write_song call writes them. A small model does this far better than inside
        // the 8-tool planning call (measured Oct 12: Gemma 4 asked the person to write the lyrics instead). A grounded song is always
        // written here, from its facts (the planning call's own lyrics were written without them).
        const w = await this.writeSong(ctx, { idea: text, seconds: v.args.seconds, tags: v.args.tags, bpm: v.args.bpm, ground: grounded ? st.ground : null });
        Object.assign(v.args, { lyrics: w.lyrics, title: grounded ? w.title || v.args.title : v.args.title || w.title, tags: w.tags, bpm: v.args.bpm || w.bpm }, !v.args.key && w.key ? { key: w.key } : {}, !v.args.time_signature && w.timeSignature ? { time_signature: w.timeSignature } : {});
        if (grounded && !st.ground.told) {
          st.ground.told = true; st.ground.used = w.used || [];
          const row = (st.rl || []).find((x) => x.status === 'found' && x.title === st.ground.title);   // v026.2
          if (row) this.rlSet(ctx, st, { topic: row.topic, used: st.ground.used.slice(0, 12) });
          this.rlDiag('research: the lyrics use', { used: (st.ground.used || []).length });
          await this.say(sid, { text: `${st.ground.local ? `Found “${st.ground.title}” in what the assistant has looked up before (${st.ground.site}${st.ground.asOf ? ', ' + st.ground.asOf : ''})` : `Looked up “${st.ground.title}” on ${st.ground.site}`}: the lyrics use ${w.used && w.used.length ? `${w.used.length} of its facts (${w.used.slice(0, 5).join(', ')})` : 'its facts'}.`, kind: 'status', history: `(grounded on ${st.ground.title})` });
        }
      }
      if (VISUAL.has(c.name) && st.likeProtected) await this.likeCheck(ctx, st, c.name, v.args);
      if (VISUAL.has(c.name) && (st.likeProtected || st.likeAsked) && !st.likeTold) {   // v022: one plain line when a transform happened
        st.likeTold = true;
        await this.say(sid, { text: `Here's an original take inspired by ${st.likeSubject || 'it'}. p0pc0rn doesn't recreate real people or copyrighted characters.`, kind: 'status', history: `(an original take inspired by ${st.likeSubject || 'it'})` });
      }
      const job = toJob(c.name, v.args, { last: s.last, photo: s.photo });
      if (!job.error && this.hooks.castJob) { const cj = await this.hooks.castJob(job, c.name, v.args, text); if (cj) Object.assign(job, cj); }   // p0pc0rn Cast: their photos as Klein's reference
      if (job.kind === 'musicvideo' && st.likeBlocks && st.likeProtected) job.params.avoid = st.likeBlocks;   // its shot plan is stripped the same way
      if (job.error) { await toolErr('error: ' + job.error); if (st.bad > this.limits.badCalls) return this.finish(ctx, st, save, job.error); continue; }
      const needs = job.kind === 'musicvideo' ? [MODEL.clip, job.params.songKey ? null : MODEL.song].filter(Boolean) : [job.model].filter(Boolean);
      for (const m of needs) if (!(await this.hooks.isInstalled(m))) {
        const hf = this.hooks.hfLogin !== false && (m === MODEL.clip || m === MODEL.animate || m === MODEL.between)   // the video model's Gemma 2 text encoder is gated by Google (hooks.hfLogin: false until the app has the login card)
          ? " It needs a one-time, free Hugging Face login first (Google's terms for its Gemma 2 text encoder); the download card walks you through it." : '';
        return this.finish(ctx, st, save, `The ${modelName(m)} isn't on this phone yet. Download it from Settings, then ask me again.${hf}`, { kind: 'needs-download', model: m });
      }
      if ((job.kind === 'song' || job.kind === 'musicvideo') && st.rl && st.rl.length) job.params.research = st.rl.slice();   // v026.2: the Library card shows it
      const child = await ctx.enqueueOnce('r0', job.kind, job.params, { title: NOUN[job.kind] });
      st.pending = { tool: c.name, args: v.args, kind: job.kind, child: child.id, attempt: 1, rerolls: 0, callId: id, minutes: job.minutes, then: job.then || null };   // Cast: a clip = its still, then image-to-video
      st.msgs.push({ role: 'tool', tool_call_id: id, name: c.name, content: `queued: the ${NOUN[job.kind]} is being made (about ${job.minutes} minutes).` });
      st.stage = 'wait'; await save();
      await this.say(sid, { text: ack(job.kind, job.minutes, v.repairs), kind: 'status', jobId: child.id, history: `(started a ${NOUN[job.kind]}: ${(v.args.prompt || v.args.idea || v.args.tags || '').slice(0, 120)})` });
      return { wait: 'all' };
    }
  }

  /** v026.2: one research row per topic (the research list), on the job state, live to the chat and in Diagnostics */
  rlSet(ctx, st, row) {
    st.rl = st.rl || [];
    const i = st.rl.findIndex((x) => x.topic === row.topic);
    if (i >= 0) st.rl[i] = Object.assign({}, st.rl[i], row); else st.rl.push(row);
    this.emit('research', ctx.job.session, ctx.job.id, st.rl.slice());
  }
  rlDiag(step, data) { this.emit('diag', step, data); }
  // v027.3: Diagnostics say what KIND of miss or drop it was, never the topic, a title, a wiki's name or a quote (people paste the report)
  static missKind(s) {
    s = String(s || '');
    return /^network|lookup failed/.test(s) ? 'network' : /licensed/.test(s) ? 'the wiki\'s licence' : /^parked/.test(s) ? 'parked after misses'
      : /not about/.test(s) ? 'not about the subject' : /usable facts|came back empty|not usable|unusable/.test(s) ? 'nothing usable'
      : /redirects to another address/.test(s) ? 'the wiki redirects elsewhere'   // post-launch: a Fandom redirect is never followed
      : /no page|no Wikipedia article|no usable Wikipedia article|not a wiki/.test(s) ? 'no article' : 'other';
  }
  static whyKinds(rd) { return rd && rd.why ? rd.why.slice(0, 8).map((w) => (/^about /.test(String(w.why)) ? 'about another subject' : String(w.why).slice(0, 40))) : null; }
  async doResearch(ctx, st, args, userText, mode = 'auto') {
    if (!this.research) { this.rlSet(ctx, st, { topic: args.topic, status: 'skipped', reason: 'research is off on this phone' }); return 'research is not available on this phone right now: answer without it, and say so.'; }
    this.research.reader = this.readerFor(ctx);
    this.research.annotate = (rec) => { rec.like = blockTerms(rec, (getSafetyTerms() || {}).signatures || {}); };   // v022: names + looks, from the full lead
    this.rlSet(ctx, st, { topic: args.topic, status: 'searching' });
    this.rlDiag('research: looking up', { kind: args.kind || null, mode });
    this.research.lastRead = null;
    let r;
    try { r = await this.research.lookup(args.topic, { context: userText, kind: args.kind, franchise: args.franchise || '', mode, signal: ctx.signal }); }
    catch (e) { if (isAbort(e)) throw e; r = { status: 'miss', topic: args.topic, reason: 'the lookup failed (' + String(e.message || e).slice(0, 60) + ')' }; }
    // v026.2: what came back, as a row and a Diagnostics step (the reader's kept / dropped quotes and why, a cache or KB hit)
    const rd = this.research.lastRead || null;
    if (r.status === 'hit') {
      this.rlSet(ctx, st, { topic: args.topic, status: 'found', origin: r.local ? 'local' : 'web', cached: !!r.cached, local: r.local || null, title: r.title,
        site: (r.source && r.source.siteName) || '', url: (r.source && (r.source.permalink || r.source.url)) || '', asOf: r.source ? asOf(r.source) : '',
        quotes: (r.facts || []).map((f) => f.quote || f.value).filter(Boolean).slice(0, 12) });
      this.rlDiag('research: found', { site: (r.source && r.source.site) || null, from: r.local ? `the phone (${r.local})` : r.cached ? 'the cache' : 'the web',
        kept: (r.facts || []).length, dropped: rd ? rd.dropped : null, why: Agent.whyKinds(rd) });
    } else {
      this.rlSet(ctx, st, { topic: args.topic, status: 'miss', reason: r.reason || 'not found' });
      this.rlDiag('research: not found', { reason: Agent.missKind(r.reason), kept: rd ? rd.kept : null, dropped: rd ? rd.dropped : null, why: Agent.whyKinds(rd) });
    }
    st.research.push(r);
    const hits = st.research.filter((x) => x.status === 'hit');
    // v022: a request to MAKE something never shows the planner how a protected thing looks (its colours, forms, emblems, items)
    const shown = r.status === 'hit' && RENDER_ASK.test(userText || '') && isProtected(r) ? Object.assign({}, r, { facts: r.facts.filter((f) => !LOOK_RELS.has(f.relation)) }) : r;
    // re-number so the [n] markers match the footer the reply gets
    return r.status === 'hit' ? renderOne(shown, hits.indexOf(r) + 1) : renderBlock([r]);   // [n] matches the footer the reply gets
  }

  /** v021: the lookup step of a plain chat turn -> null (no lookup: research off, a render request, small talk, a question about the
   *  app, nothing lookup-worthy) | {looked: [titles], reused: [titles], missed: [topics]} | {ask: '...'} (a name the message does not
   *  settle). Facts reach the answer only as the lane's rendered fact lines, as synthetic research calls the planner then reads. */
  async groundChat(ctx, st, text, s, { force = false } = {}) {   // 3.8 (v040): force = a writing or agent turn's lookups (gather)
    const t = String(text || '').trim(), sid = ctx.job.session, jid = ctx.job.id;
    if (!this.research || !t || (!force && RENDER_ASK.test(t)) || SMALL_TALK.test(t) || APP_ASK.test(t) || helpAsk(t) || selfAsk(t) || selfPicture(t)) return null;   // 3.9 (juliqa): + how-to and self questions, a picture of Juli
    const forced = FORCE_ASK.test(t), kept = (s && s.facts) || [];
    this.emit('activity', sid, jid, 'Checking what to look up…');
    let topics = await this.planTopics(ctx, t, forced);
    const out = { looked: [], reused: [], missed: [] };
    if (!topics.length) {   // a follow-up in the same thread ("how long was it?"): the facts already fetched, no new lookup
      if (kept.length && FOLLOW_UP.test(t)) { this.injectFacts(st, kept[kept.length - 1]); out.reused.push(kept[kept.length - 1].title); this.emit('activity', sid, jid, ''); return out; }
      this.emit('activity', sid, jid, ''); return null;
    }
    for (const tp of topics.slice(0, forced ? 4 : 2)) {
      const prev = kept.find((r) => relevant(tp.topic, r.title) && relevant(r.title, tp.topic));
      if (prev) { this.injectFacts(st, prev); out.reused.push(prev.title); continue; }
      if (st.research.length >= this.limits.research) break;
      this.emit('activity', sid, jid, `Looking up “${tp.topic}”…`);
      const id = uid('c'), args = Object.assign({ topic: tp.topic, kind: tp.kind === 'popculture' ? 'popculture' : 'real' }, tp.franchise ? { franchise: tp.franchise } : {});
      st.msgs.push({ role: 'assistant', tool_calls: [{ id, type: 'function', function: { name: 'research', arguments: args } }] });
      const content = await this.doResearch(ctx, st, args, t, forced ? 'forced' : 'auto');
      st.msgs.push({ role: 'tool', tool_call_id: id, name: 'research', content });
      const r = st.research[st.research.length - 1];
      if (r && r.status === 'hit') { out.looked.push(r.title); await this.keepFacts(sid, r); continue; }
      out.missed.push(tp.topic);
      if (r && /disambiguation/i.test(r.reason || '') && topics.length === 1) { this.emit('activity', sid, jid, ''); return { ask: `“${tp.topic}” could mean several things on Wikipedia. Which one did you mean? Add a word or two to say which.` }; }
      await this.say(sid, { text: `No facts found for “${tp.topic}” (${(r && r.reason) || 'not found'}).`, kind: 'status', history: `(no facts for ${tp.topic})` });
    }
    this.emit('activity', sid, jid, '');
    return out;
  }
  /** facts fetched earlier in this chat, given to the planner again as a research result (and cited again); no new fetch */
  injectFacts(st, rec) {
    if (!st.research.some((x) => x.status === 'hit' && x.title === rec.title)) st.research.push(rec);
    const n = st.research.filter((x) => x.status === 'hit').findIndex((x) => x.title === rec.title) + 1, id = uid('c');
    st.msgs.push({ role: 'assistant', tool_calls: [{ id, type: 'function', function: { name: 'research', arguments: { topic: rec.title, kind: rec.source && rec.source.site === 'fandom' ? 'popculture' : 'real' } } }] },
      { role: 'tool', tool_call_id: id, name: 'research', content: renderOne(rec, n) });
  }
  /** the session keeps the last few hits (the facts + their source, never page text) for follow-up questions */
  async keepFacts(sid, r) {
    const s = await this.session(sid); if (!s) return;
    const rec = { status: 'hit', topic: r.topic, title: r.title, facts: r.facts, flags: r.flags || [], others: r.others || [], isPerson: !!r.isPerson, isCharacter: !!r.isCharacter, source: r.source, categories: (r.categories || []).slice(0, 20), like: r.like || null };
    s.facts = (s.facts || []).filter((x) => x.title !== rec.title).concat(rec).slice(-6);
    await this.db.put('sessions', s);
  }
  /** what a chat message asks about (a research planner: a stateless planner call + the titles the
   *  person spelled out) -> [{topic, kind, franchise}], at most 4; [] = nothing to look up */
  async planTopics(ctx, text, forced) {
    const exact = explicitTitles(text, forced);
    let topics = [];
    try {
      const raw = await this.readerFor(ctx)([{ role: 'system', content: PLAN_SYS + (forced ? PLAN_FORCE : '') }, { role: 'user', content: 'MESSAGE:\n' + String(text).slice(0, 1200) }], { maxTokens: 160 });   // 3.8: exact (the planner's reading)
      topics = cleanTopics(parseTopics(raw));   // 3.9 (juliqa): Juli herself is never looked up
    } catch (e) { if (isAbort(e)) throw e; topics = []; }
    if (forced && !topics.length && !exact.length) { const rest = String(text).replace(FORCE_ASK, '').split(/[.;?!\n]/)[0].trim(); if (rest.length >= 2) exact.push(rest.slice(0, 80)); }
    const out = [], seen = new Set();
    for (const tp of [...exact.map((x) => ({ topic: x, kind: '' })), ...topics]) {
      const k = String(tp.topic).toLowerCase(); if (seen.has(k) || out.some((o) => k.includes(o.topic.toLowerCase()))) continue;
      seen.add(k); out.push(tp); if (out.length >= 4) break;
    }
    return out;
  }

  /** v021: the research step of a song plan -> null (nothing to look up: no subject, personal, abstract, research off, instrumental)
   *  | {topic, hit: false, reason} | {topic, hit: true, title, site, lines (the airlock's rendered fact lines), values (for the check)}.
   *  The facts reach the song only as rendered fact lines (research.js renderBlock), never page text. */
  async groundSong(ctx, st, text, args) {
    const skip = (topic, reason) => { this.rlSet(ctx, st, { topic, status: 'skipped', reason }); this.rlDiag('research: skipped', { reason }); return null; };   // v026.2: said, not silent
    if (!this.research) return skip('the song', 'research is off on this phone');
    if (/instrumental/i.test((args && args.tags) || '')) return skip('the song', 'instrumental: no words to ground');
    const about = songAbout(text);
    if (!about) return skip(String(text || '').slice(0, 60) || 'the song', 'no subject in the request');
    if (PERSONAL.test(about)) return skip(about, 'a personal subject: nothing to look up');
    let r = (st.research || []).find((x) => x.status === 'hit' && relevant(about, x.title, x.lead));   // the planner already looked it up
    let topic = r ? r.topic : '';
    if (!r) {
      const cls = await this.classifySubject(ctx, text, about);
      this.rlDiag('research: the song is about', { kind: cls ? cls.kind : null, topic: !!(cls && cls.topic) });
      if (!cls) return skip(about, 'the assistant could not sort the subject');
      if (!['real', 'popculture'].includes(cls.kind) || !cls.topic) return skip(about, `${cls.kind === 'abstract' ? 'an abstract' : cls.kind === 'personal' ? 'a personal' : 'a'} subject: nothing to look up`);
      topic = cls.topic;
      await this.say(ctx.job.session, { text: `Looking up “${topic}” for the lyrics…`, kind: 'status', history: false });
      await this.doResearch(ctx, st, { topic, kind: cls.kind, franchise: cls.franchise || '' }, text);
      r = st.research[st.research.length - 1];
      if (!r || r.status !== 'hit') return { topic, hit: false, reason: (r && r.reason) || 'not found' };
      // never ground on a wrong entity: the page must be about what the person wrote (the lane already checked it against the topic)
      if (!relevant(about, r.title) && !relevant(about, r.title, r.lead)) {
        st.research.pop(); this.rlSet(ctx, st, { topic, status: 'miss', reason: `“${r.title}” is not about “${about}”` }); this.rlDiag('research: not about the subject', {});
        return { topic, hit: false, reason: `“${r.title}” is not about “${about}”` };
      }
    }
    const block = renderBlock([r]).split('\n'), lines = block.filter((l) => /^- /.test(l)).map((l) => l.replace(/^- /, '').replace(/\s*\[\d+\]\s*$/, ''));
    // src: the source text this phone holds for the page (never shown to the writer: the lyrics are checked against it in code)
    return { topic, hit: true, sh: (r.like && r.like.shingles) || [], src: [r.lead, r.summary, ...(r.facts || []).map((f) => f.quote)].filter(Boolean).join(' ').slice(0, 3000), title: r.title, site: r.source.siteName, local: r.local || null, asOf: asOf(r.source), lines, values: (r.facts || []).map((f) => String(f.value).replace(/_/g, ' ')), quoted: (r.facts || []).some((f) => f.relation === 'quote') };
  }
  /** a focused, forced call: what is the song about? {kind: real | popculture | personal | abstract, topic, franchise} or null */
  async classifySubject(ctx, text, about) {
    const messages = [{ role: 'system', content: 'You sort song requests so their facts can be looked up. Call song_subject. real = a real person, place, event, ship, building, object or work: give its encyclopedia title as topic. popculture = a character, game, film, show, comic or franchise: give its name as topic and the franchise. personal = the person\'s own life, family, friends or pets. abstract = a feeling, a season, a mood, an idea, or an everyday scene or thing (the last train home, a rainy night, a summer road trip).' },
      { role: 'user', content: `Song request: "${String(text).slice(0, 300)}"\nThe song is about: "${about}"` }];
    try {
      const out = await this.llm(ctx, messages, Object.assign({ tools: decls(['song_subject']), maxTokens: 80, prefix: '<|tool_call>call:song_subject{' }, SAMPLING.review));
      const c = out.toolCalls.find((x) => x.name === 'song_subject'), v = c && validate('song_subject', c.arguments);
      return v && v.ok ? v.args : null;
    } catch (e) { if (isAbort(e)) throw e; return null; }
  }

  /** v022: the protected things in play for a visual job: this chat's looked-up records (this turn's and the ones kept for follow-ups),
   *  famous characters and brands the static lists know, and real people found by name (not refused any more: transformed) */
  likeBlocks(st, s, text, realPeople = []) {
    const SIG = (getSafetyTerms() || {}).signatures || {}, seen = new Set(), out = [], turn = (st.research || []).filter((r) => r.status === 'hit');
    for (const r of [...turn, ...((s && s.facts) || [])]) {
      const k = (r.source && r.source.permalink) || r.title; if (seen.has(k)) continue; seen.add(k);
      const b = r.like && r.like.ids ? r.like : blockTerms(r, SIG);
      // in play: looked up in THIS turn, or named / described in the request or the prompt (an earlier chat's record otherwise stays out)
      if (turn.includes(r) || scanPrompt(text, [b]).hit) out.push(b);
    }
    const pseudo = (title, cls, generic) => ({ title, cls, prot: true, ids: [title, ...title.split(/\s+/).filter((w) => w.length >= 4 && /^\p{Lu}/u.test(w))], names: [], looks: SIG[title.toLowerCase()] || [], generic });
    for (const n of termsHit(text, 'characters')) if (!out.some((b) => b.ids.some((i) => i.toLowerCase() === n))) out.push(pseudo(n.replace(/\b\w/g, (c) => c.toUpperCase()), 'character', 'an original character'));
    for (const n of termsHit(text, 'brands')) out.push(Object.assign(pseudo(n, 'brand', 'an unbranded product'), { ids: [n] }));
    for (const n of realPeople) if (!out.some((b) => b.ids.includes(n))) out.push(pseudo(n, 'person', 'a person'));
    return out;
  }
  /** v022: after the code gate, one short E2B question - would this prompt let someone recognise <subject>? On yes: one more generic
   *  rewrite (forced call), which goes through the code gate again. Code stays the primary gate; this is the second check. */
  async likeCheck(ctx, st, name, args) {
    const key = name === 'make_music_video' ? 'idea' : 'prompt', subject = st.likeSubject || (st.likeBlocks.find((b) => b.prot) || {}).title;
    if (!subject || !args[key]) return;
    let yes = false;
    try {
      const out = await this.llm(ctx, [{ role: 'system', content: LIKE_SYS }, { role: 'user', content: `SUBJECT: ${subject}\nPROMPT: ${args[key]}\nWould someone who knows ${subject} recognise it in a picture made from this prompt?` }],
        Object.assign({ tools: decls(['recognisable']), maxTokens: 30, prefix: '<|tool_call>call:recognisable{' }, SAMPLING.review));
      const c = out.toolCalls.find((x) => x.name === 'recognisable');
      yes = !!(c && /^y/i.test(String((c.arguments || {}).answer || '')));
    } catch (e) { if (isAbort(e)) throw e; }
    this.likeLog.push({ at: Date.now(), tool: name, step: 'check', subject, recognisable: yes, prompt: String(args[key]).slice(0, 300) });
    st.likeTransform = true;
    if (!yes) return;
    try {
      const out = await this.llm(ctx, [{ role: 'system', content: ORIGINAL_SYS }, { role: 'user', content: `PROMPT: ${args[key]}` }],
        Object.assign({ tools: decls(['original_prompt']), maxTokens: 300, prefix: '<|tool_call>call:original_prompt{' }, SAMPLING.exact));
      const c = out.toolCalls.find((x) => x.name === 'original_prompt'), np = c && String((c.arguments || {}).prompt || '').trim();
      if (np && np.length > 20) { const sc = scanPrompt(np, st.likeBlocks); args[key] = sc.hit ? stripPrompt(np, st.likeBlocks, sc) : np; st.likeRegen = true; }
    } catch (e) { if (isAbort(e)) throw e; }
    this.likeLog.push({ at: Date.now(), tool: name, step: 'regenerate', subject, prompt: String(args[key]).slice(0, 300) });
  }

  /** closed checks before anything is queued -> null (ok) | {action, message, final?, code, fallback} */
  async gateRender(ctx, name, args, userText, s) {
    if (!this.hooks.consent()) return { final: 'Before I can make anything, read the short lesson about copyright, trademarks and likeness and agree to it (Settings > Rights & Copyright).', code: 'NO_CONSENT' };
    let real = [];
    // p0pc0rn Cast: a Cast member is the person's own consented recording / upload: their name is never looked up as a real person and
    // never stripped (castNames: the lower-case full and first names). Unknown names and anyone found by research stay gated.
    const castN = this.hooks.castNames ? (await this.hooks.castNames()) || [] : [];
    const isCast = (n) => { const k = String(n || '').toLowerCase().trim(); return !!k && castN.includes(k); };   // exact: "Josh Brolin" is not Cast member "Josh"
    if (this.research && ['make_picture', 'edit_picture', 'make_clip', 'animate_picture', 'clip_between', 'make_music_video'].includes(name)) {
      for (const n of properNames([args.prompt, args.idea, userText].filter(Boolean).join(' \n ')).filter((x) => !isCast(x))) {   // v022: names in the request count too (the prompt may have dropped them)
        try { const p = await this.research.isRealPerson(n, { signal: ctx.signal }); if (p) real.push(p.title || n); } catch (e) { if (isAbort(e)) throw e; }
      }
      if (name === 'edit_picture' && args.source === 'my_photo' && s.photo && s.photo.attested && /\b(me|myself|my face|i am|i'm)\b/i.test(userText)) real = [];
    }
    // v022 (Josh: "'like this person' or 'like this thing'"): a visual job never carries an identity. Names and looks of protected
    // things (from this chat's lookups, the famous-character / brand lists, real people found by name) -> one rewrite, then code
    // strips them. Real people and characters are no longer refused here: they become an original take.
    if (VISUAL.has(name)) {
      const st = ctx.state || {}, ownPhoto = name === 'edit_picture' && args.source === 'my_photo' && s.photo && s.photo.attested && /\b(me|myself|my face|i am|i'm)\b/i.test(userText);
      const blocks = this.likeBlocks(st, s, [userText, args.prompt, args.idea].filter(Boolean).join(' \n '), ownPhoto ? [] : real).filter((b) => !isCast(b.title));   // p0pc0rn Cast: only a block that IS a Cast member
      st.likeBlocks = blocks; st.likeProtected = blocks.some((b) => b.prot);
      if (st.likeProtected && !st.likeSubject) st.likeSubject = blocks.find((b) => b.prot).title;
      const key = name === 'make_music_video' ? 'idea' : 'prompt', scan = scanPrompt([args[key], name === 'make_music_video' ? args.prompt : ''].filter(Boolean).join(' \n '), blocks);
      if (scan.hit) {
        this.likeLog.push({ at: Date.now(), tool: name, names: scan.names, looks: scan.looks, prompt: String(args[key] || '').slice(0, 300), step: st.likeAsked ? 'strip' : 'rewrite' });
        st.likeSubject = st.likeSubject || (blocks.find((b) => b.prot) || {}).title || scan.names[0];
        if (!st.likeAsked) {
          st.likeAsked = true;
          const words = [...scan.names, ...scan.looks.flatMap((l) => l.terms)].slice(0, 12).map((w) => `"${w}"`).join(', ');
          return { action: 'rewrite', code: 'LIKENESS_TRANSFORM', message: `error: p0pc0rn makes an original take, never a likeness of a real person, a character, a brand or an artwork. Remove ${words}. Describe only an archetype, a role, an era, a setting, a mood, materials and a palette: no names, emblems, logos, signature outfits or colour combinations. Call ${name} again.` };
        }
        args[key] = stripPrompt(args[key], blocks, scan);
        st.likeStripped = true;
      }
    }
    const g = screenRender(name, args, { realPeople: VISUAL.has(name) ? [] : real, userText, transform: VISUAL.has(name) });
    if (!g) return null;
    if (g.code === 'MINOR_SEXUAL' || g.code === 'NCII') return { final: g.reason, code: g.code };
    if (g.action === 'refuse') return { action: 'refuse', code: g.code, message: `refused: ${g.reason}. Do not call the tool for this. Tell the person in one or two sentences, offer an original alternative, and mention Settings > Rights & Copyright.`,
      fallback: g.code === 'LIKENESS' ? `I can't make pictures or clips of a real person like ${g.terms[0]} without their consent. I can make an original character instead. Settings > Rights & Copyright explains why.`
        : `I can't make ${g.terms[0]}: it's a character owned by a company. I can make an original character with the same mood instead. Settings > Rights & Copyright explains why.` };
    return { action: 'rewrite', code: g.code, message: `error: ${g.reason}. Call ${name} again with the fixed text.` };
  }

  /** the child (render) finished: look at it, maybe reroll, then reply */
  async afterChild(ctx, st, save) {
    const sid = ctx.job.session, pd = st.pending, child = this.queue.get(pd.child);
    if (!child || child.status === 'cancelled') return this.finish(ctx, st, save, 'Stopped.', { kind: 'status' });
    if (child.status === 'failed') return this.finish(ctx, st, save, failText(child), { kind: 'error', code: child.error && child.error.code });
    if (pd.then && child.status === 'done' && child.result && child.result.image) {   // p0pc0rn Cast: the still of the Cast member -> the clip
      const nx = pd.then; pd.then = null;
      const next = await ctx.enqueueOnce('then', nx.kind, Object.assign({}, nx.params, { imageKey: child.result.image.blobKey }), { title: NOUN[nx.kind] });
      pd.child = next.id; pd.kind = nx.kind; await save();
      await this.say(ctx.job.session, { text: 'The still is done; now the clip from it.', kind: 'status', jobId: next.id, history: '(cast still done, clip next)' });
      return { wait: 'all' };
    }
    const r = child.result || {};
    const rec = { jobId: child.id, prompt: child.params.prompt || child.params.idea || '', kind: child.kind };
    if (child.kind === 'picture' || child.kind === 'edit') Object.assign(rec, { blobKey: r.image && r.image.blobKey, shape: shapeOf(child.params.width, child.params.height) });
    if (CLIP_KINDS.has(child.kind)) Object.assign(rec, { blobKey: r.video && r.video.blobKey, seconds: (child.params.frames - 1) / 16 });
    if (child.kind === 'song') Object.assign(rec, { blobKey: r.audio && r.audio.blobKey, seconds: child.params.seconds, lyrics: child.params.lyrics, tags: child.params.tags });
    if (child.kind === 'foley') Object.assign(rec, { blobKey: r.audio && r.audio.blobKey });
    if (child.kind === 'musicvideo') Object.assign(rec, { blobKey: r.videoKey, songKey: r.songKey });
    const reviewable = (child.kind === 'picture' || child.kind === 'edit' || CLIP_KINDS.has(child.kind)) && this.hooks.review && rec.blobKey;
    if (reviewable) {
      let v = null;
      try { v = await this.look(ctx, child, rec, pd); } catch (e) { if (isAbort(e)) throw e; v = null; pd.lookError = String((e && e.message) || e).slice(0, 120); }   // no review is better than no result
      pd.lastVerdict = v;
      if (v && v.verdict === 'reroll' && pd.rerolls < this.limits.rerolls) {
        pd.rerolls++; pd.attempt++;
        let fix = v.fix_prompt;
        if (st.likeBlocks && st.likeProtected) { const sc = scanPrompt(fix, st.likeBlocks); if (sc.hit) { fix = stripPrompt(fix, st.likeBlocks, sc); this.likeLog.push({ at: Date.now(), step: 'reroll-strip', names: sc.names }); } }   // v022
        const params = Object.assign({}, child.params, { prompt: fix, seed: undefined });
        delete params.seed;
        const next = await ctx.enqueueOnce('r' + pd.rerolls, child.kind, params, { title: NOUN[child.kind] + ' (again)' });
        pd.child = next.id; await save();
        await this.say(sid, { text: `Not quite right (${v.issue.replace(/_/g, ' ')}). Trying again, attempt ${pd.attempt} of ${this.limits.rerolls + 1}.`, kind: 'status', jobId: next.id, history: `(rerolled: ${v.issue})` });
        return { wait: 'all' };
      }
    }
    await this.remember(sid, child.kind === 'edit' ? 'picture' : child.kind === 'musicvideo' ? 'video' : CLIP_KINDS.has(child.kind) ? 'clip' : child.kind, rec);
    let text = doneText(child, r);
    if (pd.lastVerdict && pd.lastVerdict.verdict === 'reroll') text += ` It's still not perfect (${pd.lastVerdict.issue.replace(/_/g, ' ')}); ask me if you want another try.`;
    // measured Oct 12: Gemma 4 reads "OPPEN LATE" as "OPEN LATE" even at 1120 image tokens - it cannot proofread lettering, so say so
    else if ((child.kind === 'picture' || child.kind === 'edit') && wantedWords(child.params.prompt).length) text += ' Check the lettering: I can\'t reliably spot spelling slips in signs.';
    return this.finish(ctx, st, save, text, { kind: 'result', jobId: child.id, media: { kind: child.kind, blobKey: rec.blobKey } });
  }
  /** the vision review: the model sees the result and must call look_at_result */
  async look(ctx, child, rec, pd) {
    const blob = await ctx.getBlob(rec.blobKey); if (!blob) return null;
    let images = [];
    const isClip = CLIP_KINDS.has(child.kind);
    try { images = isClip ? await this.hooks.frames(blob) : [await this.hooks.shrink(blob)]; } catch (e) { return null; }
    const ids = this.cookbooks.ids((this.cookbooks.index.review[child.kind] || []));
    const words = wantedWords(child.params.prompt);   // words the picture must show: read letter by letter, at a higher visual budget
    const content = [...images.map((im) => ({ type: 'image', image: im })), { type: 'text', text:
      `${isClip ? 'These are the first, middle and last frames of the clip' : 'This is the picture'} made from this prompt:\n"${child.params.prompt}"\n`
      + (child.kind === 'animate' ? 'The clip was made from a picture: its first frame should match that picture.\n' : child.kind === 'between' ? (child.params.mv ? 'The clip was made between two pictures: its first and last frames should match them.\n'
        : 'The clip was made between two pictures: its first frame should match the first picture, and it should move toward the second (it stops half a second before reaching it, so its last frame is close to the second picture, not the same).\n') : '')
      + (words.length ? `The prompt asks for the words ${words.map((w) => `"${w}"`).join(', ')}. Read the letters in the image one by one: any missing, extra or swapped letter is garbled_text.\n` : '')
      + `Attempt ${pd.attempt} of ${this.limits.rerolls + 1}. Look at it and call look_at_result.` }];
    const messages = [{ role: 'system', content: REVIEW_SYS + '\n\nNOTES:\n' + this.cookbooks.text(ids) }, { role: 'user', content }];
    for (let k = 0; k < 2; k++) {
      const out = await this.llm(ctx, messages, Object.assign({ tools: decls(['look_at_result']), maxTokens: 500, prefix: '<|tool_call>call:look_at_result{', imageTokenBudget: words.length ? 1120 : isClip ? 140 : 280 }, SAMPLING.review));
      const c = out.toolCalls.find((x) => x.name === 'look_at_result');
      const v = c && validate('look_at_result', c.arguments);
      if (v && v.ok) {
        if (v.args.verdict === 'reroll') { const g = screenRender(isClip ? 'make_clip' : 'make_picture', { prompt: v.args.fix_prompt }, { userText: '' }); if (g) return { verdict: 'accept', issue: 'none' }; }
        return v.args;
      }
      messages.push({ role: 'assistant', tool_calls: [{ id: 'v' + k, type: 'function', function: { name: 'look_at_result', arguments: (c && c.arguments) || {} } }] },
        { role: 'tool', tool_call_id: 'v' + k, name: 'look_at_result', content: 'error: ' + ((v && v.errors.join('; ')) || 'call look_at_result with verdict and issue') });
    }
    return { verdict: 'accept', issue: 'none' };   // the model could not decide: never loop on it
  }
  async finish(ctx, st, save, text, extra = {}) {
    const sid = ctx.job.session;
    const foot = citationFooter(st.research || []);
    const body = extra.modelText && !st.refused && !st.likeAsked ? stripYes(stripPointer(String(text || '').trim(), ctx.params && ctx.params.text), ctx.params && ctx.params.text) : String(text || '').trim();   // 3.9 (juliqa): the Rights & Copyright line only where it belongs (round 4: no "Yes:" before an answer to a question that is not a yes or no one)
    const reply = foot && (extra.modelText || extra.kind === 'result') ? `${body}\n\n${foot}` : body;
    st.stage = 'done'; st.reply = reply; await save();
    await this.say(sid, Object.assign({ text: reply, history: body }, extra, st.rl && st.rl.length ? { research: st.rl.slice() } : {}, { modelText: undefined }));   // v026.2: the research list
    if (st.route && (st.route.brain || (st.route.kind === 'writing' && !this.bigModel()))) {   // 3.9: with no Bigger brain, Juli's own writing too; 3.8 (v040): its follow-up ("make it shorter") goes to the Bigger brain too (ask: follow)
      const s = await this.session(sid); if (s) { s.brainLast = { kind: st.route.kind, at: Date.now() }; await this.db.put('sessions', s); }
    }
    if (this.research && this.research.afterAnswer) this.research.afterAnswer();   // v021: a stale KB entry's revision check, after the reply
    return { reply, research: (st.research || []).filter((r) => r.status === 'hit').map((r) => ({ title: r.title, url: r.source.permalink, license: r.source.license })) };
  }

  // ================================================================================================ music-video helpers
  songwrite(ctx) { return this.writeSong(ctx, ctx.params); }
  /** {idea, seconds, tags?, bpm?} -> {title, tags, bpm, key?, timeSignature?, lyrics (normalised, within the line budget), notes},
   *  written by the loaded model in a focused, forced write_song call */
  async writeSong(ctx, P) {
    const big = this.onBig(ctx);   // 3.8 (v040): the Bigger brain writes the words: its notes and facts fitted to its context (fitSong)
    const G = P.ground && P.ground.hit ? P.ground : null; let need = G ? Math.min(3, G.values.length, Math.max(2, lyricBudget(P.seconds, P.bpm || SONG_DEFAULTS.bpm) - 1)) : 0;
    const nb = lyricBudget(P.seconds, P.bpm || SONG_DEFAULTS.bpm), short = nb <= 3 ? `\nA very short song: one [verse] and one [chorus], ${nb} short lines in all (3 to 6 words each).` : '';   // v032: 10-20 s songs
    const factText = (n) => !G ? '' : `\n\nFACTS about "${G.title}" (${G.site}):\n${G.lines.slice(0, n).map((l) => '- ' + l + sungAs(l)).join('\n')}\nWrite NEW lines: never quote an existing song or the source. Build the lyrics from ${Math.min(need, n) < 3 ? 'these facts' : '3 to 5 of these facts'}: names, dates, places, numbers, details. Sing every number exactly as given. Use no other facts.`;
    const sysOf = (budget) => 'You write original songs made on this phone. Call write_song.\n\nNOTES:\n' + this.cookbooks.text([...this.cookbooks.index.always, ...(budget === 0 ? [] : this.cookbooks.ids(this.cookbooks.index.songwrite, budget == null ? undefined : budget))]);
    const userOf = (n) => ({ role: 'user', content: `The song is for: ${P.idea}\nLength: ${P.seconds} seconds.${P.tags ? '\nStyle: ' + P.tags : ''}${P.bpm ? `\nTempo: ${P.bpm} BPM, so at most ${lyricBudget(P.seconds, P.bpm)} sung lines.` : `\nPick the bpm for the style; at most (${P.seconds} - 6) x bpm / 480 sung lines (${lyricBudget(P.seconds, 120)} at 120 BPM).`}${short}${factText(n)}\nWrite the lyrics now.` });
    let messages = [{ role: 'system', content: sysOf(null) }, userOf(Infinity)], maxTokens = 700;
    if (big) { const f = await this.fitSong(ctx, sysOf, userOf); messages = f.messages; maxTokens = f.maxTokens; if (G) need = Math.min(need, f.facts); }
    const base = messages.length;
    let best = null;
    for (let k = 0; k < 3; k++) {
      const out = await this.llm(ctx, messages, Object.assign({ tools: decls(['write_song']), maxTokens, prefix: '<|tool_call>call:write_song{' }, SAMPLING.tool));
      const c = out.toolCalls.find((x) => x.name === 'write_song'), v = c && validate('write_song', c.arguments);
      const bad = v && v.ok ? screenRender('make_song', v.args, { userText: P.idea }) : null;
      const bpm = (v && v.ok && (P.bpm || v.args.bpm)) || SONG_DEFAULTS.bpm;
      const long = v && v.ok && !bad && k === 0 ? lyricsTooLong(v.args.lyrics, P.seconds, bpm) : null;   // ask once; then the hand-off trims
      let thin = null;
      if (v && v.ok && !bad && !long) {
        const L = normalizeLyrics(v.args.lyrics, P.tags || v.args.tags, { seconds: P.seconds, bpm });
        // v022: no line quoted from the source (6+ words in a row), no artist name in the style tags (genre, era, instruments only)
        if (G && (G.src || (G.sh && G.sh.length))) L.lyrics = dropQuoted(L.lyrics, G.src, G.sh);
        L.tags = cleanTags(L.tags);
        const out = Object.assign({ title: v.args.title, tags: L.tags, lyrics: L.lyrics, bpm, notes: L.notes, used: G ? factsUsed(G, L.lyrics) : [] }, v.args.key ? { key: v.args.key } : {}, v.args.time_signature ? { timeSignature: v.args.time_signature } : {});
        if (!G || out.used.length >= need || k === 2) return out;
        if (!best || out.used.length > best.used.length) best = out;
        thin = `the lyrics use ${out.used.length} of the facts; use at least ${need} of them (names, dates, places, numbers) and no other facts`;   // a closed check, asked again
      }
      const why = long || thin || (bad ? bad.reason : (v ? v.errors.join('; ') : 'call write_song with title, tags, bpm and lyrics'));
      if (big) { messages.length = base; messages.push({ role: 'user', content: `Your last lyrics could not be used: ${why}. Call write_song again.` }); }   // 3.8: no room for the last attempt itself
      else messages.push({ role: 'assistant', tool_calls: [{ id: 'w' + k, type: 'function', function: { name: 'write_song', arguments: (c && c.arguments) || {} } }] },
        { role: 'tool', tool_call_id: 'w' + k, name: 'write_song', content: 'error: ' + why });
    }
    if (best) return best;
    return { title: 'Untitled', tags: (P.tags || 'pop, upbeat') + ', instrumental', bpm: P.bpm || 110, lyrics: '', notes: ['the model could not write lyrics: instrumental'], used: [] };
  }
  /** shot prompts for code-timed slots: {slots: [{n, start, dur, section, hook}], idea, title, tags, lyrics, shape, maxStills}
   *  -> {shots: [{n, prompt, still?}]}; `still` (a picture prompt for the shot's first frame) only when maxStills > 0, at most maxStills */
  async shotplan(ctx) {
    const P = ctx.params, slots = P.slots, ids = this.cookbooks.ids(this.cookbooks.index.shotplan, 1900);
    const table = slots.map((s) => `${s.n} | ${s.start}-${s.start + s.dur} s | ${s.dur} s | ${s.section}${s.hook ? ' | HOOK' : ''}`).join('\n');
    const brief = `Music video idea: ${P.idea}\nSong: "${P.title || 'untitled'}" (${P.tags || ''})\nShape: ${P.shape === 'wide' ? 'wide 16:9' : 'tall 9:16 (vertical)'}\n`
      + (P.lyrics ? `Lyrics:\n${String(P.lyrics).slice(0, 900)}\n` : '') + `\nSLOTS (n | time | length | section):\n${table}\n\nWrite one clip prompt for EVERY slot with plan_shots.`
      + (P.maxStills ? ` Give a "still" (a picture prompt for the first frame) to at most ${P.maxStills} shots, only where a recurring character or place must look the same.` : ' Do not use "still".');
    const messages = [{ role: 'system', content: 'You direct a music video made on this phone. The app timed the shots; you write what each shot shows. Follow the NOTES.\n\nNOTES:\n' + this.cookbooks.text([...this.cookbooks.index.always, ...ids]) },
      { role: 'user', content: brief }];
    const coffeeOk = termsHit(P.idea + ' ' + (P.lyrics || ''), 'coffee').length > 0;
    let shots = new Map(), stills = new Map(), asked = false;
    for (let k = 0; k < 3 && shots.size < slots.length; k++) {
      const out = await this.llm(ctx, messages, Object.assign({ tools: decls(['plan_shots']), maxTokens: Math.min(3200, 150 * slots.length + 300), prefix: '<|tool_call>call:plan_shots{' }, SAMPLING.tool));
      const c = out.toolCalls.find((x) => x.name === 'plan_shots'), v = c && validate('plan_shots', c.arguments);
      for (const sh of (v && v.args.shots) || []) if (slots.some((s) => s.n === sh.n) && !shots.has(sh.n)) {
        shots.set(sh.n, sh.prompt);
        if (sh.still && P.maxStills && stills.size < P.maxStills && !screenRender('make_picture', { prompt: sh.still }, { userText: P.idea })) stills.set(sh.n, sh.still);
      }
      // closed checks: every slot, the ending sentence, no coffee unless asked, no neighbour repeats, the safety screen
      const problems = [];
      for (const s of slots) {
        const p = shots.get(s.n); if (!p) { problems.push(`slot ${s.n} is missing`); continue; }
        if (!/the clip ends with/i.test(p)) problems.push(`slot ${s.n} must end with a sentence starting "The clip ends with"`);
        if (!coffeeOk && termsHit(p, 'coffee').length) problems.push(`slot ${s.n} mentions coffee/cups/cafes: the person did not ask for that`);
        const g = screenRender('plan', { prompt: p }, { userText: P.idea }); if (g && g.code !== 'COFFEE') problems.push(`slot ${s.n}: ${g.reason}`);
      }
      for (let i = 1; i < slots.length; i++) { const a = shots.get(slots[i - 1].n), b = shots.get(slots[i].n); if (a && b && jaccard(a, b) > 0.6) problems.push(`slots ${slots[i - 1].n} and ${slots[i].n} are too similar: change the setting or framing of slot ${slots[i].n}`); }
      if (!problems.length || asked) break;
      asked = true;
      const bad = new Set(problems.map((x) => Number((/slots? (\d+)(?! and)/.exec(x) || /and (\d+)/.exec(x) || [])[1])).filter(Boolean));
      for (const n of bad) shots.delete(n);
      messages.push({ role: 'assistant', tool_calls: [{ id: 'p' + k, type: 'function', function: { name: 'plan_shots', arguments: { shots: [...shots].map(([n, prompt]) => ({ n, prompt })) } } }] },
        { role: 'tool', tool_call_id: 'p' + k, name: 'plan_shots', content: 'error: ' + problems.slice(0, 8).join('; ') + `. Call plan_shots again with ONLY slots ${[...bad].join(', ')}.` });
    }
    // anything still missing or unfixable gets a plain, safe shot (the cut must complete), varied per slot so no two repeat
    const out = slots.map((s, i) => {
      let p = shots.get(s.n) || fallbackShot(P.idea, s, i);
      if (!coffeeOk) p = p.split(/(?<=\.)\s+/).filter((x) => !termsHit(x, 'coffee').length).join(' ');
      if (P.avoid) { const sc = scanPrompt(p, P.avoid); if (sc.hit) p = stripPrompt(p, P.avoid, sc); }   // v022: no likeness in any shot
      if (!/the clip ends with/i.test(p)) p += ' The clip ends with the subject still in frame, the background moving gently, in the same framing.';
      return Object.assign({ n: s.n, prompt: p }, stills.has(s.n) && shots.has(s.n) ? { still: stills.get(s.n) } : {});
    });
    return { shots: out };
  }
  /** one review of all the clips: one middle frame each -> {rerolls: [{n, issue, fix_prompt}]} (capped) */
  async mvreview(ctx) {
    const P = ctx.params, content = [];
    for (const s of P.shots) {
      const b = await ctx.getBlob(s.videoKey); if (!b) continue;
      let f = null; try { f = (await this.hooks.frames(b, [0.5]))[0]; } catch (e) { f = null; }
      if (f) content.push({ type: 'image', image: f }, { type: 'text', text: `Shot ${s.n}: ${String(s.prompt).split(/\s+/).slice(0, 18).join(' ')}...\n` });
    }
    if (!content.length) return { rerolls: [] };
    content.push({ type: 'text', text: `Call review_shots. Reroll only real problems; at most ${this.limits.mvRerolls} shots.` });
    const ids = this.cookbooks.ids(this.cookbooks.index.review.musicvideo);
    const messages = [{ role: 'system', content: REVIEW_SYS + '\n\nNOTES:\n' + this.cookbooks.text(ids) }, { role: 'user', content }];
    const out = await this.llm(ctx, messages, Object.assign({ tools: decls(['review_shots']), maxTokens: 900, prefix: '<|tool_call>call:review_shots{', imageTokenBudget: 70 }, SAMPLING.review));
    const c = out.toolCalls.find((x) => x.name === 'review_shots'), v = c && validate('review_shots', c.arguments);
    const seen = new Set(), list = [];
    for (const r of (v && v.ok ? v.args.rerolls : [])) {
      if (seen.has(r.n) || !P.shots.some((s) => s.n === r.n) || screenRender('make_clip', { prompt: r.fix_prompt })) continue;
      seen.add(r.n); list.push(r); if (list.length >= this.limits.mvRerolls) break;
    }
    return { rerolls: list };
  }
}

// ------------------------------------------------------------------------------------------------ small helpers
const VIEWS = [['a wide view of the whole place', 'The camera holds still', 'framed wide'], ['a close view of one telling detail', 'The camera slowly moves closer', 'framed close'],
  ['a medium view of the main subject in motion', 'The camera follows the movement from the side', 'framed in a medium shot'], ['a high view looking down on the scene', 'The camera holds still', 'framed from above'],
  ['a low view looking up past the subject at the sky', 'The camera tilts down slowly', 'framed low and wide']];
const LIGHTS = ['soft morning light', 'bright midday light', 'warm low evening sun', 'blue night light with a few warm lamps'];
function fallbackShot(idea, s, i) {
  const [view, cam, frame] = VIEWS[i % VIEWS.length], light = LIGHTS[Math.floor(i / 2) % LIGHTS.length];
  return `${String(idea).replace(/\.$/, '')}: ${view}, ${light}, during the ${s.section} of the song${s.hook ? ', a striking opening image' : ''}. ${cam}. The clip ends with the scene settling, ${frame}.`;
}
/** the words a prompt asks to be written in the picture: "quoted" text, or what a sign or label says in capitals */
function wantedWords(p) {
  const out = [], s = String(p || '');
  for (const m of s.matchAll(/["“]([^"”]{1,30})["”]/g)) out.push(m[1].trim());
  for (const m of s.matchAll(/\b(?:says|reads|reading|spelling|spells|lettered)\s+([A-Z0-9][A-Z0-9 '&!.-]{0,30}[A-Z0-9!.])/g)) out.push(m[1].trim());
  return [...new Set(out)].filter(Boolean).slice(0, 3);
}
function renderOne(r, n) { return renderBlock([r], { attribute: true }).replace(/\[1\]/g, `[${n}]`); }   // v022: chat says "According to …" for live reads
// ---- v022: likeness
const VISUAL = new Set(['make_picture', 'edit_picture', 'make_clip', 'animate_picture', 'clip_between', 'make_music_video']);
const LOOK_RELS = new Set(['color', 'material', 'form', 'style', 'weapon', 'setting']);
const LIKE_SYS = 'You check picture prompts for an app that never recreates a real person, a character, a brand or an artwork. Answer with the recognisable tool: yes if the prompt names the SUBJECT or describes its signature look (its face, outfit, colours, emblem, items) closely enough to recognise it; no if it describes only an original take (an archetype, a role, an era, a setting, a mood).';
const ORIGINAL_SYS = 'Rewrite the picture PROMPT as an ORIGINAL scene with the original_prompt tool. Keep the archetype, the role, the era, the setting, the mood, the materials and the palette. Remove every name, emblem, logo, signature outfit, colour combination or item that would let someone recognise a real person, a character, a brand or an artwork. One or two sentences, plain words.';
// ---- v021: grounded chat (Josh, Oct 13: "chat with Wikipedia and Fandom grounding")
const LOOKUPS_OFF = 'Looking things up on Wikipedia and Fandom is switched off (Settings > Juli). If the person asks about a fact, say in one short sentence that you cannot look it up right now, then answer briefly and carefully from what you know.';
const RENDER_ASK = /\b(?:make|draw|paint|create|generate|render|sketch|design|compose|write)\b[\s\S]{0,60}\b(?:picture|photo|image|drawing|painting|portrait|poster|wallpaper|clip|video|movie|song|track|tune|ballad|music|lyrics)\b|\b(?:animate|edit)\b|^\s*(?:please\s+)?(?:paint|draw|sketch)\b|\b(?:picture|photo|image|clip|video|song)\s+(?:of|about)\b/i;
const SMALL_TALK = /^(?:hi|hello|hey|yo|thanks|thank you|thx|ok|okay|cool|nice|great|wow|good (?:morning|afternoon|evening|night)|how are you|what'?s up|bye|goodbye|lol|haha)\b[\s\S]{0,30}$/i;
const APP_ASK = /\b(?:p0pc0rn|this app|the app|download(?:s|ed|ing)?|settings?|queue|library|lyrics planner|music model|picture model|video model|assistant model|storage|battery|(?:you(?:'ve| have)?|i) looked (?:things )?up|lookups)\b/i;   // v021: questions about the lookups themselves (the FAQ answers them)
const FORCE_ASK = /^\s*(?:research|look\s*up|lookup)\s*[:\-]?\s+/i;
const FOLLOW_UP = /^(?=[\s\S]{0,160}$)[\s\S]*\b(?:it|its|it's|they|them|their|he|him|his|she|her|that|there|this|those|these)\b/i;
// ---- 3.8 (v040): the two-model route (BRAIN)
const BRAIN_PLAN = 'Juli already looked up the facts for this message: they are the research results below, if any. Use only those facts and never invent facts. There are no more lookups for this message.';
const BRAIN_WRITE = BRAIN_PLAN + ' The person asked for a piece of writing: write all of it as your reply, in plain text, in the form and length they asked for. Call ask_user only if the request is unclear in a way that changes the writing.';
// 3.9: a piece of writing Juli plans herself (no Bigger brain for it): she writes it in her reply; only ask_user is offered (plan())
export const JULI_WRITE = 'The person asked for a piece of writing: write all of it yourself as your reply, in plain text, in the form and length they asked for. Do not make a song, picture or clip for it. Call ask_user only if the request is unclear in a way that changes the writing.';
const MAKE_NOUN = /\b(?:picture|photo|image|drawing|painting|portrait|poster|wallpaper|clip|video|movie|animation|song|track|tune|ballad|music|lyrics)s?\b/i;
const WRITE_ASK = new RegExp(String.raw`\b(?:write|compose|draft|rewrite|redraft|polish|proofread|edit|shorten|expand|summari[sz]e|outline|brainstorm|plan|translate|make|give|create|come up with)\b[\s\S]{0,80}?\b(?:poems?|poetry|story|stories|tale|essay|letter|e-?mail|note|message|speech|toast|eulogy|script|scene|chapter|blog|post|caption|bio|article|report|review|haiku|limerick|sonnet|verses?|rhymes?|jokes?|riddles?|outline|itinerary|recipe|description|pitch|summary|tweet|cover letter|invitation|slogan|tagline|dialogue|monologue|fable|agenda|paragraph)\b`
  + String.raw`|\b(?:write|compose|draft) (?:me |us |him |her |them )?(?:a|an|the|my|our|some|this)\b|\bhelp me (?:write|plan|draft)\b|\btell (?:me |us )?(?:a|another) (?:story|joke|tale|fable|riddle)\b|\bplan (?:a|an|my|our|the) (?:trip|day|week|weekend|party|menu|route|visit|holiday|vacation)\b`, 'i');
const FOLLOW_EDIT = /\b(?:shorter|longer|shorten|lengthen|expand|rewrite|rephrase|reword|redo|revise|tweak|change|edit|fix|improve|add|remove|cut|replace|swap|another|again|instead|funnier|sadder|happier|darker|simpler|more|less|verse|stanza|line|paragraph|ending|title|tone)\b/i;
/** chat | writing | agent (something to make) for a message; follow = the kind of this chat's last Bigger brain turn: a short edit of it
 *  ("make it shorter", "change the last line") stays that kind */
export function taskKind(text, follow = null) {
  const t = String(text || '');
  if (helpAsk(t) || selfAsk(t) || jokeAsk(t) || (howToAsk(t) && !/\b(?:write|draft|compose)\s+(?:me|us|it|this|one)\b/i.test(t))) return 'chat';   // 3.9 (juliqa): how-to, self and joke questions: quick chat
  if (RENDER_ASK.test(t) && (MAKE_NOUN.test(t) || /\banimate\b/i.test(t))) return 'agent';
  if (WRITE_ASK.test(t)) return 'writing';
  if (RENDER_ASK.test(t)) return 'agent';
  if ((follow === 'writing' || follow === 'agent') && t.length <= 240 && FOLLOW_EDIT.test(t)) return follow;
  return 'chat';
}
/** worth a lookup before the Bigger brain plans (Juli's own model runs first): a name the person wrote (a capitalised word inside a
 *  sentence, a "Title (thing)"), a forced lookup, or a song about a subject (its facts are looked up: groundSong) */
export function lookupWorthy(text) {
  const t = String(text || '');
  if (FORCE_ASK.test(t) || songMakeAsk(t) || explicitTitles(t, false).length) return true;
  return t.split(/(?<=[.!?])\s+|\n+/).some((sent) => sent.trim().split(/\s+/).slice(1).some((w) => /^["“(]?\p{Lu}/u.test(w) && !/^["“(]?(?:I|I'm|I'd|I'll|I've|OK|AI|TV|DJ|Juli)\b/.test(w)));
}
/** a plan's tool exchanges with each looked-up fact list cut to its first n lines (headers, notes and sources kept) */
function cutFacts(msgs, n) {
  return msgs.map((m) => {
    if (m.role !== 'tool' || m.name !== 'research' || typeof m.content !== 'string') return m;
    let k = 0; const out = [];
    for (const line of m.content.split('\n')) {
      if (/^FACTS about /.test(line)) k = 0;
      else if (/^- /.test(line)) { k++; if (k > n) continue; }
      out.push(line);
    }
    return Object.assign({}, m, { content: out.join('\n') });
  });
}
/** a plan's tool exchanges with only the lookups and the last exchange kept (an assistant call with its answers, or a nudge) */
function keepRecent(msgs) {
  const groups = [];
  for (const m of msgs) { if (m.role === 'tool' && groups.length) groups[groups.length - 1].push(m); else groups.push([m]); }
  return groups.filter((g, i) => i === groups.length - 1 || g.some((m) => m.role === 'tool' && m.name === 'research')).flat();
}
const PLAN_SYS = 'You are a LOOKUP PLANNER for a chat assistant. Read the MESSAGE and list the specific things it asks about that an encyclopedia or a fan wiki would answer: named people, places, events, organizations, works (books, films, songs, games), objects, species, characters and franchises. Put the main subject FIRST, named exactly as an encyclopedia title (e.g. "Golden Gate Bridge", "SS Edmund Fitzgerald"). For a character, game, film, show or comic give kind "popculture" and its franchise. Return ONLY JSON: {"topics":[{"topic":"...","kind":"real","franchise":""}]}. Return {"topics":[]} for small talk, opinions, advice, questions about this app, the person\'s own life, family, friends or pets, and generic words. The assistant is called Juli: never list Juli, "you" or the app as a topic. For a question whether something is safe or harmful to eat, drink or use, put that thing or its effect first ("Grape toxicity in dogs" for "can dogs eat grapes?", "Cookie dough" for "is raw cookie dough safe to eat?"), then the animal if it helps. A general question asked about oneself is about the thing itself ("Hiccup" for "why do I get hiccups?", "Sleep" for "how much sleep do I need?"). For a question that asks which one is the largest, longest, highest, first or most, give the one you think it is as the first topic ("Russia" for "which country is the largest by area?"). At most 2 topics.';
const PLAN_FORCE = ' FORCE MODE: the person asked for a lookup; list every named thing (at most 4).';
const WIKI_TITLE_RE = /\b([A-Z][\w'.-]*(?: [A-Z][\w'.-]*){0,3} \([a-z][\w' .-]{1,30}\))/g;
/** titles the person spelled out, looked up verbatim and first: "Mercury (planet)", an inline "research: X", and in a forced ask every quoted phrase */
function explicitTitles(text, forced) {
  const msg = String(text || ''), out = [], add = (x) => { x = String(x || '').trim().replace(/^["'“”.,;:\s]+|["'“”.,;:\s]+$/g, ''); if (x.length >= 2 && x.length <= 80 && !out.some((o) => o.toLowerCase() === x.toLowerCase())) out.push(x); };
  for (const m of msg.matchAll(WIKI_TITLE_RE)) add(m[1]);
  for (const m of msg.matchAll(/\bresearch:\s*/gi)) { if (m.index === 0) continue; const rest = msg.slice(m.index + m[0].length, m.index + m[0].length + 120).split(/[.;\n]/)[0]; for (const part of rest.split(/,| and /)) add(part); }
  if (forced) for (const m of msg.matchAll(/["“]([^"“”]{2,80})["”]/g)) add(m[1]);
  return out.slice(0, 4);
}
/** the planner's JSON -> [{topic, kind, franchise}] (strings accepted; anything else dropped) */
function parseTopics(raw) {
  const s = String(raw || ''), i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return [];
  let obj = null; try { obj = JSON.parse(s.slice(i, j + 1)); } catch (e) { return []; }
  const list = obj && Array.isArray(obj.topics) ? obj.topics : [];
  return list.map((x) => (typeof x === 'string' ? { topic: x } : x && typeof x === 'object' ? x : null)).filter(Boolean)
    .map((x) => ({ topic: String(x.topic || '').replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '').trim().slice(0, 80), kind: /pop/i.test(x.kind || '') ? 'popculture' : 'real', franchise: String(x.franchise || '').slice(0, 40) }))
    .filter((x) => x.topic.length >= 2);
}
// ---- v021: grounded songs
const SONG_WORDS = '(?:song|songs|ballad|anthem|track|tune|lullaby|shanty|hymn|rap|jingle|lyrics)';
// ---- v026.8: the plan prompt's tools, the summary of earlier turns, and the song that is never asked back
const INTENT = { pic: /\b(?:picture|pictures|image|images|photo|photos|drawing|draw|paint|painting|poster|portrait|wallpaper|illustration|sketch|logo)\b/i,
  clip: /\b(?:clip|clips|video|videos|animate|animated|animation|footage|moving|motion|sound effects?|foley|add sound)\b/i,
  song: new RegExp(`\\b${SONG_WORDS}\\b|\\b(?:music|sing|singing|lyrics)\\b`, 'i') };
const ASKS = /^\s*(?:what|who|whom|whose|when|where|why|how|which|is|are|was|were|does|do|did|tell me|explain|can|could|should|would|will|may|might|has|have|had)\b/i;   // 3.9 (juliqa): + can, could, should ...
const MAKES = /\b(?:make|draw|create|generate|render|turn|change|edit|again|redo|animate|add|remove|replace|darker|brighter|bigger|smaller|another|more)\b/i;
/** the tools a request needs: a song request sees make_song, make_music_video and ask_user; a picture or clip request its own tools;
 *  a plain question research and ask_user; anything else all of them (as before) */
export function planToolNames(text, research = true) {
  const t = String(text || ''), mv = /music video/i.test(t), songAsk = !!songAbout(t) && !mv, g = new Set();
  if (mv) { g.add('make_music_video'); g.add('make_song'); }
  else if (INTENT.song.test(t)) { g.add('make_song'); g.add('make_music_video'); }
  if (INTENT.pic.test(t)) ['make_picture', 'edit_picture'].forEach((n) => g.add(n));   // animating or a clip between pictures: the clip words add them
  if (INTENT.clip.test(t) && !mv) ['make_clip', 'animate_picture', 'clip_between', 'add_sound'].forEach((n) => g.add(n));
  const res = (n) => n === 'research' && research && !songAsk;
  if (!g.size && ASKS.test(t) && !MAKES.test(t)) return MAIN_TOOLS.filter((n) => res(n) || n === 'ask_user');
  return MAIN_TOOLS.filter((n) => (g.size ? g.has(n) || n === 'ask_user' : n !== 'research') || res(n));
}
const clipText = (s, n) => { const x = String(s || ''); return x.length > n ? x.slice(0, n - 1).trimEnd() + '…' : x; };
/** the turns before the last few, as one line for the system prompt (at most 450 characters) */
export function earlierSummary(hist) {
  if (!hist || !hist.length) return '';
  const parts = hist.slice(-12).map((h) => (h.role === 'user' ? 'they: ' : 'you: ') + clipText(String(h.content || '').replace(/\s+/g, ' '), 70));
  return clipText('EARLIER IN THIS CHAT (oldest first): ' + parts.join(' | '), 450);
}
const MAKE_SONG_ASK = /\b(?:make|write|compose|create|generate|produce|record|sing|give me|do|want|like|need|can you|could you|please)\b/i;
/** a request to MAKE a song that names its subject ("make me a song about the Golden Gate Bridge"); "make me a song" has none */
export function songMakeAsk(text) {
  const t = String(text || '');
  if (/music video/i.test(t)) return false;
  const about = songAbout(t);
  return !!about && about.length >= 2 && (MAKE_SONG_ASK.test(t) || /^\s*(?:an?\s+)?[\w\s,'-]{0,40}\b(?:song|ballad|anthem|lullaby|shanty|hymn|rap|jingle|tune)\s+(?:about|for|of|on)\b/i.test(t));
}
const GENRES = ['folk', 'rock', 'pop', 'jazz', 'blues', 'country', 'hip hop', 'rap', 'r&b', 'soul', 'funk', 'disco', 'synthwave', 'synth-pop', 'synthpop', 'electronic',
  'house', 'techno', 'trance', 'drum and bass', 'dubstep', 'reggae', 'punk', 'metal', 'indie', 'lo-fi', 'lofi', 'ambient', 'classical', 'orchestral', 'gospel',
  'lullaby', 'ballad', 'sea shanty', 'shanty', 'bluegrass', 'grunge', 'emo', 'k-pop', 'latin', 'salsa', 'bossa nova', 'swing', 'acoustic', 'piano', 'chiptune'];
/** make_song as the code makes it: the genre words of the request (if any) as tags, the stated length or 60 s; no tempo, no lyrics:
 *  the writer (writeSong) picks both from the request */
export function forcedSongCall(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ', tags = GENRES.filter((g) => t.includes(' ' + g + ' ') || t.includes(' ' + g + ',') || t.includes(' ' + g + '-')).slice(0, 3);
  const sec = songSecondsFrom(text);
  return { name: 'make_song', forced: true, arguments: Object.assign({ seconds: clampSongSeconds(sec || SONG_SECONDS.def) }, tags.length ? { tags: tags.join(', ') } : {}) };
}
// v032: a stated length ("... 10 seconds long", "... in half a minute") is not part of the subject (never "80s": a decade)
const SONG_LEN_TAIL = new RegExp(String.raw`\s+(?:(?:that|which)\s+(?:is|lasts)\s+|lasting\s+|in\s+|of\s+|for\s+|at\s+)?(?:about\s+|around\s+|roughly\s+|just\s+|only\s+|under\s+|exactly\s+)?` + SONG_LENGTH_SRC + '.*$', 'i');
/** the subject of a song request ("a folk song about the wreck of the Edmund Fitzgerald, 30 seconds" -> "the wreck of the Edmund Fitzgerald") */
export function songAbout(text) {
  const t = String(text || '');
  const m = new RegExp(`\\b${SONG_WORDS}\\b[\\s\\S]*?\\babout\\s+(.+)$`, 'i').exec(t)
    || new RegExp(`\\b${SONG_WORDS}\\b[\\s\\S]*?\\b(?:celebrating|honou?ring|for|on|of|telling the story of|tribute to)\\s+(.+)$`, 'i').exec(t);
  if (!m) return '';
  return m[1].split(/[,.;!?\n]/)[0]
    .replace(/\s+(?:in|with)\s+(?:an?\s+|the\s+)?[\w\s'&-]*?\b(?:style|vibe|feel|mood|genre|tempo|sound|beat|voice|vocals?)\b.*$/i, '')
    .replace(/\s+(?:as|like)\s+an?\s+[\w\s'-]+$/i, '').replace(SONG_LEN_TAIL, '').trim().slice(0, 120);
}
/** v024: a failed turn's reason in plain words, with what it was doing (Josh's phone showed a bare "(ERROR)") */
export function failReason(j) {
  const st = (j && j.state) || {}, e = (j && j.error) || {}, c = e.code || '', m = String(e.message || '');
  const doing = st.ground && !st.done ? 'writing the song' : (st.research || []).length ? 'looking things up' : 'thinking';
  if (c === 'KILLED') return `the page stopped twice while ${doing}, so the phone is probably short on memory (closing other apps helps)`;
  if (c === 'OUT_OF_MEMORY' || /out of memory|outofmemory|allocation failed|memory/i.test(m)) return `the phone ran out of memory while ${doing}`;
  if (c === 'GPU_LOST') return `the graphics chip reset while ${doing}`;
  if (c === 'TOO_LONG') return 'the conversation got too long for Juli (start a new chat)';
  if (c === 'NOT_DOWNLOADED') return 'Juli is not on this phone any more (Settings > Models)';
  if (c === 'NO_CONSENT') return 'the agreement is needed first (Settings > Rights & Copyright)';
  const short = m.replace(/\s+/g, ' ').trim().slice(0, 80);
  return `something went wrong while ${doing}${short ? ` (${short})` : ''}; Settings > About > Diagnostics has the details`;
}
/** first- or second-person words: a song about the person's own life (no research, nothing said) */
const PERSONAL = /\b(?:my|our|mine|me|myself|i|i'm|im|we|us|your|yourself)\b/i;
/** which facts made it into the lyrics. A fact with a number counts only when THAT number is sung (as digits or in words: the desktop
 *  smoke test sang "seventy-four feet" for 746 feet); otherwise a distinctive word of it must be sung (units and filler never count). */
const GENERIC = new Set(['feet', 'foot', 'metres', 'meters', 'metre', 'meter', 'miles', 'mile', 'kilometres', 'kilometers', 'inches', 'tons', 'tonnes', 'years', 'year',
  'people', 'crew', 'part', 'with', 'from', 'into', 'that', 'this', 'their', 'there', 'about', 'located', 'state', 'states', 'city', 'county', 'river', 'lake']);
const flat = (s) => ' ' + String(s || '').toLowerCase().replace(/[‐-―-]/g, ' ').replace(/\band\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
const QUOTE_FILLER = new Set(['which', 'their', 'there', 'these', 'those', 'where', 'while', 'after', 'before', 'during', 'about', 'other', 'first', 'later',
  'became', 'become', 'known', 'between', 'under', 'since', 'until', 'among', 'being', 'having', 'would', 'could', 'should', 'still', 'often', 'several', 'large',
  'largest', 'major', 'world', 'years', 'including', 'include', 'includes', 'number', 'called', 'named', 'built', 'made', 'many', 'most', 'more', 'also', 'such']);
function factsUsed(G, lyrics) {
  const L = flat(lyrics), used = [];
  for (const v of G.values) {
    const nums = (String(v).match(/\d[\d,]*/g) || []).map((n) => n.replace(/,/g, '')).filter((n) => n.length && Number(n) > 0);
    if (G.quoted) {   // v022.1: a quoted sentence counts by the number or the distinctive word that was sung, and that is what is reported
      const n = nums.filter((x) => Number(x) >= 10).find((x) => L.includes(' ' + x + ' ') || numberWords(x).some((w) => L.includes(flat(w))));   // 'one' or 'two' prove nothing
      if (n) { if (!used.includes(n)) used.push(n); continue; }
      const w = flat(v).trim().split(' ').find((x) => x.length >= 5 && !GENERIC.has(x) && !QUOTE_FILLER.has(x) && L.includes(' ' + x + ' '));
      if (w && !used.includes(w)) used.push(w);
      continue;
    }
    if (nums.length) { if (nums.some((n) => L.includes(' ' + n + ' ') || numberWords(n).some((w) => L.includes(flat(w))))) used.push(v); continue; }
    const toks = flat(v).trim().split(' ').filter((w) => w.length >= 4 && !GENERIC.has(w));
    if (toks.length && toks.some((w) => L.includes(' ' + w + ' '))) used.push(v);
  }
  return used;
}
// numberWords: research.js (v022: shared with the quote check)
/** v022: lyric lines that copy 6+ words in a row from the source text are dropped (facts, never quoted text) */
export function dropQuoted(lyrics, src, sh = []) {
  const n = (x) => ' ' + String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ', S = n(src), H = new Set(sh || []);
  return String(lyrics || '').split('\n').filter((line) => {
    if (/^\s*\[/.test(line)) return true;
    const w = n(line).trim().split(' ');
    for (let i = 0; i + 6 <= w.length; i++) { const k = w.slice(i, i + 6).join(' '); if (S.includes(' ' + k + ' ') || H.has(fnv(k))) return false; }
    return true;
  }).join('\n').replace(/(\[[^\]]+\]\n)(?=\[|$)/g, '$1');
}
/** v022: ACE style tags carry genre, era and instrument words, never an artist: a tag with a name ("Gordon Lightfoot style") goes */
export function cleanTags(tags) {
  const keep = String(tags || '').split(',').map((t) => t.trim()).filter(Boolean).filter((t) => !/\b(style of|in the style|sounds? like|inspired by|à la|a la)\b/i.test(t)
    && !/\b\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)+\b/u.test(t) && !(termsHit(t, 'voice_clone').length));
  return keep.join(', ');
}
/** a fact line's numbers spelled the way to sing them, for the writer: " (sing: nineteen thirty-seven)" */
function sungAs(line) {
  const ws = (String(line).match(/\d[\d,]*/g) || []).map((n) => numberWords(n)[numberWords(n).length - 1]).filter(Boolean);
  return ws.length ? ` (sing: ${ws.join(', ')})` : '';
}
const shapeOf = (w, h) => (w > h ? 'wide' : w < h ? 'tall' : 'square');
const modelName = (id) => ({ 'flux2-klein-4b': 'picture model', 'sanavideo2-5b': 'video model', 'mmaudio-small-44k': 'sound model', 'acestep15-turbo': 'music model', 'gemma4-e2b': 'assistant model' }[id] || id);
function ack(kind, minutes, repairs) {
  const what = { picture: 'Making your picture', edit: 'Editing the picture', clip: 'Making your clip', animate: 'Bringing your picture to life', between: 'Making the clip between your two pictures', foley: 'Adding sound to the clip', song: 'Making your song', musicvideo: 'Starting your music video' }[kind];
  const long = minutes >= 90 ? `${(minutes / 60).toFixed(1).replace(/\.0$/, '')} hours` : minutes >= 55 ? 'an hour' : `${minutes} minutes`;
  const tail = kind === 'musicvideo' ? `. It's a long one: about ${long} on this phone. Keep p0pc0rn open and plugged in.` : ` now, about ${minutes} minutes. ${kind === 'picture' || kind === 'edit' || CLIP_KINDS.has(kind) ? "I'll check it when it's done; it will show up here." : "It will show up here when it's done."}`;   // 3.9 (juliqa r4): where it will show up
  return what + tail;
}
function doneText(child, r) {
  if (child.kind === 'picture' || child.kind === 'edit') return "Here's your picture.";
  if (CLIP_KINDS.has(child.kind)) return "Here's your clip.";
  if (child.kind === 'song') return `Your song is ready${child.params.title ? ': "' + child.params.title + '"' : ''}.`;
  if (child.kind === 'foley') return 'The sound is ready. Sound effects are for personal, non-commercial use.';
  if (child.kind === 'musicvideo') return `Your music video is ready${r && r.seconds ? ` (${Math.round(r.seconds)} seconds, ${r.shots || ''} shots)` : ''}.`;
  return 'Done.';
}
function failText(child) {
  const c = child.error && child.error.code;
  if (c === 'OUT_OF_MEMORY') return 'The phone ran out of memory making that. A smaller size or a shorter clip should work: want me to try?';
  if (c === 'KILLED') return `The page stopped twice while making the ${NOUN[child.kind] || 'job'}, so the phone is probably short on memory. Closing other apps helps; Settings > About > Diagnostics has the details.`;
  if (c === 'BAD_AUDIO') return 'The song was made, but this phone could not play the file, so it was not kept. Settings > About > Diagnostics has the details.';   // v024.1
  if (c === 'NO_CONSENT') return 'Agree to the p0pc0rn terms first (Settings > Rights & Copyright).';
  return `Something went wrong making that${c ? ' (' + c + ')' : ''}. Want me to try again?`;
}
