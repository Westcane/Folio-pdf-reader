import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  clearReaderData,
  deleteBook,
  normalizeSettings,
  saveImport,
  writeProgress,
} from "./db";
import type { Book } from "../types";

const book: Book = {
  id: "test",
  name: "test.pdf",
  size: 8,
  totalPages: 1,
  blockCount: 0,
  importedAt: 1,
  status: "ready",
  parserRevision: "test",
  diagnostics: [],
};
beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterAll(async () => {
  await db.delete();
});
describe("local persistence", () => {
  it("clears all Folio tables including credentials after pending progress writes", async () => {
    await saveImport(book, [], new Blob(["test"]));
    await db.settings.bulkPut([{ key: "deepseek-client", value: { apiKey: "test-only" } }, { key: "lastBook", value: book.id }]);
    await db.translations.put({ key: "t", bookId: book.id, blockId: "b", sourceRevision: "1", targetLanguage: "zh-CN", provider: "mock", text: "译文", updatedAt: 1 });
    const saving = writeProgress({ bookId: book.id, blockId: "b", offset: 1, fraction: 0, updatedAt: 1 });
    await clearReaderData(); await saving;
    expect(await Promise.all(db.tables.map((table) => table.count()))).toEqual(db.tables.map(() => 0));
    db.close(); await db.open();
    expect(await db.books.count()).toBe(0);
    expect(await db.settings.get("deepseek-client")).toBeUndefined();
  });
  it("rolls back storage clearing if any table cannot be cleared", async () => {
    await saveImport(book, [], new Blob(["test"]));
    await db.settings.put({ key: "reader", value: { fontSize: 24 } });
    const fail = () => { throw new Error("Cannot clear settings"); };
    db.settings.hook("deleting", fail);
    try { await expect(clearReaderData()).rejects.toThrow("Cannot clear settings"); }
    finally { db.settings.hook("deleting").unsubscribe(fail); }
    expect(await db.books.count()).toBe(1); expect(await db.files.count()).toBe(1);
    expect((await db.settings.get("reader"))?.value).toEqual({ fontSize: 24 });
  });
  it("stores the source and structural data together, preserving position on reimport", async () => {
    await saveImport(book, [], new Blob(["test"]));
    await writeProgress({
      bookId: book.id,
      blockId: "b",
      offset: 45,
      fraction: 0.5,
      updatedAt: 1,
    });
    await saveImport(book, [], new Blob(["again"]));
    expect(await db.books.count()).toBe(1);
    expect((await db.files.get(book.id))?.bytes?.byteLength).toBe(5);
    expect((await db.progress.get(book.id))?.offset).toBe(45);
    db.close();
    await db.open();
    expect((await db.progress.get(book.id))?.blockId).toBe("b");
  });
  it("rolls back the entire import when a content write fails", async () => {
    const fail = () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
    db.contents.hook("creating", fail);
    await expect(saveImport(book, [], new Blob(["test"]))).rejects.toThrow();
    db.contents.hook("creating").unsubscribe(fail);
    expect(await db.books.count()).toBe(0);
    expect(await db.files.count()).toBe(0);
  });
  it("orders rapid progress writes and removes all dependent data", async () => {
    await saveImport(book, [], new Blob(["test"]));
    await Promise.all(
      [1, 2, 3].map((offset) =>
        writeProgress({
          bookId: book.id,
          blockId: "b",
          offset,
          fraction: 0,
          updatedAt: offset,
        }),
      ),
    );
    expect((await db.progress.get(book.id))?.offset).toBe(3);
    await db.translations.put({
      key: "k",
      bookId: book.id,
      blockId: "b",
      sourceRevision: "1",
      targetLanguage: "zh",
      provider: "mock",
      text: "译文",
      updatedAt: 1,
    });
    await deleteBook(book.id);
    expect(await db.files.count()).toBe(0);
    expect(await db.contents.count()).toBe(0);
    expect(await db.progress.count()).toBe(0);
    expect(await db.translations.count()).toBe(0);
  });
  it("validates malformed or old settings without resetting the library", () => {
    expect(
      normalizeSettings({
        fontSize: Infinity,
        theme: "oops",
        lineHeight: 9,
        margin: 0,
      }),
    ).toMatchObject({
      fontSize: 21,
      theme: "light",
      lineHeight: 2.2,
      margin: 20,
    });
  });
});
