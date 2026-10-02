/** @babel */
import FilePatchHeaderView from "../lib/views/file-patch-header-view";
import ChangedFileItem from "../lib/items/changed-file-item";
import CommitDetailItem from "../lib/items/commit-detail-item";

describe("file patch headers", () => {
  let view;

  afterEach(async () => {
    await view?.destroy();
    view = null;
  });

  for (const itemType of [ChangedFileItem, CommitDetailItem]) {
    it(`keeps layout controls out of the ${itemType.name} file header`, () => {
      view = new FilePatchHeaderView({
        itemType,
        relPath: "example.txt",
        stagingStatus: "unstaged",
      });
      jasmine.attachToDOM(view.element);
      expect(view.element.querySelector("[data-diff-view]")).toBeNull();
      expect(view.element.querySelector(".git-panel-FilePatchView-title").textContent).toContain(
        "example.txt",
      );
      expect(view.element.querySelectorAll(".btn-group").length).toBe(
        itemType === ChangedFileItem ? 1 : 0,
      );
    });
  }
});
