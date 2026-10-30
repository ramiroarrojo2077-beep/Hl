export interface ExtractedPage {
  index: number;
  text: string;
  headings: { text: string; level: number }[];
  tables: number;
  tableRows: number;
  images: number;
  ocr?: boolean;
  ocrConfidence?: number;
}

export interface ExtractResult {
  pages: ExtractedPage[];
  unitLabel: string;
  warnings: string[];
  ocrUsed: boolean;
}

export interface ExtractCtx {
  signal?: AbortSignal;
  progress: (p: number, detail: string) => void;
  ocrMode: 'local' | 'ai' | 'off';
}
