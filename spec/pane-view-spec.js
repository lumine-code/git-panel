/** @babel */
import path from "path";

import ChangedFileItem from "../lib/items/changed-file-item";
import CommitDetailItem from "../lib/items/commit-detail-item";
import CommitPreviewItem from "../lib/items/commit-preview-item";
import GitTabItem from "../lib/items/git-tab-item";
import GitCacheView from "../lib/views/git-cache-view";
import GitTimingsView from "../lib/views/git-timings-view";
import GitPackage from "../lib/git-package";

describe("pane view styles", () => {
  it("matches text editor backgrounds for pane items and their loading hosts", () => {
    const stylesheet = lumine.themes.requireStylesheet(
      path.join(__dirname, "..", "styles", "pane-view.css"),
    );
    const elements = [
      "git-panel-PaneItemHost-git-file-patch-controller",
      "git-panel-PaneItemHost-git-commit-preview",
      "git-panel-PaneItemHost-git-commit-detail",
      "git-panel-PaneItemHost-git-timings-view",
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

describe("pane item host factories", () => {
  it("provides serializable hosts for every Git pane item", () => {
    const packageInstance = { controller: null };
    const factories = [
      [
        GitPackage.prototype.createGitPaneItem,
        { uri: "lumine-github://dock-item/git" },
        "GitDockItem",
      ],
      [
        GitPackage.prototype.createFilePatchPaneItem,
        { uri: "lumine-github://file-patch/a?workdir=b&stagingStatus=staged" },
        "FilePatchControllerStub",
      ],
      [
        GitPackage.prototype.createCommitPreviewPaneItem,
        { uri: "lumine-github://commit-preview?workdir=b" },
        "CommitPreviewStub",
      ],
      [
        GitPackage.prototype.createCommitDetailPaneItem,
        { uri: "lumine-github://commit-detail?workdir=b&sha=c" },
        "CommitDetailStub",
      ],
      [
        GitPackage.prototype.createGitTimingsPaneItem,
        { uri: "lumine-github://debug/timings" },
        "GitTimingsView",
      ],
    ];

    for (const [factory, options, deserializer] of factories) {
      const host = factory.call(packageInstance, options);
      expect(host.getHydrationState()).toBe("pending");
      expect(host.serialize()).toEqual(jasmine.objectContaining({ deserializer }));
      host.destroy();
    }
  });
});
