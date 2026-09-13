/** @babel */
import path from "path";

import ChangedFileItem from "../lib/items/changed-file-item";
import CommitDetailItem from "../lib/items/commit-detail-item";
import CommitPreviewItem from "../lib/items/commit-preview-item";
import GitTabItem from "../lib/items/git-tab-item";
import GitCacheView from "../lib/views/git-cache-view";
import GitTimingsView from "../lib/views/git-timings-view";

describe("pane view styles", () => {
  it("matches text editor backgrounds for pane items and their loading stubs", () => {
    const stylesheet = lumine.themes.requireStylesheet(
      path.join(__dirname, "..", "styles", "pane-view.css"),
    );
    const elements = [
      "git-panel-StubItem-git-file-patch-controller",
      "git-panel-StubItem-git-commit-preview",
      "git-panel-StubItem-git-commit-detail",
      "git-panel-StubItem-git-timings-view",
      "git-panel-FilePatch-root",
      "git-panel-CommitPreview-root",
      "git-panel-CommitDetail-root",
      "git-panel-GitTimings-root",
      "git-panel-GitCache-root",
      "git-panel-FilePatchView",
      "git-panel-CommitDetailView",
      "git-panel-GitTimingsView",
      "git-panel-CacheView",
    ].map((className) => {
      const element = document.createElement("div");
      element.classList.add(className);
      element.style.setProperty("--syntax-background-color", "rgb(1, 2, 3)");
      jasmine.attachToDOM(element);
      return element;
    });

    try {
      for (const element of elements) {
        expect(getComputedStyle(element).backgroundColor).toBe("rgb(1, 2, 3)");
      }
    } finally {
      for (const element of elements) element.remove();
      stylesheet.dispose();
    }
  });
});

describe("pane item locations", () => {
  it("keeps the main Git panel in the side docks with its default first", () => {
    expect(GitTabItem.prototype.getDefaultLocation()).toBe("right");
    expect(GitTabItem.prototype.getAllowedLocations()).toEqual(["right", "left"]);
  });

  it("keeps editor-like Git views in the workspace center", () => {
    const itemTypes = [
      ChangedFileItem,
      CommitPreviewItem,
      CommitDetailItem,
      GitTimingsView,
      GitCacheView,
    ];

    for (const ItemType of itemTypes) {
      expect(ItemType.prototype.getAllowedLocations()).toEqual(["center"]);
    }
  });
});
