/** @babel */
/** @jsx h */
import { h, flushViews, createViewHost } from "./helpers/etch.js";
import OpenCommitDialog from "../lib/views/open-commit-dialog.js";
import path from "node:path";
import { ipcRenderer } from "electron";

describe("Git commit dialog presentation", () => {
  let host, root, view, request, bindings;

  beforeEach(() => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    host = document.createElement("div");
    document.body.append(host);
    root = createViewHost(host);
    bindings = lumine.keymaps.add(
      "git-dialog-presentation-spec",
      lumine.keymaps.readKeymap(path.join(import.meta.dirname, "../keymaps/main.json")),
    );
    request = {
      accept: jasmine.createSpy("accept").and.resolveTo(undefined),
      cancel: jasmine.createSpy("cancel"),
    };
  });

  afterEach(async () => {
    await flushViews(async () => root.destroy());
    host.remove();
    bindings.dispose();
  });

  function render(inProgress = false, error = null) {
    return flushViews(async () =>
      root.update(
        <OpenCommitDialog
          ref={(instance) => (view = instance)}
          workspace={lumine.workspace}
          commands={lumine.commands}
          request={request}
          inProgress={inProgress}
          error={error}
        />,
      ),
    );
  }

  it("keeps the focused draft through busy and failed states and orders Cancel before Open", async () => {
    await render();
    await flushViews(async () => view.ref.setText("refs/heads/main"));
    const form = document.querySelector(".git-panel-Dialog");
    const input = form.querySelector("lumine-text-editor[mini]");
    const editor = input.getModel();
    const [cancel, accept] = form.querySelectorAll(".dialog-actions button");
    expect(form.getAttribute("role")).toBe("dialog");
    expect(form.getAttribute("aria-label")).toBe("Open Commit");
    expect(input.getAttribute("aria-label")).toBe("Commit SHA or ref");
    expect(form.closest("lumine-panel").classList.contains("dialog-panel")).toBe(true);
    expect(cancel.textContent).toBe("Cancel");
    expect(accept.textContent).toBe("Open commit");
    expect(getComputedStyle(cancel.parentElement).flexDirection).toBe("row");
    input.focus();
    await lumine.commands.dispatch(input, "core:focus-next");
    expect(document.activeElement).toBe(cancel);
    await lumine.commands.dispatch(cancel, "core:focus-previous");
    expect(input.hasFocus()).toBe(true);

    await render(true);
    expect(form.querySelector("lumine-text-editor")).toBe(input);
    expect(editor.isReadOnly()).toBe(true);
    expect(input.hasFocus()).toBe(true);
    expect(accept.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(lumine.commands.canDispatch(input, "core:cancel")).toBe(false);
    await lumine.commands.dispatch(input, "core:cancel");
    expect(request.cancel).not.toHaveBeenCalled();
    await lumine.commands.dispatch(input, "core:confirm");
    expect(request.accept).not.toHaveBeenCalled();

    await render(false, new Error("Revision is unavailable"));
    expect(editor.isReadOnly()).toBe(false);
    expect(editor.getText()).toBe("refs/heads/main");
    expect(form.querySelector(".dialog-status").textContent).toContain("Revision is unavailable");
    expect(accept.disabled).toBe(false);
    await lumine.commands.dispatch(input, "core:confirm");
    expect(request.accept).toHaveBeenCalledOnceWith("refs/heads/main");
    await flushViews(async () => root.destroy());
    expect(editor.isDestroyed()).toBe(true);
  });

  jasmine.itWithDocumentFocus(
    "moves between the mini and Cancel with real Tab and Shift-Tab",
    async () => {
      await render();
      const form = document.querySelector(".git-panel-Dialog");
      const input = form.querySelector("lumine-text-editor[mini]");
      input.focus();
      for (const type of ["keyDown", "keyUp"])
        await ipcRenderer.invoke("lumine:window", "sendInputEvent", { type, keyCode: "Tab" });
      await flushViews(async () => {});
      expect(document.activeElement).toBe(form.querySelector(".dialog-actions button"));
      for (const type of ["keyDown", "keyUp"])
        await ipcRenderer.invoke("lumine:window", "sendInputEvent", {
          type,
          keyCode: "Tab",
          modifiers: ["shift"],
        });
      await flushViews(async () => {});
      expect(input.hasFocus()).toBe(true);
    },
  );

  it("dismisses an idle outside click but keeps a pending operation visible", async () => {
    await render(true);
    const form = document.querySelector(".git-panel-Dialog");
    const panel = lumine.workspace
      .getModalPanels()
      .find((item) => item.getElement().contains(form));
    const outside = document.createElement("button");
    document.body.append(outside);
    const clickOutside = async () => {
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    try {
      await clickOutside();
      expect(panel.isVisible()).toBe(true);
      expect(request.cancel).not.toHaveBeenCalled();
      await render(false);
      await clickOutside();
      expect(panel.isVisible()).toBe(false);
      expect(request.cancel).toHaveBeenCalledTimes(1);
    } finally {
      outside.remove();
    }
  });
});
