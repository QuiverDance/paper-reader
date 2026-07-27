import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// The generic PDF.js viewer bundle reads the core API from this global during
// module evaluation. Register it before pdf_viewer.mjs is evaluated.
Object.assign(globalThis, { pdfjsLib });

const { GlobalWorkerOptions, getDocument } = pdfjsLib;
GlobalWorkerOptions.workerSrc = workerUrl;

export async function loadPdfDocument(data: Uint8Array): Promise<PDFDocumentProxy> {
  const task = getDocument({
    data,
    useSystemFonts: true,
  });
  return task.promise;
}

export async function extractPdfTitle(
  document: PDFDocumentProxy,
  fallback: string,
): Promise<string> {
  try {
    const metadata = await document.getMetadata();
    const info = metadata.info as { Title?: string };
    const title = info.Title?.trim();
    return title || fallback.replace(/\.pdf$/i, "");
  } catch {
    return fallback.replace(/\.pdf$/i, "");
  }
}
