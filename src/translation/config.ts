import { db } from "../storage/db";

export interface DeepSeekConfig { apiKey: string; baseUrl: string; model: string }
export const deepSeekModels = ["deepseek-flash", "deepseek-v4-pro"] as const;
export const defaultDeepSeekConfig: DeepSeekConfig = { apiKey: "", baseUrl: "https://api.deepseek.com", model: deepSeekModels[0] };
export const configKey = "deepseek-client";
export const configChanged = "folio-deepseek-config-changed";

/** Only official HTTPS endpoints are accepted, so editing Base URL cannot leak a key to a relay. */
export function validateDeepSeekConfig(value: DeepSeekConfig): DeepSeekConfig {
  let url: URL;
  try { url = new URL(value.baseUrl.trim()); } catch { throw new Error("Base URL 必须是 DeepSeek 官方 HTTPS 地址。"); }
  const path = url.pathname.replace(/\/+$/, "");
  if (url.origin !== "https://api.deepseek.com" || url.username || url.password || url.search || url.hash || !["", "/v1"].includes(path))
    throw new Error("仅支持 https://api.deepseek.com 或 https://api.deepseek.com/v1，不接受第三方中转。");
  if (!deepSeekModels.includes(value.model as typeof deepSeekModels[number])) throw new Error("请选择支持的 DeepSeek 模型。");
  const apiKey = value.apiKey.trim();
  if (apiKey.length > 512 || /[\s\x00-\x1f\x7f]/.test(apiKey)) throw new Error("API Key 格式无效，请检查是否有空格或换行。");
  return { apiKey, baseUrl: `${url.origin}${path}`, model: value.model };
}
export async function loadDeepSeekConfig(): Promise<DeepSeekConfig> {
  const row = await db.settings.get(configKey);
  if (!row) return { ...defaultDeepSeekConfig };
  try { return validateDeepSeekConfig(row.value as DeepSeekConfig); }
  catch { throw new Error("本机翻译配置无效，请重新保存 API 设置；书籍和译文不受影响。"); }
}
export async function saveDeepSeekConfig(value: DeepSeekConfig) {
  const config = validateDeepSeekConfig(value);
  await db.settings.put({ key: configKey, value: config });
  // Never put the key in event payloads, logs, URLs or cache identities.
  window.dispatchEvent(new Event(configChanged));
  return config;
}
export async function clearDeepSeekKey() {
  // A malformed, unsaved URL must never prevent removing an already saved key.
  const current = await loadDeepSeekConfig().catch(() => defaultDeepSeekConfig);
  return saveDeepSeekConfig({ ...current, apiKey: "" });
}
