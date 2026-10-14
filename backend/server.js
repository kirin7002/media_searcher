import { createApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const server = createApp({ config });
  server.listen(config.port, config.host, () => console.log(`Media Searcher ready: http://${config.host}:${config.port}`));
  server.on('error', error => { console.error(`启动失败：${error.code || error.message}`); process.exitCode = 1; });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5000).unref();
  });
} catch (error) { console.error(`配置错误：${error.message}`); process.exitCode = 1; }
