/** @babel */

// Native block heights remain indexed even while their DOM is virtualized.
export default function blockPositions(editor) {
  const component = editor.getElement().getComponent();
  const groups = new Map();
  const tops = new Map();
  for (const decoration of editor.getDecorations({ type: "block" })) {
    const marker = decoration.getMarker();
    if (!marker.isValid()) continue;
    const row = marker.getHeadScreenPosition().row;
    const { position = "before", order = 0 } = decoration.getProperties();
    const key = `${row}:${position}`;
    let group = groups.get(key);
    if (!group) {
      group = { row, position, items: [] };
      groups.set(key, group);
    }
    group.items.push({ decoration, order });
  }
  for (const { row, position, items } of groups.values()) {
    let top =
      position === "after"
        ? component.pixelPositionAfterBlocksForRow(row) + component.getLineHeight()
        : component.pixelPositionBeforeBlocksForRow(row);
    items.sort((a, b) => a.order - b.order || a.decoration.id - b.decoration.id);
    for (const { decoration } of items) {
      tops.set(decoration, top);
      top += component.heightsByBlockDecoration.get(decoration) || 0;
    }
  }
  return tops;
}
