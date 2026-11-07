import {
  PARSER_REVISION,
  type ReadingBlock,
  type TranslationProvider,
  type TranslationResult,
} from "../types";
import { db } from "../storage/db";

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
/** Future providers call a backend proxy. A secret API key must never be sent to this frontend. */
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

export async function getDeepSeekStatus(signal?: AbortSignal): Promise<DeepSeekStatus> {
  try {
    const response = await fetch("/api/translation/status", { signal, cache: "no-store" });
    if (!response.ok) throw new Error();
    const result = await response.json() as DeepSeekStatus;
    if (typeof result.configured !== "boolean" || !result.provider?.startsWith("deepseek:") || !result.model || !Number.isFinite(result.maxCharacters)) throw new Error();
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("未连接翻译服务。请在电脑的另一个终端运行 npm.cmd run api，然后点“检查连接”。已有译文仍可离线阅读。");
  }
}

/** Browser only speaks to our same-origin proxy. Credentials stay in Node. */
export function deepSeekProvider(status: DeepSeekStatus): TranslationProvider {
  return {
    id: status.provider,
    async translate(input) {
      const response = await fetch("/api/translation", {
        method: "POST", signal: input.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.block.text, kind: input.block.kind,
          targetLanguage: input.targetLanguage, provider: status.provider }),
      }).catch((error: unknown) => {
        if (input.signal?.aborted) throw error;
        throw new Error("翻译连接中断，请检查网络与电脑上的代理服务后重试。已有译文仍会保留。");
      });
      const result = await response.json().catch(() => null) as { text?: string; provider?: string; error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "翻译代理暂不可用，请检查电脑上的翻译服务。");
      if (!result?.text?.trim() || result.provider !== status.provider)
        throw new Error("译文响应不完整或模型已改变，请检查连接后重试。");
      return { bookId: input.bookId, blockId: input.block.id,
        sourceRevision: input.sourceRevision, targetLanguage: input.targetLanguage,
        provider: status.provider, text: result.text, updatedAt: Date.now() };
    },
  };
}
