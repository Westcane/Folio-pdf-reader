import { test, expect } from "@playwright/test";
test("binary storage compatibility probe", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const request = indexedDB.open("binary-probe", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });
    const outcomes: Record<string, string> = {};
    for (const [name, value] of [
      ["blob", new Blob(["pdf"])],
      ["buffer", new Uint8Array([1, 2, 3]).buffer],
    ] as const) {
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction("files", "readwrite");
          transaction.objectStore("files").put(value, name);
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
          transaction.onerror = () => reject(transaction.error);
        });
        outcomes[name] = "ok";
      } catch (e) {
        outcomes[name] = e
          ? `${(e as Error).name}: ${(e as Error).message}`
          : "transaction error without details";
      }
    }
    db.close();
    return outcomes;
  });
  console.log(results);
  expect(results.buffer).toBe("ok");
});
