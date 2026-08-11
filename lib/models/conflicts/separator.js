/** @babel */
import { deleteMarkerIn } from "./marker-tools";

export default class Separator {
  constructor(editor, marker, originalText) {
    this.editor = editor;
    this.marker = marker;
    this.originalText = originalText;
  }

  getMarker() {
    return this.marker;
  }

  delete() {
    deleteMarkerIn(this.getMarker(), this.editor);
  }

  isModified() {
    const currentText = this.editor.getTextInBufferRange(this.getMarker().getBufferRange());
    return currentText !== this.originalText;
  }
}
