/** @babel */
import FilePatchHeaderView from "../lib/views/file-patch-header-view";

describe("file patch headers", () => {
  let view;

  afterEach(async () => {
    await view?.destroy();
    view = null;
  });

  for (const itemType of ["file", "commit"]) {
    it(`keeps layout controls out of the ${itemType} file header`, () => {
      view = new FilePatchHeaderView({
        surfaceKind: itemType,
        relPath: "example.txt",
        stagingStatus: "unstaged",
      });
      jasmine.attachToDOM(view.element);
      expect(view.element.querySelector("[data-diff-view]")).toBeNull();
      expect(view.element.querySelector(".git-panel-FilePatchView-title").textContent).toContain(
        "example.txt",
      );
      expect(view.element.querySelectorAll(".btn-group").length).toBe(itemType === "file" ? 1 : 0);
    });
  }
});
