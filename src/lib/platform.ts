import { invoke, isTauri } from "@tauri-apps/api/core";

type BinaryResponse = ArrayBuffer | Uint8Array | number[];
const ARTIFACT_DATABASE = "paperloom-artifacts";
const ARTIFACT_STORE = "accepted-pdfs";

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

export async function hashPdfBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function documentIdFromHash(fileHash: string): string {
  return `pdf_${fileHash.toLowerCase()}`;
}

function openArtifactDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ARTIFACT_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ARTIFACT_STORE)) {
        request.result.createObjectStore(ARTIFACT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("로컬 논문 저장소를 열지 못했습니다."));
  });
}

export async function saveProjectPdf(
  documentId: string,
  bytes: Uint8Array,
): Promise<void> {
  if (runningInTauri()) {
    await invoke("write_project_pdf", {
      documentId,
      bytes: Array.from(bytes),
    });
    return;
  }
  const database = await openArtifactDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ARTIFACT_STORE, "readwrite");
    transaction.objectStore(ARTIFACT_STORE).put(bytes.slice().buffer, documentId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("한국어 논문을 저장하지 못했습니다."));
  });
  database.close();
}

export async function readProjectPdf(
  documentId: string,
): Promise<Uint8Array | null> {
  if (runningInTauri()) {
    const response = await invoke<BinaryResponse>("read_project_pdf", {
      documentId,
    });
    const bytes =
      response instanceof Uint8Array
        ? response
        : response instanceof ArrayBuffer
          ? new Uint8Array(response)
          : new Uint8Array(response);
    return bytes.byteLength ? bytes : null;
  }
  const database = await openArtifactDatabase();
  const value = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
    const transaction = database.transaction(ARTIFACT_STORE, "readonly");
    const request = transaction.objectStore(ARTIFACT_STORE).get(documentId);
    request.onsuccess = () => resolve(request.result as ArrayBuffer | undefined);
    request.onerror = () =>
      reject(request.error ?? new Error("저장된 한국어 논문을 읽지 못했습니다."));
  });
  database.close();
  return value ? new Uint8Array(value) : null;
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

export async function saveGeneratedPdf(
  bytes: Uint8Array,
  suggestedName: string,
): Promise<string | null> {
  if (!runningInTauri()) {
    const blob = new Blob([new Uint8Array(bytes)], {
      type: "application/pdf",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return suggestedName;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: "PDF document", extensions: ["pdf"] }],
  });
  if (!path) return null;
  await invoke("write_generated_pdf", {
    path,
    bytes: Array.from(bytes),
  });
  return path;
}

export async function storeProviderSecret(
  profileId: string,
  secret: string,
): Promise<void> {
  if (!runningInTauri()) return;
  await invoke("store_provider_secret", { profileId, secret });
}

export async function readProviderSecret(
  profileId: string,
): Promise<string> {
  if (!runningInTauri()) return "";
  return (await invoke<string | null>("read_provider_secret", { profileId })) ?? "";
}

export function fileNameFromPath(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments.at(-1) || "Untitled.pdf";
}

export function stableDocumentId(filePath: string): string {
  let hash = 2166136261;
  for (let index = 0; index < filePath.length; index += 1) {
    hash ^= filePath.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `doc_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
