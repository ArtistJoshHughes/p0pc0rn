// fit.js - 3.8 (v040): how many tokens a prompt takes, so Juli's prompts fit the Bigger brain's context (NVIDIA Nemotron 3.5 Bolt E4B
// loads with 2,048 tokens on the phone: the iOS 27 split). Exact when the engine adapter can count (countTokens: the engine's own
// tokenizer and chat template); otherwise an estimate from the prompt as the engine renders it that errs long: Gemma 4's tokenizer
// gives one token per digit and averages 3.3 to 4.4 characters a token on Juli's prompts, so the estimate counts every digit, 3.3
// characters a token for the rest and 16 tokens of the template's own (on Juli's plan, song, app and fact prompts it is 5 to 37% high).
// Other scripts take more tokens a character: a prompt the estimate lets through and the engine finds too long (TOO_LONG) goes to
// Juli's own model (queue.js runner.fallback). EST_LOW: the estimate divided by it is below the real count on all of those prompts,
// for the choices made before a model is loaded (only a prompt that surely cannot fit is kept from the Bigger brain).
'use strict';
import { renderChat } from '../engine/llm/chat_template.js';

export const EST_LOW = 1.4;

/** the estimate (no tokenizer): messages + tools + a forced start, rendered as llm.js renders them */
export function estTokens(messages, { tools = null, prefix = '' } = {}) {
  let t = '';
  try { t = renderChat(messages, { tools: tools && tools.length ? tools : undefined, addGenerationPrompt: true }) + (prefix || ''); }
  catch (e) { t = JSON.stringify(messages) + JSON.stringify(tools || []) + (prefix || ''); }   // a message the template refuses: its JSON, longer
  const digits = (t.match(/\d/g) || []).length;
  return Math.ceil((t.length - digits) / 3.3) + digits + 16;
}

/** exact when the engine can count, else the estimate */
export async function promptTokens(engine, messages, o = {}) {
  if (engine && typeof engine.countTokens === 'function') {
    try { const n = await engine.countTokens(messages, o); if (Number.isFinite(n) && n > 0) return n; } catch (e) { /* the estimate */ }
  }
  return estTokens(messages, o);
}
