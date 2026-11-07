import type { ReadingBlock } from "../types";

export function sourcePageForOffset(
  block: ReadingBlock | undefined,
  offset = 0,
): number {
  const ranges = block?.sourceRanges;
  const exact = ranges?.find(
    (range) => range.start <= offset && offset < range.end,
  );
  if (exact) return exact.page;
  return (
    ranges?.findLast((range) => range.start <= offset)?.page ??
    block?.fragments[0]?.page ??
    1
  );
}
