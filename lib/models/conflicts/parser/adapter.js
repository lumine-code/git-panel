/** @babel */
/*
 * Input adapter to facilitate parsing conflicts from text loaded into an Editor.
 */
export class EditorAdapter {
  constructor(editor, startRow) {
    this.editor = editor;
    this.currentRow = startRow;
  }

  getCurrentRow() {
    return this.currentRow;
  }

  getCurrentLine() {
    return this.editor.lineTextForBufferRow(this.currentRow);
  }

  isAtBoundary(kinds, width) {
    const buffer = this.editor.getBuffer?.();
    if (!buffer?.getTextSnapshot) {
      const line = this.getCurrentLine();
      return (
        [...kinds].find((kind) =>
          kind === "=" ? line === kind.repeat(width) : line.startsWith(kind.repeat(width) + " "),
        ) ?? null
      );
    }
    const length = buffer.lineLengthForRow(this.currentRow);
    if (length < width) return null;
    const source = buffer.getTextSnapshot(),
      start = source.lineStart(this.currentRow);
    const kind = String.fromCharCode(source.charCodeAt(start));
    if (
      !kinds.includes(kind) ||
      (kind === "=" ? length !== width : source.charCodeAt(start + width) !== 32)
    )
      return null;
    const nonMarker = { "<": /[^<]/, "|": /[^|]/, "=": /[^=]/, ">": /[^>]/ }[kind];
    for (const chunk of source.subtext(start, start + width).chunks())
      if (nonMarker.test(chunk)) return null;
    return kind;
  }

  advanceRow() {
    this.currentRow++;
  }

  isAtEnd() {
    return this.currentRow > this.editor.getLastBufferRow();
  }
}
