import type { ReadingBlock, ReadingProgress } from "../types";

/** Parser revisions can split a former paragraph into a heading and body. Prefer
 * a source-item match plus the actual reading excerpt over an unstable page number. */
export function remapProgress(
  oldBlocks: ReadingBlock[],
  blocks: ReadingBlock[],
  progress: ReadingProgress,
): ReadingProgress {
  if (!blocks.length || blocks.some((block) => block.id === progress.blockId))
    return progress;
  const old = oldBlocks.find((block) => block.id === progress.blockId);
  const source = new Set(
    old?.sourceItems.map((item) => `${item.page}:${item.index}`),
  );
  const candidates = blocks
    .map((block) => ({
      block,
      score: block.sourceItems.filter((item) =>
        source.has(`${item.page}:${item.index}`),
      ).length,
    }))
    .sort((a, b) => b.score - a.score);
  let target: ReadingBlock | undefined,
    offset = 0;
  if (old) {
    for (const size of [64, 24]) {
      const excerpt = old.text.slice(progress.offset, progress.offset + size);
      if (!excerpt) continue;
      const match = candidates.find(({ block }) =>
        block.text.includes(excerpt),
      );
      if (match) {
        target = match.block;
        offset = target.text.indexOf(excerpt);
        break;
      }
    }
    if (!target && progress.offset === 0)
      target = candidates.find(({ block }) => old.text.startsWith(block.text))?.block;
    if (!target)
      target =
        candidates.find((candidate) => candidate.score > 0)?.block ??
        blocks.find((block) =>
          block.fragments.some(
            (fragment) => fragment.page === old.fragments[0]?.page,
          ),
        );
  }
  if (!target) {
    const total = blocks.reduce((n, block) => n + block.text.length, 0);
    let remaining = Math.max(0, Math.min(1, progress.fraction)) * total;
    target = blocks.at(-1)!;
    for (const block of blocks) {
      if (remaining < block.text.length) {
        target = block;
        offset = Math.floor(remaining);
        break;
      }
      remaining -= block.text.length;
    }
  }
  const index = blocks.indexOf(target);
  const before = blocks
    .slice(0, index)
    .reduce((n, block) => n + block.text.length, 0);
  const total = blocks.reduce((n, block) => n + block.text.length, 0);
  return {
    ...progress,
    blockId: target.id,
    offset,
    translationOffset: undefined,
    fraction: total ? (before + offset) / total : 0,
  };
}
