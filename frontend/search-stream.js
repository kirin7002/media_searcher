// NDJSON frames may span chunks or share a chunk, including split UTF-8 characters.
export async function readSearchStream(response, onUpdate) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || '搜索失败，请稍后重试');
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) throw new Error('搜索服务未返回分批结果');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let complete = false;
  let result;
  const consume = line => {
    if (!line.trim()) return;
    if (line.length > 2 * 1024 * 1024) throw new Error('搜索结果过大');
    const data = JSON.parse(line);
    if (data.type === 'ping') return;
    if (data.type === 'error') throw new Error(data.error || '搜索连接中断');
    if (!['progress', 'done'].includes(data.type) || !Array.isArray(data.items) || !Array.isArray(data.sources)) throw new Error('搜索结果格式异常');
    data.done = data.type === 'done';
    onUpdate(data);
    if (data.done) { complete = true; result = data; }
  };
  try {
    while (!complete) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while (!complete && (newline = buffer.indexOf('\n')) !== -1) {
        consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      }
      if (buffer.length > 2 * 1024 * 1024) throw new Error('搜索结果过大');
      if (done) {
        if (!complete && buffer.trim()) consume(buffer);
        break;
      }
    }
    if (!complete) throw new Error('部分来源未完成，请重试');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
