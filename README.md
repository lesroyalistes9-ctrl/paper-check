# PaperCheck

Independent, read-only analytics for the [Papertrade](https://exchange.papertrade.xyz) protocol: wallet check, farm simulator, protocol numbers and account distribution. Live at **https://paper-check.xyz**.

## How it stays fresh

- **At every visit** (in the visitor's browser): circulating / staked PAPER and wallet data come straight from the HyperEVM RPC; protocol KPIs and charts come from Papertrade's public API through a small CORS proxy (`proxy/worker.js`, a Cloudflare Worker with a 30 s cache).
- **Daily** (Netlify build): `scripts/build.mjs` crawls the full public leaderboard, samples recent trades to measure the mint rate and the haircut, and bakes everything into `dist/index.html`. A Cloudflare cron calls the Netlify build hook once a day. If a fetch fails, the build fails and the previous deploy stays live.

## Layout

```
src/index.html      page template (the /*@SNAP*/ block is replaced at build time)
static/             icons and the share image
scripts/build.mjs   data refresh + build (Node 20, no dependencies)
proxy/worker.js     Cloudflare Worker: CORS proxy + daily cron trigger
netlify.toml        build command and publish directory
```

## Run locally

```
node scripts/build.mjs   # ~1 min, writes dist/
npx serve dist           # or open dist/index.html
```

PaperCheck is not affiliated with Papertrade, Hyperliquid or PaperStrategy. Nothing here is financial advice.
