import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

interface Props {
  title: string; online: boolean; visible: boolean;
  page: number; pages: number; busy: boolean;
  onShow: () => void; onSeek: (index: number) => void; onSeeking: (active: boolean) => void;
}
export function ReadingHeader({ title, online, visible, page, pages, busy, onShow, onSeek, onSeeking }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!visible) setOpen(false); }, [visible]);
  const label = `${page}/${pages || "—"} · ${pages ? Math.round(page / pages * 100) : 0}%`;
  const toggle = () => { onShow(); setOpen((old) => !old); };
  return (
    <div className={`reading-header${visible ? "" : " is-collapsed"}`}>
      <button className="reading-capsule" aria-label="阅读进度跳转" aria-expanded={open && visible} aria-controls="reading-seek" onClick={toggle}>
        <strong>{title}</strong>
        <span className="header-position-space" aria-hidden="true">{!online && <WifiOff size={14} />}<span>{label}</span></span>
      </button>
      <button className="reading-position" aria-label="阅读进度" aria-expanded={open && visible} aria-controls="reading-seek" onClick={toggle}>
        {!online && <WifiOff size={14} />}<span>{label}</span>
      </button>
      {open && visible && <div id="reading-seek" className="reading-seek">
        <input aria-label="阅读页码" aria-valuetext={`第 ${page} 页，共 ${pages} 页`} type="range" min="1" max={Math.max(1, pages)} step="1" value={page}
          disabled={busy || !pages} onChange={(event) => onSeek(Number(event.target.value) - 1)}
          onPointerDown={() => onSeeking(true)} onPointerUp={() => onSeeking(false)} onPointerCancel={() => onSeeking(false)} onLostPointerCapture={() => onSeeking(false)} onBlur={() => onSeeking(false)} />
      </div>}
    </div>
  );
}
