function integer(env, key, fallback, min, max) {
  const value = Number(env[key] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} 必须在 ${min} 到 ${max} 之间`);
  return value;
}

function baseUrl(value, fallback = '') {
  const text = String(value || fallback).trim();
  if (!text) return '';
  const parsed = new URL(text);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('来源地址必须是 HTTP(S) 根地址，不能包含凭据、查询或片段');
  return parsed.href;
}

export function loadConfig(env = process.env) {
  const channels = [...new Set((env.TELEGRAM_CHANNELS ?? 'Aliyun_4K_Movies,Quark_Movies').split(',').map(s => s.trim()).filter(Boolean))];
  if (channels.length > 5 || channels.some(s => !/^[A-Za-z0-9_]{5,64}$/.test(s))) throw new Error('TELEGRAM_CHANNELS 最多配置 5 个合法的公开频道用户名');
  return {
    host: env.HOST || '127.0.0.1',
    port: integer(env, 'PORT', 3210, 1, 65535),
    timeoutMs: integer(env, 'SOURCE_TIMEOUT_MS', 12000, 100, 120000),
    haisouTimeoutMs: integer(env, 'HAISOU_TIMEOUT_MS', 65000, 1000, 120000),
    cacheTtlMs: integer(env, 'CACHE_TTL_SECONDS', 120, 0, 3600) * 1000,
    rateLimit: integer(env, 'RATE_LIMIT_PER_MINUTE', 60, 1, 10000),
    trustProxy: env.TRUST_PROXY === 'true',
    pansousuoBaseUrl: baseUrl(env.PANSOUSUO_BASE_URL, 'https://www.pansousuo.com'),
    pansearchBaseUrl: baseUrl(env.PANSEARCH_BASE_URL, 'https://www.pansearch.me'),
    rrdynbBaseUrl: baseUrl(env.RRDYNB_BASE_URL, 'https://www.rrdynb.com'),
    telegramChannels: channels,
    disabledSources: (env.DISABLED_SOURCES || '').split(',').map(s => s.trim()).filter(Boolean),
    pansouBaseUrl: baseUrl(env.PANSOU_BASE_URL),
    pansouToken: env.PANSOU_TOKEN || '',
    haisouApiKey: env.HAISOU_API_KEY || '',
    tmdbToken: env.TMDB_READ_ACCESS_TOKEN || '',
    tmdbApiKey: env.TMDB_API_KEY || '',
    discoverTimezone: env.DISCOVER_TIMEZONE || 'Asia/Shanghai'
  };
}
