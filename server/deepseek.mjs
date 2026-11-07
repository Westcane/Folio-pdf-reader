import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { TRANSLATION_PROMPT } from './prompt.mjs';

export const DEFAULT_MODEL = 'deepseek-flash';
export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const MAX_TEXT = 16000;
const MAX_BODY = 100000;
const kinds = new Set(['title', 'heading', 'chapter', 'paragraph', 'list-item', 'caption', 'footnote', 'equation', 'reference']);
const fail = (status, message) => Object.assign(new Error(message), { status });

async function readBody(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw fail(413, '请求过大，请按段落翻译。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail(400, '请求必须是有效 JSON。'); }
}

/** Loopback-only companion API, accessed through Vite's same-origin proxy.
 * fetchImpl is injectable so tests never contact a paid provider. */
export function createTranslationServer({ apiKey = '', model = DEFAULT_MODEL, fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  const promptVersion = createHash('sha256').update(TRANSLATION_PROMPT).digest('hex').slice(0, 12);
  const provider = `deepseek:${model}:${promptVersion}`;
  let active = false;
  return createServer(async (request, response) => {
    const send = (status, body) => {
      if (response.destroyed) return;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    let path, hostname;
    try {
      path = new URL(request.url ?? '/', 'http://localhost').pathname;
      hostname = new URL(`http://${request.headers.host ?? 'invalid'}`).hostname.replace(/^\[|\]$/g, '');
    } catch { return send(400, { error: '请求地址无效。' }); }
    if (path !== '/api/translation' && path !== '/api/translation/status') return send(404, { error: '接口不存在。' });
    // Do not enable CORS. JSON + Origin checks also reject cross-site spending requests.
    const origin = request.headers.origin;
    if (hostname !== 'localhost' && !hostname.endsWith('.localhost') && !isIP(hostname))
      return send(403, { error: '本机代理只接受 localhost 或局域网 IP 地址。' });
    if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`)
      return send(403, { error: '只接受阅读器的同源请求。' });
    if (path.endsWith('/status') && request.method === 'GET')
      return send(200, { configured: !!apiKey.trim(), provider, model, maxCharacters: MAX_TEXT });
    if (path !== '/api/translation' || request.method !== 'POST') return send(405, { error: '请求方法不支持。' });
    if (!request.headers['content-type']?.startsWith('application/json')) return send(415, { error: '需要 application/json。' });
    if (!apiKey.trim()) return send(503, { error: '尚未配置 DeepSeek Key。请在 .env.local 填写 DEEPSEEK_API_KEY，然后重启翻译服务。' });
    if (active) return send(429, { error: '翻译服务正在处理另一段，请稍后重试。' });
    const controller = new AbortController();
    const disconnect = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close', disconnect);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let acquired = false;
    try {
      const input = await readBody(request);
      if (!input || typeof input.text !== 'string' || !input.text.trim()) throw fail(400, '原文不能为空。');
      if (input.text.length > MAX_TEXT) throw fail(413, `该段超过 ${MAX_TEXT} 字符，请先核对原页；暂不自动切碎翻译。`);
      if (input.targetLanguage !== 'zh-CN') throw fail(400, '当前只支持简体中文。');
      if (input.provider !== provider) throw fail(409, '模型或 prompt 已改变，请刷新翻译连接后重试。');
      if (active) throw fail(429, '翻译服务正在处理另一段，请稍后重试。');
      active = acquired = true;
      const upstream = await fetchImpl(DEEPSEEK_URL, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({ model, stream: false, thinking: { type: 'disabled' }, temperature: 0.3, max_tokens: 8192,
          messages: [ { role: 'system', content: TRANSLATION_PROMPT },
            { role: 'user', content: JSON.stringify({ blockKind: kinds.has(input.kind) ? input.kind : 'paragraph', sourceText: input.text }) } ] }),
      });
      if (!upstream.ok) {
        // Never forward upstream bodies: they may contain source text or credentials.
        await upstream.body?.cancel();
        const messages = { 401: 'DeepSeek Key 无效，请检查服务端配置。', 402: 'DeepSeek 余额不足，请检查账户。', 429: 'DeepSeek 请求过于频繁，请稍后手动重试。' };
        throw fail(upstream.status === 429 ? 429 : 502, messages[upstream.status] ?? `DeepSeek 暂时不可用（HTTP ${upstream.status}），请稍后重试。`);
      }
      const result = await upstream.json();
      const choice = result?.choices?.[0];
      if (choice?.finish_reason === 'length') throw fail(502, '译文超过输出上限，未保存不完整译文。请核对此段或调整服务端输出上限。');
      if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || !choice.message.content.trim())
        throw fail(502, 'DeepSeek 未返回完整译文，请稍后重试。');
      send(200, { text: choice.message.content.trim(), provider });
    } catch (error) {
      send(error.status ?? (controller.signal.aborted ? 504 : 502), { error: error.status ? error.message : controller.signal.aborted ? '翻译已取消或超时，请稍后重试。' : '无法连接 DeepSeek，请检查电脑网络后重试。' });
    } finally {
      clearTimeout(timeout);
      response.off('close', disconnect);
      if (acquired) active = false;
    }
  });
}
