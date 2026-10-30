/** @babel */
/** @jsx h */
import { h, flushViews, createViewHost } from "./helpers/etch.js";
import OpenCommitDialog from "../lib/views/open-commit-dialog.js";

describe("Git commit dialog presentation", () => {
  let host, root, view, request;

  beforeEach(() => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    host = document.createElement("div");
    document.body.append(host);
    root = createViewHost(host);
    request = {
      accept: jasmine.createSpy("accept").and.resolveTo(undefined),
      cancel: jasmine.createSpy("cancel"),
    };
  });

  afterEach(async () => {
    await flushViews(async () => root.destroy());
    host.remove();
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
});
