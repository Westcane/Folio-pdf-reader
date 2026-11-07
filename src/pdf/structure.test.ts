import { describe, expect, it } from "vitest";
import {
  analyzePdfTextPage,
  buildPdfPaperDocument,
  type PdfRawTextItem,
} from "./reconstruct";
import { assembleBlocks } from "./structure";
import { sourcePageForOffset } from "../reader/sourceLocation";

const item = (str: string, top: number, sourceIndex = 0): PdfRawTextItem => ({
  str,
  dir: "ltr",
  fontName: "test",
  width: 450,
  height: 12,
  transform: [12, 0, 0, 12, 60, 800 - top - 12],
  hasEOL: true,
  sourceIndex,
});
function assemble(
  pages: PdfRawTextItem[][],
  mutate?: (pages: ReturnType<typeof analyzePdfTextPage>[]) => void,
) {
  const indexed = pages.map((items) =>
    items.map((value, sourceIndex) => ({ ...value, sourceIndex })),
  );
  const analyzed = indexed.map((items, index) =>
    analyzePdfTextPage({ page: index + 1, width: 600, height: 800, items }),
  );
  mutate?.(analyzed);
  return assembleBlocks("doc", buildPdfPaperDocument(analyzed), indexed);
}
const tail = () => [
  item("This long paragraph starts before the original page boundary", 710),
  item(
    "and continues with a full-width physical line ending in an ordinary word",
    725,
  ),
];
const head = () => [
  item(
    "before completing the same paragraph on the following original page.",
    25,
  ),
  item(
    "This second physical line still belongs to that continued paragraph.",
    40,
  ),
];
describe("conservative block assembly", () => {
  it("joins ordinary cross-page prose with a space and retains both source locations", () => {
    const result = assemble([
      tail(),
      [
        ...head(),
        item(
          "A genuinely new paragraph follows a larger blank within the page.",
          100,
        ),
      ],
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].text).toContain("ordinary word before completing");
    expect(result[0].fragments.map((rect) => rect.page)).toEqual([1, 2]);
    expect(result[0].sourceRanges?.map((range) => range.page)).toEqual([1, 2]);
    const second = result[0].sourceRanges![1];
    expect(result[0].text.slice(second.start, second.end)).toMatch(
      /^before completing/,
    );
    expect(sourcePageForOffset(result[0], second.start)).toBe(2);
  });
  it("keeps emphasis ranges at their correct offsets after a page join", () => {
    const continuation = head().map((value) => ({ ...value, italic: false }));
    continuation[0] = { ...continuation[0], italic: true };
    const result = assemble([tail(), continuation]);
    expect(result).toHaveLength(1);
    const style = result[0].styles!.find((range) => range.italic)!;
    expect(result[0].text.slice(style.start, style.end)).toBe(
      continuation[0].str,
    );
    expect(style.start).toBe(result[0].sourceRanges![1].start);
  });
  it("continues a sentence when the next page starts with a capitalized proper name", () => {
    const continuation = head();
    continuation[0].str =
      "Aster and the other readers finish this ongoing sentence together.";
    expect(assemble([tail(), continuation])).toHaveLength(1);
  });
  it("can continue the paragraph after a sentence ending on a nearly full last line", () => {
    const ending = tail();
    ending[1].str += ".";
    expect(assemble([ending, head()])).toHaveLength(1);
  });
  it("does not join a short completed last line to a new page paragraph", () => {
    const ending = tail();
    ending[1] = { ...ending[1], str: "The paragraph ends here.", width: 180 };
    expect(assemble([ending, head()])).toHaveLength(2);
  });
  it("does not join a newly indented paragraph, new dialogue, or a new chapter", () => {
    const indented = head();
    indented[0] = {
      ...indented[0],
      transform: [12, 0, 0, 12, 80, 800 - 25 - 12],
      width: 430,
    };
    expect(assemble([tail(), indented])).toHaveLength(2);
    const dialogue = head();
    dialogue[0].str =
      "“A new speaker begins a separate paragraph on the next original page.”";
    expect(assemble([tail(), dialogue])).toHaveLength(2);
    expect(
      assemble([
        tail(),
        [
          item("Notes", 25),
          item("A separate section begins with this new paragraph.", 80),
        ],
      ]).map((block) => block.kind),
    ).toEqual(["paragraph", "heading", "paragraph"]);
  });
  it("leaves changed type styles, columns and rejected pages as explicit boundaries", () => {
    expect(
      assemble([tail(), head().map((value) => ({ ...value, italic: true }))]),
    ).toHaveLength(2);
    const resized = head().map((value) => ({ ...value, height: 16 }));
    expect(assemble([tail(), resized])).toHaveLength(2);
    expect(
      assemble([tail(), head()], (pages) => {
        pages[0].columnCount = 2;
      }),
    ).toHaveLength(2);
    expect(assemble([tail(), [], head()])).toHaveLength(3);
  });
  it("joins body continuation across a footer while retaining the footnote separately", () => {
    const footnote = {
      ...item(
        "1. This smaller footnote remains separate from the running body text.",
        755,
      ),
      height: 8,
      width: 360,
      transform: [8, 0, 0, 8, 60, 800 - 755 - 8],
    };
    const result = assemble([[...tail(), footnote], head()]);
    expect(result.map((block) => block.kind)).toEqual([
      "paragraph",
      "footnote",
    ]);
    expect(result[0].fragments.map((rect) => rect.page)).toEqual([1, 2]);
    expect(result[1].text).toBe(footnote.str);
  });
  it("retains a single logical paragraph across three consecutive original pages", () => {
    const middle = Array.from({ length: 48 }, (_, index) =>
      item(
        `This continuous middle-page line ${index} remains in the same uninterrupted paragraph`,
        25 + 15 * index,
      ),
    );
    const result = assemble([tail(), middle, head()].map(items => [...items, item('RUNNING FOOTER', 785)]));
    expect(result).toHaveLength(1);
    expect(result[0].sourceRanges?.map((range) => range.page)).toEqual([
      1, 2, 3,
    ]);
    expect(
      sourcePageForOffset(result[0], result[0].sourceRanges![2].start),
    ).toBe(3);
  });
  it("does not merge a small running header into adjacent body text", () => {
    const pages = Array.from({ length: 3 }, (_, index) => {
      const header = {
        ...item("RUNNING HEADER", 17),
        height: 8,
        transform: [8, 0, 0, 8, 60, 775],
      };
      return analyzePdfTextPage({
        page: index + 1,
        width: 600,
        height: 800,
        items: [
          header,
          item(
            `${["First", "Second", "Third"][index]} body continuation is long enough for reliable extraction.`,
            36,
            1,
          ),
        ],
      });
    });
    const paper = buildPdfPaperDocument(pages);
    expect(
      paper.blocks.some((block) => block.text.includes("RUNNING HEADER")),
    ).toBe(false);
    expect(paper.blocks.length).toBe(3);
  });
  it("preserves the raw text of rejected pages instead of silently omitting it", () => {
    const items = [item("x = 3", 100)];
    const paper = buildPdfPaperDocument([
      analyzePdfTextPage({ page: 1, width: 600, height: 800, items }),
    ]);
    const blocks = assembleBlocks("doc", paper, [items]);
    expect(blocks[0].text).toBe("x = 3");
    expect(blocks[0].warning).toBeTruthy();
  });
  it("retains an explicit placeholder and source mapping for a scanned page", () => {
    const paper = buildPdfPaperDocument([
      analyzePdfTextPage({ page: 1, width: 600, height: 800, items: [] }),
    ]);
    expect(assembleBlocks("doc", paper, [[]])[0]).toMatchObject({
      confidence: 0,
      fragments: [{ page: 1, left: 0, top: 0, width: 1, height: 1 }],
    });
  });
  it("merges explicit cross-page hyphen continuation and keeps both source pages", () => {
    const pages = [
      [item("This long paragraph continues with an inter-", 650)],
      [item("national reading community welcomes readers.", 100)],
    ];
    const paper = buildPdfPaperDocument(
      pages.map((items, i) =>
        analyzePdfTextPage({ page: i + 1, width: 600, height: 800, items }),
      ),
    );
    const result = assembleBlocks("doc", paper, pages);
    expect(result[0].text).toContain("international");
    expect(result[0].fragments.map((f) => f.page)).toEqual([1, 2]);
    expect(assembleBlocks("doc", paper, pages)[0].id).toBe(result[0].id);
  });
});
