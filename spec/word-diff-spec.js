/** @babel */
/** @jsx React.createElement */

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { buildFilePatch } from "../lib/models/patch";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";
import LumineTextEditor from "../lib/lumine/lumine-text-editor";
import RefHolder from "../lib/models/ref-holder";

function buildReplacement(oldText, newText, options) {
  return buildFilePatch(
    [
      {
        oldPath: "example.tex",
        newPath: "example.tex",
        oldMode: "100644",
        newMode: "100644",
        status: "modified",
        hunks: [
          {
            oldStartLine: 1,
            oldLineCount: 1,
            newStartLine: 1,
            newLineCount: 1,
            heading: "",
            lines: [
              { kind: "deleted", text: oldText },
              { kind: "added", text: newText },
            ],
          },
        ],
      },
    ],
    options,
  );
}

function renderWordLayers(multiFilePatch) {
  const view = Object.create(MultiFilePatchView.prototype);
  view.props = { multiFilePatch };
  return view.renderWordDiffDecorations().props.children;
}

function rangesFromBufferLayer(layer) {
  return layer.getMarkers().map((marker) => marker.getRange().serialize());
}

function rangesFromDisplayLayer(layer) {
  return layer.getMarkers().map((marker) => marker.getBufferRange().serialize());
}

function expectWordMarkerOptions(layer) {
  for (const marker of layer.getMarkers()) {
    expect(marker.getInvalidationStrategy()).toBe("never");
    expect(marker.isExclusive()).toBe(true);
  }
}

function WordDiffEditor({ multiFilePatch, refDeletionLayer, refAdditionLayer }) {
  const view = Object.create(MultiFilePatchView.prototype);
  view.props = { multiFilePatch };
  const [deletionDecoration, additionDecoration] = view.renderWordDiffDecorations().props.children;

  return (
    <LumineTextEditor buffer={multiFilePatch.getBuffer()} readOnly={true} softWrapped={true}>
      {deletionDecoration &&
        React.cloneElement(deletionDecoration, { handleLayer: refDeletionLayer.setter })}
      {additionDecoration &&
        React.cloneElement(additionDecoration, { handleLayer: refAdditionLayer.setter })}
    </LumineTextEditor>
  );
}

describe("word diff decorations", () => {
  it("preserves each side's columns when unchanged words have different spacing", () => {
    const patch = buildReplacement("foo    bar old", "foo bar new");
    expect(rangesFromBufferLayer(patch.getWordDeletionLayer())).toEqual([
      [
        [0, 11],
        [0, 14],
      ],
    ]);
    expect(rangesFromBufferLayer(patch.getWordAdditionLayer())).toEqual([
      [
        [1, 8],
        [1, 11],
      ],
    ]);
  });

  it("accounts for leading and trailing whitespace without highlighting pure indentation changes", () => {
    const patch = buildReplacement("   foo old   ", " foo new ");
    expect(rangesFromBufferLayer(patch.getWordDeletionLayer())).toEqual([
      [
        [0, 7],
        [0, 13],
      ],
    ]);
    expect(rangesFromBufferLayer(patch.getWordAdditionLayer())).toEqual([
      [
        [1, 5],
        [1, 9],
      ],
    ]);
  });

  it("uses UTF-16 columns after an emoji and unequal tab or space runs", () => {
    const patch = buildReplacement("😀\tfoo = 1;", "😀  foo = 2;");
    expect(rangesFromBufferLayer(patch.getWordDeletionLayer())).toEqual([
      [
        [0, 9],
        [0, 10],
      ],
    ]);
    expect(rangesFromBufferLayer(patch.getWordAdditionLayer())).toEqual([
      [
        [1, 10],
        [1, 11],
      ],
    ]);
  });

  it("keeps whitespace-only replacements out of the inline marker layers", () => {
    for (const [oldText, newText] of [
      ["  foo\tbar  ", "foo  bar"],
      ["   ", "\t"],
    ]) {
      const patch = buildReplacement(oldText, newText);
      expect(rangesFromBufferLayer(patch.getWordDeletionLayer())).toEqual([]);
      expect(rangesFromBufferLayer(patch.getWordAdditionLayer())).toEqual([]);
    }
  });

  it("highlights only the changed digits", () => {
    const oldText = "$\\displaystyle {\\eta}=\\dfrac{{J}_{Ed}}{{f}_{yd}}=0.946$";
    const newText = "$\\displaystyle {\\eta}=\\dfrac{{J}_{Ed}}{{f}_{yd}}=0.950$";
    const patch = buildReplacement(oldText, newText);
    const [deletedDecoration, addedDecoration] = renderWordLayers(patch);
    const deletedLayer = patch.getWordDeletionLayer();
    const addedLayer = patch.getWordAdditionLayer();

    expect(rangesFromBufferLayer(deletedLayer)).toEqual([
      [
        [0, 51],
        [0, 54],
      ],
    ]);
    expect(rangesFromBufferLayer(addedLayer)).toEqual([
      [
        [1, 51],
        [1, 54],
      ],
    ]);
    expect(deletedDecoration.props.external).toBe(deletedLayer);
    expect(addedDecoration.props.external).toBe(addedLayer);
  });

  it("highlights an appended suffix only on the added line", () => {
    const oldText = "\\par\\addvspace{\\medskipamount} PN-EN~15528~\\cite{pn-en_15528:2015}";
    const newText = `${oldText} + Id-16-A1 v2.0~\\cite{rym_kol_id16_a1-2.0}`;
    const patch = buildReplacement(oldText, newText);
    const [deletedDecoration, addedDecoration] = renderWordLayers(patch);

    expect(rangesFromBufferLayer(patch.getWordDeletionLayer())).toEqual([]);
    // diffWords used to assign the appended space to the unchanged prefix.
    // Its actual column belongs to the added suffix on this side.
    expect(rangesFromBufferLayer(patch.getWordAdditionLayer())).toEqual([
      [
        [1, oldText.length],
        [1, 109],
      ],
    ]);
    expect(deletedDecoration.props.external).toBe(patch.getWordDeletionLayer());
    expect(addedDecoration.props.external).toBe(patch.getWordAdditionLayer());
  });

  it("populates word markers on a derived staging patch", () => {
    const oldText = "$\\displaystyle {\\eta}=\\dfrac{{J}_{Ed}}{{f}_{yd}}=0.946$";
    const newText = "$\\displaystyle {\\eta}=\\dfrac{{J}_{Ed}}{{f}_{yd}}=0.950$";
    const patch = buildReplacement(oldText, newText);
    const [hunk] = patch.getFilePatches()[0].getHunks();
    const stagePatch = patch.getStagePatchForHunk(hunk);

    expect(rangesFromBufferLayer(stagePatch.getWordDeletionLayer())).toEqual([
      [
        [0, 51],
        [0, 54],
      ],
    ]);
    expect(rangesFromBufferLayer(stagePatch.getWordAdditionLayer())).toEqual([
      [
        [1, 51],
        [1, 54],
      ],
    ]);
  });

  it("moves word markers with a collapsed file patch", () => {
    const oldText = "$\\displaystyle {\\eta}=\\dfrac{{J}_{Ed}}{{f}_{yd}}=0.946$";
    const newText = "$\\displaystyle {\\eta}=\\dfrac{{J}_{Ed}}{{f}_{yd}}=0.950$";
    const patch = buildReplacement(oldText, newText, { largeDiffThreshold: 0 });
    const [filePatch] = patch.getFilePatches();

    expect(rangesFromBufferLayer(patch.getWordDeletionLayer())).toEqual([]);
    expect(rangesFromBufferLayer(patch.getWordAdditionLayer())).toEqual([]);

    patch.expandFilePatch(filePatch);
    expect(rangesFromBufferLayer(patch.getWordDeletionLayer())).toEqual([
      [
        [0, 51],
        [0, 54],
      ],
    ]);
    expect(rangesFromBufferLayer(patch.getWordAdditionLayer())).toEqual([
      [
        [1, 51],
        [1, 54],
      ],
    ]);
    expectWordMarkerOptions(patch.getWordDeletionLayer());
    expectWordMarkerOptions(patch.getWordAdditionLayer());

    patch.collapseFilePatch(filePatch);
    expect(rangesFromBufferLayer(patch.getWordDeletionLayer())).toEqual([]);
    expect(rangesFromBufferLayer(patch.getWordAdditionLayer())).toEqual([]);

    patch.expandFilePatch(filePatch);
    expect(rangesFromBufferLayer(patch.getWordDeletionLayer())).toEqual([
      [
        [0, 51],
        [0, 54],
      ],
    ]);
    expect(rangesFromBufferLayer(patch.getWordAdditionLayer())).toEqual([
      [
        [1, 51],
        [1, 54],
      ],
    ]);
    expectWordMarkerOptions(patch.getWordDeletionLayer());
    expectWordMarkerOptions(patch.getWordAdditionLayer());
  });

  it("updates mounted word markers when a reused patch buffer is refreshed", async () => {
    const oldText =
      "$\\displaystyle {{\\alpha}}_{ult}=\\dfrac{246.7\\,\\mathrm{MPa}}{81.7\\,\\mathrm{MPa}}=3.020$";
    const initialPatch = buildReplacement(oldText, oldText);
    const intermediatePatch = buildReplacement(oldText, oldText.replace("\\dfrac", "\\tfrac"));
    const nextPatch = buildReplacement(
      oldText,
      "$\\displaystyle {{\\alpha}}_{ult}=\\dfrac{246.7\\,\\mathrm{MPa}}{70.4\\,\\mathrm{MPa}}=3.506$",
    );
    const container = document.createElement("div");
    const root = createRoot(container);
    const refDeletionLayer = new RefHolder();
    const refAdditionLayer = new RefHolder();
    const retainedBuffers = [
      initialPatch.getBuffer(),
      intermediatePatch.getBuffer(),
      nextPatch.getBuffer(),
    ];
    const wasActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    document.body.appendChild(container);

    try {
      await act(async () => {
        root.render(
          <WordDiffEditor
            multiFilePatch={initialPatch}
            refDeletionLayer={refDeletionLayer}
            refAdditionLayer={refAdditionLayer}
          />,
        );
      });

      const deletionLayer = refDeletionLayer.get();
      const additionLayer = refAdditionLayer.get();
      expect(deletionLayer.id).toBe(initialPatch.getWordDeletionLayer().id);
      expect(additionLayer.id).toBe(initialPatch.getWordAdditionLayer().id);
      expect(rangesFromDisplayLayer(deletionLayer)).toEqual([]);
      expect(rangesFromDisplayLayer(additionLayer)).toEqual([]);

      await act(async () => {
        intermediatePatch.adoptBuffer(initialPatch.getPatchBuffer());
      });

      expect(rangesFromDisplayLayer(deletionLayer)).toEqual([
        [
          [0, 33],
          [0, 38],
        ],
      ]);
      expect(rangesFromDisplayLayer(additionLayer)).toEqual([
        [
          [1, 33],
          [1, 38],
        ],
      ]);

      await act(async () => {
        nextPatch.adoptBuffer(initialPatch.getPatchBuffer());
      });

      expectWordMarkerOptions(nextPatch.getWordDeletionLayer());
      expectWordMarkerOptions(nextPatch.getWordAdditionLayer());

      expect(rangesFromDisplayLayer(deletionLayer)).toEqual([
        [
          [0, 60],
          [0, 62],
        ],
        [
          [0, 63],
          [0, 64],
        ],
        [
          [0, 82],
          [0, 85],
        ],
      ]);
      expect(rangesFromDisplayLayer(additionLayer)).toEqual([
        [
          [1, 60],
          [1, 62],
        ],
        [
          [1, 63],
          [1, 64],
        ],
        [
          [1, 82],
          [1, 85],
        ],
      ]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      retainedBuffers.forEach((buffer) => buffer.release());
      global.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
    }
  });
});
