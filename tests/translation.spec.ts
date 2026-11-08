import { test, expect } from "@playwright/test";
import { chooseParagraph, cursorVisible, data, importFixture, mockConnection, ready, readingBlock, scrollBy } from "./reader-helpers";

const provider = "deepseek:test-model:test-prompt";
async function menu(page: import("@playwright/test").Page) {
  if (!await page.getByRole("dialog", { name: "DeepSeek 翻译" }).isVisible()) await page.getByLabel("翻译", { exact: true }).click();
}
test.beforeEach(async ({ page }) => { await mockConnection(page, true); await page.goto("/"); });

test("single paragraph translates, folds in place, retries safely and remembers collapsed state", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/translation", async (route) => {
    calls++; const body = route.request().postDataJSON();
    expect(Object.keys(body).sort()).toEqual(["kind", "provider", "targetLanguage", "text"]);
    await route.fulfill(calls === 2 ? { status: 429, json: { error: "DeepSeek 请求过于频繁。" } } : { json: { provider, text: calls === 1 ? "按自己的节奏阅读。" : "按照自己的步调阅读。" } });
  });
  await importFixture(page); expect(calls).toBe(0);
  const blockId = await chooseParagraph(page);
  const block = () => readingBlock(page, blockId);
  // 1st click: translate
  await block().getByLabel("翻译此段", { exact: true }).click();
  await expect(block().locator(".translated")).toHaveText("按自己的节奏阅读。"); await ready(page);
  // 2nd click: the button folds the paragraph (clicking the text also folds it)
  await expect(block().getByLabel("收起此段译文", { exact: true })).toBeVisible();
  await block().getByLabel("收起此段译文", { exact: true }).click();
  await expect(block().locator(".translated")).toBeHidden(); expect(calls).toBe(1);
  // collapsed state survives reload, and the button offers to translate again
  await page.reload(); await ready(page);
  await expect(block().getByLabel("重新翻译此段")).toBeVisible();
  // 3rd click: translate again (fails once, then succeeds on retry)
  await block().getByLabel("重新翻译此段").click();
  await menu(page); await expect(page.locator(".translation-error")).toContainText("过于频繁");
  expect((await data(page)).translations[0].text).toBe("按自己的节奏阅读。");
  await page.getByLabel("关闭翻译面板").click();
  // failed re-translate reopens the paragraph; fold via the text this time, then translate again
  await block().locator(".translated").click();
  await expect(block().locator(".translated")).toBeHidden();
  await block().getByLabel("重新翻译此段").click();
  await expect(block().locator(".translated")).toHaveText("按照自己的步调阅读。");
  expect((await data(page)).translations).toHaveLength(1);
});
test("whole-book translation is explicitly confirmed; hiding its controls or text keeps the job running", async ({ page }) => {
  const sent: string[] = [];
  await page.route("**/api/translation", async (route) => {
    sent.push(route.request().postDataJSON().text);
    await route.fulfill({ json: { provider, text: "这是对应段落的完整中文译文。" } });
  });
  await importFixture(page); await menu(page);
  await page.getByRole("button", { name: /^翻译全文/ }).click(); expect(sent).toHaveLength(0);
  await page.getByRole("button", { name: /^确认翻译剩余/ }).click();
  await page.getByRole("button", { name: "收起全部译文", exact: true }).click();
  await page.getByLabel("关闭翻译面板").click();
  const count = (await data(page)).contents[0].blocks.length;
  await expect.poll(async () => (await data(page)).translations.length, { timeout: 30000 }).toBe(count);
  await ready(page); expect(sent).toHaveLength(count);
  await expect(page.locator(".paragraph-translation")).toHaveCount(0);
  await menu(page); await page.getByRole("button", { name: "展开全部译文", exact: true }).click(); await ready(page);
  await expect(page.locator(".translated").first()).toBeVisible();
  await page.getByRole("button", { name: /^翻译可见段落/ }).click();
  expect(sent).toHaveLength(count);
  await page.getByLabel("关闭翻译面板").click();
  await page.screenshot({ path: ".cache/scroll-bilingual.png" });
});
test.describe("offline bilingual reading", () => {
test.use({ serviceWorkers: "allow" });
test("partial failure, cached retry and offline restart preserve completed translations", async ({ page, context }) => {
  const sent: string[] = [];
  await page.route("**/api/translation", async (route) => {
    sent.push(route.request().postDataJSON().text);
    await route.fulfill(sent.length === 2 ? { status: 502, json: { error: "DeepSeek 余额不足。" } } : { json: { provider, text: "本段的中文译文。" } });
  });
  await importFixture(page); await menu(page);
  await page.getByRole("button", { name: /^翻译可见段落/ }).click();
  await expect(page.locator(".translation-error")).toContainText("余额不足");
  expect((await data(page)).translations).toHaveLength(1); await ready(page);
  await page.getByRole("button", { name: /^翻译可见段落/ }).click();
  await expect(page.getByRole("button", { name: /^停止翻译/ })).toBeHidden();
  await expect.poll(async () => (await data(page)).translations.length).toBeGreaterThan(1);
  expect(sent.filter((text) => text === sent[0])).toHaveLength(1);
  await page.getByLabel("关闭翻译面板").click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.reload(); await ready(page);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy();
  await context.setOffline(true); await page.reload(); await ready(page);
  await expect(page.locator(".translated").first()).toBeVisible();
});
});
test("cancelling a translation stops the queue without caching a cancelled response", async ({ page }) => {
  let calls = 0, release = () => {};
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/translation", async (route) => { calls++; await blocked; await route.fulfill({ json: { provider, text: "已取消。" } }).catch(() => {}); });
  await importFixture(page); await menu(page);
  await page.getByRole("button", { name: /^翻译可见段落/ }).click();
  await expect.poll(() => calls).toBe(1); await page.getByRole("button", { name: /^停止翻译/ }).click(); release();
  await expect(page.getByRole("button", { name: /^翻译可见段落/ })).toBeEnabled();
  expect((await data(page)).translations).toHaveLength(0); expect(calls).toBe(1);
});
test("long translated text restores a character through scroll, reflow and global folding", async ({ page }) => {
  await page.route("**/api/translation", (route) => route.fulfill({ json: { provider, text: "这是忠实的中文译文，用于验证连续滚动和阅读位置保存。".repeat(180) } }));
  await importFixture(page); const blockId = await chooseParagraph(page);
  await readingBlock(page, blockId).getByLabel("翻译此段", { exact: true }).click();
  await expect(readingBlock(page, blockId).locator(".translated")).toBeVisible(); await ready(page);
  await scrollBy(page, 1600); const saved = (await data(page)).progress[0]; expect(saved.translationOffset).toBeGreaterThan(0);
  await page.reload(); await ready(page); await expect.poll(() => cursorVisible(page, saved)).toBeTruthy();
  await page.getByLabel("阅读设置", { exact: true }).click(); await page.getByLabel("字号", { exact: true }).fill("28"); await page.getByLabel("关闭阅读设置").click(); await ready(page);
  await expect.poll(() => cursorVisible(page, saved)).toBeTruthy();
  await page.setViewportSize({ width: 1194, height: 834 }); await ready(page); await expect.poll(() => cursorVisible(page, saved)).toBeTruthy();
  await menu(page); await page.getByRole("button", { name: "收起全部译文", exact: true }).click(); await ready(page);
  await expect(page.locator(".paragraph-translation")).toHaveCount(0);
  await page.getByRole("button", { name: "展开全部译文", exact: true }).click(); await ready(page);
  await expect.poll(() => cursorVisible(page, saved)).toBeTruthy();
});
test("missing Key shows guidance in the popover without taking permanent reading space", async ({ page }) => {
  await page.unroute("**/api/translation/status"); await mockConnection(page, false);
  let calls = 0; await page.route("**/api/translation", (route) => { calls++; return route.abort(); });
  await importFixture(page);
  await expect(page.locator(".translation-error")).toHaveCount(0);
  await menu(page); await expect(page.locator(".translation-error")).toContainText(".env.local");
  await expect(page.getByRole("button", { name: /^翻译可见段落/ })).toBeDisabled();
  await page.getByLabel("关闭翻译面板").click(); await expect(page.locator(".translation-error")).toHaveCount(0); expect(calls).toBe(0);
});
