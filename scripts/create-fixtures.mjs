import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir("tests/fixtures", { recursive: true });
await mkdir("public/samples", { recursive: true });
await mkdir("public/icons", { recursive: true });
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="108" fill="#496c55"/><g fill="none" stroke="#f7f6f2" stroke-width="14" stroke-linejoin="round"><path d="M256 159c-38-27-79-30-126-15v211c49-15 90-10 126 17 36-27 77-32 126-17V144c-47-15-88-12-126 15Z"/><path d="M256 159v213"/><path d="M159 193c25-5 46-2 67 10m-67 33c25-5 46-2 67 10m60-43c21-12 42-15 67-10m-67 53c21-12 42-15 67-10" stroke-width="9"/></g></svg>`;
await writeFile("public/icons/icon.svg", icon);
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
  ["icon-maskable.png", 512],
]) {
  await sharp(Buffer.from(icon))
    .resize(size, size)
    .png()
    .toFile(resolve("public/icons", name));
}
const body =
  "Reading is a conversation across time. A flexible page makes room for attention, allowing the reader to choose a comfortable type size and return to the same sentence later. Local files stay on this device, and the original page is always available for comparison.";
function wrap(text, font, size, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && font.widthOfTextAtSize(line + " " + word, size) > width) {
      lines.push(line);
      line = word;
    } else line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return lines;
}
async function make(name, count, kind = "single") {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman),
    bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  for (let i = 0; i < count; i++) {
    const page = doc.addPage([600, 800]);
    const text = (value, x, y, size = 12, face = font) =>
      page.drawText(value, {
        x,
        y,
        size,
        font: face,
        color: rgb(0.13, 0.17, 0.14),
      });
    if (kind === "scan") {
      page.drawRectangle({
        x: 70,
        y: 100,
        width: 460,
        height: 600,
        color: rgb(0.9, 0.91, 0.9),
      });
      for (let y = 150; y < 650; y += 24)
        page.drawLine({
          start: { x: 100, y },
          end: { x: 490, y },
          thickness: 6,
          color: rgb(0.6, 0.62, 0.6),
        });
      continue;
    }
    text("FOLIO SYNTHETIC READING SAMPLE", 70, 775, 8);
    text(String(i + 1), 296, 24, 9);
    if (kind === "double") {
      text("A two-column reading experiment", 55, 738, 20, bold);
      for (const [label, x] of [
        ["LEFT", 55],
        ["RIGHT", 315],
      ]) {
        let y = 680;
        for (let p = 0; p < 6; p++) {
          for (const line of wrap(
            `${label} paragraph ${p + 1}. A research paper has a clear reading order from the top to the bottom of each column.`,
            font,
            11,
            230,
          )) {
            text(line, x, y, 11);
            y -= 15;
          }
          y -= 20;
        }
      }
    } else if (kind === "complex") {
      text("Tables and equations need the original page", 60, 738, 19, bold);
      text(
        "This synthetic page intentionally includes a numeric table and an equation.",
        60,
        690,
        12,
      );
      for (let row = 0; row < 8; row++)
        for (let col = 0; col < 5; col++)
          text(
            row ? `${row * 10 + col}` : `Group ${col}`,
            70 + col * 95,
            610 - row * 30,
            10,
          );
      text("E = m * c^2   x = (a + b) / {c}   y <= z", 80, 260, 16);
      text("1. A footnote is smaller than the body text.", 60, 100, 8);
    } else {
      let y = 723;
      if (i === 0) {
        text("Reading, at your own pace", 70, 730, 25, bold);
        text("A quieter place for your PDFs.", 70, 676, 12);
        y = 624;
      } else {
        text(`Chapter ${i + 1}. A page that adapts`, 70, 730, 21, bold);
        y = 680;
      }
      for (let p = 0; p < 5; p++) {
        for (const line of wrap(
          `${p === 0 ? "Caf\u00e9 readers welcome. " : ""}${body}`,
          font,
          12,
          460,
        )) {
          text(line, 70, y, 12);
          y -= 17;
        }
        y -= 20;
      }
      if (i === 0) text("A cross-page thought describes an inter-", 70, 72, 12);
      if (i === 1) text("national community of curious readers.", 70, 752, 12);
      text("1. Synthetic footnote: compare with the original PDF.", 70, 52, 8);
    }
  }
  const bytes = await doc.save();
  await writeFile(`tests/fixtures/${name}.pdf`, bytes);
  if (name === "single")
    await writeFile("public/samples/reading-sample.pdf", bytes);
  console.log(`${name}: ${count} pages, ${bytes.length} bytes`);
}
await make("single", 8);
await make("double", 3, "double");
await make("complex", 1, "complex");
await make("scan", 1, "scan");
await make("long", 60);
await writeFile("tests/fixtures/invalid.pdf", "this is not a PDF");
