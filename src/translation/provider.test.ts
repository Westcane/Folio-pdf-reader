import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../storage/db";
import { deepSeekProvider, getDeepSeekStatus, translateBlock } from "./provider";
import { PARSER_REVISION, type ReadingBlock } from "../types";

const block = { id: "paragraph-1", text: "A quiet morning.", kind: "paragraph" } as ReadingBlock;
const status = { configured: true, provider: "deepseek:model:prompt", model: "model", maxCharacters: 16000 };
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await db.delete(); });

describe("DeepSeek browser adapter and persistent paragraph cache", () => {
  it("sends only paragraph text to the same-origin proxy; caches and force-replaces a translation", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url, options) => {
      expect(_url).toBe("/api/translation");
      const body = JSON.parse(options.body);
      expect(body).toMatchObject({ text: block.text, kind: block.kind, targetLanguage: "zh-CN" });
      expect(options.headers.Authorization).toBeUndefined();
      return Response.json({ text: fetchMock.mock.calls.length === 1 ? "静谧的清晨。" : "安静的早晨。", provider: body.provider });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = deepSeekProvider(status);
    await translateBlock(provider, "book", block);
    db.close(); await db.open();
    expect((await translateBlock(provider, "book", block)).text).toBe("静谧的清晨。");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await translateBlock(provider, "book", block, true)).text).toBe("安静的早晨。");
    expect(await db.translations.count()).toBe(1);
    await translateBlock(deepSeekProvider({ ...status, provider: "deepseek:new-model:new-prompt" }), "book", block);
    await translateBlock(provider, "other-book", block);
    // A different source revision must request again, rather than reusing stale text.
    await translateBlock(provider, "book", block, false, undefined, PARSER_REVISION + "-new");
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(await db.translations.count()).toBe(4);
  });
  it("failed, truncated or cancelled requests never poison an existing cache", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "余额不足" }, { status: 502 })));
    await expect(translateBlock(deepSeekProvider(status), "book", block)).rejects.toThrow("余额不足");
    expect(await db.translations.count()).toBe(0);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ text: "中文", provider: "changed" })));
    await expect(translateBlock(deepSeekProvider(status), "book", block)).rejects.toThrow("模型已改变");
    const controller = new AbortController(); controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ text: "中文", provider: status.provider })));
    await expect(translateBlock(deepSeekProvider(status), "book", block, false, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(await db.translations.count()).toBe(0);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(translateBlock(deepSeekProvider(status), "book", block)).rejects.toThrow("翻译连接中断");
    expect(await db.translations.count()).toBe(0);
  });
  it("missing proxy produces setup guidance rather than treating HTML as an API response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>app</html>")));
    await expect(getDeepSeekStatus()).rejects.toThrow("npm.cmd run api");
  });
});
