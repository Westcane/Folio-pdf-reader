import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../storage/db";
import type { Book, ReadingBlock, TranslationResult } from "../types";
import { deepSeekProvider, getDeepSeekStatus, translateBlock, type DeepSeekStatus } from "./provider";
import { configChanged, loadDeepSeekConfig, type DeepSeekConfig } from "./config";

export function useTranslations(book: Book, enabled: boolean) {
  const [cache, setCache] = useState<TranslationResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<DeepSeekStatus>();
  const [config, setConfig] = useState<DeepSeekConfig>();
  const [error, setError] = useState("");
  const [job, setJob] = useState<{ done: number; total: number; blockId?: string }>();
  const [failed, setFailed] = useState<{ blocks: ReadingBlock[]; force: boolean }>();
  const request = useRef<AbortController | undefined>(undefined);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    void db.translations.where("bookId").equals(book.id).toArray().then((rows) => {
      if (alive.current) { setCache(rows); setLoaded(true); }
    }).catch(() => {
      if (alive.current) { setError("无法读取本地译文缓存，请检查浏览器存储。为避免重复付费，暂不发起翻译。"); }
    });
    return () => { alive.current = false; request.current?.abort(); };
  }, [book.id]);
  const check = useCallback(async () => {
    try {
      const value = await loadDeepSeekConfig();
      if (!alive.current) return;
      setConfig(value); setStatus(getDeepSeekStatus(value)); setError("");
    } catch {
      if (alive.current) {
        setConfig(undefined); setStatus(undefined);
        setError("无法读取本机翻译配置，请重新保存 API 设置。已有译文可离线阅读。");
      }
    }
  }, []);
  useEffect(() => {
    if (enabled) void check();
    const changed = () => { request.current?.abort(); setFailed(undefined); void check(); };
    window.addEventListener(configChanged, changed);
    return () => window.removeEventListener(configChanged, changed);
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
  const previousTexts = useRef<Record<string, string>>({});
  const texts = useMemo(() => {
    const next = Object.fromEntries(Object.entries(results).map(([id, row]) => [id, row.text]));
    const old = previousTexts.current;
    if (Object.keys(old).length === Object.keys(next).length && Object.keys(next).every((id) => old[id] === next[id])) return old;
    previousTexts.current = next;
    return next;
  }, [results]);
  const run = useCallback(async (blocks: ReadingBlock[], force = false) => {
    if (request.current || !loaded || !status?.configured || !config) return;
    const unique = [...new Map(blocks.map((block) => [block.id, block])).values()];
    // Cached text has no TTL. Changing the configured model alone must not spend again.
    const queue = unique.filter((block) => force || !results[block.id]);
    if (!queue.length) { setError(""); return; }
    const controller = new AbortController();
    request.current = controller;
    setError(""); setFailed(undefined);
    const completed: TranslationResult[] = [];
    const publish = () => {
      if (alive.current && completed.length) setCache((previous) => [...previous.filter((row) => !completed.some((next) => next.blockId === row.blockId && next.provider === row.provider && next.sourceRevision === row.sourceRevision)), ...completed]);
    };
    try {
      for (const block of queue) {
        if (controller.signal.aborted) break;
        if (block.text.length > status.maxCharacters) throw new Error(`此段超过 ${status.maxCharacters} 字符，暂不自动切碎翻译，请核对原页。`);
        setJob({ done: completed.length, total: queue.length, blockId: block.id });
        completed.push(await translateBlock(deepSeekProvider(config), book.id, block, force, controller.signal, book.parserRevision));
        if (completed.length % 3 === 0) publish();
      }
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "翻译失败，请稍后重试。");
        setFailed({ blocks: queue.slice(completed.length), force });
      }
    } finally {
      if (alive.current) {
        // Publish incrementally for whole-book jobs; successfully saved work survives failure.
        publish();
        setJob(undefined);
      }
      if (request.current === controller) request.current = undefined;
    }
  }, [book.id, book.parserRevision, loaded, config, status, results]);
  return { texts, results, status, loaded, error, job, run, failed, retry: () => failed ? run(failed.blocks, failed.force) : Promise.resolve(), cancel: () => request.current?.abort() };
}
