const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);

describe("Patch rendering of actual Git file names", () => {
  let directory, temporaryRoot, repository;
  beforeEach(async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    temporaryRoot = await fs.realpath(os.tmpdir());
    directory = await fs.realpath(await fs.mkdtemp(path.join(temporaryRoot, "patch-paths-")));
    repository = await lumine.repositories.initialize(directory, { initialBranch: "main" });
  });
  afterEach(async () => {
    if (repository) await lumine.repositories.forget(repository);
    const relative = path.relative(temporaryRoot, directory);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw Error("Unsafe scratch target");
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  for (const name of ["ordinary.txt", "__proto__", "constructor", "toString"]) {
    it(`renders ${name} from a real Core structured diff`, async () => {
      const file = path.join(directory, name);
      await fs.writeFile(file, "before\n");
      await execute("git", ["add", "--", name], { cwd: directory, windowsHide: true });
      await fs.writeFile(file, "after\n");
      const snapshot = await repository.getDiff({ paths: [name] });
      expect(snapshot.files.length).toBe(1);
      expect(snapshot.files[0].newPath).toBe(name);
      const service = require("../lib/index").provideDiff();
      const patch = service.buildPatch(snapshot);
      try {
        expect(patch.getFilePatches()[0].getPath()).toBe(name);
        expect(patch.toString()).toContain("-before\n+after");
      } finally {
        patch.dispose();
      }
    });
  }
});
