import { existsSync } from 'node:fs';
import { createTranslationServer, DEFAULT_MODEL } from './deepseek.mjs';

// Native Node 22 env loading; never use a VITE_ variable for a private API key.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const server = createTranslationServer({ apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL });
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? '翻译端口 8787 已被占用，请检查是否已经启动了翻译服务。' : `翻译服务启动失败：${error.code ?? 'unknown'}`);
  process.exitCode = 1;
});
server.listen(8787, '127.0.0.1', () => {
  console.log('DeepSeek 翻译代理：http://127.0.0.1:8787（通过阅读器同源访问）');
  console.log(process.env.DEEPSEEK_API_KEY ? '已读取 Key；只在点击翻译时调用 API。' : '未配置 Key；请填写 .env.local 后重启此服务。');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(); server.closeAllConnections();
});
