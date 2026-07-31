import { describe, expect, it } from "vitest";
import {
  documentIdFromHash,
  hashPdfBytes,
} from "../src/lib/platform";

describe("source paper identity", () => {
  it("uses exact PDF bytes rather than a path or filename", async () => {
    const first = await hashPdfBytes(
      new TextEncoder().encode("%PDF-1.7 same paper"),
    );
    const second = await hashPdfBytes(
      new TextEncoder().encode("%PDF-1.7 same paper"),
    );
    const changed = await hashPdfBytes(
      new TextEncoder().encode("%PDF-1.7 changed paper"),
    );

    expect(first).toBe(second);
    expect(first).not.toBe(changed);
    expect(documentIdFromHash(first)).toBe(`pdf_${first}`);
  });
});
