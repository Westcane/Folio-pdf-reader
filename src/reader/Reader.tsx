import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, Check, Languages, LoaderCircle, ScanEye, Settings2, X } from "lucide-react";
import type { Book, ReadingBlock, ReadingProgress, Settings } from "../types";
import { styledSegments } from "../pdf/textStyle";
import { useTranslations } from "../translation/useTranslations";
import { usePagedReader, type ReaderState } from "./usePagedReader";
import { db } from "../storage/db";
import { useFloatingTranslation } from "./useFloatingTranslation";
import { useReadingChrome } from "./useReadingChrome";
import { useReadingGestures } from "./useReadingGestures";
import { ReadingHeader } from "./ReadingHeader";
import "./reader.css";

export type { ReaderState } from "./usePagedReader";
interface Props {
  book: Book; blocks: ReadingBlock[]; settings: Settings; online: boolean;
  initialProgress?: ReadingProgress;
  onProgress: (progress: ReadingProgress) => void;
  onState: (state: ReaderState) => void; onError: (error: unknown) => void;
  onBack: () => void; onOpenSettings: () => void;
  onBilingual: (enabled: boolean) => void;
  settingsOpen: boolean;
}
const emptyPresentation = { collapsed: [] as string[] };
export default function Reader({ book, blocks, settings, online, initialProgress, onProgress, onState, onError, onBack, onOpenSettings, onBilingual, settingsOpen }: Props) {
  const [panel, setPanel] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [presentation, setPresentation] = useState(emptyPresentation);
  const [viewReady, setViewReady] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const chrome = useReadingChrome(panel || settingsOpen || seeking);
  const [selectedBlock, setSelectedBlock] = useState<string>();
  const [pageBatch, setPageBatch] = useState<string[]>([]);
  const pageBatchNavigation = useRef(-1);
  const menu = useRef<HTMLElement>(null);
  const translation = useTranslations(book, true);
  const floating = useFloatingTranslation();
  const blocksById = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);
  const collapsed = useMemo(() => new Set(presentation.collapsed), [presentation.collapsed]);
  const flow = usePagedReader({ book, blocks, settings, initialProgress,
    translations: translation.texts, collapsed,
    presentationReady: viewReady && (!settings.bilingual || translation.loaded || !!translation.error), onProgress, onState, onError });

  useEffect(() => {
    let live = true;
    void db.settings.get(`view:${book.id}`).then((row) => {
      if (!live) return;
      const value = row?.value as Partial<typeof emptyPresentation> | undefined;
      setPresentation({ collapsed: Array.isArray(value?.collapsed) ? value.collapsed.filter((id) => typeof id === "string") : [] });
      setViewReady(true);
    }).catch((error) => { if (live) { setViewReady(true); onError(error); } });
    return () => { live = false; };
  }, [book.id, onError]);
  useEffect(() => {
    if (viewReady) void db.settings.put({ key: `view:${book.id}`, value: presentation }).catch(onError);
  }, [book.id, viewReady, presentation, onError]);
  useEffect(() => {
    const outside = (event: globalThis.PointerEvent) => {
      if (menu.current?.contains(event.target as Node) || (event.target as HTMLElement).closest('[aria-label="翻译"]')) return;
      setPanel(false); setConfirmAll(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setPanel(false); setConfirmAll(false); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  const changeFold = useCallback((id: string, open: boolean) => {
    flow.capture();
    setPresentation((old) => ({ ...old, collapsed: open ? old.collapsed.filter((value) => value !== id) : [...new Set([...old.collapsed, id])] }));
  }, [flow.capture]);
  const revealAll = () => {
    flow.capture();
    if (!settings.bilingual) setPresentation({ collapsed: [] });
    onBilingual(!settings.bilingual);
  };
  const translate = (selected: ReadingBlock[], force = false) => {
    flow.capture(); onBilingual(true); setConfirmAll(false);
    void translation.run(selected, force);
  };
  const revealBlocks = (ids: string[]) => {
    flow.capture();
    setPresentation((old) => ({ ...old, collapsed: [...new Set([
      ...old.collapsed, ...(!settings.bilingual ? Object.keys(translation.texts) : []),
    ])].filter((value) => !ids.includes(value)) }));
    onBilingual(true);
  };
  const toggleVisiblePage = () => {
    if (floating.consumeDrag() || book.status === "source-only" || !translation.loaded || translation.job) return;
    const visible = flow.visibleBlocks();
    if (!visible.length) return;
    // Reflow keeps the selected batch; an intentional page turn starts a new page batch.
    const samePage = pageBatch.length > 0 && pageBatchNavigation.current === flow.navigation;
    const ids = samePage ? pageBatch : visible.map((block) => block.id);
    if (!samePage) { setPageBatch(ids); pageBatchNavigation.current = flow.navigation; }
    if ((samePage || ids.every((id) => translation.texts[id])) && ids.some((id) => settings.bilingual && translation.texts[id] && !collapsed.has(id))) {
      flow.capture();
      setPresentation((old) => ({ ...old, collapsed: [...new Set([...old.collapsed, ...ids])] }));
      return;
    }
    if (samePage && ids.some((id) => translation.texts[id])) {
      // Expanding a completed/partially completed batch never retries paid requests.
      revealBlocks(ids);
      return;
    }
    revealBlocks(ids);
    const missing = blocks.filter((block) => ids.includes(block.id) && !translation.texts[block.id]);
    if (missing.length) {
      if (!translation.status?.configured) setPanel(true);
      else translate(missing);
    }
  };
  const retranslateParagraph = (block: ReadingBlock) => {
    flow.capture();
    onBilingual(true);
    setPresentation((old) => ({ ...old, collapsed: old.collapsed.filter((value) => value !== block.id) }));
    void translation.run([block], true);
  };
  const toggleParagraph = (id: string) => {
    const block = blocksById.get(id);
    if (!block || flow.busy) return;
    setSelectedBlock(id);
    if (translation.texts[id]) {
      if (settings.bilingual && !collapsed.has(id)) changeFold(id, false);
      else revealBlocks([id]);
    } else if (!translation.job && translation.loaded) {
      if (!translation.status?.configured) setPanel(true);
      else { revealBlocks([id]); translate([block], false); }
    }
  };
  const gestures = useReadingGestures((target, x) => {
    if (flow.busy) return;
    if (settings.readingMode === "horizontal") {
      if (x < 0.14) { flow.go(-1); return; }
      if (x > 0.86) { flow.go(1); return; }
    }
    const source = target.closest<HTMLElement>(".source-text[data-block-id]");
    if (source?.dataset.blockId) toggleParagraph(source.dataset.blockId);
  }, chrome.toggle);
  const pending = blocks.filter((block) => !translation.results[block.id]).length;
  const retranslateTarget = selectedBlock ? blocksById.get(selectedBlock) ?? flow.currentBlock : flow.currentBlock;
  const canTranslate = book.status !== "source-only" && translation.loaded && translation.status?.configured && !translation.job;
  const samePageBatch = pageBatchNavigation.current === flow.navigation;
  const pageExpanded = samePageBatch && pageBatch.some((id) => settings.bilingual && translation.texts[id] && !collapsed.has(id));
  const pageButtonLabel = pageExpanded ? "收起翻译" : samePageBatch && pageBatch.some((id) => translation.texts[id]) ? "展开翻译" : "一页翻译";
  const typography = { "--reading-font-size": `${settings.fontSize}px`, "--reading-leading": settings.lineHeight, "--reading-margin": `${settings.margin}px` } as CSSProperties;
  return (
    <main className={`reader paged-reader mode-${settings.readingMode}${chrome.visible ? "" : " chrome-quiet"}`} style={typography}
      onPointerDownCapture={chrome.activity} onKeyDownCapture={chrome.activity}>
      <ReadingHeader title={book.name.replace(/\.pdf$/i, "")} online={online} visible={chrome.visible} page={flow.index + 1} pages={flow.pages.length}
        busy={flow.busy} onShow={chrome.show} onSeek={flow.seek} onSeeking={setSeeking} />
      <button className={`back-dock round-tool${chrome.visible ? "" : " chrome-hidden"}`} title="返回书库" aria-label="返回书库" onClick={() => { flow.save(); onBack(); }}><ArrowLeft size={19} /></button>
      <nav className={`reader-dock${chrome.visible ? "" : " chrome-hidden"}`} aria-label="阅读工具">
        <button className="round-tool" title="阅读设置" aria-label="阅读设置" onClick={() => { flow.capture(); setPanel(false); onOpenSettings(); }}><Settings2 size={21} /></button>
        <button className={`round-tool${panel ? " active" : ""}${translation.job ? " working" : ""}`} title="翻译" aria-label="翻译" aria-expanded={panel}
          onClick={() => { setPanel((old) => !old); setConfirmAll(false); }}>
          {translation.job ? <LoaderCircle size={19} className="spin" /> : <Languages size={19} />}
          {!translation.job && settings.bilingual && <i />}
        </button>
      </nav>
      <button className={`round-tool visible-translate${floating.dragging ? " dragging" : ""}`} aria-label={pageButtonLabel} aria-expanded={pageExpanded}
        style={floating.position ? { left: floating.position.x, top: floating.position.y, right: "auto", bottom: "auto" } : undefined}
        aria-disabled={book.status === "source-only" || !blocks.length || !translation.loaded || !!translation.job}
        onPointerDown={floating.onPointerDown} onPointerMove={floating.onPointerMove} onPointerUp={floating.onPointerUp} onPointerCancel={floating.onPointerCancel}
        onContextMenu={(event) => event.preventDefault()}
        onClick={toggleVisiblePage}>
        <ScanEye size={22} />
      </button>
      {panel && (
        <section className="translation-popover" role="dialog" aria-label="翻译设置" ref={menu}>
          <header><strong>翻译设置 <small>DeepSeek</small></strong><button className="icon-button" aria-label="关闭翻译面板" onClick={() => setPanel(false)}><X size={16} /></button></header>
          <button className="translation-menu-item" onClick={revealAll} aria-pressed={settings.bilingual}>
            <span>{settings.bilingual ? "收起全部译文" : "展开全部译文"}</span>{settings.bilingual && <Check size={15} />}
          </button>
          <div className="popover-rule" />
          <button className="translation-menu-item" disabled={!canTranslate || !blocks.length} onClick={toggleVisiblePage}>{pageButtonLabel}</button>
          <button className="translation-menu-item" disabled={!canTranslate || !retranslateTarget} onClick={() => retranslateTarget && retranslateParagraph(retranslateTarget)}>重新翻译当前段</button>
          <button className={`translation-menu-item${confirmAll ? " confirm" : ""}`} disabled={!canTranslate || !pending}
            onClick={() => confirmAll ? translate(blocks) : setConfirmAll(true)}>
            {confirmAll ? `确认翻译剩余 ${pending} 段` : "翻译全文"}<small>{confirmAll ? "将逐段发送原文并调用付费 API" : `${pending} 段待译 · 按段缓存`}</small>
          </button>
          {translation.job && <button className="translation-menu-item" onClick={translation.cancel}>停止翻译 <small>已保存的译文保留</small></button>}
          <div className="popover-rule" />
          <p className="translation-summary" aria-live="polite">{translation.job ? `正在翻译 ${translation.job.done + 1} / ${translation.job.total} 段` : `本书已缓存 ${Object.keys(translation.results).length} 段译文`}</p>
          <p className="translation-summary">缓存不自动过期；删书或清理网站数据会移除缓存。</p>
          {translation.error && <p className="translation-error" role="alert">{translation.error}</p>}
          <button className="quiet-link" disabled={translation.checking || !!translation.job} onClick={() => void translation.check()}>{translation.checking ? "连接中…" : "检查连接"}</button>
          {book.status !== "ready" && <p className="translation-summary">部分原页需要校对，复杂区域的译文也应对照原 PDF。</p>}
        </section>
      )}
      <div className="reading-scroll" ref={flow.scroll} aria-label="阅读正文" aria-busy={flow.busy} tabIndex={0} data-page-count={flow.pages.length} data-page-index={flow.index}
        {...gestures}>
        <div className="paged-column flow-text" ref={flow.column} style={{ height: flow.virtual.getTotalSize() }}>
          {flow.rows.map((row) => {
            const page = flow.pages[row.index];
            return (
              <section className="reading-page" key={row.key} data-page-number={row.index + 1} data-current={row.index === flow.index} style={{ height: flow.pageHeight, transform: `translateY(${row.start}px)` }}>
                <div className="page-content page-typesetting">
                {page.fragments.map((fragment, part) => (
                  <div className="reading-fragment" key={`${fragment.blockId}-${fragment.start}-${part}`} data-block-id={fragment.blockId} data-start={fragment.start} data-translated={fragment.translated || undefined} style={{ paddingTop: fragment.gapBefore ?? 0 }}>
                    <p className={`text-block ${fragment.translated ? "translated" : "source-text"} kind-${fragment.kind}`}
                      lang={fragment.translated ? "zh-CN" : "en"} data-reading-text={fragment.translated ? "translation" : "source"} data-block-id={fragment.blockId}
                      data-start={fragment.start} data-source-length={blocksById.get(fragment.blockId)?.text.length}>
                      {styledSegments(fragment.text, fragment.styles).map((segment, index) => <span key={index} style={{ fontWeight: segment.bold ? 700 : undefined, fontStyle: segment.italic ? "italic" : undefined }}>{segment.text}</span>)}
                    </p>
                  </div>
                ))}
                </div>
              </section>
            );
          })}
        </div>
        {(!blocks.length || book.status === "source-only") && <div className="empty-reading"><p>这份 PDF 没有可重排文字。请在外部阅读器查看，或先完成 OCR 再导入。</p></div>}
      </div>
      <div ref={flow.measure} className="page-measure flow-text page-typesetting" aria-hidden="true" />
      {flow.busy && <span className="scroll-status" role="status"><LoaderCircle className="spin" size={15} /> 正在排版…</span>}
    </main>
  );
}
