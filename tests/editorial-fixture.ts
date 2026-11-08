import { PDFDocument, StandardFonts } from "pdf-lib";
export async function editorialFixture() {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([600, 800]);
  const draw = (text: string, y: number, font = regular, size = 12, x = 60) =>
    page.drawText(text, { x, y, size, font });
  draw("An editorial reading specimen", 735, regular, 21);
  draw("Summary", 675, sans);
  draw(
    "A book should keep its structure when the page is allowed to adapt.",
    640,
  );
  draw(
    "Headings and ordinary paragraphs need a clear visual relationship.",
    625,
  );
  draw("Notes", 570, sans);
  draw(
    "This introduction explains how the chapter markers should appear.",
    535,
  );
  draw("They should retain their own line and the original emphasis.", 520);
  draw("one", 435, italic);
  draw("The next chapter begins with a separate ordinary paragraph.", 408);
  draw(
    "Its first line must never be joined to the small italic chapter marker.",
    393,
  );
  return Buffer.from(await pdf.save());
}

export async function crossPageFixture() {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const first = pdf.addPage([600, 800]),
    second = pdf.addPage([600, 800]);
  first.drawText("A continuous paragraph across original pages", {
    x: 60,
    y: 730,
    size: 20,
    font: regular,
  });
  [
    "This paragraph begins close to the bottom of the first original page. Its words",
    "belong together even when a printed document has no more room for the next line.",
    "The same paragraph continues at the bottom of the page because a PDF has a fixed",
  ].forEach((text, index) =>
    first.drawText(text, {
      x: 60,
      y: 80 - index * 15,
      size: 12,
      font: regular,
    }),
  );
  second.drawText(
    "page size, while the words still belong to the same logical paragraph.",
    { x: 60, y: 750, size: 12, font: italic },
  );
  second.drawText(
    "Changing the physical page should not insert a new paragraph in the reflowed view.",
    { x: 60, y: 735, size: 12, font: regular },
  );
  second.drawText(
    "This new paragraph follows a clear blank and should remain separate.",
    { x: 60, y: 650, size: 12, font: regular },
  );
  return Buffer.from(await pdf.save());
}
