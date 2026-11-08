import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  FilePlus2,
  FileText,
  HardDrive,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import Reader, { type ReaderState } from "./reader/Reader";
import DeepSeekSettings from "./translation/DeepSeekSettings";
import {
  db,
  clearReaderData,
  deleteBook,
  normalizeSettings,
  saveImport,
  readSource,
  storageError,
  writeProgress,
} from "./storage/db";
import {
  defaultSettings,
  PARSER_REVISION,
  type Book,
  type ImportState,
  type ReadingBlock,
  type ReadingProgress,
  type Settings,
} from "./types";

// This condition and import are erased from production output by Vite.
const DebugPanel = import.meta.env.DEV
  ? lazy(() => import("./dev/DebugPanel"))
  : null;
type OpenBook = {
  book: Book;
  blocks: ReadingBlock[];
  progress?: ReadingProgress;
};

export default function App() {
  const [books, setBooks] = useState<Book[]>([]),
    [opened, setOpened] = useState<OpenBook>();
  const [settings, setSettings] = useState<Settings>(defaultSettings),
    [showSettings, setShowSettings] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const closeApiSettings = useCallback(() => setShowApiSettings(false), []);
  const swRegistration = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [ready, setReady] = useState(false);
  const [importState, setImportState] = useState<ImportState>(),
    [importing, setImporting] = useState(false);
  const [readerState, setReaderState] = useState<ReaderState>();
  const [clearingStorage, setClearingStorage] = useState(false);
  const [online, setOnline] = useState(navigator.onLine),
    [storage, setStorage] = useState("正在检查本地存储…");
  const fileInput = useRef<HTMLInputElement>(null),
    importLock = useRef(false);
  const progressRef = useRef<ReadingProgress | undefined>(undefined);
  const reportError = useCallback((e: unknown) => {
    console.error(e);
    setError(storageError(e));
  }, []);
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registration) { swRegistration.current = registration; void registration?.update().catch(() => {}); },
    onRegisterError(error) {
      console.error("离线缓存注册失败", error);
    },
  });
  useEffect(() => {
    const update = () => { if (navigator.onLine && document.visibilityState === "visible") void swRegistration.current?.update().catch(() => {}); };
    const timer = setInterval(update, 60 * 60 * 1000);
    document.addEventListener("visibilitychange", update); window.addEventListener("online", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); window.removeEventListener("online", update); };
  }, []);

  const refreshBooks = useCallback(
    async () =>
      setBooks(await db.books.orderBy("importedAt").reverse().toArray()),
    [],
  );
  const refreshStorage = useCallback(async () => {
    const estimate = await navigator.storage?.estimate?.();
    setStorage(`浏览器自动保存缓存${estimate?.usage ? ` · 已用约 ${(estimate.usage / 1024 / 1024).toFixed(1)} MB` : ""}`);
  }, []);
  const openBook = useCallback(async (book: Book) => {
    let content = await db.contents.get(book.id);
    let selected = book;
    if (!content || book.parserRevision !== PARSER_REVISION) {
      setImporting(true);
      try {
        const bytes = await readSource(book.id);
        const file = new File([bytes.buffer as ArrayBuffer], book.name, {
          type: "application/pdf",
        });
        const { importPdf } = await import("./import/importPdf");
        const result = await importPdf(file, setImportState);
        result.book.importedAt = book.importedAt;
        await saveImport(result.book, result.blocks, file);
        selected = result.book;
        content = { bookId: book.id, blocks: result.blocks };
        setBooks((previous) =>
          previous.map((value) => (value.id === book.id ? selected : value)),
        );
        setNotice("已按新版排版规则重新解析，原阅读位置已尽量保留。");
      } catch (error) {
        if (!content) throw error;
        console.warn("旧文档暂未重新解析", error);
        setNotice(
          "排版规则已更新，但本地原文件暂不可用。重新导入同一份 PDF 即可应用，现有内容仍可阅读。",
        );
      } finally {
        setImporting(false);
      }
    }
    if (!content)
      throw new Error("结构化内容已不在浏览器中，请重新导入原 PDF。");
    const progress = await db.progress.get(book.id);
    progressRef.current = progress;
    setOpened({ book: selected, blocks: content.blocks, progress });
    setReaderState(undefined);
    setShowSettings(false);
    await db.settings.put({ key: "lastBook", value: book.id });
  }, []);
  useEffect(() => {
    void (async () => {
      await db.open();
      setSettings(normalizeSettings((await db.settings.get("reader"))?.value));
      await refreshBooks();
      const last = (await db.settings.get("lastBook"))?.value;
      if (typeof last === "string") {
        const book = await db.books.get(last);
        if (book) await openBook(book);
      }
      await refreshStorage();
    })()
      .catch(reportError)
      .finally(() => setReady(true));
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, [openBook, refreshBooks, refreshStorage, reportError]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    if (ready && !clearingStorage)
      void db.settings
        .put({ key: "reader", value: settings })
        .catch(reportError);
  }, [settings, ready, clearingStorage, reportError]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSettings(false);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);

  const handleImport = async (file: File) => {
    if (importLock.current) return;
    importLock.current = true;
    setImporting(true);
    setError("");
    setNotice("");
    try {
      const { importPdf } = await import("./import/importPdf");
      const result = await importPdf(file, setImportState);
      setImportState({
        phase: "保存到本机",
        page: result.book.totalPages,
        total: result.book.totalPages,
        blocks: result.blocks.length,
      });
      const existing = await db.books.get(result.book.id);
      if (existing) result.book.importedAt = existing.importedAt;
      await saveImport(result.book, result.blocks, file);
      await refreshBooks();
      await openBook(result.book);
      setImportState({
        phase: "导入完成",
        page: result.book.totalPages,
        total: result.book.totalPages,
        blocks: result.blocks.length,
      });
      if (result.book.status === "source-only")
        setNotice(
          "没有提取到文字：这可能是扫描 PDF。本版本不含 OCR，请在外部阅读器查看，或先完成 OCR 再导入。",
        );
      else if (result.book.status === "review")
        setNotice(
          "图表、公式或复杂排版可能无法正确重排，建议在外部阅读器中对照原文件核验。",
        );
      else if (existing) setNotice("已重新导入相同文件，并保留原有阅读进度。");
    } catch (e) {
      reportError(e);
      setImportState((previous) => ({
        phase: "导入失败",
        page: previous?.page ?? 0,
        total: previous?.total ?? 0,
        blocks: previous?.blocks ?? 0,
        error: storageError(e),
      }));
    } finally {
      importLock.current = false;
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const handleProgress = useCallback(
    (progress: ReadingProgress) => {
      progressRef.current = progress;
      void writeProgress(progress).catch(reportError);
    },
    [reportError],
  );
  const leaveReader = () => {
    setOpened(undefined);
    setShowSettings(false);
    void db.settings.delete("lastBook").catch(reportError);
    void refreshBooks().catch(reportError);
  };
  const deleteLocalStorage = async () => {
    if (importLock.current || clearingStorage) return;
    if (!window.confirm("确认删除本地存储？\n\n将清除当前浏览器中 Folio 的：\n• 全部书籍、导入的 PDF 副本和重排文字\n• 阅读进度、阅读设置和界面位置\n• 全部译文缓存\n• 已保存的 DeepSeek API Key 和 API 配置\n\n设备中的原始 PDF 文件不会删除，应用离线资源会保留。\n此操作不可撤销，之后需要重新导入书籍。\n\n是否确认删除？")) return;
    importLock.current = true;
    setClearingStorage(true); setShowApiSettings(false); setError(""); setNotice("");
    try {
      await clearReaderData();
      let layoutCleared = true;
      try { localStorage.removeItem("folio-floating-translation"); } catch { layoutCleared = false; }
      progressRef.current = undefined;
      setBooks([]); setOpened(undefined); setReaderState(undefined); setImportState(undefined);
      setSettings({ ...defaultSettings }); setShowSettings(false);
      setNotice(layoutCleared ? "本地书库、进度、译文和 API 配置已清除。" : "书库、进度、译文和 API 配置已清除；浏览器未允许清理按钮位置。");
      void refreshStorage().catch(() => setStorage("本地阅读数据已清除"));
    } catch (cause) { reportError(cause); }
    finally { importLock.current = false; setClearingStorage(false); }
  };
  const demo = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}samples/reading-sample.pdf`,
      );
      if (!response.ok) throw new Error("示例文件不可用，请导入自己的 PDF。");
      await handleImport(
        new File([await response.blob()], "A quieter place.pdf", {
          type: "application/pdf",
        }),
      );
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className={`app ${opened ? "is-reading" : ""}`}>
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".pdf,application/pdf"
        aria-label="选择 PDF 文件"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImport(file);
        }}
      />
      {!opened && <header className="app-header">
          <>
            <a className="brand" href="./" aria-label="Folio 首页">
              <span className="brand-symbol">
                <BookOpen size={23} />
              </span>
              <span>
                Folio<span className="brand-dot">.</span>
              </span>
            </a>
            <div className="header-note">
              <span className="status-dot" /> LOCAL FIRST{" "}
              <span className="header-separator">/</span> 为专注而生
            </div>
            <button className="quiet-link library-api" disabled={clearingStorage} onClick={() => setShowApiSettings(true)}>API 设置</button>
            <button
              className="primary-button small"
              disabled={!ready || importing || clearingStorage}
              onClick={() => fileInput.current?.click()}
            >
              <Plus size={17} />
              导入 PDF
            </button>
          </>
      </header>}
      {!online && !opened && (
        <div className="connection-banner">
          <WifiOff size={14} /> 当前离线 · 已保存在此设备的文档可继续阅读
        </div>
      )}
      {needRefresh && (
        <div className="update-banner">
          新版本已准备好。
          <button
            onClick={() => {
              if (progressRef.current)
                void writeProgress(progressRef.current)
                  .then(() => updateServiceWorker(true))
                  .catch(reportError);
              else void updateServiceWorker(true);
            }}
          >
            保存位置并更新
          </button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="关闭错误提示" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="notice-banner" role="status">
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}

      {opened ? (
        <>
          {showSettings && (
            <>
            <div className="settings-dismiss" aria-hidden="true" onClick={(event) => { event.stopPropagation(); setShowSettings(false); }} />
            <section
              className="settings-panel"
              role="dialog"
              aria-label="阅读设置面板"
            >
              <header>
                <strong>阅读设置</strong>
                <button
                  className="icon-button"
                  aria-label="关闭阅读设置"
                  onClick={() => setShowSettings(false)}
                >
                  <X size={18} />
                </button>
              </header>
              <div className="reading-mode-options" role="group" aria-label="翻页方式">
                <button aria-pressed={settings.readingMode === "horizontal"} onClick={() => setSettings((old) => ({ ...old, readingMode: "horizontal" }))}>左右翻页</button>
                <button aria-pressed={settings.readingMode === "scroll"} onClick={() => setSettings((old) => ({ ...old, readingMode: "scroll" }))}>滚动翻页</button>
              </div>
              <label>
                字号 <output>{settings.fontSize}px</output>
                <input
                  aria-label="字号"
                  type="range"
                  min="16"
                  max="32"
                  step="1"
                  value={settings.fontSize}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      fontSize: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                行距 <output>{settings.lineHeight.toFixed(2)}</output>
                <input
                  aria-label="行距"
                  type="range"
                  min="1.3"
                  max="2.2"
                  step="0.05"
                  value={settings.lineHeight}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      lineHeight: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label>
                页边距 <output>{settings.margin}px</output>
                <input
                  aria-label="页边距"
                  type="range"
                  min="20"
                  max="80"
                  step="4"
                  value={settings.margin}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      margin: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <div className="theme-options">
                {(
                  [
                    ["light", "浅色"],
                    ["sepia", "护眼"],
                    ["dark", "深色"],
                  ] as const
                ).map(([theme, label]) => (
                  <button
                    key={theme}
                    className={`theme-choice theme-${theme}`}
                    aria-pressed={settings.theme === theme}
                    onClick={() => setSettings((s) => ({ ...s, theme }))}
                  >
                    {settings.theme === theme && <Check size={14} />}
                    {label}
                  </button>
                ))}
              </div>
            </section>
            </>
          )}
          <Reader
            key={opened.book.id}
            book={opened.book}
            blocks={opened.blocks}
            settings={settings}
            online={online}
            onBack={leaveReader}
            onOpenSettings={() => setShowSettings((value) => !value)}
            onBilingual={(bilingual) => setSettings((value) => ({ ...value, bilingual }))}
            settingsOpen={showSettings || showApiSettings}
            onOpenApiSettings={() => setShowApiSettings(true)}
            initialProgress={opened.progress}
            onProgress={handleProgress}
            onState={setReaderState}
            onError={reportError}
          />
        </>
      ) : (
        <main className="library">
          <section className="library-intro">
            <div className="eyebrow">
              <span /> YOUR PERSONAL READING SPACE
            </div>
            <h1>
              Folio，
              <br className="mobile-break" />
              你的阅读空间<span>。</span>
            </h1>
            <p>
              只是一个阅读器。
              <br />
              本地导入，语言翻译，随时接着读。
            </p>
            <div className="intro-rule" />
          </section>
          <section className="library-section">
            <div className="section-heading">
              <h2>
                我的书库 <span>{books.length.toString().padStart(2, "0")}</span>
              </h2>
              <span>仅保存在此设备</span>
            </div>
            <button
              className="import-dropzone"
              disabled={!ready || importing || clearingStorage}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) void handleImport(file);
              }}
            >
              <span className="import-icon">
                <FilePlus2 size={28} strokeWidth={1.4} />
              </span>
              <strong>导入pdf</strong>
              <span>选择或拖入文字型 PDF · 最大 50 MB / 300 页</span>
              <span className="dropzone-action">
                选择 PDF 文件 <Plus size={16} />
              </span>
            </button>
            {books.length > 0 && (
              <div className="book-list">
                {books.map((book, i) => (
                  <div className="book-card" key={book.id}>
                    <button
                      className="book-open"
                      disabled={clearingStorage}
                      onClick={() => {
                        setError("");
                        void openBook(book).catch(reportError);
                      }}
                    >
                      <span className={`book-cover cover-${i % 3}`}>
                        <span>PDF</span>
                        <BookOpen size={30} strokeWidth={1.1} />
                        <small>Folio LIBRARY</small>
                      </span>
                      <span className="book-info">
                        <small>
                          {book.status === "ready"
                            ? "Folio"
                            : book.status === "source-only"
                              ? "扫描文档 · 无可重排文字"
                              : "已导入 · 部分页面待校对"}
                        </small>
                        <strong>{book.name}</strong>
                        <span>
                          {book.totalPages} 个原始页 <i /> {book.blockCount}{" "}
                          个阅读段落
                        </span>
                      </span>
                      <span className="open-arrow">
                        <ArrowUpRight size={21} />
                      </span>
                    </button>
                    <button
                      className="delete-book icon-button"
                      disabled={clearingStorage}
                      title="从本机书库移除"
                      aria-label={`移除 ${book.name}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            `从本机书库移除“${book.name}”？原始文件不会被修改。`,
                          )
                        )
                          void deleteBook(book.id)
                            .then(refreshBooks)
                            .catch(reportError);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="sample-row">
              <span>
                <FileText size={16} /> 还没有合适的 PDF？
              </span>
              <button
                onClick={() => void demo()}
                disabled={!ready || importing || clearingStorage}
              >
                试读示例 <ArrowUpRight size={15} />
              </button>
            </div>
          </section>
          <section className="library-bottom">
            <div>
              <ShieldCheck size={19} />
              <div>
                <strong>书籍只属于你</strong>
                <p>解析在设备上完成，无需账户，也不上传文件。</p>
              </div>
            </div>
            <div>
              <HardDrive size={19} />
              <div>
                <strong>记得保留原文件</strong>
                <p>清理浏览器网站数据可能移除书库。</p>
              </div>
            </div>
          </section>
          <footer className="library-footer">
            <span>Folio · A LITTLE SPACE TO READ</span>
            <span>
              {offlineReady
                ? "应用外壳已可离线"
                : import.meta.env.DEV
                  ? "开发模式 · 热更新已启用"
                  : "HTTPS 下支持添加到主屏幕"}
            </span>
          </footer>
          <details className="storage-details">
            <summary>{storage}</summary>
            <p>
              书籍、译文和阅读进度会自动保存在当前浏览器中。
            </p>
            <div className="storage-actions">
              <button className="storage-delete" disabled={!ready || clearingStorage} onClick={() => void deleteLocalStorage()}>{clearingStorage ? "正在删除…" : "删除本地存储"}</button>
            </div>
          </details>
        </main>
      )}
      {importing && (
        <div className="import-overlay" role="status">
          <div>
            <LoaderCircle className="spin" size={28} />
            <h2>{importState?.phase ?? "正在导入"}</h2>
            <p>在本机处理，文件不会上传</p>
            <progress
              max={importState?.total || 1}
              value={importState?.page || 0}
            />
            <small>
              {importState?.page || 0} / {importState?.total || "—"} 个原始页 ·{" "}
              {importState?.blocks || 0} 个段落
            </small>
          </div>
        </div>
      )}
      {showApiSettings && <DeepSeekSettings onClose={closeApiSettings} />}
      {DebugPanel && (
        <Suspense fallback={null}>
          <DebugPanel
            importState={importState}
            readerState={readerState}
            book={opened?.book}
          />
        </Suspense>
      )}
    </div>
  );
}
