import { test, expect, type Page } from "@playwright/test";
import { importFixture, mockConnection, ready } from "./reader-helpers";

const viewport = (page: Page) => page.locator(".reading-scroll");
const current = (page: Page) => page.locator('.reading-page[data-current="true"]');
async function showTools(page: Page) {
  if (!await page.getByLabel("阅读设置", { exact: true }).isVisible()) {
    await viewport(page).dblclick({ position: { x: 200, y: 300 } });
  }
}
async function openSettings(page: Page) {
  await showTools(page); await page.getByLabel("阅读设置", { exact: true }).click();
}
async function fits(page: Page) {
  return current(page).locator(".page-content").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return [...element.children].every((child) => child.getBoundingClientRect().bottom <= rect.bottom + 2);
  });
}

test("tablet: single tap caches translations, double tap owns chrome, header slider seeks live", async ({ page }) => {
  await mockConnection(page, true);
  let requests = 0;
  await page.route("**/api/translation", (route) => {
    requests++;
    return route.fulfill({ json: { provider: "deepseek:test-model:test-prompt", text: "这是一段按段落缓存的译文。" } });
  });
  await page.goto("/"); await importFixture(page);
  const count = Number(await viewport(page).getAttribute("data-page-count"));
  expect(count).toBeGreaterThan(1); expect(await fits(page)).toBeTruthy();
  const source = () => current(page).locator(".source-text").first();
  await source().dblclick({ position: { x: 180, y: 18 } });
  await expect(page.locator(".reading-header")).toHaveClass(/is-collapsed/);
  await page.waitForTimeout(350); expect(requests).toBe(0);
  await source().dblclick({ position: { x: 180, y: 18 } });
  await expect(page.locator(".reading-header")).not.toHaveClass(/is-collapsed/);
  await expect(page.locator(".reading-header")).toHaveClass(/is-collapsed/, { timeout: 3000 });
  expect(requests).toBe(0);
  const id = (await source().getAttribute("data-block-id"))!;
  const translated = () => page.locator(`.reading-fragment[data-block-id="${id}"][data-translated="true"]`);
  await source().click({ position: { x: 180, y: 18 } });
  await expect(translated().first()).toHaveText("这是一段按段落缓存的译文。"); await ready(page);
  await source().click({ position: { x: 180, y: 18 } }); await expect(translated()).toHaveCount(0); await ready(page);
  await source().click({ position: { x: 180, y: 18 } }); await expect(translated().first()).toBeVisible(); await ready(page);
  expect(requests).toBe(1);
  await openSettings(page); await page.getByRole("button", { name: "左右翻页", exact: true }).click();
  await page.getByLabel("关闭阅读设置").click(); await ready(page);
  await viewport(page).click({ position: { x: 828, y: 350 } }); await expect(viewport(page)).toHaveAttribute("data-page-index", "1");
  await viewport(page).click({ position: { x: 6, y: 350 } }); await expect(viewport(page)).toHaveAttribute("data-page-index", "0");
  await page.getByLabel("阅读进度", { exact: true }).click();
  const slider = page.getByLabel("阅读页码", { exact: true });
  await expect(slider).toBeVisible();
  const rect = (await slider.boundingBox())!;
  await page.mouse.move(rect.x + 8, rect.y + rect.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .7, rect.y + rect.height / 2, { steps: 8 });
  const value = Number(await slider.inputValue()); expect(value).toBeGreaterThan(1);
  await expect(page.getByLabel("阅读进度", { exact: true })).toContainText(`${value}/`);
  await expect(viewport(page)).toHaveAttribute("data-page-index", String(value - 1));
  await page.waitForTimeout(2100); await expect(slider).toBeVisible(); await page.mouse.up();
  await showTools(page); await page.getByLabel("翻译", { exact: true }).click();
  await expect(page.getByLabel("原文长按时间")).toHaveCount(0);
  await page.getByLabel("关闭翻译面板").click();
  expect(requests).toBe(1);
});

test("phone: paragraph expansion keeps a partial scroll position; reflow, seek and reload retain source", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockConnection(page, true);
  let requests = 0;
  await page.route("**/api/translation", (route) => {
    requests++;
    return route.fulfill({ json: { provider: "deepseek:test-model:test-prompt", text: "此译文用于验证分页更新不会把滚动位置拉回整页顶部。".repeat(12) } });
  });
  await page.goto("/"); await importFixture(page);
  const height = await viewport(page).evaluate((element) => element.clientHeight);
  expect((await current(page).boundingBox())!.height).toBeCloseTo(height, 0);
  expect(await page.locator(".paged-column").evaluate((el) => el.clientWidth)).toBeGreaterThan(390 * .8);
  await viewport(page).evaluate((element, top) => { element.scrollTop = top; }, height + 173);
  await expect(viewport(page)).toHaveAttribute("data-page-index", "1");
  const marker = await page.locator(".source-text").evaluateAll((nodes) => {
    const node = nodes.find((node) => { const rect = node.getBoundingClientRect(); return rect.top > 100 && rect.top < 650; }) as HTMLElement;
    return { id: node.dataset.blockId!, start: node.dataset.start!, y: node.getBoundingClientRect().top };
  });
  const source = () => page.locator(`.source-text[data-block-id="${marker.id}"][data-start="${marker.start}"]`);
  const assertStationary = async () => {
    await ready(page);
    await expect.poll(async () => Math.abs((await source().boundingBox())!.y - marker.y)).toBeLessThan(2);
    const top = await viewport(page).evaluate((el) => el.scrollTop);
    expect(Math.abs(top - Math.round(top / height) * height)).toBeGreaterThan(50);
  };
  await source().click({ position: { x: 100, y: 12 } });
  await expect.poll(() => requests).toBe(1); await expect(page.locator(".translated").first()).toBeAttached();
  await assertStationary();
  await source().click({ position: { x: 100, y: 12 } }); await expect(page.locator(".translated")).toHaveCount(0); await assertStationary();
  await source().click({ position: { x: 100, y: 12 } }); await expect(page.locator(".translated").first()).toBeAttached(); await assertStationary();
  expect(requests).toBe(1);
  await page.getByLabel("阅读进度", { exact: true }).click();
  await page.getByLabel("阅读页码", { exact: true }).fill("3");
  await expect(viewport(page)).toHaveAttribute("data-page-index", "2");
  await expect(page.getByLabel("阅读进度", { exact: true })).toContainText("3/");
  await openSettings(page); const count = Number(await viewport(page).getAttribute("data-page-count"));
  await page.getByLabel("字号", { exact: true }).fill("32"); await page.getByLabel("关闭阅读设置").click(); await ready(page);
  await expect.poll(async () => Number(await viewport(page).getAttribute("data-page-count"))).toBeGreaterThan(count);
  expect(await fits(page)).toBeTruthy();
  const progress = await current(page).locator(".source-text").first().evaluate((element) => ({ id: (element as HTMLElement).dataset.blockId!, start: Number((element as HTMLElement).dataset.start) }));
  await page.reload(); await ready(page);
  await expect.poll(() => current(page).locator(".source-text").evaluateAll((nodes, marker) => nodes.some((node) => {
    const element = node as HTMLElement, start = Number(element.dataset.start);
    return element.dataset.blockId === marker.id && start <= marker.start && marker.start < start + (element.textContent?.length ?? 0);
  }), progress)).toBeTruthy();
  expect(requests).toBe(1);
  await page.screenshot({ path: ".cache/reader-tap-phone.png" });
});
