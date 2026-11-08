import { expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

export async function mockConnection(page: Page, configured = false) {
  await page.route("**/api/translation/status", (route) => route.fulfill({ json: { configured, provider: "deepseek:test-model:test-prompt", model: "test-model", maxCharacters: 16000 } }));
}
export async function ready(page: Page) {
  await expect(page.locator(".reading-scroll")).toHaveAttribute("aria-busy", "false", { timeout: 90000 });
  await expect(page.locator(".import-overlay")).toBeHidden();
}
export async function importFixture(page: Page, name = "single") {
  await page.getByLabel("选择 PDF 文件").setInputFiles(resolve(`tests/fixtures/${name}.pdf`));
  await ready(page);
}
export async function data(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("folio-reader-v1");
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    const values = (name: string) => new Promise<any[]>((resolve, reject) => {
      const req = db.transaction(name).objectStore(name).getAll(); req.onsuccess = () => resolve(req.result); req.onerror = reject;
    });
    const books = await values("books"), contents = await values("contents"), progress = await values("progress"), translations = await values("translations");
    db.close(); return { books, contents, progress, translations };
  });
}
export async function store(page: Page, changes: Array<{ table: string; value?: any; remove?: string }>) {
  await page.evaluate(async (changes) => {
    const request = indexedDB.open("folio-reader-v1");
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = reject; });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([...new Set(changes.map((c) => c.table))], "readwrite");
      for (const change of changes) { const table = tx.objectStore(change.table); if (change.remove) table.delete(change.remove); else table.put(change.value); }
      tx.oncomplete = () => resolve(); tx.onerror = reject;
    }); db.close();
  }, changes);
}
export async function cursorVisible(page: Page, position: { blockId: string; offset: number; translationOffset?: number }) {
  return page.evaluate((position) => {
    const elements = [...document.querySelectorAll<HTMLElement>("[data-reading-text]")];
    const el = elements.find((el) => el.dataset.blockId === position.blockId && el.dataset.readingText === (position.translationOffset !== undefined ? "translation" : "source"));
    if (!el || !el.getBoundingClientRect().height) return false;
    let offset = position.translationOffset ?? position.offset;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walk.nextNode() as Text | null;
    while (node && offset >= node.length) { offset -= node.length; node = walk.nextNode() as Text | null; }
    if (!node) return false;
    const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, Math.min(node.length, offset + 1));
    const rect = range.getBoundingClientRect(), viewport = document.querySelector(".reading-scroll")!.getBoundingClientRect();
    return rect.bottom > viewport.top + 42 && rect.top < viewport.bottom;
  }, position);
}
export async function scrollBy(page: Page, top: number) {
  const before = (await data(page)).progress[0]?.updatedAt ?? 0;
  await page.locator(".reading-scroll").evaluate((el, value) => el.scrollBy(0, value), top);
  await expect.poll(async () => (await data(page)).progress[0]?.updatedAt ?? 0).toBeGreaterThan(before);
}
export async function chooseParagraph(page: Page) {
  return page.locator(".source-text").evaluateAll((nodes) => {
    const viewport = document.querySelector(".reading-scroll")!.getBoundingClientRect();
    const el = nodes.find((node) => { const rect = node.getBoundingClientRect(); return rect.bottom > viewport.top + 90 && rect.top < viewport.bottom - 25; })!;
    return el.closest(".reading-block")!.getAttribute("data-block-id")!;
  });
}
export function readingBlock(page: Page, id: string) {
  return page.locator(`.reading-block[data-block-id="${id}"]`);
}
