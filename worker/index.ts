/**
 * Cloudflare Worker: serves the built SPA and proxies the two citation APIs
 * that lack CORS headers (arXiv and ADS). Everything else is a static asset.
 *
 * Same-origin proxying means the browser never needs CORS for these calls,
 * and the user's ADS token is forwarded straight through — never stored server-side.
 */

interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

const UPSTREAMS: Record<string, string> = {
  '/api/arxiv': 'https://export.arxiv.org/api/query',
  '/api/ads': 'https://api.adsabs.harvard.edu/v1/search/query',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    for (const [prefix, upstream] of Object.entries(UPSTREAMS)) {
      if (url.pathname === prefix) {
        const headers = new Headers();
        const auth = request.headers.get('authorization');
        if (auth) headers.set('authorization', auth);

        const upstreamRes = await fetch(upstream + url.search, { headers });
        const body = await upstreamRes.arrayBuffer();
        return new Response(body, {
          status: upstreamRes.status,
          headers: {
            'content-type': upstreamRes.headers.get('content-type') ?? 'application/json',
            'cache-control': 'public, max-age=300',
          },
        });
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
