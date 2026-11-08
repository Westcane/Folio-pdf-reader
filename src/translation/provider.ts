import {
  PARSER_REVISION,
  type ReadingBlock,
  type TranslationProvider,
  type TranslationResult,
} from "../types";
import { db } from "../storage/db";
import { validateDeepSeekConfig, type DeepSeekConfig } from "./config";
import { TRANSLATION_PROMPT } from "./prompt";

export function translationKey(
  result: Omit<TranslationResult, "text" | "updatedAt">,
): string {
  return JSON.stringify([
    result.bookId,
    result.blockId,
    result.sourceRevision,
    result.targetLanguage,
    result.provider,
  ]);
}
/** Shared paragraph queue/cache contract; credentials never enter translation records. */
export async function translateBlock(
  provider: TranslationProvider,
  bookId: string,
  block: ReadingBlock,
  force = false,
  signal?: AbortSignal,
  sourceRevision = PARSER_REVISION,
) {
  const input = {
    bookId,
    block,
    sourceRevision,
    targetLanguage: "zh-CN",
    signal,
  };
  const key = translationKey({
    ...input,
    blockId: block.id,
    provider: provider.id,
  });
  if (!force) {
    const cached = await db.translations.get(key);
    if (cached) return cached;
  }
  const result = await provider.translate(input);
  if (signal?.aborted)
    throw new DOMException("Translation aborted", "AbortError");
  await db.translations.put({ ...result, key });
  return result;
}

export interface DeepSeekStatus {
  configured: boolean;
  provider: string;
  model: string;
  maxCharacters: number;
}

// A prompt-only fingerprint works on LAN HTTP too and never includes a user's key.
const promptVersion = (() => {
  let hash = 2166136261;
  for (const character of TRANSLATION_PROMPT) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
})();
export function getDeepSeekStatus(config: DeepSeekConfig): DeepSeekStatus {
  return { configured: !!config.apiKey, provider: `deepseek:${config.model}:${promptVersion}`, model: config.model, maxCharacters: 16000 };
}

function httpError(status: number): Error {
  const messages: Record<number, string> = {
    400: "DeepSeek 请求格式无效（HTTP 400）。", 401: "DeepSeek API Key 无效（HTTP 401），请在 API 设置中检查密钥。",
    402: "DeepSeek 余额不足（HTTP 402），请检查自己的账户额度。", 403: "DeepSeek 拒绝访问（HTTP 403），请检查密钥权限。",
    422: "DeepSeek 模型或请求参数无效（HTTP 422）。", 429: "DeepSeek 请求限速（HTTP 429），请稍后手动重试。",
  };
  return new Error(messages[status] ?? `DeepSeek 暂时不可用（HTTP ${status}），请稍后手动重试。`);
}
/** All errors are our own messages. Upstream bodies may echo credentials or source text. */
async function request(config: DeepSeekConfig, path: string, init: RequestInit, signal?: AbortSignal, timeoutMs = 60000) {
  const valid = validateDeepSeekConfig(config);
  if (!valid.apiKey) throw new Error("请先在 API 设置中填写并保存自己的 DeepSeek API Key。");
  // Test builds may only use synthetic credentials; this also protects SW-controlled tests.
  if (__FOLIO_TEST_MODE__ && valid.apiKey !== "folio-test-only") throw new Error("测试构建禁止使用真实 API Key。");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(`${valid.baseUrl}${path}`, { ...init, signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${valid.apiKey}` } });
    if (!response.ok) { await response.body?.cancel(); throw httpError(response.status); }
    const result = await response.json().catch(() => { throw new Error("DeepSeek 返回的内容格式无效，未保存译文。"); });
    return result;
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Translation aborted", "AbortError");
    if (timedOut) throw new Error("DeepSeek 请求超时，请稍后手动重试；已保存译文保留。");
    if (error instanceof TypeError) throw new Error("无法连接 DeepSeek。请检查网络；浏览器跨域限制也可能阻止请求。已有译文可离线阅读。");
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

/** Reads model metadata without generating text. It does not validate a paid translation. */
export async function testDeepSeekConnection(config: DeepSeekConfig, signal?: AbortSignal) {
  const result = await request(config, "/models", { method: "GET" }, signal, 15000);
  if (!Array.isArray(result?.data) || !result.data.some((model: { id?: string }) => model.id === config.model))
    throw new Error("连接成功，但当前模型未出现在可用列表中，请检查模型设置。");
  return "连接成功，当前模型可用。尚未发起付费翻译。";
}

export function deepSeekProvider(config: DeepSeekConfig): TranslationProvider {
  const valid = validateDeepSeekConfig(config), status = getDeepSeekStatus(valid);
  return {
    id: status.provider,
    async translate(input) {
      if (input.targetLanguage !== "zh-CN") throw new Error("当前仅支持英译简体中文。");
      if (!input.block.text.trim() || input.block.text.length > status.maxCharacters) throw new Error("原文为空或超过单段 16000 字符限制。");
      const result = await request(valid, "/chat/completions", { method: "POST",
        body: JSON.stringify({ model: valid.model, stream: false, thinking: { type: "disabled" }, temperature: 0.3, max_tokens: 8192,
          messages: [{ role: "system", content: TRANSLATION_PROMPT }, { role: "user", content: JSON.stringify({ blockKind: input.block.kind, sourceText: input.block.text }) }] }),
      }, input.signal);
      const choice = result?.choices?.[0];
      if (choice?.finish_reason === "length") throw new Error("译文超过输出上限，未保存不完整译文。请核对此段后手动重试。");
      if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string" || !choice.message.content.trim()) throw new Error("DeepSeek 未返回完整译文，请稍后手动重试。");
      return { bookId: input.bookId, blockId: input.block.id,
        sourceRevision: input.sourceRevision, targetLanguage: input.targetLanguage,
        provider: status.provider, text: choice.message.content.trim(), updatedAt: Date.now() };
    },
  };
}
