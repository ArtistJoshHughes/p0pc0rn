// castsay.js - p0pc0rn Cast: "make <name> say <line>" through the ONE queue.
//   - the 'say' job (a render: consent-gated, one model on the GPU): the cast member's learned voice (learned once from their read-aloud
//     take, kept on the phone) -> the talker -> the codec decoder -> a checked .m4a (else a WAV). Three stages with the app's planned
//     fresh pages between them on WebKit (engine.beforeStage), resumable from the job's own state after a reload.
//   - the chat side: a message matching sayIntent() never loads the assistant: a small 'chat' job (purpose 'say') answers in code, queues
//     the 'say' child, and posts the audio bubble when it lands. Only CAST members ever speak; any other name gets a plain answer.
'use strict';
import { sayIntent } from './cast.js';
import { checkSong } from '../assistant/audiocheck.js';
import { screenRequest } from '../assistant/tools.js';   // the absolute cases (minors, intimate imagery, face swaps) apply to a spoken line too

export const VOICE_MODEL = 'qwen3-tts-0.6b';
const err = (code, m) => Object.assign(new Error(m), { code });
const isAbort = (e) => !!e && (e.name === 'AbortError' || e.code === 'ABORTED');

/** the queue's 'say' runner. cast = createCast(); the engine is the app's voice adapter (learnVoice / talk / decodeLine / toM4AFull /
 *  hasVoice / beforeStage) */
export function sayRunner({ cast }) {
  return { model: () => VOICE_MODEL, async run(ctx) {
    const P = ctx.params, eng = ctx.engine, st = Object.assign({}, ctx.state || {});
    const save = () => ctx.setState(st), prog = (phase, frac, message) => ctx.progress({ phase, frac, message });
    const person = await cast.get(P.personId);
    if (!person) throw err('NO_PERSON', `${P.name || 'That person'} is not in your cast any more.`);
    if (!person.voice) throw err('NO_VOICE', `Record ${person.name}'s voice first (in Cast).`);
    const hard = screenRequest(P.line); if (hard) throw err(hard.code, hard.reply);
    const common = { refAttested: true, signal: ctx.signal };   // the cast member's consent was given when they were added
    // 1. the learned voice: once per recording (the engine keeps it on the phone; its key is kept on the person)
    let key = st.voiceKey || person.voice.voiceKey;
    if (key && !(await eng.hasVoice(key))) key = null;
    if (!key) {
      prog('voice', 0.02, 'Learning the voice');
      const ref = await cast.getBlob(person.voice.refKey);
      if (!ref) throw err('NO_VOICE', `${person.name}'s recording is gone: record it again (in Cast).`);
      const a = await eng.learnVoice(Object.assign({ refAudio: ref, onProgress: (p) => prog('voice', 0.02 + 0.1 * (p.frac || 0), 'Learning the voice') }, common));
      key = a.key; await cast.setVoiceKey(person.id, key);
      st.learned = { sec: +a.seconds.toFixed(2), peakMB: a.peakMB };
    }
    st.voiceKey = key; await save();
    // 2. the line's codes (kept with the job: a fresh page between the stages resumes here)
    if (!st.codesKey) {
      await eng.beforeStage('speak');
      prog('speak', 0.14, 'Loading the voice model');
      const b = await eng.talk(Object.assign({ text: P.line, voiceKey: key, refText: person.voice.text, seed: P.seed,
        onProgress: (p) => prog('speak', 0.15 + 0.6 * Math.min(1, p.frac || 0), p.phase === 'speak' ? `Speaking: ${(p.seconds || 0).toFixed(1)} s` : 'Loading the voice model') }, common));
      st.codesKey = await ctx.putBlob(new Blob([b.codes], { type: 'application/octet-stream' }), { role: 'say-codes' });
      Object.assign(st, { frames: b.frames, eos: b.eos, talk: { sec: +b.seconds.toFixed(2), peakMB: b.peakMB, fps: b.timings && +(+b.timings.framesPerSec).toFixed(1) } });
      await save();
    }
    // 3. the audio, then a file this phone plays (AAC .m4a, checked; else a WAV)
    await eng.beforeStage('decode');
    prog('decode', 0.78, 'Making the audio');
    const codes = new Int32Array(await (await ctx.getBlob(st.codesKey)).arrayBuffer());
    const c = await eng.decodeLine(Object.assign({ voiceKey: key, codes, onProgress: (p) => prog('decode', 0.78 + 0.17 * Math.min(1, p.frac || 0), 'Making the audio') }, common));
    prog('save', 0.97, 'Saving');
    let file = null, check = null, aac = null;
    try { const m = await eng.toM4AFull(c.samples, 24000); if (m) { aac = m.diag; check = await checkSong(m.blob, m.seconds); if (check.ok) file = m.blob; } } catch (e) { if (isAbort(e)) throw e; }
    if (!file) { check = await checkSong(c.wav, c.duration); if (!check.ok) throw err('BAD_AUDIO', `The speech was made, but this phone could not play the file (${check.why}).`); file = c.wav; }
    return { audio: file, seconds: +c.duration.toFixed(2), seed: P.seed, frames: st.frames, eos: st.eos, codec: /mp4/.test(file.type) ? 'aac' : 'wav',
      timings: { learn: st.learned || null, talk: st.talk || null, decode: { sec: +c.seconds.toFixed(2), peakMB: c.peakMB } }, aac };
  } };
}

/** the chat coordinator for a say request (a 'chat' job, purpose 'say', NO model): plain answers in code, the 'say' child, the audio bubble */
export function sayTurn({ cast, agent, queue, installed }) {
  return async (ctx) => {
    const sid = ctx.job.session, P = ctx.params, st = Object.assign({ stage: 'start' }, ctx.state || {});
    const save = () => ctx.setState(st);
    const end = async (text, extra = {}) => { st.stage = 'done'; st.reply = text; await save(); await agent.say(sid, Object.assign({ text }, extra)); return { reply: text }; };
    if (st.stage === 'start') {
      const hard = screenRequest(P.text || P.line); if (hard) return end(hard.reply, { kind: 'refusal', code: hard.code });
      const person = await cast.byName(P.name);
      if (!person) return end(P.name.toLowerCase() === 'me' || P.name.toLowerCase() === 'myself'
        ? "Add yourself in Cast first (on the Home Screen): read a short script out loud once, and I can say anything in your voice."
        : `I can only make people in your Cast speak, in their own recorded voice and with their permission. ${P.name} isn't in your Cast: add them in Cast, on the Home Screen.`, { kind: 'status' });
      if (!person.voice) return end(`Record ${person.name}'s voice first: Cast › ${person.name}.`, { kind: 'status' });
      if (!(await installed(VOICE_MODEL))) return end("The voice model isn't on this phone yet. Download it from Settings › Models (Voice · 1.4 GB), then ask me again.", { kind: 'needs-download', model: VOICE_MODEL });
      const child = await ctx.enqueueOnce('say', 'say', { personId: person.id, name: person.name, line: P.line }, { title: `${person.name} says` });
      Object.assign(st, { stage: 'wait', child: child.id, name: person.name }); await save();
      await agent.say(sid, { text: `Making ${person.name} say it. It takes about a minute.`, kind: 'status', jobId: child.id, history: `(${person.name} says: ${P.line})` });
      return { wait: 'all' };
    }
    if (st.stage === 'wait') {
      const c = queue.get(st.child);
      if (!c || c.status === 'cancelled') return end('Stopped.', { kind: 'status' });
      if (c.status === 'failed') return end(`${st.name}'s line didn't finish${c.error && c.error.message ? `: ${c.error.message}` : '.'}`, { kind: 'error', code: c.error && c.error.code });
      const r = c.result || {};
      return end(`Here's ${st.name} saying it.`, { kind: 'result', jobId: c.id, media: { kind: 'say', blobKey: r.audio && r.audio.blobKey } });
    }
    return { reply: st.reply || '' };
  };
}

/** wrap agent.ask: a "make <name> say <line>" message becomes a 'say' chat job (no assistant model); everything else is unchanged */
export function wrapAsk(agent, queue) {
  const ask0 = agent.ask.bind(agent);
  agent.ask = async (sid, text, o = {}) => {
    const si = !o.photoBlob ? sayIntent(text) : null;
    if (!si) return ask0(sid, text, o);
    const s = await agent.session(sid); if (!s) throw new Error('no session ' + sid);
    const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const m = { id, role: 'user', at: Date.now(), text: String(text || '').slice(0, 4000), photoKey: null };
    s.messages.push(m); s.history.push({ role: 'user', content: m.text, mid: m.id }); s.history = s.history.slice(-agent.limits.history);
    await agent.db.put('sessions', s); agent.emit('message', sid, m);
    return queue.add('chat', { purpose: 'say', text: m.text, name: si.name, line: si.line, message: m.id }, { session: sid, title: m.text.slice(0, 60) });
  };
  return agent;
}
