/** @babel */
import ChangedFileController from "../lib/controllers/changed-file-controller";
import RefHolder from "../lib/models/ref-holder";
import { buildMultiFilePatch } from "../lib/models/patch";

describe("patch renderer service integration", () => {
  it("reacquires constructors when a provider generation changes", () => {
    const holder = require("../lib/patch-view");
    const previous = holder.getPatchView();
    const module = require("../lib/views/changes-view");
    class FirstGeneration {}
    class NextGeneration {}
    const first = holder.consumePatchView({ views: { ChangesView: FirstGeneration } });
    const next = holder.consumePatchView({ views: { ChangesView: NextGeneration } });
    try {
      expect(module.default).toBe(NextGeneration);
      first.dispose();
      expect(module.default).toBe(NextGeneration);
      next.dispose();
      expect(holder.getPatchView()).toBeNull();
    } finally {
      first.dispose();
      next.dispose();
      if (previous) holder.consumePatchView(previous);
    }
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
      expect(view.element.querySelector(".patch-view-ChangesView")).not.toBeNull();
      expect(holder.getOr(null)).not.toBeNull();
    } finally {
      await view.destroy();
      patch.dispose();
    }
  });
});
