import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type UIEvent } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronUp, FileSearch, Languages, LoaderCircle, ScanEye, Settings2, WifiOff, X } from "lucide-react";
import type { Book, ReadingBlock, ReadingProgress, Settings } from "../types";
import { styledSegments } from "../pdf/textStyle";
import { blockGap } from "./typography";
import { sourcePageForOffset } from "./sourceLocation";
import { useTranslations } from "../translation/useTranslations";
import { useScrollReader, type ReaderState } from "./useScrollReader";
import { db } from "../storage/db";
import type { ScrollAnchor } from "./scrollPosition";
import "./reader.css";

export type { ReaderState } from "./useScrollReader";
interface Props {
  book: Book; blocks: ReadingBlock[]; settings: Settings; online: boolean;
  initialProgress?: ReadingProgress;
  onProgress: (progress: ReadingProgress) => void;
  onSource: (page: number, block?: ReadingBlock) => void;
  onState: (state: ReaderState) => void; onError: (error: unknown) => void;
  onBack: () => void; onOpenSettings: () => void;
  onBilingual: (enabled: boolean) => void;
}
const emptyPresentation = { collapsed: [] as string[], metaCollapsed: false };
export default function Reader({ book, blocks, settings, online, initialProgress, onProgress, onSource, onState, onError, onBack, onOpenSettings, onBilingual }: Props) {
  const [panel, setPanel] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [presentation, setPresentation] = useState(emptyPresentation);
  const [viewReady, setViewReady] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const lastScrollTop = useRef(0);
  const menu = useRef<HTMLElement>(null);
  const pointer = useRef<{ x: number; y: number; at: number } | undefined>(undefined);
  const hiddenTranslation = useRef<ScrollAnchor | undefined>(undefined);
  const translation = useTranslations(book, true);
  const collapsed = useMemo(() => new Set(presentation.collapsed), [presentation.collapsed]);
  const flow = useScrollReader({ book, blocks, settings, initialProgress,
    translations: translation.texts, collapsed,
    presentationReady: viewReady && (!settings.bilingual || translation.loaded || !!translation.error), onProgress, onState });

  useEffect(() => {
    let live = true;
    void db.settings.get(`view:${book.id}`).then((row) => {
      if (!live) return;
      const value = row?.value as Partial<typeof emptyPresentation> | undefined;
      setPresentation({ collapsed: Array.isArray(value?.collapsed) ? value.collapsed.filter((id) => typeof id === "string") : [], metaCollapsed: value?.metaCollapsed === true });
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
    const current = flow.capture();
    if (settings.bilingual) { hiddenTranslation.current = current; onBilingual(false); }
    else {
      if (hiddenTranslation.current?.position.blockId === current.position.blockId) flow.restoreAnchor(hiddenTranslation.current);
      setPresentation((old) => ({ ...old, collapsed: [] })); onBilingual(true);
    }
  };
  const translate = (selected: ReadingBlock[], force = false) => {
    flow.capture(); onBilingual(true); setConfirmAll(false);
    void translation.run(selected, force);
  };
  const collapseTranslation = (event: MouseEvent, blockId: string) => {
    const start = pointer.current; pointer.current = undefined;
    if (window.getSelection()?.toString()) return;
    if (event.detail !== 0 && (!start || Date.now() - start.at > 350 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 9)) return;
    changeFold(blockId, false);
  };
  const revealParagraph = (id: string) => {
    flow.capture();
    setPresentation((old) => ({ ...old, collapsed: [...new Set([
      ...old.collapsed, ...(!settings.bilingual ? Object.keys(translation.texts) : []),
    ])].filter((value) => value !== id) }));
    onBilingual(true);
  };
  const retranslateParagraph = (block: ReadingBlock) => {
    flow.capture();
    onBilingual(true);
    setPresentation((old) => ({ ...old, collapsed: old.collapsed.filter((value) => value !== block.id) }));
    void translation.run([block], true);
  };
  const handleContentClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, [role='button'], a, input, select, textarea, summary")) return;
    setChromeVisible((value) => !value);
  };
  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop;
    if (!flow.busy && top > lastScrollTop.current + 4) setChromeVisible(false);
    lastScrollTop.current = top;
  };
  const pending = blocks.filter((block) => translation.results[block.id]?.provider !== translation.status?.provider).length;
  const canTranslate = book.status !== "source-only" && translation.loaded && translation.status?.configured && !translation.job;
  const progress = Math.round(flow.fraction * 100);
  const typography = { "--reading-font-size": `${settings.fontSize}px`, "--reading-leading": settings.lineHeight, "--reading-margin": `${settings.margin}px` } as CSSProperties;
  return (
    <main className="reader scroll-reader" style={typography}>
      <button className={`reading-capsule${presentation.metaCollapsed ? " collapsed" : ""}${chromeVisible ? "" : " chrome-hidden"}`}
        aria-label={presentation.metaCollapsed ? "展开书名与页码" : "收起书名与页码"}
        aria-expanded={!presentation.metaCollapsed}
        onClick={() => setPresentation((old) => ({ ...old, metaCollapsed: !old.metaCollapsed }))}>
        {!presentation.metaCollapsed && <strong>{book.name.replace(/\.pdf$/i, "")}</strong>}
        {!online && <WifiOff size={12} aria-label="离线" />}
        <span>{presentation.metaCollapsed ? `${progress}%` : `原 PDF ${flow.sourcePage} / ${book.totalPages} · ${progress}%`}</span>
        {presentation.metaCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
      <button className={`back-dock round-tool${chromeVisible ? "" : " chrome-hidden"}`} title="返回书库" aria-label="返回书库" onClick={() => { flow.save(); onBack(); }}><ArrowLeft size={19} /></button>
      <nav className="reader-dock" aria-label="阅读工具">
        <button className="round-tool" title="阅读设置" aria-label="阅读设置" onClick={() => { flow.capture(); setPanel(false); onOpenSettings(); }}><Settings2 size={19} /></button>
        <button className={`round-tool${panel ? " active" : ""}${translation.job ? " working" : ""}`} title="翻译" aria-label="翻译" aria-expanded={panel}
          onClick={() => { setPanel((old) => !old); setConfirmAll(false); }}>
          {translation.job ? <LoaderCircle size={19} className="spin" /> : <Languages size={19} />}
          {!translation.job && settings.bilingual && <i />}
        </button>
      </nav>
      <button className="round-tool visible-translate" title="翻译可见区域" aria-label="翻译可见区域"
        disabled={book.status === "source-only" || !blocks.length || !translation.loaded || !!translation.job}
        onClick={() => { if (!translation.status?.configured) setPanel(true); else translate(flow.visibleBlocks()); }}>
        <ScanEye size={19} />
      </button>
      {panel && (
        <section className="translation-popover" role="dialog" aria-label="DeepSeek 翻译" ref={menu}>
          <header><strong>DeepSeek <small>英 → 中</small></strong><button className="icon-button" aria-label="关闭翻译面板" onClick={() => setPanel(false)}><X size={16} /></button></header>
          <button className="translation-menu-item" onClick={revealAll} aria-pressed={settings.bilingual}>
            <span>{settings.bilingual ? "收起全部译文" : "展开全部译文"}</span>{settings.bilingual && <Check size={15} />}
          </button>
          <div className="popover-rule" />
          <button className="translation-menu-item" disabled={!canTranslate || !blocks.length} onClick={() => translate(flow.visibleBlocks())}>翻译可见段落 <small>跳过已有译文</small></button>
          <button className={`translation-menu-item${confirmAll ? " confirm" : ""}`} disabled={!canTranslate || !pending}
            onClick={() => confirmAll ? translate(blocks) : setConfirmAll(true)}>
            {confirmAll ? `确认翻译剩余 ${pending} 段` : "翻译全文"}<small>{confirmAll ? "将逐段发送原文并调用付费 API" : `${pending} 段待译 · 按段缓存`}</small>
          </button>
          {translation.job && <button className="translation-menu-item" onClick={translation.cancel}>停止翻译 <small>已保存的译文保留</small></button>}
          <div className="popover-rule" />
          <p className="translation-summary" aria-live="polite">{translation.job ? `正在翻译 ${translation.job.done + 1} / ${translation.job.total} 段` : `本书已缓存 ${Object.keys(translation.results).length} 段译文`}</p>
          {translation.error && <p className="translation-error" role="alert">{translation.error}</p>}
          <button className="quiet-link" disabled={translation.checking || !!translation.job} onClick={() => void translation.check()}>{translation.checking ? "连接中…" : "检查连接"}</button>
          {book.status !== "ready" && <p className="translation-summary">部分原页需要校对，复杂区域的译文也应对照原 PDF。</p>}
        </section>
      )}
      <div className="reading-scroll" ref={flow.scroll} aria-label="滚动阅读正文" aria-busy={flow.busy} tabIndex={0} onClick={handleContentClick} onScroll={handleScroll}>
        <div className="scroll-column flow-text" ref={flow.column} style={{ height: flow.virtual.getTotalSize() }}>
          {flow.rows.map((row) => {
            const block = blocks[row.index];
            const text = translation.texts[block.id];
            const expanded = !collapsed.has(block.id);
            const canCollapse = !!text && settings.bilingual && expanded;
            const canReveal = !!text && !settings.bilingual;
            const canRetranslate = !!text && settings.bilingual && !expanded;
            return (
              <article className={`reading-block${block.warning ? " uncertain" : ""}`}
                key={row.key} ref={flow.virtual.measureElement} data-index={row.index} data-block-id={block.id} data-kind={block.kind}
                style={{ transform: `translateY(${row.start}px)`, paddingBottom: blockGap(block.kind, blocks[row.index + 1]?.kind ?? "paragraph", settings.fontSize) }}>
                <p className={`text-block source-text kind-${block.kind}`} lang="en" data-reading-text="source" data-block-id={block.id}>
                  {styledSegments(block.text, block.styles).map((segment, index) => <span key={index} style={{ fontWeight: segment.bold ? 700 : undefined, fontStyle: segment.italic ? "italic" : undefined }}>{segment.text}</span>)}
                </p>
                <div className="paragraph-action-track"><div className="paragraph-actions" role="toolbar" aria-label="段落操作">
                  <button className="source-ref" aria-label="核对此段原页" title="核对原 PDF" onClick={() => onSource(flow.currentBlock?.id === block.id ? flow.sourcePage : sourcePageForOffset(block, 0), block)}><FileSearch size={16} /></button>
                  <button className="translate-ref" aria-label={canCollapse ? "收起此段译文" : canReveal ? "展开此段译文" : canRetranslate ? "重新翻译此段" : "翻译此段"}
                    title={canCollapse ? "收起译文" : canReveal ? undefined : canRetranslate ? "重新翻译（再次调用 API）" : "翻译此段"}
                    aria-expanded={text ? settings.bilingual && expanded : undefined}
                    onClick={() => { if (canCollapse) changeFold(block.id, false); else if (canReveal) revealParagraph(block.id); else if (!translation.status?.configured) setPanel(true); else if (canRetranslate) retranslateParagraph(block); else translate([block], false); }} disabled={!canCollapse && !canReveal && (translation.checking || !translation.loaded || !!translation.job)}>
                    <Languages size={16} />
                  </button>
                </div></div>
                {settings.bilingual && text && expanded && (
                  <div className="paragraph-translation">
                    <p className={`text-block translated kind-${block.kind}`} lang="zh-CN" data-reading-text="translation" data-block-id={block.id} data-source-length={block.text.length}
                      role="button" tabIndex={0} aria-expanded="true"
                      onPointerDown={(event) => { pointer.current = { x: event.clientX, y: event.clientY, at: Date.now() }; }}
                      onPointerCancel={() => { pointer.current = undefined; }}
                      onClick={(event) => collapseTranslation(event, block.id)}
                      onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !window.getSelection()?.toString()) { event.preventDefault(); changeFold(block.id, false); } }}>{text}</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {(!blocks.length || book.status === "source-only") && <div className="empty-reading"><FileSearch size={28} /><p>未提取到可重排文字，请查看原始 PDF。</p><button className="primary-button" onClick={() => onSource(1)}>查看原 PDF</button></div>}
      </div>
      {flow.busy && <span className="scroll-status" role="status"><LoaderCircle className="spin" size={15} /> 正在恢复阅读位置…</span>}
    </main>
  );
}
