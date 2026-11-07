import type { ReadingBlock } from "../types";
import type {
  PdfAnalyzedPage,
  PdfPaperDocument,
  PdfRawTextItem,
} from "./reconstruct";
import { describeFont } from "./fontStyle";

type SourceMap = ReadonlyMap<number, PdfRawTextItem>;
interface Line {
  left: number;
  right: number;
  top: number;
  bottom: number;
  fontSize: number;
  family: string;
  characters: number;
  italic: number;
  bold: number;
}

export function continuationContext(
  paper: PdfPaperDocument,
  items: SourceMap[],
) {
  const bottoms = paper.pages
    .filter((page) => page.quality === "supported" && page.columnCount === 1)
    .flatMap((page) => {
      const fragments = paper.blocks
        .filter((block) => block.kind === "paragraph")
        .flatMap((block) => block.fragments)
        .filter((rect) => rect.page === page.page);
      return fragments.length
        ? [Math.max(...fragments.map((rect) => rect.top + rect.height))]
        : [];
    })
    .sort((a, b) => a - b);
  return {
    pages: new Map(paper.pages.map((page) => [page.page, page])),
    items,
    // A document's normal text bottom is more useful than the physical paper edge.
    bottom: bottoms[Math.ceil((bottoms.length - 1) * 0.75)] ?? 0.9,
  };
}

function sourceLines(
  block: ReadingBlock,
  page: PdfAnalyzedPage,
  source: SourceMap,
): Line[] {
  const items = block.sourceItems
    .filter((item) => item.page === page.page)
    .flatMap((item) => {
      const raw = source.get(item.index);
      if (!raw?.str.trim()) return [];
      const fontSize = Math.max(
        1,
        Math.abs(raw.height) || Math.hypot(raw.transform[2], raw.transform[3]),
      );
      const top =
        raw.coordinateSpace === "viewport"
          ? (raw.transform[5] - fontSize) / page.height
          : (page.height - raw.transform[5] - fontSize) / page.height;
      const font = describeFont(raw.fontName);
      return [
        {
          left: raw.transform[4],
          right: raw.transform[4] + Math.abs(raw.width),
          top,
          bottom: top + fontSize / page.height,
          fontSize,
          family: raw.fontFamily ?? font.fontFamily,
          characters: raw.str.trim().length,
          italic: (raw.italic ?? font.italic) ? raw.str.trim().length : 0,
          bold: (raw.bold ?? font.bold) ? raw.str.trim().length : 0,
        },
      ];
    })
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Line[] = [];
  for (const item of items) {
    const line = lines.at(-1);
    if (
      line &&
      Math.abs(line.top - item.top) * page.height <=
        Math.max(line.fontSize, item.fontSize) * 0.45
    ) {
      line.left = Math.min(line.left, item.left);
      line.right = Math.max(line.right, item.right);
      line.bottom = Math.max(line.bottom, item.bottom);
      if (item.characters > line.characters) line.family = item.family;
      line.characters += item.characters;
      line.italic += item.italic;
      line.bold += item.bold;
    } else lines.push({ ...item });
  }
  return lines;
}

/** Returns a textual join only for compatible body flow at an adjacent page edge.
 * A page turn alone is never evidence of a new paragraph or of a continuation. */
export function pageContinuation(
  previous: ReadingBlock,
  next: ReadingBlock,
  context: ReturnType<typeof continuationContext>,
) {
  const beforeNumber = previous.fragments.at(-1)?.page,
    afterNumber = next.fragments[0]?.page;
  if (
    !beforeNumber ||
    !afterNumber ||
    beforeNumber + 1 !== afterNumber ||
    previous.kind !== "paragraph" ||
    next.kind !== "paragraph" ||
    previous.warning ||
    next.warning
  )
    return undefined;
  const before = context.pages.get(beforeNumber),
    after = context.pages.get(afterNumber);
  if (
    !before ||
    !after ||
    before.columnCount !== 1 ||
    after.columnCount !== 1 ||
    before.quality !== "supported" ||
    after.quality !== "supported" ||
    Math.abs(before.width - after.width) > before.width * 0.06
  )
    return undefined;
  const tail = sourceLines(previous, before, context.items[beforeNumber - 1]);
  const head = sourceLines(next, after, context.items[afterNumber - 1]);
  const last = tail.at(-1),
    first = head[0];
  if (
    !last ||
    !first ||
    first.top > 0.2 ||
    last.bottom < 0.72 ||
    Math.abs(last.fontSize - first.fontSize) >
      Math.max(1, last.fontSize * 0.12) ||
    last.family !== first.family
  )
    return undefined;
  const hyphenated =
    /\p{L}[-\u00ad]$/u.test(previous.text) && /^\p{Ll}/u.test(next.text);
  const compatible = [...tail, ...head].filter(
    (line) =>
      line.family === last.family &&
      Math.abs(line.fontSize - last.fontSize) <= 1,
  );
  const left = Math.min(...compatible.map((line) => line.left));
  const right = Math.max(...compatible.map((line) => line.right));
  // A newly indented first line is a real paragraph boundary, even after a full last line.
  if (
    first.left - left > last.fontSize * 0.7 ||
    Math.abs(first.left - last.left) > last.fontSize * 0.8
  )
    return undefined;
  if (hyphenated) return { removeHyphen: true, separator: "" };
  if (
    last.bottom <
    Math.max(0.72, context.bottom - (2.5 * last.fontSize) / before.height)
  )
    return undefined;
  const fill = (last.right - last.left) / Math.max(1, right - left);
  if (fill < 0.84) return undefined;
  const emphasis = (lines: Line[], key: "italic" | "bold") =>
    lines.reduce((n, line) => n + line[key], 0) /
      Math.max(
        1,
        lines.reduce((n, line) => n + line.characters, 0),
      ) >
    0.8;
  if (
    emphasis(tail, "italic") !== emphasis(head, "italic") ||
    emphasis(tail, "bold") !== emphasis(head, "bold")
  )
    return undefined;
  // Fresh dialogue, list markers and an isolated separator start their own block.
  if (/^(?:[“‘"«]|[-•▪◦]\s|[#*]{1,5}$)/u.test(next.text.trim()))
    return undefined;
  const sentenceEnd = /[.!?。！？…][”’"'»\])]*$/u.test(previous.text.trim());
  // A sentence can end inside a continued paragraph; demand a nearly full line in this case.
  if (sentenceEnd && fill < 0.97) return undefined;
  const noSpace =
    /[\u2e80-\u9fff\uf900-\ufaff]$/u.test(previous.text) ||
    /^[\u2e80-\u9fff\uf900-\ufaff,.;!?，。；！？、\])]/u.test(next.text);
  return { removeHyphen: false, separator: noSpace ? "" : " " };
}
