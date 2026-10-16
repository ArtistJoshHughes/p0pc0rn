// gemma4.js - Gemma 4's chat template and function-calling format in plain JS (no build step, no dependencies).
// Source of truth: chat_template.jinja + tokenizer_config.json of google/gemma-4-E2B-it ("Google Gemma 4 Canonical Chat Template",
// published 2026-07-09). renderPrompt() reproduces that template byte for byte for the message shapes the assistant uses
// (tests/gemma4.test: 10 golden renders made by transformers' apply_chat_template). parseResponse() follows the tokenizer's
// response_schema: an optional thought channel, then <|tool_call>call:NAME{args}<tool_call|> blocks, then text; args are JSON-like with
// <|"|> as the string delimiter and unquoted keys. The model stops on <eos>, <turn|> or <|tool_response> (generation_config eos ids 1/106/50).
//
// The engine ('gemma4-e2b') may render with this module too, so there is exactly one template implementation in p0pc0rn.

export const TOK = {
  BOS: '<bos>', EOS: '<eos>', SOT: '<|turn>', EOT: '<turn|>', STD: '<|tool>', ETD: '<tool|>', STC: '<|tool_call>', ETC: '<tool_call|>',
  STR: '<|tool_response>', ETR: '<tool_response|>', Q: '<|"|>', THINK: '<|think|>', SOC: '<|channel>', EOC: '<channel|>',
  IMAGE: '<|image|>', AUDIO: '<|audio|>', VIDEO: '<|video|>',
};
/** generation stops on any of these (ids 1, 106, 50) */
export const STOP = [TOK.EOS, TOK.EOT, TOK.STR];
/** model card best practice (sampling); the assistant overrides temperature for tool calls (see agent.js) */
export const SAMPLING = { temperature: 1.0, topP: 0.95, topK: 64 };
/** visual token budgets the model supports per image */
export const IMAGE_BUDGETS = [70, 140, 280, 560, 1120];

// ---------------------------------------------------------------------------------------------------------------- render
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(typeof Blob !== 'undefined' && v instanceof Blob);
/** Jinja's dictsort: keys sorted case-insensitively (stable) */
const dictsort = (o) => Object.keys(o).sort((a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
const up = (s) => String(s == null ? '' : s).toUpperCase();
const pyTrim = (s) => String(s).replace(/^[\s\u0085]+|[\s\u0085]+$/g, '');

function fmtArg(a, escapeKeys = true) {
  if (a === null || a === undefined) return 'null';
  if (typeof a === 'string') return TOK.Q + a + TOK.Q;
  if (typeof a === 'boolean') return a ? 'true' : 'false';
  if (Array.isArray(a)) return '[' + a.map((x) => fmtArg(x, escapeKeys)).join(',') + ']';
  if (isMap(a)) return '{' + dictsort(a).map((k) => (escapeKeys ? TOK.Q + k + TOK.Q : k) + ':' + fmtArg(a[k], escapeKeys)).join(',') + '}';
  return String(a);
}
const STANDARD_KEYS = ['description', 'type', 'properties', 'required', 'nullable'];
function fmtParams(props, required, filterKeys = false) {
  const out = [];
  for (const key of dictsort(props)) {
    if (filterKeys && STANDARD_KEYS.includes(key)) continue;
    const v = props[key] || {}, T = up(v.type);
    let s = key + ':{', comma = false;
    const sep = () => { if (comma) s += ','; else comma = true; };
    if (v.description) { s += 'description:' + TOK.Q + v.description + TOK.Q; comma = true; }
    if (T === 'STRING') {
      if (v.enum && v.enum.length) { sep(); s += 'enum:' + fmtArg(v.enum); }
    } else if (T === 'ARRAY') {
      if (isMap(v.items) && Object.keys(v.items).length) {
        sep(); s += 'items:{';
        const parts = [];
        for (const ik of dictsort(v.items)) {
          const iv = v.items[ik];
          if (iv === null || iv === undefined) continue;
          if (ik === 'properties') parts.push('properties:{' + (isMap(iv) ? fmtParams(iv, v.items.required || []) : '') + '}');
          else if (ik === 'required') parts.push('required:[' + iv.map((r) => TOK.Q + r + TOK.Q).join(',') + ']');
          else if (ik === 'type') parts.push('type:' + (typeof iv === 'string' ? fmtArg(up(iv)) : fmtArg(iv.map(up))));
          else parts.push(ik + ':' + fmtArg(iv));
        }
        s += parts.join(',') + '}';
      }
    }
    if (v.nullable) { sep(); s += 'nullable:true'; }
    if (T === 'OBJECT') {
      if (isMap(v.properties)) { sep(); s += 'properties:{' + fmtParams(v.properties, v.required || []) + '}'; }
      else if (isMap(v)) { sep(); s += 'properties:{' + fmtParams(v, v.required || [], true) + '}'; }
      if (v.required && v.required.length) { sep(); s += 'required:[' + v.required.map((r) => TOK.Q + r + TOK.Q).join(',') + ']'; }
    }
    sep(); s += 'type:' + TOK.Q + T + TOK.Q + '}';
    out.push(s);
  }
  return out.join(',');
}
function fmtDeclaration(tool) {
  const f = tool.function || tool, p = f.parameters;
  let s = 'declaration:' + f.name + '{description:' + TOK.Q + (f.description || '') + TOK.Q;
  if (p) {
    s += ',parameters:{';
    if (p.properties && Object.keys(p.properties).length) s += 'properties:{' + fmtParams(p.properties, p.required) + '},';
    if (p.required && p.required.length) s += 'required:[' + p.required.map((r) => TOK.Q + r + TOK.Q).join(',') + '],';
    if (p.type) s += 'type:' + TOK.Q + up(p.type) + TOK.Q + '}';
  }
  if (f.response) {
    s += ',response:{';
    if (f.response.description) s += 'description:' + TOK.Q + f.response.description + TOK.Q + ',';
    if (up(f.response.type) === 'OBJECT') s += 'type:' + TOK.Q + up(f.response.type) + TOK.Q + '}';
  }
  return pyTrim(s + '}');
}
function stripThinking(text) {
  let r = '';
  for (const part of String(text).split(TOK.EOC)) r += part.includes(TOK.SOC) ? part.split(TOK.SOC)[0] : part;
  return pyTrim(r);
}
function toolResponseBlock(name, response) {
  let s = TOK.STR;
  if (isMap(response)) s += 'response:' + name + '{' + dictsort(response).map((k) => k + ':' + fmtArg(response[k], false)).join(',') + '}';
  else s += 'response:' + name + '{value:' + fmtArg(response, false) + '}';
  return s + TOK.ETR;
}
const partTag = (t) => (t === 'image' || t === 'image_url' ? TOK.IMAGE : t === 'audio' || t === 'input_audio' ? TOK.AUDIO : t === 'video' ? TOK.VIDEO : '');

/**
 * messages: [{role: 'system'|'developer'|'user'|'assistant'|'tool', content: string | [{type:'text', text} | {type:'image'} ...],
 *             tool_calls?: [{id?, function: {name, arguments: object}}], tool_call_id?, name?, tool_responses?: [{name, response}]}]
 * tools: [{type: 'function', function: {name, description, parameters: JSON-schema object}}]
 * -> the exact prompt string (starts with <bos>). Images appear as <|image|> placeholders, in message order.
 */
export function renderPrompt(messages, { tools = null, addGenerationPrompt = true, enableThinking = false } = {}) {
  let out = TOK.BOS, prevType = null, prevNonTool = null;
  let loop = messages || [];
  const first = loop[0];
  if (enableThinking || (tools && tools.length) || (first && (first.role === 'system' || first.role === 'developer'))) {
    out += TOK.SOT + 'system\n';
    if (enableThinking) { out += TOK.THINK + '\n'; prevType = 'think'; }
    if (first && (first.role === 'system' || first.role === 'developer')) {
      if (typeof first.content === 'string') out += pyTrim(first.content);
      else if (Array.isArray(first.content)) for (const it of first.content) out += pyTrim(it.text || '') + ' ';
      loop = loop.slice(1);
    }
    if (tools && tools.length) { for (const t of tools) out += TOK.STD + fmtDeclaration(t) + TOK.ETD; prevType = 'tool'; }
    out += TOK.EOT + '\n';
  }
  for (let i = 0; i < loop.length; i++) {
    const m = loop[i];
    if (m.role === 'tool') continue;
    prevType = null;
    const role = m.role === 'assistant' ? 'model' : m.role;
    const cont = role === 'model' && prevNonTool === 'assistant';
    if (!cont) out += TOK.SOT + role + '\n';
    if (m.tool_calls && m.tool_calls.length) {
      for (const tc of m.tool_calls) {
        const f = tc.function || tc, a = f.arguments;
        if (a !== null && a !== undefined && !isMap(a)) throw new Error('chat_template: tool_calls[].function.arguments must be an object, not a string');
        out += TOK.STC + 'call:' + f.name + '{' + (a ? dictsort(a).map((k) => k + ':' + fmtArg(a[k], false)).join(',') : '') + '}' + TOK.ETC;
      }
      prevType = 'tool_call';
    }
    let trOut = false;
    if (m.tool_responses && m.tool_responses.length) {
      for (const r of m.tool_responses) { out += toolResponseBlock(r.name || 'unknown', r.response); trOut = true; prevType = 'tool_response'; }
    } else if (m.tool_calls && m.tool_calls.length) {
      for (let k = i + 1; k < loop.length && loop[k].role === 'tool'; k++) {
        const f = loop[k];
        let name = f.name || 'unknown';
        for (const tc of m.tool_calls) if (tc.id && tc.id === f.tool_call_id) name = (tc.function || tc).name;
        const body = f.content;
        if (typeof body === 'string') out += toolResponseBlock(name, body);
        else if (Array.isArray(body)) {
          out += toolResponseBlock(name, body.filter((p) => p.type === 'text').map((p) => p.text || '').join(''));
          for (const p of body) out += partTag(p.type);
        } else out += toolResponseBlock(name, body);
        trOut = true; prevType = 'tool_response';
      }
    }
    let captured = '';
    if (typeof m.content === 'string') captured = role === 'model' ? stripThinking(m.content) : pyTrim(m.content);
    else if (Array.isArray(m.content)) {
      for (const it of m.content) {
        if (it.type === 'text') captured += role === 'model' ? stripThinking(it.text || '') : pyTrim(it.text || '');
        else captured += partTag(it.type);
      }
    }
    out += captured;
    const hasContent = pyTrim(captured).length > 0;
    let nextRole = null;
    for (let j = i + 1; j < loop.length; j++) if (loop[j].role !== 'tool') { nextRole = loop[j].role; break; }
    const continues = role === 'model' && nextRole === 'assistant' && (!(m.tool_calls && m.tool_calls.length) || trOut);
    if (prevType === 'tool_call' && !trOut) out += TOK.STR;
    else if (continues) { /* the next assistant message continues this model turn */ }
    else if (!(trOut && !hasContent && nextRole === null)) out += TOK.EOT + '\n';
    prevNonTool = m.role;
  }
  if (addGenerationPrompt) {
    if (prevType !== 'tool_response' && prevType !== 'tool_call') out += TOK.SOT + 'model\n';
    else if (prevType === 'tool_response' && enableThinking) out += TOK.SOC + 'thought\n';
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- parse
/**
 * Tolerant parser for Gemma's call arguments: {key:<|"|>text<|"|>,n:3,list:[...],o:{...}}. Also accepts JSON ("quoted" keys and
 * strings), single quotes, bare words as strings, trailing commas and missing closing brackets (each repair is noted).
 * -> {value, repairs: [string], rest: string}
 */
export function parseArgs(src) {
  const s = String(src), repairs = [];
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const fail = (m) => { const e = new Error(m + ' at ' + i); e.code = 'BAD_ARGS'; throw e; };
  function str() {
    if (s.startsWith(TOK.Q, i)) {
      i += TOK.Q.length; const j = s.indexOf(TOK.Q, i);
      if (j < 0) { repairs.push('unterminated <|"|> string'); const v = s.slice(i).replace(/<tool_call\|>[\s\S]*$/, ''); i = s.length; return v; }
      const v = s.slice(i, j); i = j + TOK.Q.length; return v;
    }
    const q = s[i]; i++;
    let v = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\' && i + 1 < s.length) {
        const n = s[i + 1];
        if (q === '"') { const esc = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' }; if (n === 'u') { v += String.fromCharCode(parseInt(s.substr(i + 2, 4), 16)); i += 6; continue; } v += esc[n] !== undefined ? esc[n] : n; }
        else v += n;
        i += 2; continue;
      }
      v += s[i++];
    }
    if (i >= s.length) repairs.push('unterminated quoted string'); else i++;
    return v;
  }
  function word() { const m = /^[^,:{}\[\]\s]+(?:[ \t]+[^,:{}\[\]\s<]+)*/.exec(s.slice(i)); if (!m) fail('expected a value'); i += m[0].length; return m[0]; }
  function value() {
    ws();
    if (i >= s.length) fail('unexpected end');
    const c = s[i];
    if (c === '{') return obj();
    if (c === '[') return arr();
    if (s.startsWith(TOK.Q, i) || c === '"' || c === "'") return str();
    const w = word();
    if (w === 'true' || w === 'True') return true;
    if (w === 'false' || w === 'False') return false;
    if (w === 'null' || w === 'None') return null;
    if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(w)) return Number(w);
    repairs.push(`bare word "${w.slice(0, 20)}" read as text`);
    return w;
  }
  function key() {
    ws();
    if (s.startsWith(TOK.Q, i) || s[i] === '"' || s[i] === "'") return str();
    const m = /^[A-Za-z_][\w\-]*/.exec(s.slice(i)); if (!m) fail('expected a key');
    i += m[0].length; return m[0];
  }
  function obj() {
    i++; const o = {};
    for (;;) {
      ws();
      if (i >= s.length) { repairs.push('missing }'); return o; }
      if (s[i] === '}') { i++; return o; }
      if (s[i] === ',') { i++; continue; }
      if (s.startsWith('<tool_call|>', i) || s.startsWith(TOK.STR, i)) { repairs.push('missing }'); return o; }
      const k = key(); ws();
      if (s[i] === ':' || s[i] === '=') i++; else fail('expected :');
      o[k] = value(); ws();
      if (s[i] === ',') i++;
      else if (s[i] !== '}' && i < s.length && !s.startsWith('<tool_call|>', i)) { repairs.push('missing comma'); }
    }
  }
  function arr() {
    i++; const a = [];
    for (;;) {
      ws();
      if (i >= s.length) { repairs.push('missing ]'); return a; }
      if (s[i] === ']') { i++; return a; }
      if (s[i] === ',') { i++; continue; }
      a.push(value()); ws();
      if (s[i] === ',') i++;
      else if (s[i] !== ']' && i < s.length) repairs.push('missing comma in list');
    }
  }
  ws();
  const v = value();
  return { value: v, repairs, rest: s.slice(i) };
}

const CALL_RE = /<\|tool_call>\s*([\s\S]*?)(?:<tool_call\|>|(?=<\|tool_call>)|(?=<\|tool_response>)|(?=<turn\|>)|$)/g;
/**
 * raw model output (special tokens kept) -> {thinking, toolCalls: [{name, arguments, repairs}], content, errors: [string], format}
 * format: 'native' (Gemma tool-call tokens), 'repaired' (calls recovered from plain text / JSON), or 'text'.
 */
export function parseResponse(raw) {
  let s = String(raw || '');
  const res = { thinking: '', toolCalls: [], content: '', errors: [], format: 'text' };
  const th = /^\s*<\|channel>thought\n?([\s\S]*?)(?:<channel\|>|$)/.exec(s);
  if (th) { res.thinking = th[1].trim(); s = s.slice(th[0].length); }
  let rest = s, m;
  CALL_RE.lastIndex = 0;
  const calls = [];
  while ((m = CALL_RE.exec(s)) !== null) { calls.push(m[1]); if (m[0].length === 0) CALL_RE.lastIndex++; }
  if (calls.length) {
    res.format = 'native';
    rest = s.replace(CALL_RE, ' ');
    for (const body of calls) addCall(res, body);
  }
  rest = rest.replace(/<\|tool_response>[\s\S]*$/, '').replace(/<turn\|>[\s\S]*$/, '').replace(/<eos>[\s\S]*$/, '')
    .replace(/<\|?[a-z_]+\|?>/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  if (!calls.length) {
    // repairs: the model sometimes writes the call without the special token, or as JSON
    const bare = /(?:^|\n)\s*(?:```[a-z]*\s*)?call:\s*([A-Za-z_]\w*)\s*(\{[\s\S]*)$/.exec(rest);
    const fence = /```(?:json|tool_code|tool)?\s*([\s\S]*?)```/.exec(rest);
    const json = /(\{[\s\S]*"(?:name|tool|function)"[\s\S]*\})/.exec(rest);
    if (bare) { res.format = 'repaired'; addCall(res, 'call:' + bare[1] + bare[2].replace(/```[\s\S]*$/, '')); rest = rest.slice(0, bare.index).trim(); }
    else if (fence || json) {
      try {
        const o = JSON.parse((fence ? fence[1] : json[1]).trim());
        const name = o.name || o.tool || (o.function && (o.function.name || o.function));
        const args = o.arguments || o.args || o.parameters || (o.function && o.function.arguments) || {};
        if (typeof name === 'string' && /^[A-Za-z_]\w*$/.test(name)) {
          res.format = 'repaired'; res.toolCalls.push({ name, arguments: typeof args === 'string' ? safeJson(args) : args, repairs: ['plain JSON call'] });
          rest = rest.replace(fence ? fence[0] : json[1], '').trim();
        }
      } catch (e) { /* not a call: leave it as text */ }
    }
  }
  res.content = rest;
  return res;
}
function safeJson(t) { try { return JSON.parse(t); } catch (e) { return {}; } }
function addCall(res, body) {
  const mm = /^\s*call\s*:\s*([A-Za-z_]\w*)\s*([\s\S]*)$/.exec(body);
  if (!mm) { res.errors.push('a tool call without "call:<name>"'); return; }
  const name = mm[1];
  let argsSrc = mm[2].trim();
  if (!argsSrc) { res.toolCalls.push({ name, arguments: {}, repairs: ['no arguments'] }); return; }
  if (argsSrc[0] === '(') { argsSrc = argsSrc.replace(/^\(\s*/, '').replace(/\s*\)\s*$/, ''); }
  if (argsSrc[0] !== '{') argsSrc = '{' + argsSrc + '}';
  try {
    const p = parseArgs(argsSrc);
    if (!isMap(p.value)) { res.errors.push(`${name}: arguments are not an object`); return; }
    res.toolCalls.push({ name, arguments: p.value, repairs: p.repairs });
  } catch (e) { res.errors.push(`${name}: ${e.message}`); }
}

/** Untrusted text (web pages, file names, OCR) must never carry the template's control tokens: a page that contains the literal
 *  string "<|tool_call>" would otherwise be tokenised as the real special token. Neutralises every <|...> / <...|> marker and the
 *  plain-word controls (<bos>, <eos>, <pad>, <mask>, <unk>). */
export function neutralise(text) {
  return String(text || '').replace(/<\|?\s*"?\s*\|>|<\|[^<>\n]{0,40}>|<[^<>\n]{0,40}\|>|<(?:bos|eos|pad|mask|unk|start_of_turn|end_of_turn)>/gi, ' ');
}
