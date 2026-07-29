import { describe, expect, it, vi } from "vitest";
import { observeClearedTextSelection } from "../src/lib/selection-toolbar";

class SelectionChangeTarget extends EventTarget {
  change(): void {
    this.dispatchEvent(new Event("selectionchange"));
  }
}

describe("selection toolbar", () => {
  it("dismisses itself when the browser selection is cleared", () => {
    const target = new SelectionChangeTarget();
    const onClear = vi.fn();
    let selection = {
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "selected paper text",
    };
    const stop = observeClearedTextSelection(target, () => selection, onClear);

    target.change();
    expect(onClear).not.toHaveBeenCalled();

    selection = {
      isCollapsed: true,
      rangeCount: 0,
      toString: () => "",
    };
    target.change();
    expect(onClear).toHaveBeenCalledOnce();

    stop();
    target.change();
    expect(onClear).toHaveBeenCalledOnce();
  });
});
