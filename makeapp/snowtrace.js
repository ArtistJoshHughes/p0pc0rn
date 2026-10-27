// snowtrace.js - p0pc0rn 3.9 (Wallet Watch): the online source 'chain.snowtrace' = Snowtrace, the public Avalanche explorer (run by
// Routescan; its API is free with no key and no account: 2 requests a second, 10,000 a day). Read only, Avalanche C-Chain mainnet
// (chain 43114), through Routescan's Etherscan-style API at api.routescan.io (routescan.io/docs). Like every source in sources.js, the
// HOST fetches it, never the app: an app asks with p0.fetch('chain.snowtrace', {op, ...}) and gets small, checked rows back. What goes out
// is only the public addresses the person added in the app (and, for Juli's notes on a wallet's habits, the addresses it deals with
// most, for their public labels): no key, no account, no cookie, no name. Every request goes through the hard cap in budget.js (half of
// the free limits for every app on the phone together, and a ceiling for one app), and an app that reads it is checked only when the
// phone is idle (idleOnly: the host's rule, makeapp/host.js). Data from it says "Powered by Routescan.io APIs" (their terms, 5.1), with
// links to routescan.io and Routescan's X account (ui/storefront_core.js SOURCE_CREDITS: the host shows them, never the app).
//   op 'watch'    {items: [{address, kind: 'wallet' | 'contract', since}]} (1-5): the balances (one request for all), then per address its
//                 transactions, token transfers and (a wallet) internal transfers from block `since` (none: a first look at its newest
//                 rows) -> {balances: {address: wei}, items: [{address, kind, first, txs, tok, int, full, done}], stopped}
//   op 'history'  {address}: its newest 100 transactions, 100 token transfers and 50 internal transfers (for its habits)
//   op 'contract' {address}: {verified, name, compiler, proxy, impl, license} from its verified source (a proxy's implementation)
//   op 'labels'   {addresses} (1-6): the explorer's public name tags, only for organisations and contracts (a DEX, a token, a pool):
//                 a tag that could name a person is never passed on
// A request the cap refuses (or one a check makes once the phone got busy: BUSY) is never sent; 'watch' then answers with what came back
// and why it stopped (stopped: {code, until}).
import { SNOWTRACE_CAP } from './budget.js';

export const API = 'https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api';
export const PAGE = { first: 25, next: 100, history: 100, historyInt: 50, labels: 6, items: 5 };
const END = '999999999';   // the last block asked for (Avalanche is near block 99 million; Etherscan's own examples stop at 99,999,999)
const CAPS = new Set(['DAILY_CAP', 'APP_CAP', 'BACKOFF', 'RATE_LIMIT', 'BUSY']);   // nothing was sent: what came back so far counts
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const bad = (m) => Object.assign(new Error(m), { code: 'BAD_PARAMS' });
const addr = (a) => { const s = String(a == null ? '' : a).trim(); if (!ADDR.test(s)) throw bad('not an Avalanche C-Chain address: ' + s.slice(0, 50)); return s.toLowerCase(); };
const lowAddr = (a) => (ADDR.test(String(a == null ? '' : a)) ? String(a).toLowerCase() : '');
const digits = (v) => (/^\d{1,78}$/.test(String(v)) ? String(v).replace(/^0+(?=\d)/, '') : '0');
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : 0; };
const hash = (h) => (/^0x[0-9a-fA-F]{64}$/.test(String(h)) ? String(h).toLowerCase() : '');
const fnName = (s) => String(s == null ? '' : s).split('(')[0].replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
const plain = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** a token's symbol as the explorer gives it, only when it looks like a symbol: spam tokens put messages and web addresses there */
export function cleanSym(s) {
  s = String(s == null ? '' : s).trim();
  if (!s || /[\s/:@]|https?|www\.|\.(com|io|net|org|xyz|app|gg|co|me|info|site|live|top|vip|claims?)\b/i.test(s)) return '';
  return s.replace(/[^A-Za-z0-9.$_+-]/g, '').slice(0, 12);
}
/** an account list answer -> its rows ([] when there is nothing); an error answer throws NO_DATA */
export function listOf(d) {
  if (d && Array.isArray(d.result)) return d.result;
  if (d && d.status === '0' && /no (transactions|records|token transfers)/i.test(String(d.message || ''))) return [];
  throw Object.assign(new Error('Snowtrace answered: ' + plain((d && (typeof d.result === 'string' ? d.result : d.message)) || 'nothing', 80)), { code: 'NO_DATA' });
}
const tx = (r) => ({ h: hash(r.hash), b: int(r.blockNumber), t: int(r.timeStamp), f: lowAddr(r.from), to: lowAddr(r.to) || lowAddr(r.contractAddress), v: digits(r.value), fn: fnName(r.functionName), err: r.isError === '1' || r.txreceipt_status === '0' });
const tok = (r) => ({ h: hash(r.hash), b: int(r.blockNumber), t: int(r.timeStamp), f: lowAddr(r.from), to: lowAddr(r.to), v: digits(r.value), c: lowAddr(r.contractAddress), sym: cleanSym(r.tokenSymbol), dec: Math.min(36, int(r.tokenDecimal)) });
const itx = (r) => ({ h: hash(r.hash), b: int(r.blockNumber), t: int(r.timeStamp), f: lowAddr(r.from), to: lowAddr(r.to), v: digits(r.value), err: r.isError === '1' });

/** getsourcecode -> {verified, name, compiler, proxy, impl, license} */
export function contractOf(d) {
  if (!d || !Array.isArray(d.result)) throw Object.assign(new Error('Snowtrace answered: ' + plain(d && d.result, 80)), { code: 'NO_DATA' });
  const r = d.result[0] || {}, src = String(r.SourceCode || ''), abi = String(r.ABI || '');
  return { verified: !!src.trim() || (abi.trim().startsWith('[') && !/not verified/i.test(abi)), name: plain(r.ContractName, 40).replace(/[^A-Za-z0-9_ .-]/g, ''),
    compiler: plain(r.CompilerVersion, 40), proxy: String(r.Proxy) === '1', impl: lowAddr(r.Implementation), license: plain(r.LicenseType, 20) };
}
// the explorer's own categories that name an organisation or a contract, never a person: only these let a public name tag through
const ORG = /^(erc20|erc721|erc1155|erc4626|token|tokens|wrapped_token|stablecoin|bridged|bridge|dex|dex_router|router|aggregator|liquidity_pool|pool|lending|staking|liquid_staking|yield|vault|oracle|exchange|cex|multisig|burn|dao|treasury|protocol|validator|nft|nft_marketplace|marketplace|launchpad|gaming|defi|factory|precompile|system|wallet_factory)$/;
/** a getaddresstag result -> the name tag, or '' (no tag, a tag with no organisation category, or one with a web address in it) */
export function tagOf(r) {
  if (!r || typeof r !== 'object') return '';
  const t = plain(r.nametag, 60).replace(/^(.+): \1$/, '$1'), cats = (Array.isArray(r.labels) ? r.labels : []).map((x) => String(x).toLowerCase());   // "Wrapped AVAX: Wrapped AVAX" once
  return t && !/https?|www\.|@/i.test(t) && cats.some((c) => ORG.test(c)) ? t : '';
}

const q = (get, params) => get(API + '?' + new URLSearchParams(params).toString());
const acct = (action, address, since, offset) => ({ module: 'account', action, address, startblock: String(since || 0), endblock: END, page: '1', offset: String(offset), sort: 'desc' });

async function watch(p, get) {
  const items = Array.isArray(p.items) ? p.items : [];
  if (!items.length || items.length > PAGE.items) throw bad(`items: 1 to ${PAGE.items} addresses`);
  const list = items.map((it) => ({ address: addr(it && it.address), kind: it && it.kind === 'contract' ? 'contract' : 'wallet', since: Number.isInteger(it && it.since) && it.since > 0 ? it.since : null }));
  const out = { balances: {}, items: [], stopped: null };
  try {
    const bal = listOf(await q(get, { module: 'account', action: 'balancemulti', address: [...new Set(list.map((x) => x.address))].join(','), tag: 'latest' }));
    for (const r of bal) { const a = lowAddr(r && r.account); if (a) out.balances[a] = digits(r.balance); }
    for (const it of list) {
      const n = it.since ? PAGE.next : PAGE.first, row = { address: it.address, kind: it.kind, first: !it.since, txs: [], tok: [], int: [], full: {}, done: false };
      out.items.push(row);   // what came back so far counts, even when the cap stops the rest
      row.txs = listOf(await q(get, acct('txlist', it.address, it.since, n))).map(tx); row.full.txs = row.txs.length >= n;
      row.tok = listOf(await q(get, acct('tokentx', it.address, it.since, n))).map(tok); row.full.tok = row.tok.length >= n;
      if (it.kind === 'wallet') { row.int = listOf(await q(get, acct('txlistinternal', it.address, it.since, n))).map(itx); row.full.int = row.int.length >= n; }
      row.done = true;
    }
  } catch (e) {
    if (!CAPS.has(e && e.code)) throw e;
    out.stopped = { code: e.code, until: +e.until || 0, message: plain(e.message, 160) };
  }
  return out;
}
async function history(p, get) {
  const a = addr(p.address);
  return { address: a, txs: listOf(await q(get, acct('txlist', a, 0, PAGE.history))).map(tx), tok: listOf(await q(get, acct('tokentx', a, 0, PAGE.history))).map(tok),
    int: listOf(await q(get, acct('txlistinternal', a, 0, PAGE.historyInt))).map(itx) };
}
async function contract(p, get) { const a = addr(p.address); return Object.assign({ address: a }, contractOf(await q(get, { module: 'contract', action: 'getsourcecode', address: a }))); }
async function labels(p, get) {
  const list = [...new Set((Array.isArray(p.addresses) ? p.addresses : []).map(addr))];
  if (!list.length || list.length > PAGE.labels) throw bad(`addresses: 1 to ${PAGE.labels}`);
  const out = [];
  for (const a of list) { const d = await q(get, { module: 'nametag', action: 'getaddresstag', address: a }); out.push({ address: a, tag: tagOf(d && d.result) }); }
  return { labels: out };
}

const OPS = { watch, history, contract, labels };
const TTL = { watch: 20e3, history: 6 * 3600e3, contract: 12 * 3600e3, labels: 7 * 864e5 };
export const SNOWTRACE = {
  label: 'Snowtrace, the public Avalanche explorer', host: 'api.routescan.io', attribution: 'Snowtrace (Routescan)', powered: 'Powered by Routescan.io APIs',
  ttl: (p) => TTL[p && p.op] || 20e3, perMin: 12, budget: SNOWTRACE_CAP,
  idleOnly: true,   // the host checks an app that reads it only when the phone is idle (no job in the queue, Juli not answering)
  /** the API's own "too many" answer (it may come with HTTP 200): the fetcher treats it as a 429 */
  rateLimited: (d) => !!d && String(d.status) === '0' && /rate limit/i.test(String(d.result || d.message || '')),
  async get(p, get) { const f = OPS[p && p.op]; if (!f) throw bad('op: watch, history, contract or labels'); return f(p, get); },
};
