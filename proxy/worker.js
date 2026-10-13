// PaperCheck — Cloudflare Worker.
// 1) Read-only CORS proxy for a few public routes of the API used by Papertrade's own front end
//    (open CORS, 30 s cache so the upstream is not hit on every visit).
// 2) Daily cron: calls the Netlify build hook (secret BUILD_HOOK) so the site re-crawls the data.
//
// Deploy: upload via the Cloudflare API or paste in the dashboard; set the BUILD_HOOK secret;
// add a cron trigger. In the site: CONFIG.API_PROXY = 'https://<worker>.workers.dev'.
// These upstream routes are not officially documented and may change.

const UPSTREAM = 'https://exchange.papertrade.xyz';
const ALLOW = [
  /^\/query\/protocol\/summary$/,
  /^\/query\/protocol\/history$/,
  /^\/query\/protocol\/market-stats$/,
  /^\/query\/protocol\/queue-summary$/,
  /^\/query\/protocol\/paper\/activity$/
];
const TTL = 30; // seconds

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type'
};

export default {
  // Cron trigger (see schedules): ask Netlify to rebuild the site with fresh data.
  async scheduled(event, env, ctx) {
    if (!env.BUILD_HOOK) return;
    ctx.waitUntil(fetch(env.BUILD_HOOK, { method: 'POST', body: JSON.stringify({ trigger_title: 'daily refresh' }), headers: { 'content-type': 'application/json' } }));
  },

  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

    const url = new URL(request.url);
    if (!ALLOW.some(rx => rx.test(url.pathname))) return new Response('Not found', { status: 404, headers: CORS });

    const upstreamUrl = UPSTREAM + url.pathname + url.search;
    const cache = caches.default;
    const key = new Request(upstreamUrl, { method: 'GET' });

    let res = await cache.match(key);
    if (!res) {
      const up = await fetch(upstreamUrl, { headers: { accept: 'application/json' } });
      res = new Response(up.body, { status: up.status, headers: { 'content-type': up.headers.get('content-type') || 'application/json', 'cache-control': `public, max-age=${TTL}` } });
      if (up.ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    Object.entries(CORS).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  }
};
