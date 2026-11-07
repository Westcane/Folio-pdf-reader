import type { PdfPaperBlock, PdfPageIssue } from "./pdf/reconstruct";
import type { TextStyleRange } from "./pdf/textStyle";

export const PARSER_REVISION = "pdf-reader-v1";
export interface SourceTextRange {
  start: number;
  end: number;
  page: number;
}
export interface ReadingBlock extends PdfPaperBlock {
  /** Identity is scoped by the content hash and parser revision, independent of typography. */
  rawText: string;
  warning?: string;
  sourceRanges?: SourceTextRange[];
}
export interface PageDiagnostic {
  page: number;
  quality: "supported" | "review" | "rejected";
  columns: 1 | 2;
  items: number;
  characters: number;
  issues: Array<PdfPageIssue | "extraction-error" | "complex-layout">;
  rawText: string;
}
export interface Book {
  id: string;
  name: string;
  size: number;
  totalPages: number;
  blockCount: number;
  importedAt: number;
  status: "ready" | "review" | "source-only";
  parserRevision: string;
  diagnostics: PageDiagnostic[];
}
export interface BookContent {
  bookId: string;
  blocks: ReadingBlock[];
}
export interface ReadingPosition {
  blockId: string;
  offset: number;
  /** Optional cursor within a translated-only page; offset still points into the source. */
  translationOffset?: number;
}
export interface ReadingProgress extends ReadingPosition {
  bookId: string;
  fraction: number;
  updatedAt: number;
}
export interface Settings {
  fontSize: number;
  lineHeight: number;
  margin: number;
  theme: "light" | "sepia" | "dark";
  bilingual: boolean;
  readingMode: "scroll" | "horizontal";
}
export const defaultSettings: Settings = {
  fontSize: 21,
  lineHeight: 1.75,
  margin: 44,
  theme: "light",
  bilingual: false,
  readingMode: "scroll",
};
export interface PageFragment {
  blockId: string;
  start: number;
  end: number;
  kind: ReadingBlock["kind"];
  text: string;
  translated?: boolean;
  styles?: TextStyleRange[];
  gapBefore?: number;
}
export interface ReadingPage {
  fragments: PageFragment[];
  anchor: ReadingPosition;
}
export interface ImportState {
  phase: string;
  page: number;
  total: number;
  blocks: number;
  error?: string;
}

export interface TranslationResult {
  bookId: string;
  blockId: string;
  sourceRevision: string;
  targetLanguage: string;
  provider: string;
  text: string;
  updatedAt: number;
}
export interface TranslationProvider {
  readonly id: string;
  translate(input: {
    bookId: string;
    block: ReadingBlock;
    sourceRevision: string;
    targetLanguage: string;
    signal?: AbortSignal;
  }): Promise<TranslationResult>;
}
