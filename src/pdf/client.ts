// Legacy build includes the compatibility shims needed by older Safari releases.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };

export function loadPdf(data: Uint8Array) {
  const base = new URL(
    `${import.meta.env.BASE_URL}pdf-assets/`,
    window.location.href,
  ).href;
  return pdfjs.getDocument({
    data,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    useSystemFonts: true,
  });
}
