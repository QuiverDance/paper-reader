import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ScannedPdfFile } from "../types";

type BinaryResponse = ArrayBuffer | Uint8Array | number[];

export function runningInTauri(): boolean {
  return isTauri();
}

export async function readPdfFromPath(filePath: string): Promise<Uint8Array> {
  if (!runningInTauri()) {
    throw new Error("최근 문서는 데스크톱 앱에서 다시 열 수 있습니다.");
  }

  const response = await invoke<BinaryResponse>("read_pdf", { path: filePath });
  if (response instanceof Uint8Array) return response;
  if (response instanceof ArrayBuffer) return new Uint8Array(response);
  return new Uint8Array(response);
}

export async function selectPdfPath(): Promise<string | null> {
  if (!runningInTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "PDF document", extensions: ["pdf"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function selectLibraryPath(): Promise<string | null> {
  if (!runningInTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    multiple: false,
    directory: true,
    title: "논문 폴더 선택",
  });
  return typeof selected === "string" ? selected : null;
}

export async function scanLibraryFolder(
  folderPath: string,
): Promise<ScannedPdfFile[]> {
  if (!runningInTauri()) {
    throw new Error("폴더 스캔은 데스크톱 앱에서 사용할 수 있습니다.");
  }
  return invoke<ScannedPdfFile[]>("scan_pdf_directory", {
    path: folderPath,
  });
}

export function fileNameFromPath(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments.at(-1) || "Untitled.pdf";
}

export function folderNameFromPath(folderPath: string): string {
  const normalized = folderPath.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/);
  return segments.at(-1) || normalized;
}

export function stableDocumentId(filePath: string): string {
  let hash = 2166136261;
  for (let index = 0; index < filePath.length; index += 1) {
    hash ^= filePath.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `doc_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
