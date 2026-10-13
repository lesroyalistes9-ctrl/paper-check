// Daily share image + ready-to-post text, generated from the same SNAP the page gets.
// Output: dist/daily.png (1200x675, X-friendly) and dist/daily.txt.
import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const F = {
  paper: '#EBE0CC', ink: '#24231F', red: '#B14E30', muted: '#6F685C', surface: '#F4EEE3', fold: '#DED2BC', line: '#CFC3AF', green: '#4F7A55'
};
const fmt = (x, d = 0) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function dailyStats(SNAP) {
  const s = SNAP.s, n = s.rewards.length, last = n - 1, prev = Math.max(0, n - 25);
  const y24 = ((s.rewards[last] - s.rewards[prev]) * 1e6) / (((s.staked[prev] + s.staked[last]) / 2) * 1e9) / ((last - prev) / 24);
  const yDay1 = n >= 25 ? ((s.rewards[24] - s.rewards[0]) * 1e6) / (((s.staked[0] + s.staked[24]) / 2) * 1e9) : y24;
  const loss = -s.pnl[last], dLoss = s.pnl[prev] - s.pnl[last], rew = s.rewards[last], dRew = s.rewards[last] - s.rewards[prev];
  const growth = (s.supply[last] - s.supply[prev]) / s.supply[prev];
  const D = SNAP.scan, M = SNAP.mint;
  const paper1k = 1000 * M.rateNow, daily1k = paper1k * y24, q = 1 / (1 + growth), cap1k = growth > 0 ? daily1k / (1 - q) : Infinity;
  return {
    date: new Date(SNAP.at), y24, yDay1, loss, dLoss, rew, dRew, growth, mint: M.rateNow, mint24h: M.rate24h, haircut: M.haircut,
    tvl: SNAP.tvl, users: SNAP.users, winPct: D.winners / D.n, losePct: D.losers / D.n, medianLoss: D.medianLoss, medianGain: D.medianGain,
    top1Win: D.top1Win, paperTop1: D.paperTop1, accounts: D.n, daily1k, cap1k, payback1k: daily1k > 0 ? 1000 / daily1k : Infinity
  };
}

function card(x, y, w, h, eyebrow, big, unit, cap, hot) {
  const fold = 26;
  return `
  <g>
    <path d="M${x},${y} H${x + w - fold} L${x + w},${y + fold} V${y + h} H${x} Z" fill="${F.surface}" stroke="${F.ink}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M${x + w - fold},${y} V${y + fold} H${x + w}" fill="${hot ? F.red : F.fold}" stroke="${F.ink}" stroke-width="2.5" stroke-linejoin="round"/>
    <text x="${x + 26}" y="${y + 42}" font-family="IBM Plex Mono" font-size="17" letter-spacing="1.6" fill="${F.muted}">${esc(eyebrow.toUpperCase())}</text>
    <text x="${x + 26}" y="${y + 104}" font-family="Inter" font-weight="600" font-size="52" fill="${F.ink}">${esc(big)}<tspan font-size="22" font-weight="400" fill="${F.muted}" dx="8">${esc(unit)}</tspan></text>
    <text x="${x + 26}" y="${y + 142}" font-family="Inter" font-size="17" fill="${F.muted}">${esc(cap)}</text>
  </g>`;
}

export function dailySvg(SNAP) {
  const d = dailyStats(SNAP);
  const dateStr = d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const W = 1200, H = 675;
  const cards = [
    ['Yield per PAPER', '$' + fmt(d.y24, 5), '/day', `Launch day: $${fmt(d.yDay1, 4)} · ${fmt(d.yDay1 / d.y24, 0)}× lower`, true],
    ['Mint rate', fmt(d.mint, 1), 'PAPER / $ lost', `Docs: 100 · a day ago: ${fmt(d.mint24h, 1)}`],
    ['Net trader losses', '$' + fmt(d.loss, 1), 'M', `+$${fmt(d.dLoss, 1)}M in 24 h`],
    ['Paid to stakers', '$' + fmt(d.rew, 1), 'M', `${fmt(d.rew / d.loss * 100, 0)}% of losses · +$${fmt(d.dRew, 1)}M in 24 h`],
    ['PAPER supply', '+' + fmt(d.growth * 100, 1), '% / 24 h', `New PAPER dilutes every holder`],
    ['$1,000 dry loss', isFinite(d.cap1k) ? '$' + fmt(d.cap1k, 0) : '∞', 'max back', `~$${fmt(d.daily1k, 0)}/day now, shrinking daily`, true]
  ];
  const cw = 356, ch = 170, gx = 28, gy = 24, x0 = 48, y0 = 150;
  let g = '';
  cards.forEach((c, i) => { g += card(x0 + (i % 3) * (cw + gx), y0 + Math.floor(i / 3) * (ch + gy), cw, ch, ...c); });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${F.paper}"/>
  <g transform="translate(48,44)">
    <g transform="scale(1.55)"><path d="M4 4h17l7 7v17H4z" fill="${F.surface}" stroke="${F.ink}" stroke-width="2.4" stroke-linejoin="round"/><path d="M21 4v7h7" fill="${F.fold}" stroke="${F.ink}" stroke-width="2.4" stroke-linejoin="round"/><path d="M10 19l4 4 8-9" fill="none" stroke="${F.red}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>
    <text x="64" y="34" font-family="Inter" font-weight="600" font-size="30" fill="${F.ink}">PaperCheck</text>
    <text x="236" y="34" font-family="IBM Plex Mono" font-size="17" letter-spacing="1.6" fill="${F.muted}">· DAILY</text>
  </g>
  <text x="${W - 48}" y="78" text-anchor="end" font-family="IBM Plex Mono" font-size="17" letter-spacing="1" fill="${F.muted}">${esc(dateStr.toUpperCase())} · ${fmt(d.accounts)} ACCOUNTS SCANNED</text>
  <line x1="48" x2="${W - 48}" y1="112" y2="112" stroke="${F.line}" stroke-width="2" stroke-dasharray="4 6"/>
  ${g}
  <text x="48" y="${H - 62}" font-family="Inter" font-size="18" fill="${F.muted}">Traders lose, PAPER gets minted, stakers get paid from the next losses.</text>
  <text x="48" y="${H - 36}" font-family="IBM Plex Mono" font-size="15" letter-spacing="1.2" fill="${F.muted}">ON-CHAIN · INDEPENDENT · NOT ADVICE</text>
  <text x="${W - 48}" y="${H - 42}" text-anchor="end" font-family="IBM Plex Mono" font-weight="500" font-size="22" letter-spacing="1" fill="${F.ink}">paper-check.xyz</text>
</svg>`;
}

export function dailyText(SNAP) {
  const d = dailyStats(SNAP);
  const dateStr = d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `PaperCheck daily · ${dateStr}

Yield: $${fmt(d.y24, 5)} per PAPER per day (${fmt(d.yDay1 / d.y24, 0)}× below launch day)
Mint: ${fmt(d.mint, 1)} PAPER per $ lost (docs say 100)
Net trader losses: $${fmt(d.loss, 1)}M (+$${fmt(d.dLoss, 1)}M in 24 h)
Paid to stakers: $${fmt(d.rew, 1)}M
Supply: +${fmt(d.growth * 100, 1)}% in 24 h

A $1,000 dry loss gets back at most ~$${isFinite(d.cap1k) ? fmt(d.cap1k, 0) : '∞'} at today's pace.

Check your wallet: paper-check.xyz
`;
}

export async function writeDaily(SNAP, outDir, fontDir) {
  const svg = dailySvg(SNAP);
  const r = new Resvg(svg, { font: { fontFiles: [fontDir + 'Inter-Regular.ttf', fontDir + 'Inter-SemiBold.ttf', fontDir + 'IBMPlexMono-Medium.ttf'], loadSystemFonts: false, defaultFontFamily: 'Inter' }, fitTo: { mode: 'width', value: 1200 } });
  await writeFile(outDir + 'daily.png', r.render().asPng());
  await writeFile(outDir + 'daily.svg', svg);
  await writeFile(outDir + 'daily.txt', dailyText(SNAP));
}

// Standalone: node scripts/daily.mjs dist/index.html  (reads the SNAP baked into a built page)
if (process.argv[1] && process.argv[1].endsWith('daily.mjs')) {
  const html = await readFile(process.argv[2] || 'dist/index.html', 'utf8');
  const SNAP = JSON.parse(html.match(/\/\*@SNAP\*\/([\s\S]*?)\/\*@SNAP\*\//)[1]);
  await writeDaily(SNAP, 'dist/', new URL('../assets/fonts/', import.meta.url).pathname);
  console.log('daily.png written');
}
