import { describe, expect, it } from "vitest";
import {
  findDocumentReferenceLabels,
  localizeDocumentReferenceLabels,
} from "../src/lib/document-references";

describe("document reference semantics", () => {
  it("keeps the subpart as mention metadata and the parent as target identity", () => {
    expect(
      findDocumentReferenceLabels(
        "Figure 2a, Figure 2(a), and Figure 5 A show the variants.",
      ).map(({ label, number, subpart }) => ({
        label,
        number,
        subpart,
      })),
    ).toEqual([
      { label: "Figure 2a", number: "2", subpart: "a" },
      { label: "Figure 2(a)", number: "2", subpart: "a" },
      { label: "Figure 5 A", number: "5", subpart: "a" },
    ]);
  });

  it("localizes the complete reference token without changing its parent number", () => {
    expect(
      localizeDocumentReferenceLabels(
        "Figure 5 A and Table 3(b) summarize the results.",
      ),
    ).toBe("그림 5(a) and 표 3(b) summarize the results.");
  });
});
