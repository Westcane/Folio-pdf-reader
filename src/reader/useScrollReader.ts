import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Book, ReadingBlock, ReadingProgress, Settings } from "../types";
import { fractionForPosition } from "./pagination";
import { sourcePageForOffset } from "./sourceLocation";
import { anchorRect, captureScrollAnchor, estimateBlockHeight, READING_GUIDE, type ScrollAnchor } from "./scrollPosition";

export interface ReaderState {
  page: number; pages: number; anchor?: ReadingProgress;
  width: number; height: number; paginating: boolean;
  mode: "scroll"; renderedBlocks: number;
}
interface Input {
  book: Book; blocks: ReadingBlock[]; settings: Settings;
  initialProgress?: ReadingProgress; translations: Record<string, string>;
  collapsed: Set<string>; presentationReady: boolean;
  onProgress: (progress: ReadingProgress) => void; onState: (state: ReaderState) => void;
}
export function useScrollReader({ book, blocks, settings, initialProgress, translations, collapsed, presentationReady, onProgress, onState }: Input) {
  const scroll = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const anchor = useRef<ScrollAnchor>({ position: initialProgress ?? { blockId: blocks[0]?.id ?? "", offset: 0 }, inset: 0 });
  const restoring = useRef(true);
  const [busy, setBusy] = useState(true);
  const [position, setPosition] = useState(initialProgress ?? { blockId: blocks[0]?.id ?? "", offset: 0 });
  const [size, setSize] = useState({ width: 600, height: 800 });
  const itemKey = useCallback((index: number) => blocks[index].id, [blocks]);
  const virtual = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: book.status === "source-only" ? 0 : blocks.length, getScrollElement: () => scroll.current,
    getItemKey: itemKey,
    measureElement: (element) => element.getBoundingClientRect().height,
    estimateSize: (index) => estimateBlockHeight(blocks[index], size.width, settings.fontSize, settings.lineHeight,
      settings.bilingual ? translations[blocks[index].id] : undefined, collapsed.has(blocks[index].id)),
    overscan: 5, paddingStart: 64, paddingEnd: 100, scrollPaddingStart: READING_GUIDE,
    useFlushSync: false,
  });
  useLayoutEffect(() => {
    if (!column.current || !scroll.current) return;
    const observer = new ResizeObserver(() => {
      if (!column.current || !scroll.current) return;
      const width = Math.round(column.current.clientWidth), height = Math.round(scroll.current.clientHeight);
      setSize((old) => old.width === width && old.height === height ? old : { width, height });
    });
    observer.observe(column.current); observer.observe(scroll.current);
    return () => observer.disconnect();
  }, []);

  const capture = useCallback(() => {
    if (restoring.current || !scroll.current) return anchor.current;
    const captured = captureScrollAnchor(scroll.current);
    if (captured) anchor.current = captured;
    return anchor.current;
  }, []);
  const save = useCallback(() => {
    if (restoring.current || !blocks.length) return;
    const current = capture().position;
    setPosition(current);
    const element = scroll.current;
    onProgress({ ...current, bookId: book.id,
      fraction: element && element.scrollHeight - element.scrollTop - element.clientHeight < 3 ? 1 : fractionForPosition(blocks, current), updatedAt: Date.now() });
  }, [capture, blocks, book.id, onProgress]);

  useLayoutEffect(() => {
    if (!presentationReady || !scroll.current || !blocks.length || book.status === "source-only") { if (!blocks.length || book.status === "source-only") { restoring.current = false; setBusy(false); } return; }
    restoring.current = true; setBusy(true);
    virtual.measure();
    // measure() clears size caches. Re-measure mounted rows even when no ResizeObserver event fires.
    for (const element of scroll.current.querySelectorAll<HTMLElement>(".reading-block")) virtual.resizeItem(Number(element.dataset.index), element.getBoundingClientRect().height);
    let frame = 0, count = 0, stable = 0;
    const saved = anchor.current;
    const index = Math.max(0, blocks.findIndex((block) => block.id === saved.position.blockId));
    virtual.scrollToIndex(index, { align: "start" });
    const settle = () => {
      const element = scroll.current;
      if (!element) return;
      // A jump can mount additional rows whose first observer event was deferred during scrollToIndex.
      for (const row of element.querySelectorAll<HTMLElement>(".reading-block")) virtual.resizeItem(Number(row.dataset.index), row.getBoundingClientRect().height);
      const rect = anchorRect(element, saved.position);
      if (!rect) { virtual.scrollToIndex(index, { align: "start" }); stable = 0; }
      else {
        const delta = rect.top - element.getBoundingClientRect().top - READING_GUIDE - saved.inset;
        if (Math.abs(delta) > 1) { element.scrollTop += delta; stable = 0; }
        else stable++;
      }
      if (++count < 24 && stable < 4) frame = requestAnimationFrame(settle);
      else { restoring.current = false; setBusy(false); setPosition(saved.position); }
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [book.status, blocks, presentationReady, size.width, size.height, settings.fontSize, settings.lineHeight, settings.margin, settings.bilingual, translations, collapsed, virtual]);

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    let frame = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (restoring.current) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setPosition(capture().position));
      clearTimeout(timer); timer = setTimeout(save, 180);
    };
    const hidden = () => { if (document.visibilityState === "hidden") save(); };
    element.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", save);
    return () => { element.removeEventListener("scroll", onScroll); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", save); clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [capture, save]);
  const currentBlock = blocks.find((block) => block.id === position.blockId);
  const sourcePage = sourcePageForOffset(currentBlock, position.offset);
  const fraction = blocks.length ? fractionForPosition(blocks, position) : 0;
  const rows = virtual.getVirtualItems();
  useEffect(() => {
    onState({ page: sourcePage, pages: book.totalPages, anchor: { ...position, bookId: book.id, fraction, updatedAt: Date.now() }, ...size, paginating: busy, mode: "scroll", renderedBlocks: rows.length });
  }, [sourcePage, book.totalPages, book.id, position, fraction, size, busy, rows.length, onState]);
  const visibleBlocks = () => {
    const element = scroll.current;
    if (!element) return [];
    const rect = element.getBoundingClientRect();
    const ids = new Set([...element.querySelectorAll<HTMLElement>(".reading-block")].filter((node) => {
      const block = node.getBoundingClientRect(); return block.bottom > rect.top + READING_GUIDE && block.top < rect.bottom;
    }).map((node) => node.dataset.blockId));
    return blocks.filter((block) => ids.has(block.id));
  };
  return { scroll, column, virtual, rows, busy, capture, save, sourcePage, currentBlock, fraction, visibleBlocks,
    restoreAnchor: (value: ScrollAnchor) => { anchor.current = value; } };
}
