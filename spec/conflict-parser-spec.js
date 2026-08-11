/** @babel */

import { Readable } from "stream";

import Conflict from "../lib/models/conflicts/conflict";
import { ConflictParser } from "../lib/models/conflicts/parser";
import { EditorAdapter } from "../lib/models/conflicts/parser/adapter";
import { hasMergeMarkers } from "../lib/models/repository";

function marker(character, size = 7) {
  return character.repeat(size);
}

function conflictText(size = 7, ours = "ours", theirs = "theirs") {
  return [
    `${marker("<", size)} current branch`,
    ours,
    marker("=", size),
    theirs,
    `${marker(">", size)} incoming branch with spaces`,
    "",
  ].join("\n");
}

describe("conflict parsing", () => {
  it("discovers custom-width conflicts in an editor buffer", () => {
    const editor = lumine.workspace.buildTextEditor();
    const layer = editor.addMarkerLayer({ persistent: false });
    try {
      editor.setText(conflictText(11));

      const conflicts = Conflict.allFromEditor(editor, layer, false);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].getSides().length).toBe(2);
      expect(conflicts[0].getSeparator().isModified()).toBe(false);
    } finally {
      layer.destroy();
      editor.destroy();
    }
  });

  it("parses editor conflicts with Git's configured marker width", () => {
    const lines = conflictText(12).trimEnd().split("\n");
    const editor = {
      lineTextForBufferRow: (row) => lines[row],
      getLastBufferRow: () => lines.length - 1,
    };
    const visitor = {
      visitOurSide: jasmine.createSpy("visitOurSide"),
      visitBaseSide: jasmine.createSpy("visitBaseSide"),
      visitSeparator: jasmine.createSpy("visitSeparator"),
      visitTheirSide: jasmine.createSpy("visitTheirSide"),
    };

    const result = new ConflictParser(new EditorAdapter(editor, 0), visitor, false, 12).parse();

    expect(result.wasSuccessful()).toBe(true);
    expect(visitor.visitOurSide).toHaveBeenCalled();
    expect(visitor.visitTheirSide).toHaveBeenCalled();
  });

  it("counts conflicts independently of stream chunk boundaries", async () => {
    const first = conflictText(7, "a".repeat(70000), "first theirs");
    const second = conflictText(15, "second ours", "second theirs");
    const combined = `prefix\n${first}middle\n${second}suffix\n`;
    const chunks = [combined.slice(0, 50000), combined.slice(50000, 70040), combined.slice(70040)];

    expect(await Conflict.countFromStream(Readable.from(chunks))).toBe(2);
  });

  it("counts a criss-cross conflict once while validating its nested base conflict", async () => {
    const text = [
      `${marker("<")} ours`,
      "outer ours",
      `${marker("|")} base`,
      `${marker("<")} nested ours`,
      "nested ours",
      marker("="),
      "nested theirs",
      `${marker(">")} nested theirs`,
      marker("="),
      "outer theirs",
      `${marker(">")} theirs`,
      "",
    ].join("\n");

    expect(await Conflict.countFromStream(Readable.from([text]))).toBe(1);
  });

  it("does not count incomplete or width-mismatched marker sets", async () => {
    const text = [
      `${marker("<", 10)} ours`,
      "ours",
      marker("=", 9),
      "theirs",
      `${marker(">", 10)} theirs`,
      "",
    ].join("\n");

    expect(await Conflict.countFromStream(Readable.from([text]))).toBe(0);
  });

  it("detects custom-width markers and labels containing spaces before staging", () => {
    expect(hasMergeMarkers(conflictText(14))).toBe(true);
    expect(hasMergeMarkers("<<<<<< not a Git marker\n")).toBe(false);
  });
});
