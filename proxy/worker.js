// PaperCheck — proxy CORS optionnel (Cloudflare Workers).
// Sert en lecture seule quelques routes publiques de l'API consommée par le front de Papertrade,
// avec CORS ouvert et un cache de 30 s pour ne pas la solliciter à chaque visite.
//
// Déploiement : Workers & Pages > Create > coller ce fichier > Deploy.
// Puis dans papercheck.html : CONFIG.API_PROXY = 'https://<ton-worker>.workers.dev'
//
// À savoir : ces routes ne sont pas documentées officiellement et peuvent changer ou être limitées.

const UPSTREAM = 'https://exchange.papertrade.xyz';
const ALLOW = [
  /^\/query\/protocol\/summary$/,
  /^\/query\/protocol\/history$/,
  /^\/query\/protocol\/market-stats$/,
  /^\/query\/protocol\/queue-summary$/,
  /^\/query\/protocol\/paper\/activity$/
];
const TTL = 30; // secondes

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type'
};

export default {
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
