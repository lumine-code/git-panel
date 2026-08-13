/** @babel */

import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";

import Conflict from "../lib/models/conflicts/conflict";
import { ConflictParser } from "../lib/models/conflicts/parser";
import { EditorAdapter } from "../lib/models/conflicts/parser/adapter";
import Repository, { hasMergeMarkers } from "../lib/models/repository";

describe("scanning a file for merge markers", () => {
  const CHUNK_SIZE = 64 * 1024;
  let workingDirectory;
  let repository;

  beforeEach(() => {
    workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-markers-"));
    repository = Object.create(Repository.prototype);
    repository.getWorkingDirectoryPath = () => workingDirectory;
  });

  afterEach(() => {
    fs.rmSync(workingDirectory, { recursive: true, force: true, maxRetries: 5 });
  });

  function write(name, contents) {
    fs.writeFileSync(path.join(workingDirectory, name), contents);
    return name;
  }

  it("finds a marker at the start of the file", async () => {
    const file = write("first.txt", "<<<<<<< HEAD\nours\n");
    expect(await repository.pathHasMergeMarkers(file)).toBe(true);
  });

  it("ignores a file with no markers", async () => {
    const file = write("plain.txt", "hello\nworld\n");
    expect(await repository.pathHasMergeMarkers(file)).toBe(false);
  });

  it("ignores an angle-bracket run that is not a marker", async () => {
    expect(await repository.pathHasMergeMarkers(write("short.txt", "<<<<<< nope\n"))).toBe(false);
    expect(await repository.pathHasMergeMarkers(write("bare.txt", "<<<<<<<\n"))).toBe(false);
    expect(await repository.pathHasMergeMarkers(write("mid.txt", "x <<<<<<< HEAD y\n"))).toBe(
      false,
    );
  });

  it("finds a marker split across a read boundary", async () => {
    const file = write("split.txt", `${"z".repeat(CHUNK_SIZE - 5)}\n<<<<<<< HEAD\nours\n`);
    expect(await repository.pathHasMergeMarkers(file)).toBe(true);
  });

  it("finds a marker after a line longer than the carried remainder", async () => {
    const file = write("longline.txt", `${"q".repeat(200000)}\n<<<<<<< HEAD\nours\n`);
    expect(await repository.pathHasMergeMarkers(file)).toBe(true);
  });

  it("finds a marker following multi-byte text that spans a read boundary", async () => {
    const file = write("utf8.txt", `${"é".repeat(CHUNK_SIZE)}\n<<<<<<< HEAD\nours\n`);
    expect(await repository.pathHasMergeMarkers(file)).toBe(true);
  });

  it("reads no further than the scan limit for a binary file", async () => {
    // The bytes after the header would match if they were ever decoded, so a
    // pass here is evidence the scan stopped at the NUL rather than that the
    // file happens to be marker-free.
    const file = write(
      "binary.bin",
      Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from("\n<<<<<<< HEAD\nours\n", "utf8")]),
    );
    expect(await repository.pathHasMergeMarkers(file)).toBe(false);
  });

  it("resolves false for a missing path", async () => {
    expect(await repository.pathHasMergeMarkers("absent.txt")).toBe(false);
  });

  it("resolves false for a directory, which is how a submodule presents", async () => {
    fs.mkdirSync(path.join(workingDirectory, "submodule"));
    expect(await repository.pathHasMergeMarkers("submodule")).toBe(false);
  });

  it("scans a file far larger than V8's string limit without reading it whole", async () => {
    // A whole-file read of this path used to throw ERR_STRING_TOO_LONG, and on
    // a real working directory it exhausted the renderer heap first.
    const file = path.join(workingDirectory, "huge.bin");
    const handle = fs.openSync(file, "w");
    try {
      fs.writeSync(handle, Buffer.from([0, 0, 0, 0]));
      fs.ftruncateSync(handle, 600 * 1024 * 1024);
    } finally {
      fs.closeSync(handle);
    }

    const before = process.memoryUsage().heapUsed;
    expect(await repository.pathHasMergeMarkers("huge.bin")).toBe(false);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(64 * 1024 * 1024);
  });
});

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
