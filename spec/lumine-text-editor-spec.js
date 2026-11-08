/** @babel */
/** @jsx h */
import { h, flushViews, createViewHost } from "./helpers/etch.js";

import LumineTextEditor from "../lib/lumine/lumine-text-editor.js";
import Marker from "../lib/lumine/marker.js";
import Decoration from "../lib/lumine/decoration.js";
import RefHolder from "../lib/models/ref-holder.js";
import { transaction } from "../lib/etch/view.js";

describe("LumineTextEditor", () => {
  let container, root;

  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createViewHost(container);
  });

  afterEach(async () => {
    await flushViews(async () => root.destroy());
    container.remove();
  });

  function decoratedEditor(refModel, prefix) {
    return (
      <LumineTextEditor refModel={refModel}>
        {Array.from({ length: 20 }, (_, column) => (
          <Marker
            key={`${prefix}-${column}`}
            bufferRange={[
              [0, column],
              [0, column + 1],
            ]}
          >
            <Decoration type="highlight" className="native-editor-batch" />
          </Marker>
        ))}
      </LumineTextEditor>
    );
  }

  function decorationRanges(editor) {
    return editor
      .getDecorations({ class: "native-editor-batch" })
      .map((decoration) => decoration.getMarker().getBufferRange().serialize());
  }

  it("publishes the complete initial native decoration set once", async () => {
    const refModel = new RefHolder();
    const updates = [];
    let updateSub;
    const refSub = refModel.observe((editor) => {
      editor.setText("x".repeat(20));
      updateSub = editor.onDidUpdateDecorations(() => updates.push(decorationRanges(editor)));
    });
    try {
      await flushViews(() => root.update(decoratedEditor(refModel, "initial")));
      const ranges = Array.from({ length: 20 }, (_, column) => [
        [0, column],
        [0, column + 1],
      ]);
      expect(decorationRanges(refModel.get())).toEqual(ranges);
      expect(updates).toEqual([ranges]);
    } finally {
      refSub.dispose();
      updateSub?.dispose();
    }
  });

  it("publishes complete synchronous native child replacements without intermediate inventories", async () => {
    const refModel = new RefHolder();
    await flushViews(() => root.update(<LumineTextEditor refModel={refModel} />));
    const editor = refModel.get();
    editor.setText("x".repeat(20));
    const updates = [];
    const sub = editor.onDidUpdateDecorations(() => updates.push(decorationRanges(editor)));
    try {
      for (const prefix of ["first", "replacement"]) {
        updates.length = 0;
        await transaction(() => root.update(decoratedEditor(refModel, prefix)));
        const ranges = Array.from({ length: 20 }, (_, column) => [
          [0, column],
          [0, column + 1],
        ]);
        expect(refModel.get()).toBe(editor);
        expect(decorationRanges(editor)).toEqual(ranges);
        expect(updates).toEqual([ranges]);
      }
    } finally {
      sub.dispose();
    }
  });

  it("uses Plain Text for an editor whose buffer it owns", async () => {
    await flushViews(async () => root.update(<LumineTextEditor />));

    expect(container.querySelector("lumine-text-editor").getModel().getGrammar().scopeName).toBe(
      "text.plain",
    );
  });

  it("keeps explicit wrap bounds when scoped settings change", async () => {
    await flushViews(async () =>
      root.update(
        <LumineTextEditor softWrapped={true} softWrapMinColumn={80} softWrapMaxColumn={80} />,
      ),
    );
    const editor = container.querySelector("lumine-text-editor").getModel();
    expect(editor.getSoftWrapColumn()).toBe(80);

    lumine.config.set("editor.softWrapMinColumn", 10, { scopeSelector: ".text.plain" });
    lumine.config.set("editor.softWrapMaxColumn", 20, { scopeSelector: ".text.plain" });
    await globalThis.flushMicrotasks();

    expect(editor.getSoftWrapColumn()).toBe(80);
  });

  it("keeps explicit scrollPastEnd false when editor config is true", async () => {
    const previousScrollPastEnd = lumine.config.get("editor.scrollPastEnd");
    const scopeSelector = ".text.plain";
    const previousScopedSetting = lumine.config.inspect("editor.scrollPastEnd", {
      scopeSelector,
    });
    let resolvePackageActivation;
    spyOn(lumine.packages, "getActivatePromise").and.returnValue(
      new Promise((resolve) => {
        resolvePackageActivation = resolve;
      }),
    );

    try {
      lumine.config.set("editor.scrollPastEnd", true);
      await flushViews(async () => {
        root.update(<LumineTextEditor autoHeight={false} scrollPastEnd={false} />);
        await globalThis.flushMicrotasks();
      });

      const editor = container.querySelector("lumine-text-editor").getModel();
      expect(editor.getScrollPastEnd()).toBe(false);

      resolvePackageActivation();
      await globalThis.flushMicrotasks();
      expect(editor.getScrollPastEnd()).toBe(false);

      lumine.config.set("editor.scrollPastEnd", false);
      lumine.config.set("editor.scrollPastEnd", true);
      await globalThis.flushMicrotasks();

      expect(editor.getScrollPastEnd()).toBe(false);

      lumine.config.set("editor.scrollPastEnd", false, { scopeSelector });
      lumine.config.set("editor.scrollPastEnd", true, { scopeSelector });
      await globalThis.flushMicrotasks();

      expect(editor.getScrollPastEnd()).toBe(false);
    } finally {
      if (previousScopedSetting.hasOverride) {
        lumine.config.set("editor.scrollPastEnd", previousScopedSetting.overrideValue, {
          scopeSelector,
        });
      } else {
        lumine.config.unset("editor.scrollPastEnd", { scopeSelector });
      }
      lumine.config.set("editor.scrollPastEnd", previousScrollPastEnd);
      await globalThis.flushMicrotasks();
    }
  });
});
