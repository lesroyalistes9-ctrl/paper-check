// PaperCheck build: refreshes every number baked into the page, then writes dist/.
// Run by Netlify on each build (daily via a Cloudflare cron that calls the build hook).
// If any critical fetch fails, the build fails and Netlify keeps the previous deploy live.
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';

const API = process.env.PAPERTRADE_API || 'https://exchange.papertrade.xyz';
const E18 = 1e18;
const num = x => Number(BigInt(x)) / E18;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getJSON(path, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 20000);
      const r = await fetch(API + path, { headers: { accept: 'application/json' }, signal: c.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
      return await r.json();
    } catch (e) { err = e; await sleep(400 * (i + 1)); }
  }
  throw err;
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const r = (x, d = 3) => +Number(x).toFixed(d);

/* ───────── 1. Protocol summary + hourly history ───────── */
async function protocol() {
  const [sum, his, ms] = await Promise.all([getJSON('/query/protocol/summary'), getJSON('/query/protocol/history?interval=1h'), getJSON('/query/protocol/market-stats')]);
  const c = his.columns;
  const i0 = c.volume.findIndex(v => v > 0);
  if (i0 < 0) throw new Error('history: no volume');
  const cut = (k, f, d = 3) => c[k].slice(i0).map(v => r(v / f, d));
  const s = { tvl: cut('tvl', 1e6, 2), rewards: cut('stakingRewards', 1e6), pnl: cut('traderPnl', 1e6), vol: cut('volume', 1e9, 1), users: c.users.slice(i0).map(Math.round), supply: cut('paperSupply', 1e9), staked: cut('paperStaked', 1e9) };
  if (s.tvl.length < 26) throw new Error('history too short');
  const tvlPeak = Math.max(...c.tvl) / 1e6;
  return {
    at: sum.source.at, acc0: String(sum.paper.accumulator),
    start: his.startMs + i0 * his.intervalMs, step: his.intervalMs,
    tvl: r(num(sum.balances.tvl) / 1e6, 2), lp: r(num(sum.paper.trackedLp ?? sum.balances.lp) / 1e6, 3), margin: r(num(sum.balances.margin) / 1e6, 3),
    volume: r(num(sum.activity.volume) / 1e9, 2), open: sum.activity.open, fees: r(num(sum.fees.lifetime) / 1e6, 3),
    supply: r(num(sum.paper.supply) / 1e9, 5), staked: r(num(sum.paper.staked) / 1e9, 5),
    users: s.users[s.users.length - 1], trades: c.trades ? Math.round(c.trades[c.trades.length - 1]) : 0,
    liqVol: c.liquidation ? r(c.liquidation[c.liquidation.length - 1] / 1e9, 1) : 0, tvlPeak: r(tvlPeak, 2),
    vBTC: r(num(ms.markets['0'].volume_24h) / 1e9, 2), vETH: r(num(ms.markets['1'].volume_24h) / 1e9, 2),
    s
  };
}

/* ───────── 2. Leaderboard crawl → distribution ───────── */
async function leaderboard() {
  const first = await getJSON('/state/leaderboard/accounts?page=1');
  const total = first.pageInfo.totalPages;
  const pages = Array.from({ length: total }, (_, i) => i + 1);
  const rows = new Map();
  const add = d => d.accounts.forEach(a => rows.set(a.address, { address: a.address, pnl: num(a.realizedPnl), paper: num(a.paperTotal), vol: num(a.totalVolume), last: a.lastActiveTs, open: a.currentOpenPositionCount }));
  add(first);
  let failed = 0;
  const bad = [];
  await pool(pages.slice(1), 4, async p => { try { add(await getJSON('/state/leaderboard/accounts?page=' + p)); } catch (e) { bad.push(p); } });
  await pool(bad, 2, async p => { try { add(await getJSON('/state/leaderboard/accounts?page=' + p, 6)); } catch (e) { failed++; } });
  log(`leaderboard: ${total} pages, ${rows.size} accounts, ${failed} failed pages`);
  if (failed > total * 0.02) throw new Error('leaderboard: too many failed pages');
  const R = [...rows.values()], n = R.length, now = Date.now() / 1000;
  const pnl = R.map(x => x.pnl), gains = pnl.filter(v => v > 0.01), losses = pnl.filter(v => v < -0.01);
  const winners = gains.length, losers = losses.length, flat = n - winners - losers;
  const sumGains = gains.reduce((a, b) => a + b, 0), sumLosses = losses.reduce((a, b) => a + b, 0);
  const sortedG = [...gains].sort((a, b) => b - a), sortedL = [...losses].sort((a, b) => a - b);
  const share = (arr, k, tot) => arr.slice(0, k).reduce((a, b) => a + b, 0) / tot;
  const paperSorted = R.map(x => x.paper).sort((a, b) => b - a), totP = paperSorted.reduce((a, b) => a + b, 0);
  const big = R.filter(x => x.paper >= 1e6), hedged = R.filter(x => Math.abs(x.pnl) < 1000 && x.paper >= 5e5);
  const bucket = (lo, hi) => pnl.filter(v => v >= lo && v < hi).length;
  const hist = [
    ['< −$10k', pnl.filter(v => v < -1e4).length, 'neg'], ['−$10k to −$1k', bucket(-1e4, -1e3), 'neg'], ['−$1k to −$100', bucket(-1e3, -100), 'neg'],
    ['−$100 to −$10', bucket(-100, -10), 'neg'], ['−$10 to 0', pnl.filter(v => v >= -10 && v < -0.01).length, 'neg'],
    ['≈ 0 (nothing realized)', flat, 'zero'], ['0 to +$10', pnl.filter(v => v > 0.01 && v < 10).length, 'pos'], ['+$10 to +$100', bucket(10, 100), 'pos'],
    ['+$100 to +$1k', bucket(100, 1e3), 'pos'], ['+$1k to +$10k', bucket(1e3, 1e4), 'pos'], ['> +$10k', pnl.filter(v => v >= 1e4).length, 'pos']
  ];
  return {
    n, winners, losers, flat, sumPnl: r(pnl.reduce((a, b) => a + b, 0) / 1e6), sumGains: r(sumGains / 1e6), sumLosses: r(sumLosses / 1e6),
    medianLoss: r(median(losses), 1), medianGain: r(median(gains), 1), p10: r(quantile(pnl, .1), 0), p90: r(quantile(pnl, .9), 2), p99: r(quantile(pnl, .99), 0),
    lose1k: pnl.filter(v => v <= -1e3).length, lose10k: pnl.filter(v => v <= -1e4).length, lose100k: pnl.filter(v => v <= -1e5).length,
    win1k: pnl.filter(v => v >= 1e3).length, win10k: pnl.filter(v => v >= 1e4).length, win100k: pnl.filter(v => v >= 1e5).length,
    top10Win: r(share(sortedG, 10, sumGains)), top1Win: r(share(sortedG, Math.ceil(winners * .01), sumGains)), top1Loss: r(share(sortedL, Math.ceil(losers * .01), sumLosses)),
    paperTop10: r(share(paperSorted, 10, totP)), paperTop100: r(share(paperSorted, 100, totP)), paperTop1: r(share(paperSorted, Math.ceil(n * .01), totP)),
    paperMedian: Math.round(median(R.map(x => x.paper))),
    big: { n: big.length, share: r(big.reduce((a, x) => a + x.paper, 0) / totP), pnl: r(big.reduce((a, x) => a + x.pnl, 0) / 1e6, 1) },
    hedged: { n: hedged.length, share: r(hedged.reduce((a, x) => a + x.paper, 0) / totP) },
    active24h: R.filter(x => now - x.last < 86400).length, withOpen: R.filter(x => x.open > 0).length,
    hist, _active: R.filter(x => x.vol > 0).sort((a, b) => b.last - a.last).slice(0, 300).map(x => x.address)
  };
}

/* ───────── 3. Mint rate + haircut sample ───────── */
async function mint(activeAddrs, atMs) {
  // Pool = the 300 most recently active accounts; 80 picked at random so the last hours are well covered.
  const pick = [...activeAddrs].sort(() => Math.random() - .5).slice(0, 80);
  let trades = 0; const ev = [], hc = [];
  await pool(pick, 4, async a => {
    let d; try { d = await getJSON(`/query/accounts/${a}/trades?filter=all&limit=75`); } catch (e) { return; }
    for (const t of d.items || []) {
      if (!['PositionClosed', 'Liquidated'].includes(t.kind)) continue;
      trades++;
      const minted = num(t.paperMintedRaw || '0'), basis = num(t.paperMintBasisRaw || '0'), pnl = num(t.adjustedPnlRaw || '0'), fee = num(t.userPaidFeeRaw || '0');
      if (minted > 0 && basis > 0) ev.push({ rate: minted / basis, age: (atMs - t.timestampMs) / 3600000 });
      if (t.kind === 'PositionClosed' && pnl > 0 && fee > 0) hc.push(fee / (pnl + fee) * 100);
    }
  });
  if (ev.length < 40) throw new Error('mint sample too small: ' + ev.length);
  const rates = ev.map(e => e.rate);
  const buckets = [['24–30 h ago', 24, 30], ['18–24 h ago', 18, 24], ['12–18 h ago', 12, 18], ['6–12 h ago', 6, 12], ['3–6 h ago', 3, 6], ['last 3 h', 0, 3]];
  const trend = buckets.map(([l, a, b]) => { const x = ev.filter(e => e.age >= a && e.age < b).map(e => e.rate); return x.length ? [l, r(median(x), 1), x.length] : null; }).filter(Boolean);
  // "Now" = median of the 60 most recent mint events (never falls back to old events).
  const byAge = [...ev].sort((a, b) => a.age - b.age);
  const rateNow = r(median(byAge.slice(0, 60).map(e => e.rate)), 1);
  if (byAge[59] && byAge[59].age > 12) throw new Error('mint sample too stale: 60th event is ' + byAge[59].age.toFixed(1) + ' h old');
  const d24 = ev.filter(e => e.age >= 18 && e.age < 30).map(e => e.rate);
  log(`mint: ${trades} trades, ${ev.length} mint events, rateNow ${rateNow}, haircut ${r(median(hc), 1)}%`);
  return { n: ev.length, trades, accounts: pick.length, rateNow, rate24h: r(median(d24.length ? d24 : rates), 1), median: r(median(rates), 1), p10: r(quantile(rates, .1), 1), p90: r(quantile(rates, .9), 1), base: 100, haircut: r(median(hc) ?? 2, 0), trend };
}

/* ───────── Build ───────── */
const t0 = Date.now();
const P = await protocol(); log('protocol ok, at', new Date(P.at).toISOString());
const scan = await leaderboard();
const M = await mint(scan._active, P.at); delete scan._active;
const SNAP = { ...P, mint: M, scan };
let html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
const re = /\/\*@SNAP\*\/[\s\S]*?\/\*@SNAP\*\//;
if (!re.test(html)) throw new Error('template marker missing');
html = html.replace(re, () => '/*@SNAP*/' + JSON.stringify(SNAP) + '/*@SNAP*/');
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', html);
await cp(new URL('../static/', import.meta.url), 'dist/', { recursive: true });
await writeFile('dist/snapshot.json', JSON.stringify({ builtAt: new Date().toISOString(), at: P.at, users: P.users, tvl: P.tvl, mintRateNow: M.rateNow, accounts: scan.n }, null, 1));
log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s · ${scan.n} accounts · mint ${M.rateNow} PAPER/$`);
