import { describe, expect, it } from "vitest";
import type { ReadingBlock } from "../types";
import { sourcePageForOffset } from "./sourceLocation";
const block = {
  fragments: [{ page: 3 }, { page: 4 }],
  sourceRanges: [
    { page: 3, start: 0, end: 99 },
    { page: 4, start: 100, end: 170 },
  ],
} as ReadingBlock;
describe("original page locations inside a continued paragraph", () => {
  it("distinguishes the original pages at a character boundary and its inserted space", () => {
    expect(sourcePageForOffset(block, 50)).toBe(3);
    expect(sourcePageForOffset(block, 99)).toBe(3);
    expect(sourcePageForOffset(block, 100)).toBe(4);
    expect(sourcePageForOffset(block, 170)).toBe(4);
  });
  it("can still open the first source page of an old cached paragraph", () => {
    expect(
      sourcePageForOffset({ fragments: [{ page: 7 }] } as ReadingBlock, 80),
    ).toBe(7);
    expect(sourcePageForOffset(undefined)).toBe(1);
  });
});
