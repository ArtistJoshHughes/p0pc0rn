// Klein prompt tokenizer (SPEC 2.1-2.2): the vendored @huggingface/tokenizers (Apache-2.0, vendor/LICENSE-tokenizers.txt) driven by a
// tokenizer.json built here from the pack's verbatim Qwen2 files (vocab.json, merges.txt, tokenizer_config.json).
// The whole chat template is tokenized in one call (added tokens split first, NFC, the Qwen2 regex, byte-level BPE), exactly as
// the reference implementation does; then the prompt part is capped at 500 tokens and the sequence is right-padded with 151643 to 512.
'use strict';
import { Tokenizer } from '../vendor/tokenizers.min.mjs';

export const PAD = 151643, MIN_LEN = 512, MAX_PROMPT = 500;
export const PRE = [151644, 872, 198];
export const SUF = [151645, 198, 151644, 77091, 198, 151667, 271, 151668, 271];
const REGEX = "(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+";

/** vocab: object (vocab.json), mergesText: string (merges.txt), config: object (tokenizer_config.json) */
export function buildTokenizer(vocab, mergesText, config) {
  const merges = mergesText.split('\n').filter((l) => l && !l.startsWith('#version'));
  const added = Object.entries(config.added_tokens_decoder || {}).map(([id, t]) => ({ id: +id, content: t.content,
    single_word: !!t.single_word, lstrip: !!t.lstrip, rstrip: !!t.rstrip, normalized: !!t.normalized, special: !!t.special }));
  const bl = { type: 'ByteLevel', add_prefix_space: false, trim_offsets: false, use_regex: false };
  const json = {
    version: '1.0', truncation: null, padding: null, added_tokens: added,
    normalizer: { type: 'NFC' },
    pre_tokenizer: { type: 'Sequence', pretokenizers: [{ type: 'Split', pattern: { Regex: REGEX }, behavior: 'Isolated', invert: false }, bl] },
    post_processor: bl, decoder: bl,
    model: { type: 'BPE', dropout: null, unk_token: null, continuing_subword_prefix: '', end_of_word_suffix: '', fuse_unk: false,
      byte_fallback: false, ignore_merges: false, vocab, merges },
  };
  return new Tokenizer(json, config);
}

/** -> {ids: Int32Array(T), T, nvalid, promptTokens, truncated} */
export function encodePrompt(tok, prompt, opts = {}) {
  const clean = String(prompt).split('<|endoftext|>').join('');
  const full = tok.encode(`<|im_start|>user\n${clean}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`, { add_special_tokens: false }).ids;
  const okPre = PRE.every((v, i) => full[i] === v), okSuf = SUF.every((v, i) => full[full.length - SUF.length + i] === v);
  if (!okPre || !okSuf) throw new Error('tokenizer: chat template ids mismatch');
  let mid = full.slice(PRE.length, full.length - SUF.length);
  const maxP = opts.maxPrompt || MAX_PROMPT, truncated = mid.length > maxP;
  if (truncated) mid = mid.slice(0, maxP);
  const seq = PRE.concat(mid, SUF), nvalid = seq.length, T = Math.max(opts.minLen || MIN_LEN, nvalid);
  const ids = new Int32Array(T).fill(PAD); ids.set(seq);
  return { ids, T, nvalid, promptTokens: mid.length, truncated };
}
