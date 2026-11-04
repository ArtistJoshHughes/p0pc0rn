// tokenwatch.js - p0pc0rn v4 (Token Watch): the online source 'tokens.dexscreener' = the new tokens that ROSE most since they launched,
// on the chains the person picks (Avalanche, Solana, Base, Ethereum, BNB Chain, Arbitrum), ONLY tokens on a real DEX pool: a token still
// on a launchpad's bonding curve is never shown. Read only, keyless. Like every source in sources.js, the HOST fetches it, never the app:
// an app asks with p0.fetch('tokens.dexscreener', {op: 'top', chains, hours}) and gets small, checked rows back. What goes out: the chain
// names and public token addresses, nothing of the person's.
//   - Discovery (DEX Screener's public API has no "all new pairs" feed, so it is a hybrid): GeckoTerminal's newest pools per chain
//     (api.geckoterminal.com, new_pools, page 1) merged with DEX Screener's own launch signals (its latest token profiles and boosts,
//     filtered to the chain).
//   - Every number comes from DEX Screener (api.dexscreener.com). tokens/v1 (up to 30 addresses a request) gives ONE pair per token, its
//     main one: a first sort. token-pairs/v1 (one token a request) gives ALL its pairs, for each token that may be shown: when it really
//     launched (its first pair, the bonding curve's included), whether it graduated, and its most liquid real DEX pool, whose numbers
//     stand for it (the price change over 5 minutes / 1 / 6 / 24 hours, volume, liquidity, FDV and market cap, buys and sells).
//   - Ranking is code, never a model: launched within the window (1 hour, or 6 at the person's tap), its most liquid pair on a real DEX
//     pool with at least FLOOR_USD of liquidity, RISEN since launch; biggest rise first; the top 5 across the chains picked. A token that
//     graduated during the window is measured on its pool, so its rise counts from when it graduated, and says so (move.since).
//   - Safety flags, for the top 5 only: what GoPlus (api.gopluslabs.io, EVM chains, one request per chain for its tokens) and RugCheck
//     (api.rugcheck.xyz, Solana, one per token) REPORT, plus what the data itself says (graduated from a launchpad, a DEX Screener boost
//     or profile). A failed or skipped check is "safety check unavailable", never "safe". p0pc0rn only relays what they report.
// Josh's hard caps, in code (makeapp/budget.js TOKENWATCH_RULES): each chain is looked at most every 5 minutes (createSpacing: whatever asks,
// also across a reload; within those 5 minutes the same look is used again, so "look back 6 hours" costs no new discovery); one look sends
// at most 12 requests across the four (the fetcher's perCall cap is the hard one; this plan stays inside it: a token is shown only when
// its own check and its safety check both fit); each source has its own hourly cap (the fetcher's budgets); nothing is kept beyond this
// page or served to anyone else.
// No buy, sell or swap anywhere: this is a list of what rose, with a link to the token's page on DEX Screener (page()).
// Pure parts (no DOM) are exported for the node tests; the op runs through the fetcher's get() (host check, budgets, call cap).
import { TOKENWATCH_RULES as RULES, DEXSCREENER_CAP, GECKOTERMINAL_CAP, GOPLUS_CAP, RUGCHECK_CAP, createSpacing } from './budget.js';

/** the chains Token Watch offers: only ones every source supports (GeckoTerminal's network id, DEX Screener's chain id, GoPlus' chain id) */
export const CHAINS = Object.freeze({
  avalanche: Object.freeze({ label: 'Avalanche', gt: 'avax', ds: 'avalanche', goplus: '43114', kind: 'evm' }),
  solana: Object.freeze({ label: 'Solana', gt: 'solana', ds: 'solana', goplus: '', kind: 'solana' }),
  base: Object.freeze({ label: 'Base', gt: 'base', ds: 'base', goplus: '8453', kind: 'evm' }),
  ethereum: Object.freeze({ label: 'Ethereum', gt: 'eth', ds: 'ethereum', goplus: '1', kind: 'evm' }),
  bsc: Object.freeze({ label: 'BNB Chain', gt: 'bsc', ds: 'bsc', goplus: '56', kind: 'evm' }),
  arbitrum: Object.freeze({ label: 'Arbitrum', gt: 'arbitrum', ds: 'arbitrum', goplus: '42161', kind: 'evm' }),
});
export const CHAIN_IDS = Object.freeze(Object.keys(CHAINS));
export const DEFAULT_CHAINS = Object.freeze(['avalanche']);   // Josh: Avalanche is on by default; the person turns it off by hand
export const HOSTS = Object.freeze({ ds: 'api.dexscreener.com', gt: 'api.geckoterminal.com', goplus: 'api.gopluslabs.io', rug: 'api.rugcheck.xyz' });
export const FLOOR_USD = RULES.floorUsd;   // $5,000 of liquidity in its most liquid pool: below that a price moves on a few trades
export const PAGE = Object.freeze({ gtPerPage: 20, perLookup: 30, top: RULES.top, maxChains: RULES.maxChains });
export const LIMITS = Object.freeze({ perRefresh: RULES.perRefresh, gapMs: RULES.refreshGapMs, keepMs: RULES.keepMs, shareFlag: 0.2, taxFlag: 0.1, gradGapMs: 2 * 60e3 });

// ---- graduated or not (Josh, Nov 1: "only grad tokens")
// A launchpad's BONDING CURVE (its own market, before a token "graduates" to a DEX pool) is never counted: a token whose most liquid
// market is a curve, or that has no real pool, is never shown. DEX Screener's dexIds, checked live on Nov 1 2026 (tokens/v1,
// token-pairs/v1 and search on all six chains):
//   solana   pumpfun     pump.fun's curve: seen live, beside the token's pumpswap pool once it graduates
//            meteoradbc  Meteora's Dynamic Bonding Curve: seen live
//            bags        Bags.fm (launches on Meteora's curve): seen live
//            moonshot, launchlab (Raydium LaunchLab, which letsbonk.fun uses), believe, boop (boop.fun): Josh's list; not in the day's
//            samples, so they are named here before they show up
//   bsc      fourmeme    Four.meme's curve: seen live (31 pairs in one search)
//   avalanche arenatrade Arena's launchpad curve: seen live
//   base, ethereum, arbitrum: no curve seen; their new tokens sat straight on Uniswap, Aerodrome, Camelot ... pools
// A pair a DEX labels as its curve (meteora [DBC], raydium [LaunchLab]) is a curve too.
export const CURVE_DEXES = Object.freeze({ pumpfun: 'pump.fun', meteoradbc: 'Meteora DBC', bags: 'Bags.fm', moonshot: 'Moonshot', launchlab: 'Raydium LaunchLab',
  believe: 'Believe', boop: 'boop.fun', fourmeme: 'Four.meme', arenatrade: 'Arena' });
export const CURVE_LABELS = Object.freeze(['dbc', 'launchlab']);
// The real DEX pools (an AMM) a token counts on. Any other dexId (a launchpad we do not know yet, 'zora', or an unnamed contract: both
// seen live) is not counted, so a token still on a curve is never shown by mistake.
export const AMM_DEXES = Object.freeze(['pumpswap', 'raydium', 'meteora', 'orca', 'fluxbeam', 'lifinity', 'uniswap', 'sushiswap', 'pancakeswap', 'traderjoe', 'lfj',
  'pharaoh', 'pangolin', 'blackhole', 'aerodrome', 'aero', 'baseswap', 'alienbase', 'hydrex', 'camelot', 'ramses', 'balancer', 'kyberswap', 'velodrome', 'thena', 'biswap', 'apeswap']);
const AMM = new Set(AMM_DEXES);
/** one DEX Screener pair -> 'curve' (a launchpad's bonding curve), 'amm' (a real DEX pool) or 'other' (a market we do not know: not counted) */
export function pairKind(p) {
  const d = String((p && p.dexId) || '').toLowerCase(), labels = ((p && p.labels) || []).map((x) => String(x).toLowerCase());
  if (CURVE_DEXES[d] || labels.some((l) => CURVE_LABELS.includes(l))) return 'curve';
  return AMM.has(d) ? 'amm' : 'other';
}

const EVM = /^0x[0-9a-fA-F]{40}$/, SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, ZERO = /^0x0{40}$/i;
const SKIP = new Set(['So11111111111111111111111111111111111111112']);   // wrapped SOL: the quote side of most new Solana pools, never new
const bad = (m) => Object.assign(new Error(m), { code: 'BAD_PARAMS' });
const plain = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
const int0 = (v) => { const n = Math.floor(+v); return Number.isFinite(n) && n >= 0 ? n : 0; };
const CAPS = new Set(['DAILY_CAP', 'APP_CAP', 'HOUR_CAP', 'BACKOFF', 'RATE_LIMIT', 'BUSY', 'CALL_CAP']);   // nothing was sent: what came back so far counts

/** a public token address on that chain, as the APIs use it (EVM: lower case; Solana: as it is, base58 is case-sensitive), else '' */
export function addrOf(chain, a) {
  const s = String(a == null ? '' : a).trim(), c = CHAINS[chain];
  if (!c) return '';
  if (c.kind === 'evm') return EVM.test(s) && !ZERO.test(s) ? s.toLowerCase() : '';
  return SOL.test(s) && !SKIP.has(s) ? s : '';
}
/** a token's symbol and name as people read them: letters, digits and a few signs only (a name can carry anything, a web address or a
 *  message to Juli: it never gets through) */
export const cleanSym = (s) => { const t = plain(s, 40).replace(/[^\p{L}\p{N}$._+-]/gu, ''); return /https?|www|\.(com|io|net|xyz|app)\b/i.test(t) ? '' : t.slice(0, 14); };
export const cleanName = (s) => { const t = plain(s, 80).replace(/[^\p{L}\p{N} $.'&_+-]/gu, '').replace(/\s+/g, ' ').trim(); return /https?|www\.|\.(com|io|net|xyz|app)\b/i.test(t) ? '' : t.slice(0, 32); };
const cleanWord = (s, n) => plain(s, n * 2).replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S*|www\.\S*/gi, ' ').replace(/[^A-Za-z0-9 .$%,'()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);   // a third party's words: no markup, no web address

/** the chains asked for -> at most PAGE.maxChains known ones, in the order offered; none -> the default (Avalanche) */
export function chainsOf(list) {
  const want = new Set((Array.isArray(list) ? list : String(list || '').split(',')).map((x) => String(x).trim().toLowerCase()));
  const out = CHAIN_IDS.filter((c) => want.has(c)).slice(0, PAGE.maxChains);
  return out.length ? out : DEFAULT_CHAINS.slice();
}
export const hoursOf = (h) => (+h === 6 ? 6 : 1);

// ---- discovery
/** GeckoTerminal's new_pools page -> [{address, at}] (the base token of each new pool, newest first; at = the pool's creation, ms) */
export function gtPools(d, chain) {
  const out = [];
  for (const x of (d && Array.isArray(d.data) ? d.data : []).slice(0, PAGE.gtPerPage)) {
    const at = Date.parse(x && x.attributes && x.attributes.pool_created_at);
    const id = String((((x && x.relationships) || {}).base_token || {}).data ? x.relationships.base_token.data.id || '' : '');
    const a = addrOf(chain, id.slice(id.indexOf('_') + 1));
    if (a && Number.isFinite(at)) out.push({ address: a, at });
  }
  return out;
}
/** DEX Screener's latest token profiles and boosts -> {chain: [{address, profile, boost}]} for the chains Token Watch offers */
export function dsSignals(profiles, boosts) {
  const out = {}, byDs = new Map(CHAIN_IDS.map((c) => [CHAINS[c].ds, c]));
  const add = (list, k) => {
    for (const x of (Array.isArray(list) ? list : []).slice(0, 100)) {
      const c = byDs.get(String(x && x.chainId)); if (!c) continue;
      const a = addrOf(c, x.tokenAddress); if (!a) continue;
      const L = out[c] || (out[c] = []); let e = L.find((y) => y.address === a);
      if (!e) { e = { address: a, profile: false, boost: false }; L.push(e); }
      e[k] = true;
    }
  };
  add(profiles, 'profile'); add(boosts, 'boost');
  return out;
}
/** one chain's candidates: GeckoTerminal's new pools and DEX Screener's signals, taken in turn, each address once, at most max ->
 *  [{address, pool (ms or 0), profile, boost}] */
export function mergeCandidates(pools, signals, max = PAGE.perLookup) {
  const out = [], seen = new Map(), A = (pools || []).slice(), B = (signals || []).slice();
  const put = (x, from) => {
    if (!x || !x.address) return;
    const e = seen.get(x.address);
    if (e) { if (from === 'gt') e.pool = e.pool ? Math.min(e.pool, x.at) : x.at; else { e.profile = e.profile || !!x.profile; e.boost = e.boost || !!x.boost; } return; }
    if (out.length >= max) return;
    const n = { address: x.address, pool: from === 'gt' ? x.at : 0, profile: from === 'ds' && !!x.profile, boost: from === 'ds' && !!x.boost };
    seen.set(x.address, n); out.push(n);
  };
  while (A.length || B.length) { if (A.length) put(A.shift(), 'gt'); if (B.length) put(B.shift(), 'ds'); }
  return out;
}

// ---- the numbers (DEX Screener)
const PAIR = /^[A-Za-z0-9]{20,66}$/;
const chg = (o) => ({ m5: num(o && o.m5), h1: num(o && o.h1), h6: num(o && o.h6), h24: num(o && o.h24) });
const tx = (o) => ({ buys: int0(o && o.buys), sells: int0(o && o.sells) });
const liqOf = (p) => num(p && p.liquidity && p.liquidity.usd);
/** DEX Screener's pairs for one chain (tokens/v1: one main pair a token; token-pairs/v1: all of one token's) -> Map(address -> token), only
 *  the addresses asked for, as the base token of a pair:
 *    status    'curve' (no real pool, or a curve is its most liquid market: still on a launchpad's bonding curve), 'graduated' (a curve
 *              pair and a real pool that is now its most liquid market), 'direct' (real pools only), 'other' (a market we do not know)
 *    launchedAt its FIRST pair's creation, the curve's included (the token's own launch); poolAt = its most liquid real pool's creation
 *    the numbers are that pool's; curve = the launchpad's name when it graduated from one */
export function tokensOf(pairs, chain, wanted, now = Date.now()) {
  const c = CHAINS[chain], want = wanted instanceof Set ? wanted : new Set(wanted || []), by = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!p || String(p.chainId) !== c.ds) continue;
    const a = addrOf(chain, p.baseToken && p.baseToken.address); if (!a || !want.has(a)) continue;
    const g = by.get(a) || { pairs: [], first: Infinity, boosted: false, info: null };
    g.pairs.push(p); const at = num(p.pairCreatedAt); if (at && at < g.first) g.first = at;
    if (p.boosts && num(p.boosts.active) > 0) g.boosted = true;
    if (p.info && !g.info) g.info = p.info;
    by.set(a, g);
  }
  const out = new Map();
  for (const [a, g] of by) {
    const byLiq = (L) => L.slice().sort((x, y) => (liqOf(y) || -1) - (liqOf(x) || -1));
    const amm = byLiq(g.pairs.filter((p) => pairKind(p) === 'amm')), curves = g.pairs.filter((p) => pairKind(p) === 'curve'), top = byLiq(g.pairs)[0];
    const curveName = curves.length ? CURVE_DEXES[String(curves[0].dexId).toLowerCase()] || 'a launchpad' : '';
    const status = !amm.length ? (curves.length ? 'curve' : 'other') : pairKind(top) === 'curve' && (liqOf(top) || 0) > (liqOf(amm[0]) || 0) ? 'curve' : curves.length ? 'graduated' : 'direct';
    const best = amm[0] || top, launchedAt = Number.isFinite(g.first) ? g.first : null, info = g.info || {};
    const pair = PAIR.test(String(best.pairAddress || '')) ? String(best.pairAddress) : '';
    out.set(a, { chain, address: a, pair, symbol: cleanSym(best.baseToken && best.baseToken.symbol), name: cleanName(best.baseToken && best.baseToken.name),
      dex: cleanWord(best.dexId, 24), status, curve: curveName, launchedAt, poolAt: num(best.pairCreatedAt), ageMin: launchedAt ? Math.max(0, Math.round((now - launchedAt) / 60e3)) : null,
      liquidity: status === 'curve' || status === 'other' ? null : liqOf(best), fdv: num(best.fdv), marketCap: num(best.marketCap), change: chg(best.priceChange),
      volume: { m5: num(best.volume && best.volume.m5), h1: num(best.volume && best.volume.h1), h6: num(best.volume && best.volume.h6), h24: num(best.volume && best.volume.h24) },
      txns: { h1: tx(best.txns && best.txns.h1), h24: tx(best.txns && best.txns.h24) },
      socials: Array.isArray(info.socials) ? Math.min(20, info.socials.length) : 0, websites: Array.isArray(info.websites) ? Math.min(20, info.websites.length) : 0,
      profile: !!g.info, boosted: g.boosted, pump: chain === 'solana' && /pump$/.test(a), pairs: g.pairs.length });
  }
  return out;
}
/** the rise: its pool's price change over the smallest window that covers the token's age (under an hour: h1, as DEX Screener counts a
 *  window longer than the pool's life from its first trade). since = 'launch', or 'graduation' when the pool came more than 2 minutes
 *  after the token launched (its change then counts from the pool's first trade) -> {pct, window, since} or null */
export function moveOf(t) {
  if (!t || t.ageMin == null) return null;
  const w = t.ageMin <= 60 ? 'h1' : t.ageMin <= 360 ? 'h6' : 'h24', v = t.change ? t.change[w] : null;
  if (!Number.isFinite(v)) return null;
  const since = t.status === 'graduated' && t.poolAt && t.launchedAt && t.poolAt - t.launchedAt > LIMITS.gradGapMs ? 'graduation' : 'launch';
  return { pct: v, window: w, since };
}
/** one token against the rules (code): -> 'kept' or why not: 'curve' (still on a bonding curve), 'other' (no pool we know), 'older'
 *  (launched before the window), 'floor' (under FLOOR_USD), 'down' (not risen since launch), 'nomove' (no number) */
export function judge(t, { now = Date.now(), hours = 1, floor = FLOOR_USD } = {}) {
  if (!t) return 'other';
  if (!t.launchedAt || t.launchedAt > now + 60e3 || now - t.launchedAt > hoursOf(hours) * 3600e3) return 'older';
  if (t.status === 'curve') return 'curve';
  if (t.status !== 'graduated' && t.status !== 'direct') return 'other';
  if (!(t.liquidity >= floor)) return 'floor';
  const mv = moveOf(t); if (!mv) return 'nomove';
  return mv.pct > 0 ? 'kept' : 'down';
}
const STAT0 = () => ({ looked: 0, launched: 0, curve: 0, other: 0, floorOut: 0, down: 0, unchecked: 0, kept: 0 });
/** the ranking (code, never the model): judge() every token; the ones kept by their rise since launch, biggest first, then more
 *  liquidity -> {top, stats: {chain: {looked, launched, curve, other, floorOut, down, unchecked, kept}}} */
export function rank(tokens, { now = Date.now(), hours = 1, floor = FLOOR_USD, top = PAGE.top, chains = null } = {}) {
  const stats = {}, keep = [];
  for (const c of chains || CHAIN_IDS) stats[c] = STAT0();
  for (const t of tokens || []) {
    const s = stats[t.chain] || (stats[t.chain] = STAT0()); s.looked++;
    const j = judge(t, { now, hours, floor });
    if (j !== 'older' && j !== 'other') s.launched++;
    if (j === 'curve') s.curve++; else if (j === 'other') s.other++; else if (j === 'floor') s.floorOut++; else if (j === 'down') s.down++;
    if (j === 'kept') { s.kept++; keep.push(Object.assign({}, t, { move: moveOf(t) })); }
  }
  keep.sort((a, b) => b.move.pct - a.move.pct || (b.liquidity || 0) - (a.liquidity || 0) || (a.address < b.address ? -1 : 1));
  return { top: keep.slice(0, top), stats };
}

// ---- safety (the top 5 only); a flag = {id, text, level: 'danger' | 'warn' | 'note', by}. The words are what GoPlus or RugCheck REPORT:
// p0pc0rn relays them and takes no responsibility for security or safety; Juli checks no contract
const pct = (f) => (f >= 0.1 ? Math.round(f * 100) : Math.round(f * 1000) / 10);
/** GoPlus' answer for one EVM token -> {by, status: 'checked' | 'unavailable', flags} */
export function goplusOf(r) {
  if (!r || typeof r !== 'object') return { by: 'GoPlus', status: 'unavailable', why: 'GoPlus had no answer for it', flags: [] };
  const on = (k) => String(r[k]) === '1', flags = [], f = (v) => (v === '' || v == null ? null : num(v));
  if (on('is_honeypot')) flags.push({ id: 'honeypot', text: 'GoPlus reports it as a honeypot', level: 'danger', by: 'GoPlus' });
  if (on('is_mintable')) flags.push({ id: 'mintable', text: 'More of it can be minted', level: 'warn', by: 'GoPlus' });
  if (on('hidden_owner')) flags.push({ id: 'hidden-owner', text: 'It has a hidden owner', level: 'danger', by: 'GoPlus' });
  if (on('can_take_back_ownership')) flags.push({ id: 'take-back', text: 'Its owner can take back ownership', level: 'danger', by: 'GoPlus' });
  const bt = f(r.buy_tax), st = f(r.sell_tax);
  if (bt != null && bt > LIMITS.taxFlag) flags.push({ id: 'buy-tax', text: `A buy tax of ${pct(bt)} %`, level: 'warn', by: 'GoPlus' });
  if (st != null && st > LIMITS.taxFlag) flags.push({ id: 'sell-tax', text: `A sell tax of ${pct(st)} %`, level: st >= 0.5 ? 'danger' : 'warn', by: 'GoPlus' });
  const cp = f(r.creator_percent), op = f(r.owner_percent);
  if (cp != null && cp >= LIMITS.shareFlag) flags.push({ id: 'creator-share', text: `Its creator has ${pct(cp)} % of the supply`, level: 'warn', by: 'GoPlus' });
  if (op != null && op >= LIMITS.shareFlag && !(cp != null && cp >= LIMITS.shareFlag && String(r.owner_address || '').toLowerCase() === String(r.creator_address || '').toLowerCase()))
    flags.push({ id: 'owner-share', text: `Its owner has ${pct(op)} % of the supply`, level: 'warn', by: 'GoPlus' });
  if (String(r.is_open_source) === '0') flags.push({ id: 'closed-source', text: 'Its code is not open source', level: 'warn', by: 'GoPlus' });
  return { by: 'GoPlus', status: 'checked', flags };
}
/** RugCheck's report summary for one Solana token -> {by, status, flags, score, lpLockedPct} (its own risks of level danger or warn,
 *  in its own words, cleaned) */
export function rugOf(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.risks)) return { by: 'RugCheck', status: 'unavailable', why: 'RugCheck had no report for it', flags: [] };
  const flags = [];
  for (const r of d.risks.slice(0, 12)) {
    const lv = String(r && r.level || '').toLowerCase(); if (lv !== 'danger' && lv !== 'warn') continue;
    const name = cleanWord(r.name, 48), val = cleanWord(r.value, 24); if (!name) continue;
    const id = 'rc-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    if (flags.some((x) => x.id === id)) continue;
    flags.push({ id, text: name + (val ? ` (${val})` : ''), level: lv === 'danger' ? 'danger' : 'warn', by: 'RugCheck' });
    if (flags.length >= 5) break;
  }
  const score = num(d.score_normalised), lp = num(d.lpLockedPct);
  return { by: 'RugCheck', status: 'checked', flags, score: score != null ? Math.max(0, Math.min(100, Math.round(score))) : null, lpLockedPct: lp != null ? Math.max(0, Math.min(100, Math.round(lp))) : null };
}
/** what the data itself says (no safety source): where it graduated from, DEX Screener's boost and profile */
export function dataFlags(t) {
  const out = [];
  if (t.status === 'graduated') out.push({ id: 'graduated', text: t.pump ? 'Graduated from a pump.fun-style launch' : `Graduated from a ${t.curve || 'launchpad'} launch`, level: 'note', by: 'DEX Screener' });
  if (t.boosted) out.push({ id: 'boosted', text: 'Boosted on DEX Screener (a paid promotion)', level: 'note', by: 'DEX Screener' });
  if (t.profile) out.push({ id: 'profile', text: 'Has a DEX Screener profile', level: 'note', by: 'DEX Screener' });
  return out;
}
export const unavailable = (by, why) => ({ by, status: 'unavailable', why: String(why || 'the check did not answer').slice(0, 120), flags: [] });

/** the token's page on DEX Screener (its most liquid pool), for the host's link: never fetched, never a request of the app's own */
export function page(p) {
  const c = CHAINS[p && p.chain], pair = String((p && p.pair) || '');
  if (!c || !PAIR.test(pair)) throw bad('a DEX Screener page needs a chain and a pair address');
  return { url: `https://dexscreener.com/${c.ds}/${pair.toLowerCase()}`, site: 'dexscreener.com', name: 'DEX Screener' };   // DEX Screener's own form (lower case)
}

// ---- the look (op 'top')
const URLS = {
  gt: (c, n) => `https://${HOSTS.gt}/api/v2/networks/${CHAINS[c].gt}/new_pools?page=${n}`,
  profiles: () => `https://${HOSTS.ds}/token-profiles/latest/v1`,
  boosts: () => `https://${HOSTS.ds}/token-boosts/latest/v1`,
  tokens: (c, list) => `https://${HOSTS.ds}/tokens/v1/${CHAINS[c].ds}/${list.join(',')}`,
  pairs: (c, a) => `https://${HOSTS.ds}/token-pairs/v1/${CHAINS[c].ds}/${a}`,
  goplus: (c, list) => `https://${HOSTS.goplus}/api/v1/token_security/${CHAINS[c].goplus}?contract_addresses=${list.join(',')}`,
  rug: (mint) => `https://${HOSTS.rug}/v1/tokens/${mint}/report/summary`,
};
export { URLS };
const UNCHECKED = 'not checked this time (p0pc0rn’s cap of 12 requests a look)';

/** createTokenSource({spacing}) -> the source object for SOURCES (one per page: what it saw stays in this page's memory for keepMs, per
 *  app). spacing = a createSpacing() (the tests pass their own); else one is made from the fetcher's storage on first use */
export function createTokenSource(o = {}) {
  const kept = new Map();   // scope -> {signals, chains: {c: {at, tokens (main pairs), cover, error}}, full: Map(key -> {at, t}), safety: Map(key -> {at, s})}
  let spacing = o.spacing || null, clock = Date.now();
  const keepOf = (scope) => { let k = kept.get(scope); if (!k) { k = { signals: null, chains: {}, full: new Map(), safety: new Map() }; kept.set(scope, k); if (kept.size > 20) kept.delete(kept.keys().next().value); } return k; };

  async function top(p, get, ctx = {}) {
    const now = typeof ctx.now === 'number' ? ctx.now : Date.now(), scope = String(ctx.scope || ''), chains = chainsOf(p && p.chains), hours = hoursOf(p && p.hours);
    clock = now;
    if (!spacing) spacing = createSpacing({ key: 'tokenwatch', gapMs: LIMITS.gapMs }, { store: ctx.store || null, now: () => clock });
    const K = keepOf(scope), out = { chains: {}, top: [], hours, floor: FLOOR_USD, at: now, calls: 0, stopped: null, reused: [], soon: null };
    let used = 0;
    const call = async (url) => { if (used >= LIMITS.perRefresh) throw Object.assign(new Error('this look has used its 12 requests'), { code: 'CALL_CAP', until: 0 }); used++; return get(url); };
    const stop = (e) => { if (!out.stopped) out.stopped = { code: e.code, until: +e.until || 0, message: plain(e.message, 160) }; };
    const fresh = (x) => x && now - x.at < LIMITS.keepMs;
    const busy = () => !!out.stopped && out.stopped.code === 'BUSY';
    const keyOf = (t) => t.chain + ':' + t.address;

    // 1. which chains need a new look (each at most every 5 minutes: a look within that time is used again, or waits)
    const look = [];
    for (const c of chains) {
      if (fresh(K.chains[c])) { out.reused.push(c); continue; }
      const s = spacing.check(scope, c);
      if (!s.ok) { out.chains[c] = { status: 'soon', until: s.until }; out.soon = Math.max(out.soon || 0, s.until); continue; }
      look.push(c);
    }
    // 2. DEX Screener's launch signals (shared by every chain, kept with the look)
    if (look.length && !fresh(K.signals)) {
      let pr = null, bo = null;
      try { pr = await call(URLS.profiles()); } catch (e) { if (CAPS.has(e && e.code)) stop(e); }
      if (!out.stopped) { try { bo = await call(URLS.boosts()); } catch (e) { if (CAPS.has(e && e.code)) stop(e); } }
      if (pr || bo) K.signals = { at: now, by: dsSignals(pr, bo) };
    }
    const sig = (K.signals && K.signals.by) || {};
    // 3. each chain: GeckoTerminal's newest pools, then DEX Screener's main pair of every candidate (30 in one request): a first sort
    for (const c of look) {
      if (busy()) break;
      const st = { at: now, tokens: new Map(), cover: null, error: '', looked: 0 }, before = used;
      let pools = [];
      try { pools = gtPools(await call(URLS.gt(c, 1)), c); st.cover = pools.length ? Math.min(...pools.map((x) => x.at)) : null; }
      catch (e) { if (CAPS.has(e && e.code)) stop(e); else st.error = 'GeckoTerminal did not answer'; }
      const cand = mergeCandidates(pools, sig[c] || [], PAGE.perLookup);
      if (cand.length && !busy()) {
        try {
          const got = tokensOf(await call(URLS.tokens(c, cand.map((x) => x.address))), c, new Set(cand.map((x) => x.address)), now);
          for (const [a, t] of got) { const x = cand.find((y) => y.address === a); if (x) { t.profile = t.profile || x.profile; t.boosted = t.boosted || x.boost; } st.tokens.set(a, t); }
          st.looked = cand.length;
        } catch (e) { if (CAPS.has(e && e.code)) stop(e); st.error = st.error || 'DEX Screener did not answer'; }
      }
      if (used > before) spacing.mark(scope, c);   // a request went out for it: its next look waits 5 minutes
      if (st.looked || pools.length) K.chains[c] = st;
      else if (!busy()) out.chains[c] = { status: 'error', error: st.error || 'nothing came back' };
    }
    // 4. the first sort (code), on each token's main pair: a curve, a launch before the window (its main pool is already older), under
    //    the floor or not risen go no further; the rest, biggest rise first, are checked with ALL their pairs (token-pairs/v1) one by
    //    one, while the look's 12 requests still leave room for that token's safety check too
    const stats = {}; for (const c of chains) stats[c] = STAT0();
    const pre = [];
    for (const c of chains) {
      const st = K.chains[c]; if (!fresh(st)) continue;
      for (const t0 of st.tokens.values()) {
        const t = Object.assign({}, t0, { ageMin: t0.launchedAt ? Math.max(0, Math.round((now - t0.launchedAt) / 60e3)) : null }), s = stats[c]; s.looked++;
        const j = judge(t, { now, hours });
        if (j === 'older' || j === 'other') { if (j === 'other') s.other++; continue; }
        s.launched++;
        if (j === 'kept') pre.push(t); else if (j === 'curve') s.curve++; else if (j === 'floor') s.floorOut++; else if (j === 'down') s.down++;
      }
    }
    pre.sort((a, b) => moveOf(b).pct - moveOf(a).pct || (b.liquidity || 0) - (a.liquidity || 0));
    const shown = [], need = (L) => L.filter((t) => t.chain === 'solana').length + new Set(L.filter((t) => t.chain !== 'solana').map((t) => t.chain)).size;
    for (const t0 of pre) {
      if (shown.length >= PAGE.top) break;
      const s = stats[t0.chain];
      let full = K.full.get(keyOf(t0)); full = full && now - full.at < LIMITS.keepMs ? full.t : null;
      if (!full) {
        if (busy() || used + 1 + need(shown.concat(t0)) > LIMITS.perRefresh) { s.unchecked++; continue; }   // no room for its check and its safety
        try {
          const all = tokensOf(await call(URLS.pairs(t0.chain, t0.address)), t0.chain, new Set([t0.address]), now).get(t0.address);
          if (!all) { s.unchecked++; continue; }
          full = Object.assign(all, { profile: all.profile || t0.profile, boosted: all.boosted || t0.boosted });
          K.full.set(keyOf(t0), { at: now, t: full });
        } catch (e) { if (CAPS.has(e && e.code)) stop(e); s.unchecked++; continue; }
      }
      const t = Object.assign({}, full, { ageMin: full.launchedAt ? Math.max(0, Math.round((now - full.launchedAt) / 60e3)) : null }), j = judge(t, { now, hours });
      if (j === 'kept') { s.kept++; shown.push(Object.assign(t, { move: moveOf(t) })); continue; }
      if (j === 'older' || j === 'other') s.launched--;   // its first pair is older than its main pool: it launched before the window
      if (j === 'curve') s.curve++; else if (j === 'other') s.other++; else if (j === 'floor') s.floorOut++; else if (j === 'down') s.down++;
    }
    shown.sort((a, b) => b.move.pct - a.move.pct || (b.liquidity || 0) - (a.liquidity || 0));
    for (const c of chains) {
      const st = K.chains[c];
      if (!out.chains[c]) out.chains[c] = fresh(st) ? Object.assign({ status: st.error && !st.looked ? 'error' : 'ok', cover: st.cover, error: st.error || '', lookedAt: st.at }, stats[c]) : { status: 'error', error: 'nothing came back' };
    }
    // 5. safety for the shown (kept per token for keepMs): GoPlus once per EVM chain, RugCheck once per Solana token; what the cap or an
    //    error leaves out says "safety check unavailable"
    const T = shown.map((t) => Object.assign({}, t, { flags: dataFlags(t), safety: null }));
    for (const t of T) { const k = K.safety.get(keyOf(t)); if (k && now - k.at < LIMITS.keepMs) t.safety = k.s; }
    for (const c of chains.filter((x) => CHAINS[x].kind === 'evm')) {
      const want = T.filter((t) => t.chain === c && !t.safety); if (!want.length) continue;
      if (busy()) break;
      try {
        const d = await call(URLS.goplus(c, want.map((t) => t.address))), res = d && Number(d.code) === 1 && d.result && typeof d.result === 'object' ? d.result : null;
        for (const t of want) { t.safety = res ? goplusOf(res[t.address] || res[t.address.toLowerCase()]) : unavailable('GoPlus', 'GoPlus did not answer'); if (res) K.safety.set(keyOf(t), { at: now, s: t.safety }); }
      } catch (e) { if (CAPS.has(e && e.code)) stop(e); for (const t of want) t.safety = unavailable('GoPlus', e && e.code === 'CALL_CAP' ? UNCHECKED : CAPS.has(e && e.code) ? 'not checked this time (p0pc0rn’s request cap)' : 'GoPlus did not answer'); }
    }
    for (const t of T.filter((x) => x.chain === 'solana' && !x.safety)) {
      if (busy()) { t.safety = unavailable('RugCheck', 'not checked this time (your phone got busy)'); continue; }
      try { t.safety = rugOf(await call(URLS.rug(t.address))); if (t.safety.status === 'checked') K.safety.set(keyOf(t), { at: now, s: t.safety }); }
      catch (e) { if (CAPS.has(e && e.code) && e.code !== 'CALL_CAP') stop(e); t.safety = unavailable('RugCheck', e && e.code === 'CALL_CAP' ? UNCHECKED : CAPS.has(e && e.code) ? 'not checked this time (p0pc0rn’s request cap)' : 'RugCheck did not answer'); }
    }
    for (const t of T) if (!t.safety) t.safety = unavailable(CHAINS[t.chain].kind === 'evm' ? 'GoPlus' : 'RugCheck', 'not checked this time');
    out.top = T.map((t) => Object.assign(t, { label: CHAINS[t.chain].label }));
    out.calls = used;
    if (out.soon && !look.length && !out.reused.length) out.stopped = out.stopped || { code: 'TOO_SOON', until: out.soon, message: 'looked less than 5 minutes ago' };
    return out;
  }

  return {
    label: 'New tokens on DEX Screener (with GeckoTerminal, GoPlus and RugCheck)', host: HOSTS.ds, hosts: Object.values(HOSTS),
    attribution: 'DEX Screener', ttl: 0, perMin: 6, perCall: LIMITS.perRefresh, idleOnly: true,
    budget: DEXSCREENER_CAP,   // the source's own: when DEX Screener rests, no check starts (the host's capOf)
    budgets: { [HOSTS.ds]: DEXSCREENER_CAP, [HOSTS.gt]: GECKOTERMINAL_CAP, [HOSTS.goplus]: GOPLUS_CAP, [HOSTS.rug]: RUGCHECK_CAP },
    /** GoPlus says "too many" in its body (code 4029), with HTTP 200: the fetcher treats it as a 429 */
    rateLimited: (d, url) => { try { return new URL(url).hostname === HOSTS.goplus && !!d && Number(d.code) === 4029; } catch (e) { return false; } },
    page,
    async get(p, get, ctx) { if (!p || p.op !== 'top') throw bad('op: top'); return top(p, get, ctx || {}); },
    _kept: kept,
  };
}
export const TOKENS = createTokenSource();

/** v4 (Token Watch): the chat's "watch closely" in code (no model): "watch closely", "watch Avalanche closely", "watch Solana and Base
 *  closely", "watch new tokens closely"; "stop watching closely". -> {cmd: 'watch' | 'stop', chains: [...] | null} or null. Only a short
 *  message that is that command and nothing else ("watch my kids closely" is not one). */
const CHAIN_WORDS = [['avalanche', /\b(?:avalanche|avax)\b/i], ['solana', /\b(?:solana|sol)\b/i], ['base', /\bbase\b/i], ['ethereum', /\b(?:ethereum|eth|mainnet)\b/i],
  ['bsc', /\b(?:bnb(?: chain| smart chain)?|bsc|binance(?: smart chain)?)\b/i], ['arbitrum', /\b(?:arbitrum|arb)\b/i]];
export function tokenCommand(text) {
  const t = String(text || '').trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  if (!t || t.length > 90) return null;
  if (/^(?:please |ok |okay |hey )?(?:juli,? )?(?:stop|end|cancel) watching(?: (?:tokens|new tokens|token launches|launches))? closely(?: please)?$/i.test(t)) return { cmd: 'stop', chains: null };
  const m = /^(?:please |ok |okay |hey )?(?:juli,? )?(?:token watch,? )?watch(?: (.+?))? closely(?: for me)?(?: please)?$/i.exec(t);
  if (!m) return null;
  const what = String(m[1] || '').trim();
  if (!what) return { cmd: 'watch', chains: null };
  const chains = CHAIN_WORDS.filter(([, re]) => re.test(what)).map(([c]) => c);
  const rest = CHAIN_WORDS.reduce((s, [, re]) => s.replace(new RegExp(re.source, 'gi'), ' '), what).replace(/\b(?:and|or|the|on|new|tokens?|token launches|launches|chains?|coins?|&|,)\b|[,&]/gi, ' ').trim();
  if (rest) return null;   // something else is watched ("watch my kids closely")
  return { cmd: 'watch', chains: chains.length ? chains.slice(0, PAGE.maxChains) : null };
}
