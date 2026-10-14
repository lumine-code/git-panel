// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
function selectDiffView(layout) {
  const button = document.querySelector(
    `.git-panel-DiffViewToggle button[data-diff-view="${layout}"]`,
  );
  if (!button) throw new Error(`Missing ${layout} layout control`);
  button.click();
}

function imageVersionsReady(layout) {
  const preview = document.querySelector(".git-panel-ImagePatchView");
  const images = Array.from(preview?.querySelectorAll("img") || []);
  const divider = preview?.querySelector('[role="slider"]');
  return (
    Boolean(
      document.querySelector(
        `.git-panel-DiffViewToggle button[data-diff-view="${layout}"].selected`,
      ),
    ) &&
    images.length === 2 &&
    images.every((image) => image.complete && image.naturalWidth === 640) &&
    document.body.innerText.includes("Working Tree") &&
    (layout === "unified" ? divider?.getAttribute("aria-valuenow") === "50" : !divider)
  );
}

module.exports = {
  version: 1,
  dependencies: ["language-javascript", "tree-view"],
  viewport: { width: 1200, height: 600 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    const git = (args) =>
      require("node:child_process").execFileSync("git", args, {
        cwd: context.project,
        windowsHide: true,
      });
    git(["branch", "smoothing"]);
    git(["branch", "data-validation"]);
    state.editor = await open("Version Control/signal.js");
    state.editor.setText(
      "export function average(samples) {\n  if (samples.length === 0) return 0;\n  return samples.reduce((sum, value) => sum + value, 0) / samples.length;\n}\n\nconst samples = [0.2, 0.8, -0.4, 0.5, 1.0];\nconsole.log(`Mean amplitude: ${average(samples).toFixed(2)}`);\n",
    );
    await state.editor.save();
    await lumine.project.setPaths([fixture("Version Control")]);
    await new Promise((r) => setTimeout(r, 600));
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Review an unstaged patch beside the Git staging panel.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(lumine.views.getView(state.editor), "git-panel:toggle-focus");
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        {
          lumine.commands.dispatch(
            lumine.views.getView(state.editor),
            "git-panel:view-unstaged-changes-for-current-file",
          );
        }
      },
      ready() {
        return Boolean(document.body.innerText.includes("Unstaged Changes"));
      },
    },
    {
      id: "image-versions",
      file: "demo-images.png",
      caption: "Drag the divider between old and new image versions in the unified patch view.",
      timeout: 60000,
      async run({ lumine, state, fixture, project, waitFor }) {
        const panel = lumine.packages.getActivePackage("git-panel").mainModule;
        await panel.getActiveRepository().stageFiles(["Version Control/signal.js"]);
        require("node:fs").copyFileSync(
          fixture(".artwork/signal-new.png"),
          fixture("Version Control/signal.png"),
        );
        const lease = await lumine.repositories.add(project, { persist: false });
        if (!lease) throw new Error("Demo repository is not registered");
        try {
          await lease.repository.refreshStatusSnapshot();
        } finally {
          lease.dispose();
        }
        const uri = panel.provideDiff().buildPatchURI({
          kind: "file",
          workingDirectory: project,
          relPath: "Version Control/signal.png",
          stagingStatus: "unstaged",
        });
        state.imagePatch = await lumine.workspace.open(uri, { pending: true });
        selectDiffView("unified");
        await waitFor(() => this.ready(), "both image versions decoded");
      },
      ready() {
        return imageVersionsReady("unified");
      },
    },
    {
      id: "image-versions-side-by-side",
      file: "demo-images-side-by-side.png",
      caption: "Inspect old and new image versions side by side.",
      timeout: 60000,
      async run({ waitFor }) {
        selectDiffView("side-by-side");
        await waitFor(() => this.ready(), "both side-by-side image versions decoded");
      },
      ready() {
        return imageVersionsReady("side-by-side");
      },
    },
  ],
  async cleanup() {},
};
