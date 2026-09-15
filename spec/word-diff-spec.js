/** @babel */

import { buildFilePatch } from "../lib/models/patch";
import MultiFilePatchView from "../lib/views/multi-file-patch-view";

function buildReplacement(oldText, newText) {
  return buildFilePatch([
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
  ]);
}

function renderWordLayers(multiFilePatch) {
  const view = Object.create(MultiFilePatchView.prototype);
  view.props = { multiFilePatch };
  return view.renderWordDiffDecorations().props.children;
}

function rangesFrom(layer) {
  return layer.props.children[0].map((marker) => marker.props.bufferRange.serialize());
}

describe("word diff decorations", () => {
  it("highlights only the changed digits", () => {
    const oldText = "$\\displaystyle {\\eta}=\\dfrac{{J}_{Ed}}{{f}_{yd}}=0.946$";
    const newText = "$\\displaystyle {\\eta}=\\dfrac{{J}_{Ed}}{{f}_{yd}}=0.950$";
    const [deletedLayer, addedLayer] = renderWordLayers(buildReplacement(oldText, newText));

    expect(rangesFrom(deletedLayer)).toEqual([
      [
        [0, 51],
        [0, 54],
      ],
    ]);
    expect(rangesFrom(addedLayer)).toEqual([
      [
        [1, 51],
        [1, 54],
      ],
    ]);
  });

  it("highlights an appended suffix only on the added line", () => {
    const oldText = "\\par\\addvspace{\\medskipamount} PN-EN~15528~\\cite{pn-en_15528:2015}";
    const newText = `${oldText} + Id-16-A1 v2.0~\\cite{rym_kol_id16_a1-2.0}`;
    const [deletedLayer, addedLayer] = renderWordLayers(buildReplacement(oldText, newText));

    expect(deletedLayer).toBeNull();
    expect(rangesFrom(addedLayer)).toEqual([
      [
        [1, 67],
        [1, 109],
      ],
    ]);
  });

  it("recreates its marker layers when a reused patch buffer receives a new patch", () => {
    const firstPatch = buildReplacement("before 1", "after 1");
    const [firstDeletedLayer, firstAddedLayer] = renderWordLayers(firstPatch);
    const nextPatch = buildReplacement("before 2", "after 2");

    nextPatch.adoptBuffer(firstPatch.getPatchBuffer());
    const [nextDeletedLayer, nextAddedLayer] = renderWordLayers(nextPatch);

    expect(nextDeletedLayer.key).not.toBe(firstDeletedLayer.key);
    expect(nextAddedLayer.key).not.toBe(firstAddedLayer.key);
  });
});
