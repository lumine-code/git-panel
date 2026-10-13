/** @babel */
import { createRequire } from "node:module";
import path from "path";
import PatchView from "../lib/views/patch-view.js";
import PatchDocument from "../lib/models/patch-document.js";
import RefHolder from "../lib/models/ref-holder.js";
import { buildMultiFilePatch } from "../lib/models/patch/index.js";

const require = createRequire(import.meta.url);

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
  it("builds every patch pane URI from a public document descriptor", async () => {
    const provider = await lumine.packages.startPackage("git-panel");
    const service = provider.mainModule.provideDiff();
    const renderer = spyOnProperty(service, "ChangesView", "get").and.throwError(
      "URI creation loaded the renderer",
    );
    for (const descriptor of [
      {
        kind: "file",
        workingDirectory: import.meta.dirname,
        relPath: path.join("nested", "a %2F.txt"),
        stagingStatus: "unstaged",
      },
      { kind: "staged-all", workingDirectory: import.meta.dirname },
      { kind: "commit", workingDirectory: import.meta.dirname, sha: "abc" },
    ]) {
      const document = PatchDocument.fromURI(service.buildPatchURI(descriptor));
      expect(document.kind).toBe(descriptor.kind);
      expect(document.workingDirectory).toBe(descriptor.workingDirectory);
      if (descriptor.kind === "file") {
        expect(document.relPath).toBe(descriptor.relPath);
        expect(document.stagingStatus).toBe("unstaged");
      } else if (descriptor.kind === "commit") expect(document.sha).toBe("abc");
      else expect(document.stagingStatus).toBe("staged");
    }
    expect(() =>
      service.buildPatchURI({ kind: "commit", workingDirectory: import.meta.dirname }),
    ).toThrowError(TypeError);
    expect(service.models).toBeUndefined();
    expect(service.views).toBeUndefined();
    expect(renderer).not.toHaveBeenCalled();
  });
  it("mounts the shared provider through the panel's native view factory", async () => {
    const patch = buildMultiFilePatch([]);
    const holder = new RefHolder();
    const view = new PatchView({
      multiFilePatch: patch,
      document: PatchDocument.file(import.meta.dirname, "example.txt", "unstaged"),
      title: "Unstaged Changes",
      stagingStatus: "unstaged",
      surfaceKind: "file",
      readOnly: false,
      surface: () => {},
      refPatchController: holder,
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: lumine.tooltips,
    });
    try {
      expect(view.element.matches(".git-panel-ChangesView")).toBe(true);
      expect(holder.getOr(null)).not.toBeNull();
    } finally {
      await view.destroy();
      patch.dispose();
    }
  });
});
