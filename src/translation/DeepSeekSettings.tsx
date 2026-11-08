import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { clearDeepSeekKey, defaultDeepSeekConfig, deepSeekModels, loadDeepSeekConfig, saveDeepSeekConfig } from "./config";
import { testDeepSeekConnection } from "./provider";
import "./settings.css";

export default function DeepSeekSettings({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState(defaultDeepSeekConfig);
  const [visible, setVisible] = useState(false), [ready, setReady] = useState(false), [working, setWorking] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const connection = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadDeepSeekConfig().then((value) => { if (live) setDraft(value); }).catch(() => { if (live) setError("无法读取本机配置，可以重新填写保存。"); }).finally(() => { if (live) setReady(true); });
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    return () => { live = false; connection.current?.abort(); document.removeEventListener("keydown", key); };
  }, [onClose]);
  const save = async (clear = false) => {
    setWorking(true); setError(""); setMessage("");
    try {
      const value = clear ? await clearDeepSeekKey() : await saveDeepSeekConfig(draft);
      setDraft(value); setVisible(false); setMessage(clear ? "API Key 已清除，书籍、进度和译文保留。" : "配置已保存在当前设备。");
    } catch { setError("保存失败。请检查官方地址、模型、密钥格式和设备存储空间。"); }
    finally { setWorking(false); }
  };
  const test = async () => {
    setWorking(true); setError(""); setMessage("");
    const controller = new AbortController(); connection.current = controller;
    try { setMessage(await testDeepSeekConnection(draft, controller.signal)); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "连接失败，请检查网络与配置。"); }
    finally { if (!controller.signal.aborted) setWorking(false); }
  };
  return <div className="api-settings-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="api-settings" role="dialog" aria-modal="true" aria-label="DeepSeek API 设置">
      <header><h2>DeepSeek API 设置</h2><button className="icon-button" aria-label="关闭 API 设置" onClick={onClose}><X size={20} /></button></header>
      <p>使用自己的 Key 和额度，浏览器通过 HTTPS 直连 DeepSeek。</p>
      <label htmlFor="deepseek-key">API Key</label>
      <div className="api-key-field"><input id="deepseek-key" type={visible ? "text" : "password"} value={draft.apiKey} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={!ready || working}
        onChange={(event) => setDraft((old) => ({ ...old, apiKey: event.target.value }))} />
        <button className="icon-button" aria-label={visible ? "隐藏 API Key" : "显示 API Key"} onClick={() => setVisible((old) => !old)}>{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
      <label htmlFor="deepseek-url">Base URL</label>
      <input id="deepseek-url" type="url" value={draft.baseUrl} autoComplete="off" spellCheck={false} disabled={!ready || working} onChange={(event) => setDraft((old) => ({ ...old, baseUrl: event.target.value }))} />
      <small>仅支持 DeepSeek 官方地址，也可使用官方 /v1 路径。</small>
      <label htmlFor="deepseek-model">模型</label><select id="deepseek-model" value={draft.model} disabled={!ready || working} onChange={(event) => setDraft((old) => ({ ...old, model: event.target.value }))}>
        {deepSeekModels.map((model) => <option key={model} value={model}>{model}</option>)}
      </select>
      <p className="api-security-note">密钥仅保存在此浏览器的 IndexedDB，直接发送给 DeepSeek，不上传到 GitHub。浏览器存储不是保险箱，同源脚本或使用本设备的人可能读取；请勿在共享设备保存。清除网站数据会删除密钥和书库。</p>
      <div className="api-settings-actions"><button disabled={!ready || working || !draft.apiKey.trim()} onClick={() => void test()}>测试连接</button><button className="primary-button" disabled={!ready || working} onClick={() => void save()}>保存配置</button></div>
      <button className="api-clear" disabled={!ready || working} onClick={() => void save(true)}>清除 API Key</button>
      {working && <p role="status">正在处理…</p>}{message && <p role="status">{message}</p>}{error && <p className="translation-error" role="alert">{error}</p>}
    </section>
  </div>;
}
