import { describe, expect, it } from "vitest";
import type { ReadingBlock, ReadingProgress } from "../types";
import { remapProgress } from "./remapProgress";
const block = (id: string, text: string, indexes: number[]): ReadingBlock => ({
  id,
  text,
  rawText: text,
  readingOrder: 0,
  kind: "paragraph",
  column: "span",
  confidence: 1,
  fragments: [{ page: 1, left: 0.1, top: 0.2, width: 0.8, height: 0.1 }],
  sourceItems: indexes.map((index) => ({ page: 1, index })),
});
const progress: ReadingProgress = {
  bookId: "doc",
  blockId: "old",
  offset: 12,
  fraction: 0.25,
  updatedAt: 1,
};
describe("reading progress after parser updates", () => {
  it("moves an old next-page locator into the merged logical paragraph", () => {
    const before = block("before", "The previous page continues with", [1]);
    const after = block(
      "old",
      "the remainder of the same paragraph on the next page.",
      [2],
    );
    const merged = {
      ...before,
      id: "joined",
      text: before.text + " " + after.text,
      sourceItems: [...before.sourceItems, ...after.sourceItems],
    };
    expect(
      remapProgress([before, after], [merged], { ...progress, offset: 4 }),
    ).toMatchObject({ blockId: "joined", offset: before.text.length + 1 + 4 });
  });
  it("finds the same body excerpt after separating a chapter marker", () => {
    const text =
      "A chapter begins with a long paragraph for a reading position.";
    const before = block("old", "one " + text, [1, 2]);
    const after = [block("chapter", "one", [1]), block("body", text, [2])];
    expect(remapProgress([before], after, progress)).toMatchObject({
      blockId: "body",
      offset: 8,
      updatedAt: 1,
    });
  });
  it("keeps a locator at the former joined chapter boundary on its heading", () => {
    const before = block("old", "one A chapter begins.", [1, 2, 3, 4]);
    expect(
      remapProgress(
        [before],
        [
          block("chapter", "one", [1]),
          block("body", "A chapter begins.", [2, 3, 4]),
        ],
        { ...progress, offset: 0 },
      ),
    ).toMatchObject({ blockId: "chapter", offset: 0 });
  });
});
