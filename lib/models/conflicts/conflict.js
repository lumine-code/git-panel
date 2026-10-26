/** @babel */
import { MIDDLE } from "./position.js";
import { MarkerLineScanner, streamMarkers } from "./marker-lines.js";
import { setImmediate as yieldWork } from "node:timers/promises";
import { OURS, THEIRS, BASE } from "./source.js";
import Side from "./side.js";
import Banner from "./banner.js";
import Separator from "./separator.js";

import { ConflictParser } from "./parser/index.js";
import { EditorAdapter } from "./parser/adapter.js";

/*
 * Conflict parser visitor that marks each buffer range and assembles a Conflict from the
 * pieces.
 */
class ConflictVisitor {
  /*
   * editor - [TextEditor] displaying the conflicting text.
   * layer - [DisplayMarkerLayer] to created conflict markers on.
   */
  constructor(editor, layer, markerSize) {
    this.editor = editor;
    this.layer = layer;
    this.markerSize = markerSize;

    this.ours = null;
    this.base = null;
    this.separator = null;
    this.theirs = null;
  }

  /*
   * position - [Position] one of TOP or BOTTOM.
   * bannerRow - [Integer] of the buffer row that contains our side's banner.
   * textRowStart - [Integer] of the first buffer row that contain this side's text.
   * textRowEnd - [Integer] of the first buffer row beyond the extend of this side's text.
   */
  visitOurSide(position, bannerRow, textRowStart, textRowEnd) {
    this.ours = this.markSide(position, OURS, bannerRow, textRowStart, textRowEnd);
  }

  /*
   * bannerRow - [Integer] the buffer row that contains our side's banner.
   * textRowStart - [Integer] first buffer row that contain this side's text.
   * textRowEnd - [Integer] first buffer row beyond the extend of this side's text.
   */
  visitBaseSide(bannerRow, textRowStart, textRowEnd) {
    this.base = this.markSide(MIDDLE, BASE, bannerRow, textRowStart, textRowEnd);
  }

  /*
   * sepRowStart - [Integer] buffer row that contains the "=======" separator.
   */
  visitSeparator(sepRowStart) {
    const marker = this.layer.markBufferRange(
      [
        [sepRowStart, 0],
        [sepRowStart + 1, 0],
      ],
      {
        invalidate: "surround",
        exclusive: true,
      },
    );
    const originalText = this.editor.getBuffer().getTextSnapshotInRange(marker.getBufferRange());
    this.separator = new Separator(this.editor, marker, originalText);
  }

  /*
   * position - [Position] alignment within the conflict marker: TOP or BOTTOM.
   * bannerRow - [Integer] the buffer row that contains our side's banner.
   * textRowStart - [Integer] first buffer row that contain this side's text.
   * textRowEnd - [Integer] first buffer row beyond the extent of this side's text.
   */
  visitTheirSide(position, bannerRow, textRowStart, textRowEnd) {
    this.theirs = this.markSide(position, THEIRS, bannerRow, textRowStart, textRowEnd);
  }

  markSide(position, source, bannerRow, textRowStart, textRowEnd) {
    const blockCol = position.when({
      top: () => 0,
      middle: () => 0,
      bottom: () => this.editor.getBuffer().lineLengthForRow(bannerRow),
    });
    const blockRange = [
      [bannerRow, blockCol],
      [bannerRow, blockCol],
    ];
    const blockMarker = this.layer.markBufferRange(blockRange, {
      invalidate: "surround",
      exclusive: true,
    });

    const description = this.sideDescription(bannerRow);
    const bannerRange = [
      [bannerRow, 0],
      [bannerRow + 1, 0],
    ];
    const bannerMarker = this.layer.markBufferRange(bannerRange, {
      invalidate: "surround",
      exclusive: true,
    });
    const originalBannerText = this.editor.getBuffer().getTextSnapshotInRange(bannerRange);
    const banner = new Banner(this.editor, bannerMarker, description, originalBannerText);

    const textRange = [
      [textRowStart, 0],
      [textRowEnd, 0],
    ];
    const sideMarker = this.layer.markBufferRange(textRange, {
      invalidate: "surround",
      exclusive: false,
    });
    const originalText = this.editor.getBuffer().getTextSnapshotInRange(textRange);

    return new Side(this.editor, sideMarker, blockMarker, source, position, banner, originalText);
  }

  /*
   * Parse the banner description for the current side from a banner row.
   *
   * bannerRow - [Integer] buffer row containing the <, |, or > marker
   */
  sideDescription(bannerRow) {
    const buffer = this.editor.getBuffer();
    const start = this.markerSize + 1,
      end = buffer.lineLengthForRow(bannerRow);
    return (
      buffer.getTextInRange([
        [bannerRow, start],
        [bannerRow, Math.min(end, start + 256)],
      ]) + (end > start + 256 ? "�" : "")
    );
  }

  conflict() {
    return new Conflict(this.ours, this.separator, this.base, this.theirs);
  }
}

export default class Conflict {
  constructor(ours, separator, base, theirs) {
    this.separator = separator;

    this.bySource = {};
    this.byPosition = {};

    [ours, base, theirs].forEach((side) => {
      if (!side) {
        return;
      }

      this.bySource[side.getSource().getName()] = side;
      this.byPosition[side.getPosition().getName()] = side;
    });

    this.resolution = null;
  }

  getKey() {
    return this.getSide(OURS).getMarker().id;
  }

  isResolved() {
    return this.resolution !== null;
  }

  resolveAs(source) {
    this.resolution = this.getSide(source);
  }

  getSides() {
    return ["ours", "base", "theirs"]
      .map((sourceName) => this.bySource[sourceName])
      .filter((side) => side);
  }

  getChosenSide() {
    return this.resolution;
  }

  getUnchosenSides() {
    return this.getSides().filter((side) => side !== this.resolution);
  }

  getSide(source) {
    return this.bySource[source.getName()];
  }

  /*
   * Return a `Side` containing a buffer point, or `undefined` if none do.
   */
  getSideContaining(point) {
    return this.getSides().find((side) => side.includesPoint(point));
  }

  /*
   * Return a `Range` that encompasses the entire Conflict region.
   */
  getRange() {
    const topRange = this.byPosition.top.getRange();
    const bottomRange = this.byPosition.bottom.getRange();
    return topRange.union(bottomRange);
  }

  /*
   * Determine whether or not a buffer position is contained within this conflict.
   */
  includesPoint(point) {
    return this.getRange().containsPoint(point);
  }

  /*
   * Return the `DisplayMarker` that immediately follows the `Side` in a given `Position`. Return `null` if no such
   * marker exists.
   */
  markerAfter(position) {
    return position.when({
      top: () =>
        this.byPosition.middle
          ? this.byPosition.middle.getBannerMarker()
          : this.getSeparator().getMarker(),
      middle: () => this.getSeparator().getMarker(),
      bottom: () => this.byPosition.bottom.getBannerMarker(),
    });
  }

  getSeparator() {
    return this.separator;
  }

  /*
   * Parse any conflict markers in a TextEditor's buffer and return a Conflict that contains markers corresponding to
   * each.
   *
   * editor [TextEditor] The editor to search.
   * layer [DisplayMarkerLayer] Marker layer to create markers on.
   * return [Array<Conflict>] A (possibly empty) collection of parsed Conflicts.
   */
  static allFromEditor(editor, layer, isRebase) {
    const scanner = this.scanEditor(editor, layer, isRebase);
    let step;
    do {
      step = scanner.next();
    } while (!step.done);
    return step.value;
  }

  static async allFromEditorAsync(editor, layer, isRebase, { signal, isCurrent } = {}) {
    const scanner = this.scanEditor(editor, layer, isRebase);
    let deadline = performance.now() + 4;
    for (;;) {
      signal?.throwIfAborted();
      if (isCurrent && !isCurrent())
        throw Object.assign(new Error("Conflict source changed"), { name: "AbortError" });
      const step = scanner.next();
      if (step.done) return step.value;
      if (performance.now() >= deadline) {
        await yieldWork();
        deadline = performance.now() + 4;
      }
    }
  }

  static *scanEditor(editor, layer, isRebase) {
    if (editor.getGrammar?.() === lumine.grammars.nullGrammar) return [];
    const conflicts = [],
      buffer = editor.getBuffer(),
      source = buffer.getTextSnapshot();
    for (let row = 0; row < buffer.getLastRow(); row++) {
      yield;
      const start = source.lineStart(row),
        length = buffer.lineLengthForRow(row);
      if (length < 9 || source.charCodeAt(start) !== 60) continue;
      // Validate only candidate header lines. Ordinary giant lines are skipped
      // from row metadata without asking for their strings.
      const scanner = new MarkerLineScanner();
      for (const chunk of source.subtext(start, start + length).chunks()) {
        scanner.part(chunk);
        yield;
        if (scanner.phase === "invalid") break;
      }
      const marker = scanner.end();
      if (!marker || marker.kind !== "<") continue;
      const adapter = new EditorAdapter(editor, row);
      const calls = [];
      const deferred = Object.fromEntries(
        ["visitOurSide", "visitBaseSide", "visitSeparator", "visitTheirSide"].map((method) => [
          method,
          (...args) => calls.push([method, args]),
        ]),
      );
      const parser = new ConflictParser(adapter, deferred, isRebase, marker.width);
      if ((yield* parser.parseSteps()).wasSuccessful()) {
        const visitor = new ConflictVisitor(editor, layer, marker.width);
        for (const [method, args] of calls) visitor[method](...args);
        conflicts.push(visitor.conflict());
      }
      row = Math.max(row, adapter.getCurrentRow() - 1);
    }
    return conflicts;
  }

  /*
   * Return the number of conflict markers present in a streamed file.
   */
  static async countFromStream(stream) {
    const stack = [];
    let count = 0;
    for await (const marker of streamMarkers(stream)) {
      const current = stack.at(-1);
      if (marker.kind === "<" && (!current || current.phase === "base")) {
        stack.push({ markerSize: marker.width, phase: "first" });
        continue;
      }
      if (!current || marker.width !== current.markerSize) continue;
      if (marker.kind === "|" && current.phase === "first") current.phase = "base";
      else if (marker.kind === "=" && ["first", "base"].includes(current.phase))
        current.phase = "second";
      else if (marker.kind === ">" && current.phase === "second") {
        stack.pop();
        if (!stack.length) count++;
      }
    }

    return count;
  }
}
