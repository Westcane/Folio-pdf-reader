import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { editorialFixture, crossPageFixture } from "./editorial-fixture";
import { PARSER_REVISION } from "../src/types";
import { chooseParagraph, cursorVisible, data, importFixture, mockConnection, ready, readingBlock, scrollBy, store } from "./reader-helpers";

test.beforeEach(async ({ page }) => { await mockConnection(page); await page.goto("/"); });
test("worker import, vertical scroll, font/rotation restore, original source, reopen", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await importFixture(page);
  const parsed = await data(page);
  expect(parsed.contents[0].blocks.some((block: any) => block.text.includes("Café"))).toBeTruthy();
  expect(parsed.contents[0].blocks.some((block: any) => /FOLIO TEST HEADER/.test(block.text))).toBeFalsy();
  await expect(page.getByLabel("下一页", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("上一页", { exact: true })).toHaveCount(0);
  await scrollBy(page, 1750);
  const saved = (await data(page)).progress[0];
  await page.getByLabel("阅读设置", { exact: true }).click();
  await page.getByLabel("字号", { exact: true }).fill("28");
  await page.getByLabel("关闭阅读设置").click(); await ready(page);
  await expect.poll(() => cursorVisible(page, saved)).toBeTruthy();
  await page.setViewportSize({ width: 1194, height: 834 }); await ready(page);
  await expect.poll(() => cursorVisible(page, saved)).toBeTruthy();
  await page.reload(); await ready(page);
  await expect.poll(() => cursorVisible(page, saved)).toBeTruthy();
  await readingBlock(page, await chooseParagraph(page)).getByRole("button", { name: "核对此段原页", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "原始 PDF 校对" })).toBeVisible();
  await expect(page.locator(".source-loading")).toBeHidden();
  expect(await page.locator(".source-canvas-wrap canvas").evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(0);
  await page.getByLabel("关闭原页").click();
  expect(errors).toEqual([]);
});
test("compact side controls and collapsible title leave almost the whole screen for reading", async ({ page }) => {
  await importFixture(page);
  expect(await page.getByRole("navigation", { name: "阅读工具" }).getByRole("button").count()).toBe(2);
  await expect(page.locator(".app-header")).toHaveCount(0);
  await page.getByLabel("收起书名与页码").click();
  await expect(page.getByLabel("展开书名与页码")).toHaveAttribute("aria-expanded", "false");
  await page.reload(); await ready(page);
  await expect(page.getByLabel("展开书名与页码")).toBeVisible();
  const layout = await page.locator(".reading-scroll").evaluate((el) => ({ height: el.clientHeight, viewport: window.innerHeight, x: el.scrollWidth - el.clientWidth }));
  expect(layout.height / layout.viewport).toBeGreaterThan(.97); expect(layout.x).toBe(0);
  await expect.poll(() => page.locator(".reading-block").evaluateAll((nodes) => {
    const viewport = document.querySelector(".reading-scroll")!.getBoundingClientRect();
    const visible = nodes.filter((node) => { const rect = node.getBoundingClientRect(); return rect.bottom > viewport.top + 58 && rect.top < viewport.bottom; });
    return Math.max(0, ...visible.slice(1).map((node, index) => Math.abs(node.getBoundingClientRect().top - visible[index].getBoundingClientRect().bottom)));
  })).toBeLessThan(2);
  await page.screenshot({ path: ".cache/scroll-reader-portrait.png" });
  await page.setViewportSize({ width: 1194, height: 834 }); await ready(page);
  await page.screenshot({ path: ".cache/scroll-reader-landscape.png" });
});
test("double columns preserve reading order and source provenance", async ({ page }) => {
  await importFixture(page, "double");
  const parsed = await data(page); expect(parsed.books[0].diagnostics[0].columns).toBe(2);
  const blocks = parsed.contents[0].blocks.filter((b: any) => b.fragments[0].page === 1), text = blocks.map((b: any) => b.text).join("\n");
  expect(text.indexOf("LEFT paragraph 6")).toBeLessThan(text.indexOf("RIGHT paragraph 1"));
  expect(blocks.every((b: any) => b.id && b.rawText && b.fragments.length && b.sourceItems.length)).toBeTruthy();
});
test("complex pages, scanned documents and invalid files retain clear fallback", async ({ page }) => {
  await importFixture(page, "complex");
  expect((await data(page)).books[0].diagnostics[0].issues).toContain("complex-layout");
  await page.getByLabel("翻译", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "DeepSeek 翻译" })).toContainText("部分原页需要校对");
  await page.getByLabel("返回书库").click(); await importFixture(page, "scan");
  await expect(page.locator(".empty-reading")).toContainText("未提取到可重排文字");
  await page.getByLabel("返回书库").click();
  await page.getByLabel("选择 PDF 文件").setInputFiles(resolve("tests/fixtures/invalid.pdf"));
  await expect(page.getByRole("alert")).toContainText("不是有效的 PDF");
});
test.describe("offline reading", () => {
test.use({ serviceWorkers: "allow" });
test("production offline restart opens local text and source PDF", async ({ page, context }) => {
  await importFixture(page); await scrollBy(page, 1200);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); await ready(page);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy();
  const saved = (await data(page)).progress[0];
  await context.setOffline(true); await page.reload(); await ready(page);
  await expect.poll(() => cursorVisible(page, saved)).toBeTruthy();
  await readingBlock(page, await chooseParagraph(page)).getByLabel("核对此段原页", { exact: true }).click();
  await expect(page.locator(".source-loading")).toBeHidden();
  await expect(page.locator(".source-modal .error-banner")).toHaveCount(0);
});
});
test("long documents mount bounded virtual rows and scroll without horizontal page gestures", async ({ page }) => {
  const start = Date.now(); await importFixture(page, "long"); expect(Date.now() - start).toBeLessThan(90000);
  const total = (await data(page)).contents[0].blocks.length;
  expect(await page.locator(".reading-block").count()).toBeLessThan(45);
  expect(await page.locator(".reading-block").count()).toBeLessThan(total);
  await scrollBy(page, 8000);
  expect((await data(page)).progress[0].fraction).toBeGreaterThan(0);
  expect(await page.locator(".reading-block").count()).toBeLessThan(45);
  const top = await page.locator(".reading-scroll").evaluate((el) => el.scrollTop);
  await page.locator(".reading-scroll").dispatchEvent("pointerdown", { clientX: 650, clientY: 300, pointerId: 1 });
  await page.locator(".reading-scroll").dispatchEvent("pointerup", { clientX: 180, clientY: 300, pointerId: 1 });
  expect(await page.locator(".reading-scroll").evaluate((el) => el.scrollTop)).toBeCloseTo(top, 0);
  await page.evaluate(() => { const el = [...document.querySelectorAll<HTMLElement>(".source-text")].find((el) => el.getBoundingClientRect().top > 60)!; const range = document.createRange(); range.selectNodeContents(el); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range); });
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
});
test("missing source bytes can be repaired by reimport without losing a scroll cursor", async ({ page }) => {
  await importFixture(page); await scrollBy(page, 1500);
  const saved = (await data(page)).progress[0];
  await store(page, [{ table: "files", remove: saved.bookId }]);
  await readingBlock(page, await chooseParagraph(page)).getByLabel("核对此段原页", { exact: true }).click();
  await expect(page.locator(".source-modal .error-banner")).toContainText("重新导入同一个原文件");
  await page.getByLabel("关闭原页").click();
  await page.locator(".reading-scroll").click({ position: { x: 300, y: 400 } });
  await page.getByLabel("返回书库").click();
  await importFixture(page); await expect.poll(() => cursorVisible(page, saved)).toBeTruthy();
});
test("editorial hierarchy and parser revision migration survive the scroll conversion", async ({ page }) => {
  await page.getByLabel("选择 PDF 文件").setInputFiles({ name: "editorial.pdf", mimeType: "application/pdf", buffer: await editorialFixture() }); await ready(page);
  await expect(page.locator(".source-text.kind-heading").filter({ hasText: /^Summary$/ })).toHaveCSS("font-weight", "700");
  await expect(page.locator(".source-text.kind-chapter span")).toHaveCSS("font-style", "italic");
  const parsed = await data(page), book = parsed.books[0], blocks = parsed.contents[0].blocks;
  const chapterIndex = blocks.findIndex((block: any) => block.kind === "chapter"), chapter = blocks[chapterIndex], body = blocks[chapterIndex + 1];
  expect(chapter.text).toBe("one"); expect(body.text).not.toMatch(/^one /);
  await page.getByLabel("返回书库").click();
  const merged = { ...body, id: "legacy-chapter-and-body", text: chapter.text + " " + body.text, sourceItems: [...chapter.sourceItems, ...body.sourceItems], fragments: [...chapter.fragments, ...body.fragments] };
  await store(page, [ { table: "books", value: { ...book, parserRevision: "legacy-parser" } },
    { table: "contents", value: { bookId: book.id, blocks: [...blocks.slice(0, chapterIndex), merged, ...blocks.slice(chapterIndex + 2)] } },
    { table: "settings", value: { key: "lastBook", value: book.id } },
    { table: "progress", value: { bookId: book.id, blockId: merged.id, offset: chapter.text.length + 1 + 16, fraction: .7, updatedAt: 1 } } ]);
  await page.reload(); await ready(page);
  expect((await data(page)).books[0].parserRevision).toBe(PARSER_REVISION);
  expect((await data(page)).progress[0]).toMatchObject({ blockId: body.id, offset: 16 });
});
test("merged cross-page paragraphs locate the correct original PDF page while scrolling", async ({ page }) => {
  await page.getByLabel("选择 PDF 文件").setInputFiles({ name: "cross-page.pdf", mimeType: "application/pdf", buffer: await crossPageFixture() }); await ready(page);
  const parsed = await data(page), book = parsed.books[0], blocks = parsed.contents[0].blocks;
  const block = blocks.find((b: any) => b.sourceRanges?.length > 1), range = block.sourceRanges.find((r: any) => r.page === 2);
  expect(block.text).toContain("Changing the physical page should not insert a new paragraph");
  await page.getByLabel("返回书库").click();
  await store(page, [ { table: "settings", value: { key: "lastBook", value: book.id } },
    { table: "progress", value: { bookId: book.id, blockId: block.id, offset: range.start + 5, fraction: .5, updatedAt: 1 } } ]);
  await page.reload(); await ready(page);
  await expect(page.locator(".reading-capsule")).toContainText("原 PDF 2 / 2");
  await page.locator(`.reading-block[data-block-id="${block.id}"] .source-text`).click({ position: { x: 10, y: 15 } });
  await readingBlock(page, block.id).getByLabel("核对此段原页", { exact: true }).click();
  await expect(page.getByLabel("原 PDF 页码", { exact: true })).toHaveValue("2");
});
test("development diagnostics and server secrets remain outside production assets", async ({ page }) => {
  await importFixture(page); await expect(page.getByText("DEV · 调试", { exact: false })).toHaveCount(0);
  for (const file of readdirSync("dist/assets").filter((f) => /\.(js|css)$/.test(f))) {
    const output = readFileSync(resolve("dist/assets", file), "utf8");
    for (const marker of ["Folio DEV diagnostics", "dev-panel", "DEEPSEEK_API_KEY", "You are a professional English-to-Simplified-Chinese translator"]) expect(output).not.toContain(marker);
  }
  await page.goto("http://localhost:5273"); await page.getByRole("button", { name: /DEV · 调试/ }).click();
  await expect(page.getByRole("region", { name: "开发调试面板" })).toBeVisible();
});
test("test servers deny unmatched API calls before any proxy or paid provider", async ({ request }) => {
  for (const port of [4273, 5273]) {
    const response = await request.post(`http://localhost:${port}/api/translation`, { data: { text: "must never reach any provider" } });
    expect(response.status()).toBe(503);
    expect(await response.json()).toMatchObject({ testMode: true });
  }
});
test("optional local novel preserves headings, italic chapters and cross-page flow", async ({ page }) => {
  const path = process.env.FOLIO_LOCAL_PDF;
  test.skip(!path || !existsSync(path), "Private PDF is never included in the app or CI.");
  await page.getByLabel("选择 PDF 文件").setInputFiles(path!); await ready(page);
  const blocks = (await data(page)).contents[0].blocks;
  expect(blocks.find((b: any) => b.text === "Summary").kind).toBe("heading");
  expect(blocks.find((b: any) => b.text === "one").kind).toBe("chapter");
  expect(blocks.some((b: any) => b.sourceRanges?.some((r: any) => r.page === 1) && b.sourceRanges?.some((r: any) => r.page === 2))).toBeTruthy();
});
