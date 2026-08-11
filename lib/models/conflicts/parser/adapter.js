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

  advanceRow() {
    this.currentRow++;
  }

  isAtEnd() {
    return this.currentRow > this.editor.getLastBufferRow();
  }
}
