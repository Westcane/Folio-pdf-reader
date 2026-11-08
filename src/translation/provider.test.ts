import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../storage/db";
import { deepSeekProvider, getDeepSeekStatus, testDeepSeekConnection, translateBlock } from "./provider";
import { loadDeepSeekConfig, saveDeepSeekConfig, validateDeepSeekConfig } from "./config";
import { TRANSLATION_PROMPT } from "./prompt";
import { PARSER_REVISION, type ReadingBlock } from "../types";

const block = { id: "paragraph-1", text: "A quiet morning.", kind: "paragraph" } as ReadingBlock;
const config = { apiKey: "folio-test-only", baseUrl: "https://api.deepseek.com", model: "deepseek-flash" };
const completion = (text = "静谧的清晨。", finish_reason = "stop") => Response.json({ choices: [{ finish_reason, message: { content: text } }] });
beforeEach(async () => { await db.delete(); await db.open(); vi.stubGlobal("window", new EventTarget()); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(async () => { await db.delete(); });

describe("direct official DeepSeek requests and local configuration", () => {
  it("persists the key, clears it independently of books, and restricts the endpoint", async () => {
    await saveDeepSeekConfig(config); db.close(); await db.open();
    expect(await loadDeepSeekConfig()).toEqual(config);
    await db.settings.put({ key: "lastBook", value: "book" });
    await saveDeepSeekConfig({ ...config, apiKey: "" });
    expect((await loadDeepSeekConfig()).apiKey).toBe("");
    expect((await db.settings.get("lastBook"))?.value).toBe("book");
    for (const baseUrl of ["http://api.deepseek.com", "https://example.com", "https://api.deepseek.com.evil.test", "https://user:secret@api.deepseek.com", "https://api.deepseek.com?key=x", "https://api.deepseek.com/other"]) {
      expect(() => validateDeepSeekConfig({ ...config, baseUrl })).toThrow();
    }
    expect(validateDeepSeekConfig({ ...config, baseUrl: config.baseUrl + "/v1/" }).baseUrl).toBe(config.baseUrl + "/v1");
  });
  it("sends only structured source and the original prompt to official HTTPS; reuses cache", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url, options) => {
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect(options).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error", headers: { Authorization: "Bearer folio-test-only" } });
      const body = JSON.parse(options.body);
      expect(body.model).toBe("deepseek-flash");
      expect(body.messages).toEqual([{ role: "system", content: TRANSLATION_PROMPT }, { role: "user", content: JSON.stringify({ blockKind: block.kind, sourceText: block.text }) }]);
      expect(options.body).not.toContain(config.apiKey);
      return completion();
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = deepSeekProvider(config);
    await translateBlock(provider, "book", block); db.close(); await db.open();
    expect((await translateBlock(provider, "book", block)).text).toBe("静谧的清晨。");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await translateBlock(provider, "book", block, true);
    await translateBlock(provider, "book", block, false, undefined, PARSER_REVISION + "-new");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(await db.translations.toArray())).not.toContain(config.apiKey);
    expect(getDeepSeekStatus(config)).not.toHaveProperty("apiKey");
  });
  it.each([401, 402, 429, 500, 503])("maps HTTP %s without echoing upstream secrets or retrying", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: { message: config.apiKey } }, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await translateBlock(deepSeekProvider(config), "book", block).catch((error: Error) => error);
    if (!(error instanceof Error)) throw new Error("Expected the request to fail");
    expect(error.message).toContain(String(status)); expect(error.message).not.toContain(config.apiKey);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(await db.translations.count()).toBe(0);
  });
  it("never caches truncated output or a canceled request; network failure is sanitized", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => completion("partial", "length")));
    await expect(translateBlock(deepSeekProvider(config), "book", block)).rejects.toThrow("不完整译文");
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => completion()));
    await expect(translateBlock(deepSeekProvider(config), "book", block, false, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError(config.apiKey)));
    await expect(translateBlock(deepSeekProvider(config), "book", block)).rejects.toThrow("无法连接 DeepSeek");
    expect(await db.translations.count()).toBe(0);
  });
  it("connection test only queries model metadata, and a stalled request times out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [{ id: config.model }] })); vi.stubGlobal("fetch", fetchMock);
    await expect(testDeepSeekConnection(config)).resolves.toContain("尚未发起付费翻译");
    expect(fetchMock.mock.calls[0][0]).toBe(config.baseUrl + "/models");
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("abort", "AbortError"))))));
    const waiting = expect(testDeepSeekConnection(config)).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(15001); await waiting;
  });
});
