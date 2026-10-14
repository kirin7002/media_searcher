export const PLATFORMS = {
  quark: { name: '夸克网盘', short: '夸克', letter: '夸', color: 'purple' },
  baidu: { name: '百度网盘', short: '百度', letter: '百', color: 'blue' },
  aliyun: { name: '阿里云盘', short: '阿里', letter: '阿', color: 'orange' },
  xunlei: { name: '迅雷网盘', short: '迅雷', letter: '迅', color: 'blue' },
  uc: { name: 'UC 网盘', short: 'UC', letter: 'U', color: 'orange' },
  tianyi: { name: '天翼云盘', short: '天翼', letter: '天', color: 'blue' },
  mobile: { name: '移动云盘', short: '移动', letter: '移', color: 'green' },
  '115': { name: '115 网盘', short: '115', letter: '115', color: 'green' },
  '123': { name: '123 云盘', short: '123', letter: '123', color: 'blue' },
  guangya: { name: '光鸭云盘', short: '光鸭', letter: '光', color: 'orange' },
  lanzou: { name: '蓝奏云', short: '蓝奏', letter: '蓝', color: 'blue' },
  weiyun: { name: '微云', short: '微云', letter: '微', color: 'green' }
};

export function safeShareUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    let platform;
    if (host === 'pan.quark.cn') platform = 'quark';
    else if (host === 'pan.baidu.com') platform = 'baidu';
    else if (['www.alipan.com', 'alipan.com', 'www.aliyundrive.com', 'aliyundrive.com'].includes(host)) platform = 'aliyun';
    else if (host === 'pan.xunlei.com') platform = 'xunlei';
    else if (host === 'drive.uc.cn') platform = 'uc';
    else if (host === 'cloud.189.cn') platform = 'tianyi';
    else if (host === 'yun.139.com') platform = 'mobile';
    else if (['115.com', '115cdn.com', 'anxia.com'].includes(host)) platform = '115';
    else if (['123pan.com', 'www.123pan.com', '123pan.cn', 'www.123pan.cn', '123684.com', 'www.123684.com', '123865.com', 'www.123865.com', '123912.com', 'www.123912.com'].includes(host)) platform = '123';
    else if (host === 'pan.guangya.com') platform = 'guangya';
    else if (host === 'share.weiyun.com') platform = 'weiyun';
    else if (/^(?:[a-z0-9-]+\.)?(?:lanzou[a-z]|lanzn|lanznq)\.com$/.test(host)) platform = 'lanzou';
    if (!platform) return null;
    let shareId;
    if (platform === 'tianyi') shareId = url.searchParams.get('code') || url.pathname.match(/\/t\/([^/]+)/)?.[1];
    else if (platform === 'mobile') shareId = url.searchParams.get('linkID') || url.pathname.match(/\/w\/i\/([^/]+)/)?.[1];
    else if (['lanzou', 'weiyun'].includes(platform)) shareId = url.pathname.split('/').filter(Boolean).at(-1);
    else shareId = url.pathname.match(/\/s\/([^/]+)/)?.[1];
    if (!shareId || !/^[a-zA-Z0-9_-]{3,150}$/.test(shareId)) return null;
    const password = url.searchParams.get('pwd') || url.searchParams.get('password') || url.searchParams.get('passCode') || '';
    return { url: url.href, platform, id: `${platform}:${shareId}`, password };
  } catch { return null; }
}

export function mergeItems(items) {
  const map = new Map();
  for (const item of items) {
    const previous = map.get(item.id);
    if (!previous) { map.set(item.id, { ...item, sources: [...(item.sources || [])] }); continue; }
    for (const source of item.sources || []) {
      if (!previous.sources.some(s => s.id === source.id && s.url === source.url && s.password === source.password)) previous.sources.push(source);
    }
    if (!previous.password && item.password) previous.password = item.password;
    for (const key of ['size', 'quality', 'publishedAt', 'description', 'fileCount']) {
      if (!previous[key] && item[key]) previous[key] = item[key];
    }
  }
  return [...map.values()];
}
