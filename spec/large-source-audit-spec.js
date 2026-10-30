/** @babel */
import { TextBuffer, Range } from "lumine";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { constants } from "node:buffer";
import { createViewModel } from "./helpers/etch.js";
import { textSource, joinSources } from "../lib/text-source.js";
import Conflict from "../lib/models/conflicts/conflict.js";
import Repository from "../lib/models/repository.js";
import EditorConflictController from "../lib/controllers/editor-conflict-controller.js";
import { OURS, THEIRS } from "../lib/models/conflicts/source.js";
import PatchBuffer from "../lib/models/patch/patch-buffer.js";
import { Addition } from "../lib/models/patch/region.js";
import buildSideBySidePatch from "../lib/models/patch/side-by-side.js";
import readFileBounded from "../lib/read-file-bounded.js";
import { commitText, hasMessageContent } from "../lib/commit-message-source.js";
import { buildMultiFilePatch } from "../lib/models/patch/index.js";

function giantSource() {
  let source = textSource("x".repeat(32768));
  while (source.canMaterialize()) source = source.replace(source.length, source.length, source);
  return source;
}

describe("large source Git operations", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    await (
      await lumine.packages.activatePackage("language-text")
    ).resourceLoadPromise;
  });

  it("resolves and undoes giant conflict sides without requesting their strings", async () => {
    const large = giantSource(),
      ours = joinSources([large, "\r\n"]),
      theirs = textSource("😀e\u0301\r\n");
    const original = joinSources([
      "<<<<<<< HEAD\r\n",
      ours,
      "=======\r\n",
      theirs,
      ">>>>>>> other\r\n",
    ]);
    lumine.config.set("editor.tabType", "soft");
    const buffer = new TextBuffer({ text: original });
    const editor = lumine.workspace.buildTextEditor({ buffer, softTabs: true });
    editor.setGrammar(lumine.grammars.grammarForId("text.plain"));
    spyOn(buffer, "getText").and.throwError("Whole buffer read");
    spyOn(editor, "getTextInBufferRange").and.throwError("Whole conflict side read");
    spyOn(editor, "lineTextForBufferRow").and.throwError("Whole conflict line read");
    const controller = createViewModel(EditorConflictController, {
      editor,
      isRebase: false,
      resolutionProgress: { reportBufferMarkerCount() {}, clearBuffer() {} },
      refreshResolutionProgress() {},
    });
    controller.updateState = (update) => {
      Object.assign(
        controller.state,
        typeof update === "function" ? update(controller.state) : update,
      );
      controller.updateMarkerCount();
    };
    controller.didMount();
    try {
      await controller.parsePromise;
      expect(controller.state.conflicts.size).toBe(1);
      const conflict = [...controller.state.conflicts][0];
      expect(conflict.getSide(OURS).isModified()).toBe(false);
      expect(controller.resolveAsSequence(conflict, [OURS, THEIRS])).toBe(true);
      expect(buffer.getTextSnapshot().equals(joinSources([ours, theirs]))).toBe(true);
      editor.undo();
      expect(buffer.getTextSnapshot().equals(original)).toBe(true);
      await controller.reparseConflicts();
      expect(controller.state.conflicts.size).toBe(1);
    } finally {
      controller.willDestroy();
      editor.destroy();
    }
  });

  it("adopts and projects a giant patch row with shared roots", () => {
    const source = giantSource(),
      original = new PatchBuffer(),
      target = new PatchBuffer();
    original.getBuffer().setTextInRange(original.getBuffer().getRange(), source);
    spyOn(original.getBuffer(), "getText").and.throwError("Whole patch read");
    try {
      target.adopt(original);
      expect(target.getBuffer().getTextSnapshot().equals(source)).toBe(true);
      const extracted = target.createSubBuffer(new Range([0, 0], [0, source.length])).patchBuffer;
      try {
        expect(extracted.getBuffer().getTextSnapshot().equals(source)).toBe(true);
      } finally {
        extracted.dispose();
      }
      const region = {
        getRange: () => new Range([0, 0], [0, source.length]),
        isDeletion: () => false,
        isAddition: () => false,
        isNoNewline: () => false,
        isUnchanged: () => true,
      };
      const hunk = { getOldStartRow: () => 0, getNewStartRow: () => 0, getRegions: () => [region] };
      const file = { getRenderStatus: () => ({ isVisible: () => true }), getHunks: () => [hunk] };
      const projection = buildSideBySidePatch({
        getBuffer: () => target.getBuffer(),
        getFilePatches: () => [file],
      });
      expect(projection.oldSource.equals(source)).toBe(true);
      expect(projection.newSource.equals(source)).toBe(true);
    } finally {
      original.dispose();
      target.dispose();
    }
  });

  it("cancels obsolete cooperative conflict analysis without publishing its markers", async () => {
    lumine.config.set("editor.tabType", "soft");
    const editor = lumine.workspace.buildTextEditor();
    editor.setGrammar(lumine.grammars.grammarForId("text.plain"));
    editor.setText("<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n" + "\n".repeat(200000));
    const createdLayers = [];
    const addLayer = editor.addMarkerLayer.bind(editor);
    spyOn(editor, "addMarkerLayer").and.callFake((...args) => {
      const layer = addLayer(...args);
      createdLayers.push(layer);
      return layer;
    });
    const controller = createViewModel(EditorConflictController, {
      editor,
      isRebase: false,
      resolutionProgress: { reportBufferMarkerCount() {}, clearBuffer() {} },
      refreshResolutionProgress() {},
    });
    controller.updateState = (update) =>
      Object.assign(
        controller.state,
        typeof update === "function" ? update(controller.state) : update,
      );
    controller.didMount();
    const pending = controller.parsePromise;
    try {
      editor.setText("new source without conflicts\n");
      controller.reparseConflicts();
      await pending;
      expect(controller.state.conflicts.size).toBe(0);
      expect(controller.layer.getMarkerCount()).toBe(0);
      expect(createdLayers.filter((layer) => !layer.isDestroyed())).toEqual([controller.layer]);
    } finally {
      controller.willDestroy();
      editor.destroy();
    }
  });

  it("rejects an oversized string patch before reading source chunks", () => {
    const source = giantSource(),
      buffer = new TextBuffer({ text: source });
    const region = new Addition({ getRange: () => new Range([0, 0], [0, source.length]) });
    const chunks = spyOn(Object.getPrototypeOf(source), "chunks").and.throwError(
      "Must preflight before formatting",
    );
    try {
      expect(() => region.toStringIn(buffer)).toThrowError(/Git transport budget/);
      expect(chunks).not.toHaveBeenCalled();
    } finally {
      buffer.destroy();
    }
  });

  it("builds a selected-hunk model without materializing a giant source row", () => {
    const source = giantSource();
    const patch = buildMultiFilePatch([
      {
        status: "modified",
        oldPath: "file.txt",
        newPath: "file.txt",
        oldMode: "100644",
        newMode: "100644",
        hunks: [
          {
            oldStartLine: 1,
            oldLineCount: 1,
            newStartLine: 1,
            newLineCount: 1,
            heading: "",
            lines: ["-old", "+new"],
          },
        ],
      },
    ]);
    let staged;
    try {
      patch.getBuffer().setTextInRange(
        [
          [0, 0],
          [0, 3],
        ],
        source,
      );
      spyOn(patch.getBuffer(), "getTextInRange").and.throwError("Whole selected-hunk text");
      staged = patch.getStagePatchForLines(new Set([0, 1]));
      expect(staged.getBuffer().lineLengthForRow(0)).toBe(source.length);
      expect(() => staged.toString()).toThrowError(/Git transport budget/);
    } finally {
      staged?.dispose();
      patch.dispose();
    }
  });

  it("measures and serializes symbolic-link patch bytes without changing the legacy patch", () => {
    const patch = buildMultiFilePatch([
      {
        status: "added",
        oldPath: null,
        newPath: "link",
        oldMode: null,
        newMode: "120000",
        hunks: [
          {
            oldStartLine: 0,
            oldLineCount: 0,
            newStartLine: 1,
            newLineCount: 1,
            heading: "",
            lines: ["+target", "\\ No newline at end of file"],
          },
        ],
      },
    ]);
    try {
      const file = patch.getFilePatches()[0],
        text = file.toStringIn(patch.getBuffer());
      expect(file.getTextLengthIn(patch.getBuffer())).toBe(text.length);
      expect(text).toContain("new file mode 120000");
      expect(text).toContain("+target\n\\ No newline at end of file\n");
      expect(patch.toString()).toBe(text + "\n");
    } finally {
      patch.dispose();
    }
  });

  it("counts a conflict whose single body line exceeds the native string limit", async () => {
    const chunk = "x".repeat(32768),
      repetitions = Math.ceil((constants.MAX_STRING_LENGTH + 1) / chunk.length);
    const chunks = async function* () {
      yield "<<<<<<< HEAD\r\n";
      for (let index = 0; index < repetitions; index++) yield chunk;
      yield "\r\n=======\r\ntheirs\r\n>>>>>>> branch";
    };
    expect(await Conflict.countFromStream(Readable.from(chunks()))).toBe(1);
  });

  it("retains huge commit drafts while refusing string protocol materialization", () => {
    const source = giantSource();
    expect(hasMessageContent(source)).toBe(false);
    expect(() => commitText(source)).toThrowError(/commit messages exceed/i);
    expect(hasMessageContent(textSource("# comment\r\n\t😀\r\n"))).toBe(true);
    expect(hasMessageContent(textSource("# comment\r\n \t\r\n"))).toBe(false);
  });
});

describe("bounded Git file reads", () => {
  let directory, root;
  beforeEach(async () => {
    root = await fs.realpath(os.tmpdir());
    directory = await fs.realpath(await fs.mkdtemp(path.join(root, "git-source-budget-")));
  });
  afterEach(async () => {
    const relative = path.relative(root, await fs.realpath(directory));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unsafe scratch path");
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });

  it("finds unresolved markers beyond the old eight-megabyte scan limit", async () => {
    const filePath = path.join(directory, "conflict.txt");
    await fs.writeFile(filePath, "x".repeat(9 * 1024 * 1024) + "\n<<<<<<< HEAD\n");
    const repository = Object.create(Repository.prototype);
    repository.getWorkingDirectoryPath = () => directory;
    expect(await repository.pathHasMergeMarkers("conflict.txt")).toBe(true);
  });

  it("checks file size before read and detects growth beyond a captured stat", async () => {
    const filePath = path.join(directory, "input.txt");
    await fs.writeFile(filePath, "😀\r\n".repeat(20));
    await expectAsync(readFileBounded(filePath, { maxBytes: 32 })).toBeRejectedWith(
      jasmine.objectContaining({ code: "ERR_GIT_DIFF_TOO_LARGE" }),
    );
    const open = fs.open.bind(fs);
    spyOn(fs, "open").and.callFake(async (...args) => {
      const handle = await open(...args);
      spyOn(handle, "stat").and.resolveTo({ size: 0 });
      return handle;
    });
    await expectAsync(readFileBounded(filePath, { maxBytes: 32 })).toBeRejectedWith(
      jasmine.objectContaining({ code: "ERR_GIT_DIFF_TOO_LARGE" }),
    );
    expect(await readFileBounded(filePath, { maxBytes: 1024, encoding: "utf8" })).toBe(
      "😀\r\n".repeat(20),
    );
  });
});
