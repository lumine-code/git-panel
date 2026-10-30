/** @babel */
import { createViewModel } from "./helpers/etch.js";
import path from "path";

import GitRootController from "../lib/controllers/git-root-controller.js";
import PatchDocument from "../lib/models/patch-document.js";

describe("GitRootController conflict recounting", () => {
  function buildRecountController() {
    const controller = Object.create(GitRootController.prototype);
    controller.props = {
      resolutionProgress: {
        reportDiskMarkerCount: jasmine.createSpy("reportDiskMarkerCount"),
      },
      notificationManager: { addError: jasmine.createSpy("addError") },
    };
    return controller;
  }

  it("settles with the persisted marker count", async () => {
    const controller = buildRecountController();
    const filePath = path.join(import.meta.dirname, "git-root-controller-spec.js");

    const count = await controller.refreshResolutionProgress(filePath);

    expect(count).toBe(0);
    expect(controller.props.resolutionProgress.reportDiskMarkerCount).toHaveBeenCalledWith(
      filePath,
      0,
    );
  });

  it("settles safely when a formerly conflicted file has disappeared", async () => {
    const controller = buildRecountController();
    const filePath = path.join(import.meta.dirname, "missing-conflict-file.txt");

    const count = await controller.refreshResolutionProgress(filePath);

    expect(count).toBe(0);
    expect(controller.props.resolutionProgress.reportDiskMarkerCount).toHaveBeenCalledWith(
      filePath,
      0,
    );
    expect(controller.props.notificationManager.addError).not.toHaveBeenCalled();
  });
});

describe("GitRootController patch source navigation", () => {
  const directory = path.join(import.meta.dirname, "source-repository");
  const documents = [
    PatchDocument.file(directory, "nested.txt", "staged"),
    PatchDocument.staged(directory),
    PatchDocument.commit(directory, "abc"),
  ];
  for (const document of documents) {
    it(`selects the ${document.kind} document's repository before revealing its panel location`, async () => {
      let finish;
      let selectedDirectory = "another-repository";
      const gate = new Promise((resolve) => {
        finish = resolve;
      });
      const events = [];
      const tab = {
        focusAndSelectStagingItem: jasmine
          .createSpy("select file")
          .and.callFake(() => events.push("file")),
        focusAndSelectCommitPreviewButton: jasmine
          .createSpy("select staged-all")
          .and.callFake(() => events.push("staged-all")),
        focusAndSelectRecentCommit: jasmine
          .createSpy("select commit")
          .and.callFake(() => events.push("commit")),
      };
      const tracker = {
        ensureVisible: jasmine.createSpy("show source panel").and.callFake(async () => {
          expect(selectedDirectory).toBe(directory);
          events.push("visible");
        }),
        getComponent: jasmine.createSpy("get selected panel").and.callFake(() => {
          expect(events[events.length - 1]).toBe("visible");
          return tab;
        }),
      };
      const selectRepository = jasmine
        .createSpy("select repository")
        .and.callFake(async (chosen) => {
          events.push("selecting");
          await gate;
          selectedDirectory = chosen;
          events.push("selected");
        });
      const controller = createViewModel(GitRootController, {
        repository: {
          isDestroyed: () => true,
          getWorkingDirectoryPath: () => "another-repository",
        },
        selectRepository,
        gitTabTracker: tracker,
      });
      try {
        const navigation = controller.surfaceDocument(document);
        expect(selectRepository).toHaveBeenCalledOnceWith(directory);
        expect(tracker.ensureVisible).not.toHaveBeenCalled();
        expect(tracker.getComponent).not.toHaveBeenCalled();
        finish();
        await navigation;
        expect(events).toEqual(["selecting", "selected", "visible", document.kind]);
        if (document.kind === "file")
          expect(tab.focusAndSelectStagingItem).toHaveBeenCalledOnceWith("nested.txt", "staged");
        else if (document.kind === "staged-all")
          expect(tab.focusAndSelectCommitPreviewButton).toHaveBeenCalledOnceWith();
        else expect(tab.focusAndSelectRecentCommit).toHaveBeenCalledOnceWith();
      } finally {
        finish();
        await controller.destroy();
      }
    });
  }
});
