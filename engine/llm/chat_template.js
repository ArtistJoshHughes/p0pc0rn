// Gemma 4 chat template (google/gemma-4-E2B-it chat_template.jinja, "Canonical Chat Template" 2026-07-09) ported to JS.
// Output is byte-identical to transformers' apply_chat_template for the message shapes the app uses (tests/chat_vectors.json):
// system/developer first message, user/assistant turns (string or [{type:'text'|'image'}] content), tools (OpenAI function schema),
// assistant tool_calls with object arguments, role:'tool' results (string or text parts), legacy tool_responses, reasoning text,
// enable_thinking, add_generation_prompt.  Images become '<|image|>' here; expandImages() turns each into <|image> + n x <|image|> + <image|>.
'use strict';

const Q = '<|"|>';
// jinja dictsort: case-insensitive key order
const dictsort = (o) => Object.keys(o).sort((a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const upper = (s) => String(s).toUpperCase();
const pyStr = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v));
const trim = (s) => String(s).replace(/^\s+|\s+$/g, '');

export function formatArgument(a, escapeKeys = true) {
  if (a === null || a === undefined) return 'null';
  if (typeof a === 'string') return Q + a + Q;
  if (typeof a === 'boolean') return a ? 'true' : 'false';
  if (isMap(a)) return '{' + dictsort(a).map((k) => (escapeKeys ? Q + k + Q : k) + ':' + formatArgument(a[k], escapeKeys)).join(',') + '}';
  if (Array.isArray(a)) return '[' + a.map((x) => formatArgument(x, escapeKeys)).join(',') + ']';
  return pyStr(a);
}

function formatParameters(props, required, filterKeys = false) {
  const std = ['description', 'type', 'properties', 'required', 'nullable'];
  let out = '', first = false;
  for (const key of dictsort(props)) {
    const value = props[key];
    if (filterKeys && std.includes(key)) continue;
    if (first) out += ',';
    first = true;
    let addComma = false;
    const comma = () => { if (addComma) out += ','; else addComma = true; };
    out += key + ':{';
    if (value.description) { out += 'description:' + Q + value.description + Q; addComma = true; }
    const T = upper(value.type || '');
    if (T === 'STRING') {
      if (value.enum) { comma(); out += 'enum:' + formatArgument(value.enum); }
    } else if (T === 'ARRAY') {
      if (isMap(value.items) && Object.keys(value.items).length) {
        comma(); out += 'items:{';
        let f2 = false;
        for (const ik of dictsort(value.items)) {
          const iv = value.items[ik];
          if (iv === null || iv === undefined) continue;
          if (f2) out += ','; f2 = true;
          if (ik === 'properties') { out += 'properties:{'; if (isMap(iv)) out += formatParameters(iv, value.items.required || []); out += '}'; }
          else if (ik === 'required') { out += 'required:[' + iv.map((r) => Q + r + Q).join(',') + ']'; }
          else if (ik === 'type') { out += 'type:' + (typeof iv === 'string' ? formatArgument(upper(iv)) : formatArgument(iv.map(upper))); }
          else out += ik + ':' + formatArgument(iv);
        }
        out += '}';
      }
    }
    if (value.nullable) { comma(); out += 'nullable:true'; }
    if (T === 'OBJECT') {
      if (isMap(value.properties)) { comma(); out += 'properties:{' + formatParameters(value.properties, value.required || []) + '}'; }
      else if (isMap(value)) { comma(); out += 'properties:{' + formatParameters(value, value.required || [], true) + '}'; }
      if (value.required && value.required.length) { comma(); out += 'required:[' + value.required.map((r) => Q + r + Q).join(',') + ']'; }
    }
    comma(); out += 'type:' + Q + upper(value.type) + Q + '}';
  }
  return out;
}

function formatFunctionDeclaration(tool) {
  const f = tool.function;
  let out = 'declaration:' + f.name + '{description:' + Q + f.description + Q;
  const p = f.parameters;
  if (p) {
    out += ',parameters:{';
    if (p.properties && Object.keys(p.properties).length) out += 'properties:{' + formatParameters(p.properties, p.required) + '},';
    if (p.required && p.required.length) out += 'required:[' + p.required.map((r) => Q + r + Q).join(',') + '],';
    if (p.type) out += 'type:' + Q + upper(p.type) + Q + '}';
  }
  if ('response' in f) {
    const r = f.response;
    out += ',response:{';
    if (r.description) out += 'description:' + Q + r.description + Q + ',';
    if (upper(r.type || '') === 'OBJECT') out += 'type:' + Q + upper(r.type) + Q + '}';
  }
  return out + '}';
}

function stripThinking(text) {
  let res = '';
  for (const part of String(text).split('<channel|>')) res += part.includes('<|channel>') ? part.split('<|channel>')[0] : part;
  return trim(res);
}

function toolResponseBlock(name, response) {
  let out = '<|tool_response>';
  if (isMap(response)) out += 'response:' + name + '{' + dictsort(response).map((k) => k + ':' + formatArgument(response[k], false)).join(',') + '}';
  else out += 'response:' + name + '{value:' + formatArgument(response, false) + '}';
  return out + '<tool_response|>';
}

/** messages -> prompt text (with '<|image|>' placeholders).  opts: {tools, enableThinking, preserveThinking, addGenerationPrompt=true, bos='<bos>'} */
export function renderChat(messages, opts = {}) {
  const tools = opts.tools && opts.tools.length ? opts.tools : null;
  const think = !!opts.enableThinking, preserve = !!opts.preserveThinking, addGen = opts.addGenerationPrompt !== false;
  let out = opts.bos === undefined ? '<bos>' : opts.bos;
  let prevType = null, prevNonToolRole = null, loop = messages;
  if (think || tools || (messages.length && ['system', 'developer'].includes(messages[0].role))) {
    out += '<|turn>system\n';
    if (think) { out += '<|think|>\n'; prevType = 'think'; }
    if (messages.length && ['system', 'developer'].includes(messages[0].role)) {
      const c = messages[0].content;
      if (typeof c === 'string') out += trim(c);
      else if (Array.isArray(c)) for (const it of c) out += trim(it.text) + ' ';
      loop = messages.slice(1);
    }
    if (tools) { for (const t of tools) out += '<|tool>' + trim(formatFunctionDeclaration(t)) + '<tool|>'; prevType = 'tool'; }
    out += '<turn|>\n';
  }
  let lastUser = -1; loop.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
  for (let i = 0; i < loop.length; i++) {
    const m = loop[i];
    if (m.role === 'tool') continue;
    prevType = null;
    const role = m.role === 'assistant' ? 'model' : m.role;
    if (!(role === 'model' && prevNonToolRole === 'assistant')) out += '<|turn>' + role + '\n';
    const thinking = m.reasoning || m.reasoning_content;
    if (thinking && (i > lastUser || (preserve && m.tool_calls))) out += '<|channel>thought\n' + thinking + '\n<channel|>';
    if (m.tool_calls && m.tool_calls.length) {
      for (const tc of m.tool_calls) {
        const f = tc.function; out += '<|tool_call>call:' + f.name + '{';
        if (isMap(f.arguments)) out += dictsort(f.arguments).map((k) => k + ':' + formatArgument(f.arguments[k], false)).join(',');
        else if (f.arguments !== null && f.arguments !== undefined) throw new Error('tool_calls[].function.arguments must be an object');
        out += '}<tool_call|>';
      }
      prevType = 'tool_call';
    }
    let trOut = false;
    if (m.tool_responses && m.tool_responses.length) {
      for (const tr of m.tool_responses) { out += toolResponseBlock(tr.name || 'unknown', tr.response); trOut = true; prevType = 'tool_response'; }
    } else if (m.tool_calls && m.tool_calls.length) {
      for (let k = i + 1; k < loop.length && loop[k].role === 'tool'; k++) {
        const fol = loop[k];
        let tname = fol.name || 'unknown';
        for (const tc of m.tool_calls) if (tc.id !== undefined && tc.id === fol.tool_call_id) tname = tc.function.name;
        const body = fol.content;
        if (typeof body === 'string') out += toolResponseBlock(tname, body);
        else if (Array.isArray(body)) {
          out += toolResponseBlock(tname, body.filter((p) => p.type === 'text').map((p) => p.text || '').join(''));
          for (const p of body) { if (p.type === 'image' || p.type === 'image_url') out += '<|image|>'; else if (p.type === 'audio' || p.type === 'input_audio') out += '<|audio|>'; else if (p.type === 'video') out += '<|video|>'; }
        } else out += toolResponseBlock(tname, body);
        trOut = true; prevType = 'tool_response';
      }
    }
    let cap = '';
    if (typeof m.content === 'string') cap = role === 'model' ? stripThinking(m.content) : trim(m.content);
    else if (Array.isArray(m.content)) for (const it of m.content) {
      if (it.type === 'text') cap += role === 'model' ? stripThinking(it.text) : trim(it.text);
      else if (it.type === 'image' || it.type === 'image_url') cap += '<|image|>';
      else if (it.type === 'audio' || it.type === 'input_audio') cap += '<|audio|>';
      else if (it.type === 'video') cap += '<|video|>';
    }
    out += cap;
    const has = trim(cap).length > 0;
    let nextRole = null, found = false;
    for (let j = i + 1; j < loop.length; j++) if (loop[j].role !== 'tool') { nextRole = loop[j].role; found = true; break; }
    const contInto = role === 'model' && nextRole === 'assistant' && (!(m.tool_calls && m.tool_calls.length) || trOut);
    if (prevType === 'tool_call' && !trOut) out += '<|tool_response>';
    else if (contInto) { /* same model turn continues */ }
    else if (!(trOut && !has && !found)) out += '<turn|>\n';
    prevNonToolRole = m.role;
  }
  if (addGen) {
    if (prevType !== 'tool_response' && prevType !== 'tool_call') out += '<|turn>model\n';
    else if (prevType === 'tool_response' && think) out += '<|channel>thought\n';
  }
  return out;
}

/** replace the i-th '<|image|>' placeholder with <|image> + n_i x <|image|> + <image|> (the Gemma4Processor expansion) */
export function expandImages(text, counts) {
  let i = 0;
  return text.split('<|image|>').reduce((acc, part, k) => (k === 0 ? part : acc + '<|image>' + '<|image|>'.repeat(counts[i++]) + '<image|>' + part), '');
}

/** parse the model's reply: {thinking, content, toolCalls: [{name, arguments}]} (response_schema of tokenizer_config.json) */
export function parseReply(text) {
  let s = text, thinking = null;
  const tm = s.match(/^<\|channel>thought\n([\s\S]*?)<channel\|>/);
  if (tm) { thinking = tm[1]; s = s.slice(tm[0].length); }
  const toolCalls = [];
  const re = /<\|tool_call>call:(\w+)(\{[\s\S]*?\})<tool_call\|>/g;
  let m;
  while ((m = re.exec(s))) toolCalls.push({ name: m[1], arguments: parseGemmaArgs(m[2]) });
  let content = s.replace(re, '');
  content = content.split('<turn|>')[0].split('<|tool_response>')[0].replace(/<eos>$/, '');
  return { thinking, content: content.trim(), toolCalls };
}

/** Gemma tool-call argument syntax: {key:value,...}, strings in <|"|>..<|"|>, unquoted keys -> JS object */
export function parseGemmaArgs(src) {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const val = () => {
    ws();
    if (src.startsWith(Q, i)) { const j = src.indexOf(Q, i + Q.length); if (j < 0) throw new Error('unterminated string'); const v = src.slice(i + Q.length, j); i = j + Q.length; return v; }
    if (src[i] === '{') { i++; const o = {}; ws(); if (src[i] === '}') { i++; return o; }
      for (;;) { ws(); let k; if (src.startsWith(Q, i)) k = val(); else { const j = src.indexOf(':', i); k = src.slice(i, j).trim(); i = j; }
        ws(); if (src[i] !== ':') throw new Error('expected : at ' + i); i++; o[k] = val(); ws();
        if (src[i] === ',') { i++; continue; } if (src[i] === '}') { i++; return o; } throw new Error('expected , or } at ' + i); } }
    if (src[i] === '[') { i++; const a = []; ws(); if (src[i] === ']') { i++; return a; }
      for (;;) { a.push(val()); ws(); if (src[i] === ',') { i++; continue; } if (src[i] === ']') { i++; return a; } throw new Error('expected , or ] at ' + i); } }
    const m2 = /^(true|false|null|-?\d+(\.\d+)?([eE][-+]?\d+)?)/.exec(src.slice(i));
    if (m2) { i += m2[0].length; return m2[1] === 'true' ? true : m2[1] === 'false' ? false : m2[1] === 'null' ? null : Number(m2[1]); }
    const j = src.slice(i).search(/[,}\]]/); const raw = src.slice(i, i + (j < 0 ? src.length : j)).trim(); i += j < 0 ? src.length - i : j; return raw;
  };
  return val();
}
