/** @babel */
import { deleteMarkerIn } from "./marker-tools.js";
import { textSource, chompSource } from "../../text-source.js";

export default class Banner {
  constructor(editor, marker, description, originalText) {
    this.editor = editor;
    this.marker = marker;
    this.description = description;
    this.originalSource = textSource(originalText);
  }

  getMarker() {
    return this.marker;
  }

  getRange() {
    return this.marker.getBufferRange();
  }

  isModified() {
    const text = this.editor.getBuffer().getTextSnapshotInRange(this.marker.getBufferRange());
    return !chompSource(text).equals(chompSource(this.originalSource));
  }

  revert() {
    const range = this.getMarker().getBufferRange();
    this.editor.setTextInBufferRange(range, this.originalSource, { normalizeLineEndings: false });
    this.getMarker().setBufferRange(range);
  }

  delete() {
    deleteMarkerIn(this.getMarker(), this.editor);
  }
}
