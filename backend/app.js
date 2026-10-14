import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createProviders, UpstreamError } from './providers.js';
import { createSearchService, InputError } from './search.js';
import { loadConfig } from './config.js';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/shared.js': ['shared.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml']
};
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Frame-Options': 'DENY'
};

function json(res, status, value, extra = {}) {
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new InputError('请使用 application/json', 415);
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16384) throw new InputError('请求内容过大', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new InputError('JSON 格式不正确'); }
}

export function createApp({ config = loadConfig(), fetchImpl = fetch, providers } = {}) {
  const service = createSearchService(providers || createProviders(config, fetchImpl), config);
  const visitors = new Map();
  const startedAt = new Date().toISOString();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { status: 'ok', version: '1.0.0', startedAt, enabledSources: service.sources().filter(s => s.enabled).map(s => s.id) });
      if (url.pathname === '/api/sources' && req.method === 'GET') return json(res, 200, { sources: service.sources(), checkingEnabled: service.sources().some(s => s.supportsCheck) });
      if (url.pathname === '/api/search' || url.pathname === '/api/check') {
        const method = url.pathname === '/api/search' ? 'GET' : 'POST';
        if (req.method !== method) return json(res, 405, { error: '请求方法不支持' }, { Allow: method });
        if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}` && new URL(req.headers.origin).host !== req.headers.host) throw new InputError('不接受跨站请求', 403);
        const address = config.trustProxy ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
        const now = Date.now();
        const window = visitors.get(address);
        if (!window || now >= window.expires) {
          visitors.set(address, { count: 1, expires: now + 60000 });
          if (visitors.size > 10000) for (const [key, value] of visitors) if (now >= value.expires) visitors.delete(key);
          if (visitors.size > 10000) visitors.delete(visitors.keys().next().value);
        } else {
          if (window.count >= config.rateLimit) return json(res, 429, { error: '请求较多，请一分钟后再试' }, { 'Retry-After': String(Math.ceil((window.expires - now) / 1000)) });
          window.count++;
        }
        if (url.pathname === '/api/search') {
          const result = await service.search(url.searchParams);
          return json(res, result.failed ? 502 : 200, result);
        }
        return json(res, 200, await service.check(await readJson(req)));
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: '接口不存在' });
      const asset = assets[url.pathname];
      if (!asset) return json(res, 404, { error: '页面不存在' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '请求方法不支持' }, { Allow: 'GET, HEAD' });
      const content = await readFile(new URL(`../frontend/${asset[0]}`, import.meta.url));
      res.writeHead(200, { ...headers, 'Content-Type': asset[1], 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const status = error instanceof InputError ? error.status : error instanceof UpstreamError ? 502 : 500;
      json(res, status, { error: status === 500 ? '服务暂时发生错误，请稍后重试' : error.message });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
