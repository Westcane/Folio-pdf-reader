import { loadPdf, pdfjs } from "../pdf/client";
import {
  analyzePdfTextPage,
  buildPdfPaperDocument,
  MAX_PDF_ANALYSIS_CHARACTERS,
  MAX_PDF_ANALYSIS_PAGES,
} from "../pdf/reconstruct";
import type { PdfAnalyzedPage, PdfRawTextItem } from "../pdf/reconstruct";
import {
  PARSER_REVISION,
  type Book,
  type ImportState,
  type ReadingBlock,
} from "../types";
import { assembleBlocks, rawText } from "../pdf/structure";
import { readPageFontStyles } from "../pdf/fontStyle";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Full-file, deterministic 128-bit content identity. Not a security/authentication hash.
 * Avoids crypto.subtle, which is unavailable on an iPad's HTTP LAN development URL. */
export function contentId(bytes: Uint8Array): string {
  let a = 0x811c9dc5,
    b = 0x9e3779b9,
    c = 0x85ebca6b,
    d = 0xc2b2ae35;
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, 0x01000193);
    b = Math.imul(b ^ byte, 0x85ebca6b);
    c = Math.imul(c ^ byte, 0xc2b2ae35);
    d = Math.imul(d ^ byte, 0x27d4eb2f);
  }
  return `pdf-${bytes.length}-${[a, b, c, d].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("")}`;
}

export async function validatePdf(file: File): Promise<void> {
  if (!file.size) throw new Error("文件为空，请重新选择 PDF。");
  if (file.size > MAX_FILE_BYTES)
    throw new Error("最小版本支持最大 50 MB 的 PDF，请拆分后导入。");
  const header = new TextDecoder().decode(
    await file.slice(0, 1024).arrayBuffer(),
  );
  if (!header.includes("%PDF-"))
    throw new Error("文件内容不是有效的 PDF，不能只修改文件扩展名。");
}

export async function importPdf(
  file: File,
  onState: (state: ImportState) => void,
): Promise<{ book: Book; blocks: ReadingBlock[] }> {
  onState({ phase: "检查文件", page: 0, total: 0, blocks: 0 });
  await validatePdf(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = contentId(bytes);
  const task = loadPdf(bytes);
  const pages: PdfAnalyzedPage[] = [];
  const rawPages: Array<{ items: PdfRawTextItem[]; extractionError: boolean }> =
    [];
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PDF_ANALYSIS_PAGES)
      throw new Error(
        `最小版本最多解析 ${MAX_PDF_ANALYSIS_PAGES} 个原始 PDF 页面，请先拆分文档。`,
      );
    let characters = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      let page: Awaited<ReturnType<typeof pdf.getPage>> | undefined;
      let items: PdfRawTextItem[] = [];
      let extractionError = false;
      let width = 600,
        height = 800;
      try {
        page = await pdf.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        width = viewport.width;
        height = viewport.height;
        const text = await page.getTextContent();
        const fonts = await readPageFontStyles(page, Object.keys(text.styles));
        items = text.items.flatMap((item, sourceIndex) =>
          "str" in item
            ? [
                {
                  ...item,
                  ...fonts.get(item.fontName),
                  sourceIndex,
                  transform: pdfjs.Util.transform(
                    viewport.transform,
                    item.transform,
                  ),
                  coordinateSpace: "viewport" as const,
                },
              ]
            : [],
        );
      } catch (error) {
        console.error(`PDF 第 ${number} 页提取失败`, error);
        extractionError = true;
      } finally {
        page?.cleanup();
      }
      characters += items.reduce((n, item) => n + item.str.length, 0);
      if (characters > MAX_PDF_ANALYSIS_CHARACTERS)
        throw new Error("提取文本超过 200 万字符上限，请拆分文档后导入。");
      const analyzed = analyzePdfTextPage({
        page: number,
        width,
        height,
        items,
      });
      pages.push(analyzed);
      rawPages.push({ items, extractionError });
      onState({
        phase: "提取文字与重建段落",
        page: number,
        total: pdf.numPages,
        blocks: pages.reduce((n, p) => n + p.blocks.length, 0),
      });
      // Give Safari time to paint import progress and process touch input.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const paper = buildPdfPaperDocument(pages);
    const blocks = assembleBlocks(
      id,
      paper,
      rawPages.map((p) => p.items),
    );
    const diagnostics = pages.map((p, index) => {
      const raw = rawPages[index];
      const complex =
        p.blocks.some((b) => b.kind === "equation") || looksTabular(raw.items);
      return {
        page: p.page,
        quality:
          complex && p.quality === "supported"
            ? ("review" as const)
            : p.quality,
        columns: p.columnCount,
        items: p.sourceItemCount,
        characters: p.characterCount,
        issues: [
          ...p.issues,
          ...(raw.extractionError ? ["extraction-error" as const] : []),
          ...(complex ? ["complex-layout" as const] : []),
        ],
        rawText: rawText(raw.items),
      };
    });
    const hasText = rawPages.some((p) =>
      p.items.some((item) => item.str.trim()),
    );
    return {
      book: {
        id,
        name: file.name,
        size: file.size,
        totalPages: pdf.numPages,
        blockCount: blocks.length,
        importedAt: Date.now(),
        status: !hasText
          ? "source-only"
          : diagnostics.some((d) => d.quality !== "supported")
            ? "review"
            : "ready",
        parserRevision: PARSER_REVISION,
        diagnostics,
      },
      blocks,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException")
      throw new Error("暂不支持密码加密 PDF，请先用原软件解密后重新导入。");
    throw error;
  } finally {
    await task.destroy();
  }
}

function looksTabular(items: PdfRawTextItem[]): boolean {
  // Conservative flag only: there is no claim of semantic table reconstruction.
  const short = items.filter((i) => i.str.trim() && i.str.length < 18);
  return short.length >= 18 && short.length > items.length * 0.6;
}
