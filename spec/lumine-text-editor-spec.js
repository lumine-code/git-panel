/** @babel */
/** @jsx h */
import { h, flushViews, createViewHost } from "./helpers/etch";

import LumineTextEditor from "../lib/lumine/lumine-text-editor";

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

  it("uses Plain Text for an editor whose buffer it owns", async () => {
    await flushViews(async () => root.update(<LumineTextEditor />));

    expect(container.querySelector("lumine-text-editor").getModel().getGrammar().scopeName).toBe(
      "text.plain",
    );
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
