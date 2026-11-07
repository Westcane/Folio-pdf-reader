import type {
  PageFragment,
  ReadingBlock,
  ReadingPage,
  ReadingPosition,
  Settings,
} from "../types";
import { clipStyleRanges, type TextStyleRange } from "../pdf/textStyle";
import { blockGap, isHeading, renderMeasuredText } from "./typography";

export function pageForPosition(
  pages: ReadingPage[],
  position?: ReadingPosition,
): number {
  if (!position) return 0;
  if (position.translationOffset !== undefined) {
    const translated = pages.findIndex((page) => page.fragments.some((f) =>
      f.translated && f.blockId === position.blockId && f.start <= position.translationOffset! && position.translationOffset! < f.end));
    if (translated >= 0) return translated;
  }
  const exact = pages.findIndex((page) =>
    page.fragments.some(
      (f) =>
        !f.translated &&
        f.blockId === position.blockId &&
        f.start <= position.offset &&
        position.offset < f.end,
    ),
  );
  if (exact >= 0) return exact;
  return Math.max(
    0,
    pages.findIndex((page) =>
      page.fragments.some((f) => f.blockId === position.blockId),
    ),
  );
}

export function fractionForPosition(
  blocks: ReadingBlock[],
  position: ReadingPosition,
): number {
  let total = 0,
    before = 0,
    found = false;
  for (const block of blocks) {
    if (block.id === position.blockId) {
      before = total + Math.min(position.offset, block.text.length);
      found = true;
    }
    total += block.text.length;
  }
  return total && found ? Math.min(1, before / total) : 0;
}

/** Greedy, measured pages shared by horizontal and vertical reading modes.
 * Offsets use JS/DOM UTF-16 positions; cuts do not split surrogate pairs. */
export async function paginate(
  blocks: ReadingBlock[],
  host: HTMLElement,
  width: number,
  height: number,
  settings: Settings,
  signal: AbortSignal,
  translations: Readonly<Record<string, string>> = {},
): Promise<ReadingPage[]> {
  if (signal.aborted)
    throw new DOMException("Pagination aborted", "AbortError");
  host.style.width = `${Math.max(80, width)}px`;
  host.style.fontSize = `${settings.fontSize}px`;
  host.style.lineHeight = String(settings.lineHeight);
  const probe = document.createElement("p");
  host.replaceChildren(probe);
  const pages: ReadingPage[] = [];
  let current: PageFragment[] = [],
    used = 0;
  let lastSource: ReadingPosition | undefined;
  const flush = () => {
    if (!current.length) return;
    const source = current.find((f) => !f.translated) ?? current[0];
    pages.push({
      fragments: current,
      anchor: {
        blockId: source.blockId,
        offset: source.translated ? (lastSource?.blockId === source.blockId ? lastSource.offset : 0) : source.start,
        ...(source.translated ? { translationOffset: source.start } : {}),
      },
    });
    current = [];
    used = 0;
  };
  const measure = (
    text: string,
    kind: ReadingBlock["kind"],
    translated: boolean,
    styles?: TextStyleRange[],
  ) => {
    probe.className = `text-block kind-${kind}${translated ? " translated" : ""}`;
    renderMeasuredText(probe, text, styles);
    return probe.getBoundingClientRect().height;
  };
  let operations = 0;
  for (const [blockIndex, block] of blocks.entries()) {
    const translation = settings.bilingual ? translations[block.id] : undefined;
    const units = [
      { text: block.text, translated: false },
      ...(translation ? [{ text: translation, translated: true }] : []),
    ];
    for (const unit of units) {
      let start = 0;
      while (start < unit.text.length) {
        if (signal.aborted)
          throw new DOMException("Pagination aborted", "AbortError");
        const previous = current.at(-1);
        const gap = previous
          ? blockGap(previous.kind, block.kind, settings.fontSize)
          : 0;
        const styles = unit.translated ? undefined : block.styles;
        // Keep a short heading with at least the first two lines of its following paragraph.
        if (
          !start &&
          !unit.translated &&
          isHeading(block.kind) &&
          current.length &&
          blocks[blockIndex + 1]
        ) {
          const ownHeight = measure(unit.text, block.kind, false, styles);
          const follow = blocks[blockIndex + 1];
          const reserved =
            blockGap(block.kind, follow.kind, settings.fontSize) +
            settings.fontSize * settings.lineHeight * 2;
          if (
            ownHeight + reserved < height &&
            used + gap + ownHeight + reserved > height - 2
          ) {
            flush();
            continue;
          }
        }
        const available = Math.max(1, height - used - gap - 2);
        const remainder = unit.text.slice(start);
        let end = unit.text.length;
        if (
          measure(
            remainder,
            block.kind,
            unit.translated,
            clipStyleRanges(styles, start, unit.text.length),
          ) > available
        ) {
          let low = 0,
            high = remainder.length;
          while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (
              measure(
                remainder.slice(0, mid),
                block.kind,
                unit.translated,
                clipStyleRanges(styles, start, start + mid),
              ) <= available
            )
              low = mid;
            else high = mid - 1;
          }
          // Start a fresh page if there is not enough room for a meaningful first line.
          if (low < 12 && current.length) {
            flush();
            continue;
          }
          let length = Math.max(1, low);
          const prefix = remainder.slice(0, length);
          const lastSpace = prefix.lastIndexOf(" ");
          if (lastSpace > length * 0.65) length = lastSpace + 1;
          const code = remainder.charCodeAt(length - 1);
          if (code >= 0xd800 && code <= 0xdbff)
            length = Math.max(2, length - 1);
          end = Math.min(unit.text.length, start + length);
        }
        const fragment = {
          blockId: block.id,
          start,
          end,
          text: unit.text.slice(start, end),
          kind: block.kind,
          translated: unit.translated,
          styles: clipStyleRanges(styles, start, end),
          gapBefore: gap,
        };
        const measured = measure(
          fragment.text,
          block.kind,
          unit.translated,
          fragment.styles,
        );
        if (current.length && measured > available + 1) {
          flush();
          continue;
        }
        current.push(fragment);
        if (!unit.translated) lastSource = { blockId: block.id, offset: Math.max(start, end - 1) };
        used += measured + (current.length > 1 ? gap : 0);
        start = end;
        if (start < unit.text.length) flush();
        if (++operations % 24 === 0)
          await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
  if (signal.aborted)
    throw new DOMException("Pagination aborted", "AbortError");
  flush();
  host.replaceChildren();
  return pages;
}
