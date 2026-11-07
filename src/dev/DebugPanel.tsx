import { useEffect, useState } from "react";
import type { Book, ImportState } from "../types";
import type { ReaderState } from "../reader/Reader";
import { clearLogs, getLogs, subscribe } from "./logs";
import "./debug.css";

export default function DebugPanel({
  importState,
  readerState,
  book,
}: {
  importState?: ImportState;
  readerState?: ReaderState;
  book?: Book;
}) {
  const [open, setOpen] = useState(false),
    [logs, setLogs] = useState(getLogs);
  useEffect(() => subscribe(() => setLogs(getLogs())), []);
  return (
    <div className="dev-tools">
      <button
        className="dev-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        DEV · 调试 {logs.length > 0 && `(${logs.length})`}
      </button>
      {open && (
        <section className="dev-panel" aria-label="开发调试面板">
          <header>
            <strong>Folio DEV diagnostics</strong>
            <button onClick={() => setOpen(false)}>关闭</button>
          </header>
          <p>仅开发模式可见 · 日志只在当前设备内存中保留</p>
          <dl>
            <dt>环境</dt>
            <dd>
              {window.isSecureContext
                ? "安全上下文"
                : "HTTP LAN · 无 PWA 离线能力"}{" "}
              / {navigator.onLine ? "online" : "offline"}
            </dd>
            <dt>导入状态</dt>
            <dd>
              {JSON.stringify(importState ?? { phase: "待导入" }, null, 2)}
            </dd>
            <dt>文档标识</dt>
            <dd>{book?.id ?? "—"}</dd>
            <dt>段落数 / 原页</dt>
            <dd>
              {book?.blockCount ?? 0} / {book?.totalPages ?? 0}
            </dd>
            <dt>阅读器状态</dt>
            <dd>{JSON.stringify(readerState ?? {}, null, 2)}</dd>
          </dl>
          <details>
            <summary>逐页解析诊断 ({book?.diagnostics.length ?? 0})</summary>
            {book?.diagnostics.map((page) => (
              <pre key={page.page}>
                {JSON.stringify({ ...page, rawText: undefined })}
              </pre>
            ))}
          </details>
          <header>
            <strong>错误与警告 ({logs.length})</strong>
            <button onClick={clearLogs}>清空日志</button>
          </header>
          {!logs.length && <p>暂无错误或警告。</p>}
          {logs.map((log, i) => (
            <pre key={i}>
              [{log.time}] {log.level}: {log.message}
            </pre>
          ))}
        </section>
      )}
    </div>
  );
}
