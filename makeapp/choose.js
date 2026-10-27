// choose.js - Juli as a player (3.9): an app, such as a game, offers Juli its LEGAL choices and she picks ONE (p0.juli.choose /
// K.choose). Sized for a small model on a phone: the app keeps the rules and works out the facts (the legal moves, and hints such as
// "this column wins now"); Juli only chooses from a short numbered list; p0pc0rn checks that her answer is one of the options. Every
// call is greedy, so a retry changes the prompt (no skill, no board text); after that the app gets by 'fallback' (no move: it asks
// again or says so, never moving for her). 3.9 polish: the move can also be framed as a tool call, choose_move {choice} (the
// runner's o.tool); app.js asks both models for the number (the Bigger brain read worse as a tool call: 89% of the desk's 36
// positions, against all 36 with the number). Pure: no DOM, no queue (makeapp/host.js runs it as the queue job 'appchoose').

export const CHOOSE = { min: 2, max: 12, option: 60, about: 1200, hint: 300, skillTokens: 500, maxTokens: 4, perHour: 240, prefix: '' };

const ONE_LINE = /[\u0000-\u001f\u007f]+/g, CTRL = /[\u0000-\u0009\u000b-\u001f\u007f]+/g;
const bad = (m) => Object.assign(new Error(m), { code: 'BAD_CHOICE' });

/** an app's choose call -> {about, options, hint, skill}, every field plain text and cut to its limit; throws BAD_CHOICE for options a
 *  person could not choose between (fewer than 2, more than 12, empty, or two the same) */
export function cleanChoose(arg) {
  const o = arg && typeof arg === 'object' ? arg : {};
  if (!Array.isArray(o.options)) throw bad('choose needs a list of options');
  const options = o.options.map((x) => String(x == null ? '' : x).replace(ONE_LINE, (m) => (m === '\u0000' || /^[\u0000\u0007\u0008]+$/.test(m) ? '' : ' ')).replace(/\s+/g, ' ').trim().slice(0, CHOOSE.option));
  if (options.length < CHOOSE.min || options.length > CHOOSE.max) throw bad(`choose needs ${CHOOSE.min} to ${CHOOSE.max} options`);
  if (options.some((x) => !x)) throw bad('an option is empty');
  if (new Set(options.map((x) => x.toLowerCase())).size !== options.length) throw bad('two options are the same');
  const about = String(o.about == null ? '' : o.about).replace(/\r\n?/g, '\n').replace(CTRL, '').trim().slice(0, CHOOSE.about);
  const hint = String(o.hint == null ? '' : o.hint).replace(ONE_LINE, ' ').replace(/\s+/g, ' ').trim().slice(0, CHOOSE.hint);
  const skill = /^[a-z0-9-]{3,40}$/.test(String(o.skill || '')) ? String(o.skill) : '';
  return { about, options, hint, skill };
}

/** the messages of one choose call: the rules (+ the skill's text, already framed and cut by the host) in the system turn; the app's
 *  words, its hint and the numbered options in the user turn. short = the retry: no skill and no board text (a different prompt) */
/** 3.9 polish: the move as a tool call (the runner's o.tool): its one tool, and the forced start of the call */
export const CHOOSE_TOOL = { type: 'function', function: { name: 'choose_move', description: 'Make your move: the number of one of your choices.',
  parameters: { type: 'object', properties: { choice: { type: 'integer', description: 'the number of your choice' } }, required: ['choice'] } } };
export const CHOOSE_TOOL_PREFIX = '<|tool_call>call:choose_move{choice:';
export function chooseMessages({ app = '', about = '', options = [], hint = '', skill = '' }, { short = false, tool = false } = {}) {
  const name = String(app || 'a game').replace(/["\u0000-\u001f]/g, '').slice(0, 30) || 'a game';
  let sys = `You are Juli, playing "${name}" with the person on this phone. The game keeps the rules and lists only the moves you may make. `
    + (tool ? 'Pick the best one for you and make it with choose_move.' : 'Pick the best one for you. Answer with the number of your choice and nothing else.');
  if (skill && !short) sys += '\n\n' + String(skill);
  const parts = [];
  if (about && !short) parts.push(String(about));
  if (hint) parts.push('Hint from the game: ' + hint);
  parts.push('Your choices:\n' + options.map((x, i) => `${i + 1}. ${x}`).join('\n'));
  parts.push(tool ? 'Make your move with choose_move: the number of your choice.' : 'Answer with the number of your choice only.');
  return { messages: [{ role: 'system', content: sys }, { role: 'user', content: parts.join('\n\n') }],
    opts: tool ? { tools: [CHOOSE_TOOL], prefix: CHOOSE_TOOL_PREFIX, maxTokens: 8 } : { maxTokens: CHOOSE.maxTokens, prefix: CHOOSE.prefix } };
}
/** 3.9 polish: a choose_move call (the engine's reply.toolCalls, else the text after the forced start) -> the index, or null */
export function toolChoice(r, options) {
  const calls = (r && r.reply && Array.isArray(r.reply.toolCalls)) ? r.reply.toolCalls : [], c = calls.find((x) => x && x.name === 'choose_move');
  const v = c && c.arguments && typeof c.arguments === 'object' ? c.arguments.choice : null, k = typeof v === 'number' ? v : parseInt(String(v == null ? '' : v), 10);
  if (Number.isInteger(k) && k >= 1 && k <= (options || []).length) return k - 1;
  return parseChoice(String((r && r.text) || '').replace(CHOOSE_TOOL_PREFIX, '').split('}')[0], options);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[*_`"'“”‘’.,:;!?()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
/** Juli's answer -> the index of the option she named, or null: an option's own words first, then the first number (1..n), then the one
 *  option whose last word she wrote alone (a column's letter) */
export function parseChoice(text, options) {
  const s = norm(text), L = (options || []).map(norm);
  if (!s) return null;
  const exact = L.indexOf(s); if (exact >= 0) return exact;
  const m = /\d+/.exec(s);
  if (m) { const k = +m[0]; return k >= 1 && k <= L.length ? k - 1 : null; }
  const last = L.map((x) => x.split(' ').pop());
  const hits = last.reduce((a, w, i) => (w === s ? a.concat(i) : a), []);
  return hits.length === 1 ? hits[0] : null;
}
