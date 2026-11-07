import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../storage/db";
import type { Book, ReadingBlock, TranslationResult } from "../types";
import { deepSeekProvider, getDeepSeekStatus, translateBlock, type DeepSeekStatus } from "./provider";

export function useTranslations(book: Book, enabled: boolean) {
  const [cache, setCache] = useState<TranslationResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<DeepSeekStatus>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<{ done: number; total: number; blockId?: string }>();
  const request = useRef<AbortController | undefined>(undefined);
  const connection = useRef<AbortController | undefined>(undefined);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    void db.translations.where("bookId").equals(book.id).toArray().then((rows) => {
      if (alive.current) { setCache(rows); setLoaded(true); }
    }).catch(() => {
      if (alive.current) { setError("无法读取本地译文缓存，请检查浏览器存储。为避免重复付费，暂不发起翻译。"); }
    });
    return () => { alive.current = false; request.current?.abort(); connection.current?.abort(); };
  }, [book.id]);
  const check = useCallback(async () => {
    connection.current?.abort();
    const controller = new AbortController();
    connection.current = controller;
    setChecking(true);
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const value = await getDeepSeekStatus(controller.signal);
      if (!alive.current || connection.current !== controller) return;
      setStatus(value);
      setError(value.configured ? "" : "尚未配置 DeepSeek Key：请填写电脑上的 .env.local，然后重启 npm.cmd run api。");
    } catch {
      if (alive.current && connection.current === controller) {
        setStatus(undefined);
        setError("未连接翻译服务。请在电脑另一个终端运行 npm.cmd run api，然后检查连接。已有译文可离线阅读。");
      }
    } finally {
      clearTimeout(timer);
      if (alive.current && connection.current === controller) setChecking(false);
    }
  }, []);
  useEffect(() => {
    if (enabled) void check();
  }, [enabled, check]);
  const results = useMemo(() => {
    const selected: Record<string, TranslationResult> = {};
    for (const row of cache) {
      if (row.sourceRevision !== book.parserRevision || row.targetLanguage !== "zh-CN" || !row.provider.startsWith("deepseek:")) continue;
      const old = selected[row.blockId];
      // Prefer this model/prompt, while keeping older cached versions readable offline.
      if (!old || (row.provider === status?.provider && old.provider !== status.provider) ||
        ((row.provider === status?.provider) === (old.provider === status?.provider) && row.updatedAt > old.updatedAt)) selected[row.blockId] = row;
    }
    return selected;
  }, [cache, book.parserRevision, status?.provider]);
  const texts = useMemo(() => Object.fromEntries(Object.entries(results).map(([id, row]) => [id, row.text])), [results]);
  const run = useCallback(async (blocks: ReadingBlock[], force = false) => {
    if (request.current || !loaded || !status?.configured) return;
    const unique = [...new Map(blocks.map((block) => [block.id, block])).values()];
    const queue = unique.filter((block) => force || results[block.id]?.provider !== status.provider);
    if (!queue.length) { setError(""); return; }
    const controller = new AbortController();
    request.current = controller;
    setError("");
    const completed: TranslationResult[] = [];
    const publish = () => {
      if (alive.current) setCache((previous) => [...previous.filter((row) => !completed.some((next) => next.blockId === row.blockId && next.provider === row.provider && next.sourceRevision === row.sourceRevision)), ...completed]);
    };
    try {
      for (const block of queue) {
        if (controller.signal.aborted) break;
        if (block.text.length > status.maxCharacters) throw new Error(`此段超过 ${status.maxCharacters} 字符，暂不自动切碎翻译，请核对原页。`);
        setJob({ done: completed.length, total: queue.length, blockId: block.id });
        completed.push(await translateBlock(deepSeekProvider(status), book.id, block, force, controller.signal, book.parserRevision));
        if (completed.length % 3 === 0) publish();
      }
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "翻译失败，请稍后重试。");
    } finally {
      if (alive.current) {
        // Publish incrementally for whole-book jobs; successfully saved work survives failure.
        publish();
        setJob(undefined);
      }
      if (request.current === controller) request.current = undefined;
    }
  }, [book.id, book.parserRevision, loaded, status, results]);
  return { texts, results, status, checking, loaded, error, job, check, run, cancel: () => request.current?.abort() };
}
