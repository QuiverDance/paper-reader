import { invoke } from "@tauri-apps/api/core";
import type { TypesettingPackageStatus } from "../types";
import { runningInTauri } from "./platform";

type BinaryResponse = ArrayBuffer | Uint8Array | number[];

const VERSION = "nanum-korean-7ff85c8";
const CACHE_NAME = `paperloom-typesetting-${VERSION}`;
const FILES = {
  serif: {
    url: "https://raw.githubusercontent.com/google/fonts/7ff85c87f93ea6cca5f41c69f2e4edcb90240f26/ofl/nanummyeongjo/NanumMyeongjo-Regular.ttf",
    bytes: 3_058_408,
    sha256: "7ed9e8653a8ed04285d51dc343ffea6eb3d9c73afc27383ea8929ee4ffd03205",
  },
  sans: {
    url: "https://raw.githubusercontent.com/google/fonts/7ff85c87f93ea6cca5f41c69f2e4edcb90240f26/ofl/nanumgothic/NanumGothic-Regular.ttf",
    bytes: 2_054_744,
    sha256: "76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31",
  },
} as const;

const TOTAL_BYTES = FILES.serif.bytes + FILES.sans.bytes;

function asBytes(response: BinaryResponse): Uint8Array {
  if (response instanceof Uint8Array) return response;
  if (response instanceof ArrayBuffer) return new Uint8Array(response);
  return new Uint8Array(response);
}

async function digest(bytes: Uint8Array): Promise<string> {
  const copied = new Uint8Array(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copied.buffer);
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function browserStatus(): Promise<TypesettingPackageStatus> {
  if (!("caches" in globalThis)) {
    return {
      installed: false,
      totalBytes: TOTAL_BYTES,
      installedBytes: 0,
      version: VERSION,
    };
  }
  const cache = await caches.open(CACHE_NAME);
  let installedBytes = 0;
  for (const file of Object.values(FILES)) {
    const response = await cache.match(file.url);
    if (response) installedBytes += file.bytes;
  }
  return {
    installed: installedBytes === TOTAL_BYTES,
    totalBytes: TOTAL_BYTES,
    installedBytes,
    version: VERSION,
  };
}

export async function getTypesettingPackageStatus(): Promise<TypesettingPackageStatus> {
  if (runningInTauri()) {
    return invoke<TypesettingPackageStatus>("typesetting_package_status");
  }
  return browserStatus();
}

export async function installTypesettingPackage(
  onProgress?: (completedBytes: number, totalBytes: number) => void,
): Promise<TypesettingPackageStatus> {
  if (runningInTauri()) {
    return invoke<TypesettingPackageStatus>("install_typesetting_package");
  }
  if (!("caches" in globalThis)) {
    throw new Error("이 브라우저는 글꼴 패키지 캐시를 지원하지 않습니다.");
  }
  const cache = await caches.open(CACHE_NAME);
  let completed = 0;
  for (const file of Object.values(FILES)) {
    const cached = await cache.match(file.url);
    if (cached) {
      completed += file.bytes;
      onProgress?.(completed, TOTAL_BYTES);
      continue;
    }
    const response = await fetch(file.url);
    if (!response.ok) {
      throw new Error(`한글 조판 글꼴을 받지 못했습니다 (${response.status}).`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== file.bytes || (await digest(bytes)) !== file.sha256) {
      throw new Error("받은 한글 조판 글꼴의 무결성 확인에 실패했습니다.");
    }
    await cache.put(
      file.url,
      new Response(bytes, {
        headers: { "Content-Type": "font/otf", "Content-Length": String(bytes.length) },
      }),
    );
    completed += bytes.length;
    onProgress?.(completed, TOTAL_BYTES);
  }
  return browserStatus();
}

export async function loadTypesettingFonts(): Promise<{
  serif: Uint8Array;
  sans: Uint8Array;
}> {
  if (runningInTauri()) {
    const [serif, sans] = await Promise.all([
      invoke<BinaryResponse>("read_typesetting_font", { kind: "serif" }),
      invoke<BinaryResponse>("read_typesetting_font", { kind: "sans" }),
    ]);
    return { serif: asBytes(serif), sans: asBytes(sans) };
  }
  const cache = await caches.open(CACHE_NAME);
  const [serifResponse, sansResponse] = await Promise.all([
    cache.match(FILES.serif.url),
    cache.match(FILES.sans.url),
  ]);
  if (!serifResponse || !sansResponse) {
    throw new Error("한글 조판 패키지를 먼저 설치해 주세요.");
  }
  return {
    serif: new Uint8Array(await serifResponse.arrayBuffer()),
    sans: new Uint8Array(await sansResponse.arrayBuffer()),
  };
}
