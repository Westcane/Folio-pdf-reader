import type { ReadingBlock, ReadingPosition } from "../types";

export interface ScrollAnchor { position: ReadingPosition; inset: number }
export const READING_GUIDE = 58;

function textPoint(element: HTMLElement, offset: number): [Text, number] | undefined {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (offset < node.length) return [node, offset];
    offset -= node.length;
    node = walker.nextNode() as Text | null;
  }
}
export function characterRect(element: HTMLElement, offset: number): DOMRect | undefined {
  const length = element.textContent?.length ?? 0;
  if (!length) return;
  const point = textPoint(element, Math.min(length - 1, Math.max(0, offset)));
  if (!point) return;
  const range = document.createRange();
  range.setStart(...point);
  range.setEnd(point[0], Math.min(point[0].length, point[1] + 1));
  return range.getBoundingClientRect();
}

/** Locate a source/translation character, not a virtual row or an unstable scroll fraction. */
export function captureScrollAnchor(scroller: HTMLElement): ScrollAnchor | undefined {
  const guide = scroller.getBoundingClientRect().top + READING_GUIDE;
  const segments = [...scroller.querySelectorAll<HTMLElement>("[data-reading-text]")]
    .filter((element) => element.getBoundingClientRect().height > 0);
  const element = segments.find((node) => node.getBoundingClientRect().bottom > guide) ?? segments.at(-1);
  if (!element) return;
  const length = element.textContent?.length ?? 0;
  let low = 0, high = Math.max(0, length - 1);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((characterRect(element, middle)?.bottom ?? 0) <= guide) low = middle + 1;
    else high = middle;
  }
  // Store the first character of the current visual line, preserving inline emphasis offsets.
  const rect = characterRect(element, low) ?? element.getBoundingClientRect();
  const translated = element.dataset.readingText === "translation";
  const sourceLength = Number(element.dataset.sourceLength ?? length);
  return {
    position: { blockId: element.dataset.blockId!, offset: translated ? Math.max(0, sourceLength - 1) : low,
      ...(translated ? { translationOffset: low } : {}) },
    inset: Math.min(120, Math.max(-100, rect.top - guide)),
  };
}
export function anchorRect(scroller: HTMLElement, position: ReadingPosition): DOMRect | undefined {
  const elements = [...scroller.querySelectorAll<HTMLElement>("[data-reading-text]")];
  const translated = position.translationOffset !== undefined;
  const element = elements.find((node) => node.dataset.blockId === position.blockId && node.dataset.readingText === (translated ? "translation" : "source") && node.getBoundingClientRect().height > 0)
    ?? elements.find((node) => node.dataset.blockId === position.blockId && node.dataset.readingText === "source");
  if (!element) return;
  return characterRect(element, element.dataset.readingText === "translation" ? position.translationOffset ?? 0 : position.offset);
}

export function estimateBlockHeight(block: ReadingBlock, width: number, fontSize: number, leading: number, translation?: string, collapsed = false): number {
  const columns = Math.max(8, width / (fontSize * 0.51));
  const source = Math.max(1, Math.ceil(block.text.length / columns)) * fontSize * leading;
  const chinese = translation && !collapsed ? Math.ceil(translation.length / Math.max(6, width / (fontSize * 0.94))) * fontSize * leading : 0;
  return source + chinese + (translation ? 34 : 0) + fontSize * 1.2;
}
