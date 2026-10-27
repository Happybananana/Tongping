/**
 * Bangumi v0 transport. Inspired by the supplied 收藏柜 source, rewritten for
 * Tongpin's Vercel serverless search backend.
 * - official origin by default; operator-verified mirrors are OPT IN
 * - delayed hedge + early start on failure
 * - short-lived failure cooling, preferred healthy origin
 * - abort losing requests without treating deliberate cancellation as failure
 * - never forward user cookies/tokens to a mirror
 */
const DEFAULT_ORIGIN = 'https://api.bgm.tv';
const DEFAULT_HEDGE_MS = 900;
const DEFAULT_TIMEOUT_MS = 6500;
const DEFAULT_COOL_MS = 10 * 60_000;

export function parseBangumiBases(env = process.env) {
  const list = String(env.BANGUMI_API_BASES || DEFAULT_ORIGIN)
    .split(',').map(x => x.trim().replace(/\/+$/, '')).filter(Boolean);
  const safe = list.filter(x => {
    try {
      const u = new URL(x);
      return u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash &&
        !u.username && !u.password && !u.port && !!u.hostname && u.hostname !== 'localhost';
    } catch { return false; }
  });
  return [...new Set(safe.length ? safe : [DEFAULT_ORIGIN])].slice(0, 3);
}

export function createBangumiTransport({fetcher = fetch, env = process.env, now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS, hedgeMs = DEFAULT_HEDGE_MS,
  cooldownMs = DEFAULT_COOL_MS} = {}) {
  const state = new Map();
  let preferred = '';
  const ordered = () => {
    const all = parseBangumiBases(env);
    const healthy = all.filter(x => (state.get(x)?.retryAt || 0) <= now());
    // When all origins are cooling down, probe only one to avoid a burst.
    if (!healthy.length) return [all[0]];
    if (preferred && healthy.includes(preferred)) {
      return [preferred, ...healthy.filter(x => x !== preferred)];
    }
    return healthy;
  };

  async function request(path, {method = 'GET', body, headers = {}} = {}) {
    if (!/^\/v0\/(?:search\/subjects|subjects\/\d+)(?:\?[^#]*)?$/.test(path)) {
      throw new Error('Unsupported Bangumi endpoint');
    }
    const bases = ordered();
    const controllers = bases.map(() => new AbortController());
    const start = [];
    const gates = bases.map((_, i) => new Promise(resolve => {start[i] = resolve;}));
    const timers = bases.slice(1).map((_, i) => setTimeout(() => start[i + 1](), hedgeMs * (i + 1)));
    const reqHeaders = {Accept:'application/json', 'User-Agent':String(env.BANGUMI_USER_AGENT || 'Tongpin/0.4.4 (personal-collection)'), ...headers};

    const attempts = bases.map((base,i) => gates[i].then(async () => {
      const ctrl = controllers[i];
      const timer = setTimeout(() => ctrl.abort(new Error('Bangumi request timeout')), timeoutMs);
      try {
        const r = await fetcher(base+path, {method,body,headers:reqHeaders,redirect:'manual',signal:ctrl.signal});
        if (!r.ok) {
          const error = Object.assign(new Error(`Bangumi HTTP ${r.status}`), {upstreamStatus:r.status});
          throw error;
        }
        const data = await r.json();
        state.delete(base); preferred = base;
        return data;
      } catch(err) {
        // Abort after another origin won is not an unhealthy origin.
        if (!ctrl.signal.aborted || ctrl.signal.reason?.message === 'Bangumi request timeout') {
          if (!err?.upstreamStatus || err.upstreamStatus === 403 || err.upstreamStatus === 429 || err.upstreamStatus >= 500) {
            state.set(base,{retryAt:now()+cooldownMs});
          }
        }
        start[i+1]?.();
        throw err;
      } finally {clearTimeout(timer);}
    }));
    start[0]();
    try {
      return await Promise.any(attempts);
    } catch(err) {
      const errors = err instanceof AggregateError ? err.errors : [err];
      throw new Error(`Bangumi 数据源暂不可用：${errors.map(e=>e?.message || String(e)).join('；').slice(0,180)}`);
    } finally {
      timers.forEach(clearTimeout);
      controllers.forEach(c => {if(!c.signal.aborted)c.abort(new Error('hedge completed'));});
    }
  }
  return {request, orderedBases: ordered};
}

const defaultTransport = createBangumiTransport();
export function bangumiRequest(path, opts = {}, options = {}) {
  // For tests or separately configured local service instances.
  if (options.fetcher || options.env) {
    return createBangumiTransport(options).request(path,opts);
  }
  return defaultTransport.request(path,opts);
}
