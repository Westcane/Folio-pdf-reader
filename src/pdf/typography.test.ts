import { describe, expect, it } from "vitest";
import { analyzePdfTextPage, type PdfRawTextItem } from "./reconstruct";
import { clipStyleRanges, styledSegments } from "./textStyle";
import { describeFont } from "./fontStyle";

function item(
  str: string,
  top: number,
  fontName = "Times-Roman",
  left = 60,
  width = 430,
): PdfRawTextItem {
  return {
    str,
    transform: [12, 0, 0, 12, left, 800 - top - 12],
    height: 12,
    width,
    dir: "ltr",
    hasEOL: false,
    fontName,
  };
}
const analyze = (items: PdfRawTextItem[]) =>
  analyzePdfTextPage({ page: 1, width: 600, height: 800, items });
describe("editorial structure and emphasis", () => {
  it("uses the normal line leading to separate full-width paragraphs, including closing quotes", () => {
    const result = analyze([
      item("This paragraph occupies an ordinary long line of text,", 100),
      item("and ends on another full-width line with a closing quote.”", 115),
      item("This is a new paragraph after the larger original blank.", 142),
      item("Its continuation uses normal line spacing again.", 157),
    ]);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].text).toContain("quote.”");
    expect(result.blocks[1].text).toMatch(/^This is a new paragraph/);
  });
  it("recognizes same-size summary and notes headings", () => {
    const result = analyze([
      item("Summary", 80, "Helvetica", 40, 55),
      item(
        "This body paragraph is long enough to establish ordinary running text.",
        120,
      ),
      item("Notes", 180, "Helvetica", 40, 35),
      item(
        "A separate editorial paragraph follows the second section heading.",
        220,
      ),
    ]);
    expect(
      result.blocks.filter((b) => b.kind === "heading").map((b) => b.text),
    ).toEqual(["Summary", "Notes"]);
  });
  it("keeps a standalone italic chapter number separate from the following body", () => {
    const result = analyze([
      item(
        "This previous paragraph is separated from the chapter opening.",
        350,
      ),
      item("one", 440, "QRRAAA+NimbusRomNo9L-ReguItal", 60, 20),
      item("The next chapter begins with ordinary text on its own line.", 467),
    ]);
    const marker = result.blocks.find((block) => block.text === "one");
    expect(marker).toMatchObject({
      kind: "chapter",
      styles: [{ start: 0, end: 3, italic: true }],
    });
    expect(
      result.blocks.some((block) => block.text.startsWith("one The")),
    ).toBe(false);
  });
  it("preserves inline italics within a paragraph, including the correct joined offsets", () => {
    const result = analyze([
      item("The reader can", 100, "Times-Roman", 60, 80),
      item("choose", 100, "Times-Italic", 145, 35),
      item("a comfortable pace.", 100, "Times-Roman", 185, 120),
      item("The next physical line belongs to this same paragraph.", 115),
    ]);
    expect(result.blocks[0].text).toContain(
      "The reader can choose a comfortable pace.",
    );
    expect(
      styledSegments(result.blocks[0].text, result.blocks[0].styles).find(
        (segment) => segment.italic,
      )?.text,
    ).toBe("choose");
    expect(result.blocks[0].kind).toBe("paragraph");
  });
  it("does not turn a wrapped ordinary word or an italic sentence into a chapter", () => {
    const result = analyze([
      item("This ordinary sentence has a long physical line ending with", 100),
      item("one", 115, "Times-Roman", 60, 20),
      item("continuation that still belongs to the very same paragraph.", 130),
      item(
        "A complete italic sentence stays a paragraph.",
        200,
        "Times-Italic",
      ),
    ]);
    expect(result.blocks.every((block) => block.kind === "paragraph")).toBe(
      true,
    );
    expect(result.blocks[0].text).toContain("one continuation");
  });
  it("uses font descriptors, including subset font names, without enabling extra font data", () => {
    expect(describeFont("ABCDEF+NimbusRomNo9L-ReguItal")).toMatchObject({
      italic: true,
      bold: false,
      fontFamily: "NimbusRomNo9L",
    });
    expect(describeFont("ABCDEF+NimbusSans-Bold")).toMatchObject({
      bold: true,
      fontFamily: "NimbusSans",
    });
  });
  it("clips emphasis to a new page without changing the original text offsets", () => {
    const ranges = [{ start: 3, end: 12, italic: true }];
    expect(clipStyleRanges(ranges, 7, 15)).toEqual([
      { start: 0, end: 5, italic: true },
    ]);
    expect(
      styledSegments("abcDEFghi", [{ start: 3, end: 6, bold: true }])
        .map((s) => s.text)
        .join(""),
    ).toBe("abcDEFghi");
  });
});
