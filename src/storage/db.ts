import Dexie, { type EntityTable } from "dexie";
import { remapProgress } from "../reader/remapProgress";
import {
  defaultSettings,
  type Book,
  type BookContent,
  type ReadingProgress,
  type Settings,
  type TranslationResult,
} from "../types";

export class ReaderDatabase extends Dexie {
  books!: EntityTable<Book, "id">;
  files!: EntityTable<
    { bookId: string; bytes?: ArrayBuffer; blob?: Blob },
    "bookId"
  >;
  contents!: EntityTable<BookContent, "bookId">;
  progress!: EntityTable<ReadingProgress, "bookId">;
  settings!: EntityTable<{ key: string; value: unknown }, "key">;
  translations!: EntityTable<TranslationResult & { key: string }, "key">;
  constructor(name = "folio-reader-v1") {
    super(name);
    this.version(1).stores({
      books: "id, importedAt",
      files: "bookId",
      contents: "bookId",
      progress: "bookId",
      settings: "key",
      translations:
        "key, bookId, [bookId+blockId+sourceRevision+targetLanguage+provider]",
    });
  }
}
export const db = new ReaderDatabase();

export async function saveImport(
  book: Book,
  blocks: BookContent["blocks"],
  file: Blob,
) {
  // ArrayBuffer works on WebKit ports that cannot commit IndexedDB Blob records.
  // Materialize before the transaction: awaiting file IO inside it can auto-close it.
  const bytes = await file.arrayBuffer();
  // A failed quota write rolls back metadata, blocks and source bytes together.
  await db.transaction(
    "rw",
    db.books,
    db.files,
    db.contents,
    db.progress,
    async () => {
      const oldContent = await db.contents.get(book.id);
      const oldProgress = await db.progress.get(book.id);
      await db.books.put(book);
      await db.files.put({ bookId: book.id, bytes });
      await db.contents.put({ bookId: book.id, blocks });
      if (oldContent && oldProgress && blocks.length)
        await db.progress.put(
          remapProgress(oldContent.blocks, blocks, oldProgress),
        );
    },
  );
}
export async function readSource(bookId: string): Promise<Uint8Array> {
  const file = await db.files.get(bookId);
  if (file?.bytes) return new Uint8Array(file.bytes);
  // Non-destructive compatibility with early development snapshots.
  if (file?.blob) return new Uint8Array(await file.blob.arrayBuffer());
  throw new Error(
    "原 PDF 已不在浏览器存储中。请关闭此窗口，重新导入同一个原文件；现有阅读进度会保留。",
  );
}
export async function deleteBook(id: string) {
  await db.transaction(
    "rw",
    [
      db.books,
      db.files,
      db.contents,
      db.progress,
      db.translations,
      db.settings,
    ],
    async () => {
      await Promise.all([
        db.books.delete(id),
        db.files.delete(id),
        db.contents.delete(id),
        db.progress.delete(id),
        db.translations.where("bookId").equals(id).delete(),
        db.settings.delete(`view:${id}`),
      ]);
      if ((await db.settings.get("lastBook"))?.value === id)
        await db.settings.delete("lastBook");
    },
  );
}
export function normalizeSettings(value: unknown): Settings {
  const source =
    value && typeof value === "object" ? (value as Partial<Settings>) : {};
  const number = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(min, Math.min(max, v))
      : fallback;
  return {
    fontSize: number(source.fontSize, 21, 16, 32),
    lineHeight: number(source.lineHeight, 1.75, 1.3, 2.2),
    margin: number(source.margin, 44, 20, 80),
    theme: ["light", "sepia", "dark"].includes(source.theme ?? "")
      ? source.theme!
      : defaultSettings.theme,
    bilingual: source.bilingual === true,
  };
}
export function storageError(error: unknown): string {
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  if (/Quota|Storage|UnknownError/i.test(name))
    return "设备存储空间不足或 Safari 存储不可用。请释放空间后重试，并保留原文件以便重新导入。";
  return error instanceof Error ? error.message : String(error);
}

// Serialize writes and expose failures to the UI. No delayed debounce is lost on tab suspension.
let pending: Promise<unknown> = Promise.resolve();
export function writeProgress(progress: ReadingProgress): Promise<unknown> {
  pending = pending.catch(() => {}).then(() => db.progress.put(progress));
  return pending;
}
