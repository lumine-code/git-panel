/** @babel */
import { deleteMarkerIn } from "./marker-tools.js";
import { textSource } from "../../text-source.js";

export default class Separator {
  constructor(editor, marker, originalText) {
    this.editor = editor;
    this.marker = marker;
    this.originalSource = textSource(originalText);
  }

  getMarker() {
    return this.marker;
  }

  delete() {
    deleteMarkerIn(this.getMarker(), this.editor);
  }

  isModified() {
    const currentText = this.editor
      .getBuffer()
      .getTextSnapshotInRange(this.getMarker().getBufferRange());
    return !currentText.equals(this.originalSource);
  }
}
