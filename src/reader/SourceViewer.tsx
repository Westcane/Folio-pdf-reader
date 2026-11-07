import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { loadPdf } from "../pdf/client";
import { readSource, storageError } from "../storage/db";
import type { Book, ReadingBlock } from "../types";

export default function SourceViewer({
  book,
  initialPage,
  block,
  onClose,
}: {
  book: Book;
  initialPage: number;
  block?: ReadingBlock;
  onClose: () => void;
}) {
  const [page, setPage] = useState(initialPage),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [width, setWidth] = useState(600);
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] =
    useState<Awaited<ReturnType<typeof loadPdf>["promise"]>>();
  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof loadPdf> | undefined;
    void (async () => {
      const bytes = await readSource(book.id);
      if (!active) return;
      task = loadPdf(bytes);
      const result = await task.promise;
      if (active) setPdf(result);
    })().catch((error) => {
      if (active) {
        setError(storageError(error));
        setBusy(false);
      }
    });
    return () => {
      active = false;
      void task?.destroy();
    };
  }, [book.id]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width)),
    );
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true;
    let render:
      | ReturnType<Awaited<ReturnType<typeof pdf.getPage>>["render"]>
      | undefined;
    setBusy(true);
    setError("");
    void (async () => {
      const source = await pdf.getPage(page);
      if (!active || !canvas.current) return;
      const natural = source.getViewport({ scale: 1 });
      const scale = Math.max(0.1, Math.min(width, 1200) / natural.width);
      const viewport = source.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const target = canvas.current;
      target.width = Math.floor(viewport.width * ratio);
      target.height = Math.floor(viewport.height * ratio);
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      render = source.render({
        canvas: target,
        viewport,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      await render.promise;
      if (active) setBusy(false);
    })().catch((error) => {
      if (active && error?.name !== "RenderingCancelledException") {
        setError(storageError(error));
        setBusy(false);
      }
    });
    return () => {
      active = false;
      render?.cancel();
    };
  }, [pdf, page, width]);
  return (
    <div
      className="modal-backdrop source-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="原始 PDF 校对"
    >
      <section className="source-modal">
        <header>
          <div>
            <strong>原始 PDF 校对</strong>
            <small>原页是图表、公式与阅读顺序的核对依据</small>
          </div>
          <button
            className="icon-button"
            aria-label="关闭原页"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>
        <nav className="source-nav">
          <button
            aria-label="原 PDF 上一页"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <label>
            原 PDF{" "}
            <input
              aria-label="原 PDF 页码"
              type="number"
              min={1}
              max={book.totalPages}
              value={page}
              onChange={(e) =>
                setPage(
                  Math.max(
                    1,
                    Math.min(book.totalPages, Number(e.target.value) || 1),
                  ),
                )
              }
            />{" "}
            / {book.totalPages} 页
          </label>
          <button
            aria-label="原 PDF 下一页"
            disabled={page >= book.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </nav>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <div className="source-scroll" ref={host}>
          {busy && <p className="source-loading">正在绘制原页…</p>}
          <div className="source-canvas-wrap">
            <canvas ref={canvas} aria-label={`原始 PDF 第 ${page} 页`} />
            {!busy &&
              block?.fragments
                .filter((f) => f.page === page)
                .map((rect, i) => (
                  <div
                    className="source-highlight"
                    key={i}
                    style={{
                      left: `${rect.left * 100}%`,
                      top: `${rect.top * 100}%`,
                      width: `${rect.width * 100}%`,
                      height: `${rect.height * 100}%`,
                    }}
                  />
                ))}
          </div>
        </div>
        <p className="source-caption">
          高亮区域对应所选段落。此模式仅显示原始页面，不参与文字重排。
        </p>
      </section>
    </div>
  );
}
