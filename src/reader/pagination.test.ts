import { describe, expect, it } from "vitest";
import { fractionForPosition, pageForPosition } from "./pagination";
import type { ReadingBlock, ReadingPage } from "../types";

const page = (start: number, end: number): ReadingPage => ({
  anchor: { blockId: "b", offset: start },
  fragments: [{ blockId: "b", start, end, text: "", kind: "paragraph" }],
});
describe("source based reading positions", () => {
  it("restores a translated-only page and falls back to the source when bilingual mode is disabled", () => {
    const translatedPage: ReadingPage = {
      anchor: { blockId: "b", offset: 99, translationOffset: 50 },
      fragments: [{ blockId: "b", start: 50, end: 100, text: "译文", kind: "paragraph", translated: true }],
    };
    const position = translatedPage.anchor;
    expect(pageForPosition([page(0, 100), translatedPage], position)).toBe(1);
    expect(pageForPosition([page(0, 100)], position)).toBe(0);
    expect(fractionForPosition([{ id: "b", text: "a".repeat(100) }] as ReadingBlock[], position)).toBe(0.99);
  });
  it("finds the page containing an offset after font-size or viewport changes", () => {
    const position = { blockId: "b", offset: 75 };
    expect(pageForPosition([page(0, 50), page(50, 100)], position)).toBe(1);
    expect(pageForPosition([page(0, 100)], position)).toBe(0);
    expect(pageForPosition([page(0, 75), page(75, 100)], position)).toBe(1);
  });
  it("keeps document progression independent of rendered page count", () => {
    const blocks = [
      { id: "a", text: "a".repeat(100) },
      { id: "b", text: "b".repeat(100) },
    ] as ReadingBlock[];
    expect(fractionForPosition(blocks, { blockId: "b", offset: 50 })).toBe(
      0.75,
    );
    expect(pageForPosition([], { blockId: "missing", offset: 90 })).toBe(0);
  });
});
