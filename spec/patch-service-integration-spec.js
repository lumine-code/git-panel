/** @babel */
import ChangedFileController from "../lib/controllers/changed-file-controller";
import RefHolder from "../lib/models/ref-holder";
import { buildMultiFilePatch } from "../lib/models/patch";

describe("patch renderer service integration", () => {
  it("publishes the renderer from Git Panel without exposing its module graph", async () => {
    const provider = await lumine.packages.startPackage("git-panel");
    const service = provider.mainModule.provideDiff();
    expect(lumine.packages.serviceHub.hasProvider("git-panel.diff", "^1.0.0")).toBe(true);
    const loadedView = require("../lib/views/changes-view");
    expect(service.ChangesView).toBe(loadedView.default || loadedView);
    expect(service.models).toBeUndefined();
    expect(service.views).toBeUndefined();
  });
  it("mounts the shared provider through the panel's native view factory", async () => {
    const patch = buildMultiFilePatch([]);
    const holder = new RefHolder();
    const view = new ChangedFileController({
      multiFilePatch: patch,
      stagingStatus: "unstaged",
      refPatchController: holder,
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: lumine.tooltips,
    });
    try {
      expect(view.element.querySelector(".git-panel-ChangesView")).not.toBeNull();
      expect(holder.getOr(null)).not.toBeNull();
    } finally {
      await view.destroy();
      patch.dispose();
    }
  });
});
