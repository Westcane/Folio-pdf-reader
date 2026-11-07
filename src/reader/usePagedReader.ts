import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { Book, ReadingBlock, ReadingPage, ReadingPosition, ReadingProgress, Settings } from "../types";
import { fractionForPosition, pageForPosition, paginate } from "./pagination";
import { anchorRect, captureScrollAnchor, READING_GUIDE, type ScrollAnchor } from "./scrollPosition";

export interface ReaderState {
  page: number; pages: number; anchor?: ReadingPosition;
  width: number; height: number; paginating: boolean;
  mode: "scroll" | "horizontal"; renderedBlocks: number;
}
interface Input {
  book: Book; blocks: ReadingBlock[]; settings: Settings; initialProgress?: ReadingProgress;
  translations: Record<string, string>; collapsed: Set<string>; presentationReady: boolean;
  onProgress: (progress: ReadingProgress) => void; onState: (state: ReaderState) => void; onError: (error: unknown) => void;
}
export function usePagedReader({ book, blocks, settings, initialProgress, translations, collapsed, presentationReady, onProgress, onState, onError }: Input) {
  const scroll = useRef<HTMLDivElement>(null), column = useRef<HTMLDivElement>(null), measure = useRef<HTMLDivElement>(null);
  const anchor = useRef<ReadingPosition>(initialProgress ?? { blockId: blocks[0]?.id ?? "", offset: 0 });
  const viewportAnchor = useRef<ScrollAnchor>({ position: anchor.current, inset: 0 });
  const mode = useRef(settings.readingMode);
  mode.current = settings.readingMode;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pages, setPages] = useState<ReadingPage[]>([]), [index, setIndex] = useState(0), [busy, setBusy] = useState(true);
  const [navigation, setNavigation] = useState(0);
  const indexRef = useRef(0), restoring = useRef(true), pagesRef = useRef(pages);
  pagesRef.current = pages;
  const visibleTranslations = useMemo(() => Object.fromEntries(Object.entries(translations).filter(([id]) => !collapsed.has(id))), [translations, collapsed]);
  // Keep the anchor page mounted while pagination changes its index, so a single layout
  // restoration can preserve the exact text line instead of first snapping to a page top.
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) =>
    [...new Set([...defaultRangeExtractor(range), Math.max(0, Math.min(range.count - 1, index))])].filter((value) => value >= 0 && value < range.count).sort((a, b) => a - b), [index]);
  const virtual = useVirtualizer<HTMLDivElement, HTMLDivElement>({ count: pages.length, getScrollElement: () => scroll.current,
    estimateSize: () => Math.max(1, size.height), rangeExtractor, overscan: 1, useFlushSync: false });
  const capture = useCallback((): ScrollAnchor => {
    if (!restoring.current) {
      const current = mode.current === "scroll" && scroll.current ? captureScrollAnchor(scroll.current) : undefined;
      viewportAnchor.current = current ?? { position: pagesRef.current[indexRef.current]?.anchor ?? anchor.current, inset: 0 };
      anchor.current = viewportAnchor.current.position;
    }
    return viewportAnchor.current;
  }, []);

  useLayoutEffect(() => {
    if (!scroll.current || !column.current) return;
    const observer = new ResizeObserver(() => {
      const width = Math.floor(column.current?.clientWidth ?? 0), height = Math.floor(scroll.current?.clientHeight ?? 0);
      setSize((old) => old.width === width && old.height === height ? old : { width, height });
    });
    observer.observe(scroll.current); observer.observe(column.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!presentationReady || !measure.current || !size.width || !size.height) return;
    const controller = new AbortController();
    capture();
    restoring.current = true; setBusy(true);
    const content = book.status === "source-only" ? [] : blocks;
    void paginate(content, measure.current, size.width, Math.max(80, size.height - 96), settings, controller.signal, visibleTranslations)
      .then((result) => {
        if (controller.signal.aborted) return;
        const next = pageForPosition(result, anchor.current);
        indexRef.current = next; setIndex(next); setPages(result); setBusy(false);
      }).catch((error) => { if (!controller.signal.aborted) { restoring.current = false; setBusy(false); onError(error); } });
    return () => controller.abort();
  }, [blocks, book.status, presentationReady, size.width, size.height, settings.fontSize, settings.lineHeight, settings.margin, settings.bilingual, visibleTranslations, onError, capture]);
  useLayoutEffect(() => {
    if (busy || !scroll.current || !size.height) return;
    restoring.current = true;
    virtual.measure();
    const element = scroll.current;
    const rect = settings.readingMode === "scroll" ? anchorRect(element, viewportAnchor.current.position) : undefined;
    element.scrollTop = rect
      ? element.scrollTop + rect.top - element.getBoundingClientRect().top - READING_GUIDE - viewportAnchor.current.inset
      : indexRef.current * size.height;
    const frame = requestAnimationFrame(() => { restoring.current = false; });
    return () => cancelAnimationFrame(frame);
  }, [pages, size.height, settings.readingMode, busy, virtual]);
  const persist = useCallback((position: ReadingPosition) => {
    onProgress({ ...position, bookId: book.id, fraction: fractionForPosition(blocks, position), updatedAt: Date.now() });
  }, [book.id, blocks, onProgress]);
  const save = useCallback(() => {
    if (!pagesRef.current.length) return;
    const position = restoring.current ? anchor.current : capture().position;
    persist(position);
  }, [capture, persist]);
  useEffect(() => {
    // Do not rely on a delayed scroll event or pagehide: Safari may close/reload first.
    if (!busy && pages.length) save();
  }, [busy, pages, index, save]);
  const seek = useCallback((requested: number) => {
    if (busy || !pages.length) return;
    const next = Math.max(0, Math.min(pages.length - 1, Math.round(requested)));
    if (next !== indexRef.current) setNavigation((value) => value + 1);
    indexRef.current = next; setIndex(next);
    anchor.current = pages[next].anchor;
    viewportAnchor.current = { position: anchor.current, inset: 0 };
    if (scroll.current) scroll.current.scrollTop = next * size.height;
    // The target virtual page may not have mounted yet; save its known cursor directly.
    persist(anchor.current);
  }, [busy, pages, size.height, persist]);
  const go = useCallback((delta: number) => seek(indexRef.current + delta), [seek]);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (restoring.current || !pagesRef.current.length) return;
      const next = Math.max(0, Math.min(pagesRef.current.length - 1, Math.floor((element.scrollTop + READING_GUIDE) / Math.max(1, size.height))));
      if (next !== indexRef.current) {
        indexRef.current = next; setIndex(next); setNavigation((value) => value + 1);
      }
      clearTimeout(timer); timer = setTimeout(save, 150);
    };
    const hidden = () => { if (document.visibilityState === "hidden") save(); };
    element.addEventListener("scroll", update, { passive: true }); window.addEventListener("pagehide", save); document.addEventListener("visibilitychange", hidden);
    return () => { clearTimeout(timer); element.removeEventListener("scroll", update); window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", hidden); };
  }, [save, size.height]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (settings.readingMode !== "horizontal" || (event.target as HTMLElement).closest("input, select, textarea, button, [role='dialog']") || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); go(event.key === "ArrowLeft" ? -1 : 1); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [go, settings.readingMode]);
  const page = pages[index];
  const rows = virtual.getVirtualItems();
  useEffect(() => {
    onState({ page: index + 1, pages: pages.length, anchor: page?.anchor, ...size, paginating: busy, mode: settings.readingMode, renderedBlocks: rows.reduce((count, row) => count + (pages[row.index]?.fragments.length ?? 0), 0) });
  }, [index, pages, page, size, busy, settings.readingMode, rows.length, onState]);
  return { scroll, column, measure, virtual, rows, pages, page, index, pageHeight: size.height, busy, navigation, go, seek, capture, save,
    currentBlock: blocks.find((block) => block.id === page?.anchor.blockId),
    visibleBlocks: () => { const ids = new Set(pagesRef.current[indexRef.current]?.fragments.map((fragment) => fragment.blockId)); return blocks.filter((block) => ids.has(block.id)); } };
}
