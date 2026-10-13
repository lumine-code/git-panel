const requireCurrent = require("node:module").createRequire(__filename);
beforeEach(() => {
  for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
    spyOn(lumine.shell, method).and.resolveTo();
  spyOn(lumine.application, "openWindow").and.resolveTo();
});

describe("Git timings selected File import", () => {
  let view, input, handler, restored, errors;

  beforeEach(async () => {
    jasmine.useRealClock();
    if (lumine.packages.isPackageLoaded("git-panel"))
      await lumine.packages.unloadPackage("git-panel");
    await lumine.packages.activatePackage("git-panel");
    const loaded = requireCurrent("../lib/views/git-timings-view");
    const GitTimingsView = loaded.default || loaded;
    restored = spyOn(GitTimingsView, "restoreGroup").and.callThrough();
    handler = spyOn(GitTimingsView.prototype, "handleImportClick").and.callThrough();
    errors = spyOn(lumine.notifications, "addError").and.callThrough();
    view = new GitTimingsView();
    jasmine.attachToDOM(view.element);
    spyOn(HTMLInputElement.prototype, "click").and.callFake(function () {
      input = this;
      document.body.append(input);
    });
  });

  afterEach(async () => {
    input?.remove();
    await view?.destroy();
    if (lumine.packages.isPackageLoaded("git-panel"))
      await lumine.packages.unloadPackage("git-panel");
    await lumine.fileWatchClient.settlePendingTeardown();
    view = input = null;
  });

  function clickImport() {
    view.element.querySelector("button").click();
    expect(input.type).toBe("file");
    return handler.calls.mostRecent().returnValue;
  }

  it("imports the selected browser File's contents without a legacy path", async () => {
    const data = [
      { label: "Owned selected timing", end: 20, markers: [{ name: "owned task", start: 10 }] },
    ];
    const selected = new File([JSON.stringify(data)], "timings.json", { type: "application/json" });
    const transfer = new DataTransfer();
    transfer.items.add(selected);
    const imported = clickImport();
    input.files = transfer.files;
    expect(input.files[0]).toBe(selected);
    expect(input.files[0].path).toBeUndefined();
    input.dispatchEvent(new Event("change"));
    await imported;
    expect(errors).not.toHaveBeenCalled();
    expect(restored).toHaveBeenCalledTimes(1);
    expect(restored.calls.mostRecent()?.args[0][0].serialize()).toEqual(data[0]);
    await conditionPromise(() => view.element.textContent.includes("Owned selected timing"));
    expect(view.element.textContent).toContain("Owned selected timing");
  });

  it("keeps cancellation free of imports and errors", async () => {
    const imported = clickImport();
    input.dispatchEvent(new Event("cancel"));
    await imported;
    expect(restored).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });
});
/* global conditionPromise */
