import type { ReadingBlock } from "../types";
import { styledSegments, type TextStyleRange } from "../pdf/textStyle";

export function isHeading(kind: ReadingBlock["kind"]) {
  return kind === "title" || kind === "heading" || kind === "chapter";
}

/** Used by both the page measurer and visible fragments; never duplicate spacing in CSS. */
export function blockGap(
  previous: ReadingBlock["kind"],
  next: ReadingBlock["kind"],
  fontSize: number,
): number {
  if (next === "title") return fontSize * 1.5;
  if (next === "chapter") return fontSize * 1.7;
  if (next === "heading") return fontSize * 1.4;
  if (previous === "title") return fontSize * 0.9;
  if (previous === "heading") return fontSize * 0.5;
  if (previous === "chapter") return fontSize * 0.65;
  return fontSize * 0.8;
}

export function renderMeasuredText(
  element: HTMLElement,
  text: string,
  styles?: TextStyleRange[],
) {
  const nodes = styledSegments(text, styles).map((segment) => {
    if (!segment.bold && !segment.italic)
      return document.createTextNode(segment.text);
    const span = document.createElement("span");
    if (segment.bold) span.style.fontWeight = "700";
    if (segment.italic) span.style.fontStyle = "italic";
    span.textContent = segment.text;
    return span;
  });
  element.replaceChildren(...nodes);
}
