/** @babel */
import path from "path";
import StagingView from "../lib/views/staging-view";

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(3));
};
const elapsed = (start) => Number(process.hrtime.bigint() - start) / 1e6;

describe("Git panel rendering performance", () => {
  for (const count of [100, 1000]) {
    it(`measures mounting and selection commits for ${count} changed files`, async () => {
      const stylesheet = lumine.themes.requireStylesheet(
        path.join(__dirname, "..", "styles", "main.css"),
      );
      const container = document.createElement("div");
      container.style.cssText = "width:400px;height:600px;overflow:auto";
      jasmine.attachToDOM(container);
      const props = {
        workspace: lumine.workspace,
        commands: lumine.commands,
        workingDirectoryPath: "C:\\benchmark-repo",
        unstagedChanges: Array.from({ length: count }, (_, index) => ({
          filePath: `src/file-${index}.txt`,
          status: "modified",
        })),
        stagedChanges: [],
        mergeConflicts: [],
        hasUndoHistory: false,
      };
      const mounts = [];
      const selections = [];
      try {
        for (let cycle = 0; cycle < 31; cycle++) {
          const start = process.hrtime.bigint();
          const view = new StagingView(props);
          container.appendChild(view.element);
          lumine.views.performDocumentUpdate();
          if (cycle) mounts.push(elapsed(start));
          expect(container.querySelectorAll(".git-panel-FilePatchListView-item").length).toBe(
            count,
          );
          for (let move = 0; move < 60; move++) {
            const started = process.hrtime.bigint();
            const updated = view.selectNext();
            lumine.views.performDocumentUpdate();
            await updated;
            if (cycle) selections.push(elapsed(started));
          }
          await view.destroy();
          lumine.views.performDocumentUpdate();
          expect(container.children.length).toBe(0);
        }
        console.log(
          "LUMINE_PERFORMANCE=" +
            JSON.stringify({
              renderer: "etch",
              scenario: "staging",
              count,
              mount: { p50: percentile(mounts, 0.5), p95: percentile(mounts, 0.95) },
              selectionCommit: {
                p50: percentile(selections, 0.5),
                p95: percentile(selections, 0.95),
              },
              samples: { mount: mounts.length, selection: selections.length },
              editorsAfterDestroy: container.querySelectorAll("lumine-text-editor").length,
            }),
        );
      } finally {
        container.remove();
        stylesheet.dispose();
      }
    }, 30000);
  }
});
