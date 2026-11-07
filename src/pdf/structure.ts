import type { PdfPaperDocument, PdfRawTextItem } from "./reconstruct";
import { PARSER_REVISION, type ReadingBlock } from "../types";
import { clipStyleRanges } from "./textStyle";
import { continuationContext, pageContinuation } from "./continuation";

export function rawText(items: PdfRawTextItem[]): string {
  return items
    .map((item) => item.str + (item.hasEOL ? "\n" : " "))
    .join("")
    .trim();
}

export function assembleBlocks(
  bookId: string,
  paper: PdfPaperDocument,
  rawPages: PdfRawTextItem[][],
): ReadingBlock[] {
  const output: ReadingBlock[] = [];
  const itemMaps = rawPages.map(
    (items) =>
      new Map(items.map((item, index) => [item.sourceIndex ?? index, item])),
  );
  const context = continuationContext(paper, itemMaps);
  // Include rejected/empty pages explicitly, so images or extraction failures never silently disappear.
  for (const page of paper.pages) {
    const blocks = paper.blocks.filter(
      (block) => block.fragments[0]?.page === page.page,
    );
    if (page.quality === "rejected" || blocks.length === 0) {
      output.push({
        id: `${bookId}:${PARSER_REVISION}:raw-${page.page}`,
        kind: "paragraph",
        text:
          rawText(rawPages[page.page - 1] ?? []) ||
          "本页没有可提取的文字。请打开原始 PDF 查看图片或扫描内容。",
        rawText: rawText(rawPages[page.page - 1] ?? []),
        warning:
          "本页无法可靠重排。以下为提取顺序的原始文本；图表和阅读顺序请核对原页。",
        readingOrder: output.length,
        column: "span",
        confidence: 0,
        fragments: [{ page: page.page, left: 0, top: 0, width: 1, height: 1 }],
        sourceItems: [],
      });
      continue;
    }
    for (const [blockIndex, block] of blocks.entries()) {
      let previousIndex = output.length - 1;
      // Footnotes remain separate after the complete body paragraph, rather than breaking its flow.
      while (previousIndex >= 0 && output[previousIndex].kind === "footnote")
        previousIndex--;
      const previous = output[previousIndex];
      const source = block.sourceItems
        .map((item) => itemMaps[item.page - 1]?.get(item.index))
        .filter((v): v is PdfRawTextItem => !!v);
      const next: ReadingBlock = {
        ...block,
        id: `${bookId}:${PARSER_REVISION}:${block.id}:${block.readingOrder}`,
        rawText: rawText(source),
        sourceRanges: [
          { start: 0, end: block.text.length, page: block.fragments[0].page },
        ],
        warning:
          page.quality === "review"
            ? "本页存在复杂排版，请核对原始 PDF。"
            : undefined,
      };
      const join =
        previous && blockIndex === 0
          ? pageContinuation(previous, next, context)
          : undefined;
      if (join) {
        const prefixLength = previous.text.length - (join.removeHyphen ? 1 : 0);
        const offset = prefixLength + join.separator.length;
        previous.styles = [
          ...clipStyleRanges(previous.styles, 0, prefixLength),
          ...(block.styles ?? []).map((style) => ({
            ...style,
            start: style.start + offset,
            end: style.end + offset,
          })),
        ];
        previous.sourceRanges = [
          ...(previous.sourceRanges ?? [])
            .map((range) => ({
              ...range,
              end: Math.min(range.end, prefixLength),
            }))
            .filter((range) => range.end > range.start),
          ...next.sourceRanges!.map((range) => ({
            ...range,
            start: range.start + offset,
            end: range.end + offset,
          })),
        ];
        previous.text =
          previous.text.slice(0, prefixLength) + join.separator + block.text;
        previous.rawText += "\n" + next.rawText;
        previous.fragments.push(...block.fragments);
        previous.sourceItems.push(...block.sourceItems);
      } else output.push(next);
    }
  }
  return output.map((block, readingOrder) => ({ ...block, readingOrder }));
}
