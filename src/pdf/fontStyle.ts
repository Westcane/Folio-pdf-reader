import type { PDFPageProxy } from "pdfjs-dist";

export function describeFont(
  name: string,
  metadata?: {
    bold?: unknown;
    italic?: unknown;
    cssFontInfo?: { fontWeight?: unknown; italicAngle?: unknown };
  },
) {
  const family = name
    .replace(/^[A-Z]{6}\+/u, "")
    .replace(
      /[-,](?:regular|regu(?:ital)?|roman|bold.*|italic|oblique|medium|book|light|semibold|demi.*)$/iu,
      "",
    );
  return {
    fontName: name,
    fontFamily: family,
    bold:
      metadata?.bold === true ||
      Number(metadata?.cssFontInfo?.fontWeight) >= 600 ||
      /bold|black|demi/iu.test(name),
    italic:
      metadata?.italic === true ||
      !!Number(metadata?.cssFontInfo?.italicAngle) ||
      /italic|oblique|ital$/iu.test(name),
  };
}

/** PDF.js text-content font IDs are opaque. Resolve its already-parsed font objects
 * after the operator list loads fonts. Version-pinned adapter; unknown fonts fall back safely. */
export async function readPageFontStyles(page: PDFPageProxy, ids: string[]) {
  const styles = new Map<string, ReturnType<typeof describeFont>>();
  if (ids.some((id) => !page.commonObjs.has(id))) {
    try {
      await page.getOperatorList();
    } catch (error) {
      console.warn("字体样式信息不完整，将继续保留原始文字。", error);
    }
  }
  for (const id of ids) {
    if (!page.commonObjs.has(id)) continue;
    try {
      const font = page.commonObjs.get(id);
      if (typeof font?.name === "string")
        styles.set(id, describeFont(font.name, font));
    } catch {
      /* A missing style must never cause a text page to be dropped. */
    }
  }
  return styles;
}
