/** UTF-16 ranges match PDF block locators and DOM text offsets. Plain text stays authoritative. */
export interface TextStyleRange {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
}

export function appendStyleRange(
  ranges: TextStyleRange[],
  range: TextStyleRange,
): void {
  if (range.end <= range.start || (!range.bold && !range.italic)) return;
  const previous = ranges.at(-1);
  if (
    previous?.end === range.start &&
    !!previous.bold === !!range.bold &&
    !!previous.italic === !!range.italic
  )
    previous.end = range.end;
  else ranges.push({ ...range });
}

export function clipStyleRanges(
  ranges: TextStyleRange[] | undefined,
  start: number,
  end: number,
): TextStyleRange[] {
  return (ranges ?? []).flatMap((range) => {
    const left = Math.max(start, range.start),
      right = Math.min(end, range.end);
    return right > left
      ? [{ ...range, start: left - start, end: right - start }]
      : [];
  });
}

export function styledSegments(text: string, ranges?: TextStyleRange[]) {
  const segments: Array<{ text: string; bold?: boolean; italic?: boolean }> =
    [];
  let cursor = 0;
  for (const range of ranges ?? []) {
    const start = Math.max(cursor, range.start),
      end = Math.min(text.length, range.end);
    if (end <= start) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    segments.push({
      text: text.slice(start, end),
      bold: range.bold,
      italic: range.italic,
    });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
