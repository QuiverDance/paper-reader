type SelectionSnapshot = {
  isCollapsed: boolean;
  rangeCount: number;
  toString(): string;
};

type SelectionChangeTarget = {
  addEventListener(
    type: "selectionchange",
    listener: EventListenerOrEventListenerObject,
  ): void;
  removeEventListener(
    type: "selectionchange",
    listener: EventListenerOrEventListenerObject,
  ): void;
};

export function observeClearedTextSelection(
  target: SelectionChangeTarget,
  getSelection: () => SelectionSnapshot | null,
  onClear: () => void,
): () => void {
  const handleSelectionChange = () => {
    const selection = getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !selection.toString().trim()
    ) {
      onClear();
    }
  };

  target.addEventListener("selectionchange", handleSelectionChange);
  return () => {
    target.removeEventListener("selectionchange", handleSelectionChange);
  };
}
