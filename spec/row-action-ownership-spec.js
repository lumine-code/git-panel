const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);

describe("Patch row action snapshot ownership", () => {
  let root, directory, repositories, adapters, patches, view, service;
  beforeEach(async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    root = await fs.realpath(os.tmpdir());
    directory = await fs.realpath(await fs.mkdtemp(path.join(root, "patch-row-owners-")));
    repositories = [];
    adapters = [];
    patches = [];
    service = require("../lib/index").provideDiff();
    for (const name of ["a", "b"]) {
      const cwd = path.join(directory, name);
      await fs.mkdir(cwd);
      const repository = await lumine.repositories.initialize(cwd, { initialBranch: "main" });
      repositories.push(repository);
      // Match the current Git Panel consumer's patch-to-string/index mapping,
      // while sending the write through actual Core repository operations.
      adapters.push({
        getWorkingDirectoryPath: () => cwd,
        applyPatchToIndex: (patch) =>
          repository.getOperations().applyPatch(patch.toString(), { index: true }),
      });
      await fs.writeFile(path.join(cwd, `${name}.txt`), "before\n");
      await execute("git", ["add", "--", `${name}.txt`], { cwd, windowsHide: true });
      await fs.writeFile(path.join(cwd, `${name}.txt`), "after\n");
      patches.push(service.buildPatch(await repository.getDiff({ paths: [`${name}.txt`] })));
    }
    const loadedView = require("../lib/views/changes-view");
    const ChangesView = loadedView.default || loadedView;
    view = new ChangesView({
      multiFilePatch: patches[0],
      repository: adapters[0],
      stagingStatus: "unstaged",
      title: "Owned source A",
      readOnly: false,
      workspace: lumine.workspace,
      commands: lumine.commands,
      config: lumine.config,
      keymaps: lumine.keymaps,
      tooltips: lumine.tooltips,
      discardLines: jasmine.createSpy("actual consumer discard boundary").and.resolveTo(),
      surface: () => {},
    });
    jasmine.attachToDOM(view.element);
  });
  afterEach(async () => {
    await view?.destroy();
    for (const patch of patches) patch.dispose();
    for (const repository of repositories) await lumine.repositories.forget(repository);
    const relative = path.relative(root, directory);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw Error("Unsafe cleanup");
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  for (const action of ["toggleRows", "discardRows"]) {
    it(`does not retarget ${action} after its real selection update awaits`, async () => {
      const controller = view.refPatchController.get();
      const selected = controller.selectedRowsChanged.bind(controller);
      let release, entered;
      const arrival = new Promise((resolve) => (entered = resolve));
      const held = new Promise((resolve) => (release = resolve));
      spyOn(controller, "selectedRowsChanged").and.callFake(async (...args) => {
        await selected(...args);
        entered();
        await held;
      });
      const index = spyOn(adapters[1], "applyPatchToIndex").and.callThrough();
      const actionResult = controller[action](new Set([1]), "line");
      try {
        await arrival;
        await view.update({
          ...view.props,
          multiFilePatch: patches[1],
          repository: adapters[1],
          title: "New source B",
        });
      } finally {
        release();
        await actionResult;
      }
      expect(index).not.toHaveBeenCalled();
      expect(view.props.discardLines).not.toHaveBeenCalled();
      const text = (
        await execute("git", ["show", ":b.txt"], {
          cwd: path.join(directory, "b"),
          windowsHide: true,
        })
      ).stdout;
      expect(text).toBe("before\n");
    });
  }
  it("keeps foreign performance entries when the actual native view is destroyed", async () => {
    const name = "owned-test-other-package-mark";
    performance.mark(name);
    performance.measure(`${name}-measure`, name);
    try {
      await view.destroy();
      expect(performance.getEntriesByName(name).length).toBe(1);
      expect(performance.getEntriesByName(`${name}-measure`).length).toBe(1);
    } finally {
      performance.clearMarks(name);
      performance.clearMeasures(`${name}-measure`);
    }
  });
  it("finishes an accepted native index job without waiting for a replacement patch refresh", async () => {
    const controller = view.refPatchController.get();
    const apply = adapters[0].applyPatchToIndex;
    let release, entered;
    const arrival = new Promise((resolve) => (entered = resolve));
    const held = new Promise((resolve) => (release = resolve));
    spyOn(adapters[0], "applyPatchToIndex").and.callFake(async (patch) => {
      entered();
      await held;
      return apply(patch);
    });
    const action = controller.toggleRows(new Set([1]), "line");
    try {
      await arrival;
      await view.update({ ...view.props, multiFilePatch: patches[1], repository: adapters[1] });
    } finally {
      release();
      await action;
    }
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.stagingOperationInProgress).toBe(false);
    const read = async (name) =>
      (
        await execute("git", ["show", `:${name}.txt`], {
          cwd: path.join(directory, name),
          windowsHide: true,
        })
      ).stdout;
    expect(await read("a")).toBe("before\nafter\n");
    expect(await read("b")).toBe("before\n");
  });
});
