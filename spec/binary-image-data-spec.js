/** @babel */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import GitShellOutStrategy from "../lib/git-shell-out-strategy.js";
import Repository from "../lib/models/repository.js";
import { buildFilePatch, buildMultiFilePatch } from "../lib/models/patch/index.js";
import { COLLAPSED } from "../lib/models/patch/patch.js";
import { parseDiff } from "../lib/parse-diff.js";

describe("binary patch metadata", () => {
  const models = [];
  const own = (model) => {
    models.push(model);
    return model;
  };
  const binaryDiff = () => ({
    oldPath: "image.png",
    newPath: "image.png",
    oldMode: "100644",
    newMode: "100644",
    status: "modified",
    binary: true,
    hunks: [],
  });

  afterEach(() => {
    while (models.length) models.pop().dispose();
  });

  it("keeps binary identity through cloning, collapse and expansion without raw patches", () => {
    const patch = own(buildFilePatch([binaryDiff()]));
    const cloned = own(patch.clone());
    const file = cloned.getFilePatches()[0];
    expect(file.isBinary()).toBeTrue();
    expect(file.getHunks()).toEqual([]);
    cloned.collapseFilePatch(file);
    expect(file.isBinary()).toBeTrue();
    cloned.expandFilePatch(file);
    expect(file.isBinary()).toBeTrue();
    expect(patch.getFilePatches()[0].isBinary()).toBeTrue();
  });

  it("keeps binary content in a paired symlink replacement, including hidden patches", () => {
    const content = { ...binaryDiff(), oldPath: null, oldMode: null, status: "added" };
    const link = {
      oldPath: "image.png",
      newPath: null,
      oldMode: "120000",
      newMode: null,
      status: "deleted",
      hunks: [
        { oldStartLine: 1, oldLineCount: 1, newStartLine: 0, newLineCount: 0, lines: ["-target"] },
      ],
    };
    for (const options of [{}, { renderStatusOverrides: { "image.png": COLLAPSED } }]) {
      const patch = own(buildMultiFilePatch([link, content], options));
      const file = patch.getFilePatches()[0];
      expect(file.hasTypechange()).toBeTrue();
      expect(file.isBinary()).toBeTrue();
      expect(own(patch.clone()).getFilePatches()[0].isBinary()).toBeTrue();
      patch.expandFilePatch(file);
      expect(file.isBinary()).toBeTrue();
    }
  });

  it("preserves raw binary patches and distinguishes ordinary zero-hunk changes", () => {
    const raw =
      "diff --git a/image.png b/image.png\nindex 1111111..2222222 100644\nBinary files a/image.png and b/image.png differ\n";
    const patch = own(buildFilePatch(parseDiff(raw)));
    expect(patch.getFilePatches()[0].isBinary()).toBeTrue();
    const text = own(buildFilePatch([{ ...binaryDiff(), binary: false }]));
    expect(text.getFilePatches()[0].isBinary()).toBeFalse();
  });
});

describe("binary file endpoint reads through the panel repository", () => {
  let scratch, scratchRoot, scratchParent, coreRepository, repository;
  const committed = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0xc3, 0x28]);
  const staged = Buffer.from([0xff, 0xd8, 0xff, 0, 0x80, 0xfe, 0xd9]);
  const working = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0xfd, 0x81]);

  beforeEach(async () => {
    scratchParent = await fs.realpath(os.tmpdir());
    scratchRoot = await fs.realpath(
      await fs.mkdtemp(path.join(scratchParent, "git-panel-image-data-")),
    );
    scratch = path.join(scratchRoot, "repository");
    await fs.mkdir(scratch);
    coreRepository = await lumine.repositories.initialize(scratch, { initialBranch: "main" });
    repository = new Repository(scratch);
    await repository.getLoadPromise();
  });

  afterEach(async () => {
    repository?.destroy();
    if (coreRepository) lumine.repositories.forget(coreRepository);
    if (scratchRoot) {
      const resolved = await fs.realpath(scratchRoot);
      const relative = path.relative(scratchParent, resolved);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error("Fixture cleanup escaped its owned temporary root.");
      }
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
    scratch = scratchRoot = coreRepository = repository = null;
  });

  it("reads independent commit, index and worktree bytes without decoding or stale caching", async () => {
    await repository.setConfig("user.name", "Lumine Specs");
    await repository.setConfig("user.email", "specs@lumine.invalid");
    const filename = "image.png";
    const absolute = path.join(scratch, filename);
    await fs.writeFile(absolute, committed);
    await repository.stageFiles([filename]);
    await repository.commit("Add binary image");
    await fs.writeFile(absolute, staged);
    await repository.stageFiles([filename]);
    await fs.writeFile(absolute, working);

    for (const [endpoint, expected] of [
      [{ type: "commit", revision: "HEAD" }, committed],
      [{ type: "index" }, staged],
      [{ type: "worktree" }, working],
    ]) {
      const actual = await repository.readFileAtEndpoint(filename, endpoint);
      expect(Buffer.isBuffer(actual)).toBeTrue();
      expect(actual.equals(expected)).toBeTrue();
    }

    await fs.writeFile(absolute, committed);
    expect(
      (await repository.readFileAtEndpoint(filename, { type: "worktree" })).equals(committed),
    ).toBeTrue();
    await repository.stageFiles([filename]);
    expect(
      (await repository.readFileAtEndpoint(filename, { type: "index" })).equals(committed),
    ).toBeTrue();
    expect(await repository.readFileAtEndpoint(filename, { type: "empty" })).toBeNull();
    for (const endpoint of [
      { type: "commit", revision: "HEAD" },
      { type: "index" },
      { type: "worktree" },
    ]) {
      expect(await repository.readFileAtEndpoint("missing.png", endpoint)).toBeNull();
    }
  });

  it("identifies an untracked image as binary and reads its complete bytes", async () => {
    await fs.writeFile(path.join(scratch, "untracked.png"), committed);
    await coreRepository.refreshStatusSnapshot();
    const patch = await repository.getFilePatchForPath("untracked.png");
    const file = patch.getFilePatches()[0];
    expect(file.isBinary()).toBeTrue();
    expect(file.getOldFile().isPresent()).toBeFalse();
    expect(file.getHunks()).toEqual([]);
    expect(
      (await repository.readFileAtEndpoint(file.getNewPath(), { type: "worktree" })).equals(
        committed,
      ),
    ).toBeTrue();
    expect(await repository.readFileAtEndpoint(file.getOldPath(), { type: "index" })).toBeNull();
  });

  it("rejects relative and absolute endpoint paths outside the repository", async () => {
    const outside = path.join(scratchRoot, "outside.png");
    await fs.writeFile(outside, committed);
    for (const filename of [outside, path.relative(scratch, outside)]) {
      for (const endpoint of [
        { type: "commit", revision: "HEAD" },
        { type: "index" },
        { type: "worktree" },
      ]) {
        await expectAsync(repository.readFileAtEndpoint(filename, endpoint)).toBeRejectedWithError(
          TypeError,
          "A file endpoint requires a path inside the repository.",
        );
      }
    }
  });

  it("reads symlink bytes like the index and does not follow an outside directory", async () => {
    const outside = path.join(scratchRoot, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "target.png"), committed);
    await fs.symlink(
      path.join("..", "outside", "target.png"),
      path.join(scratch, "link.png"),
      "file",
    );
    await repository.stageFiles(["link.png"]);
    const linkBytes = Buffer.from("../outside/target.png");
    for (const endpoint of [{ type: "index" }, { type: "worktree" }]) {
      const actual = await repository.readFileAtEndpoint("link.png", endpoint);
      expect(Buffer.isBuffer(actual)).toBeTrue();
      expect(actual.equals(linkBytes)).toBeTrue();
      expect(actual.equals(committed)).toBeFalse();
    }

    await fs.symlink(
      outside,
      path.join(scratch, "directory-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expectAsync(
      repository.readFileAtEndpoint(path.join("directory-link", "target.png"), {
        type: "worktree",
      }),
    ).toBeRejectedWithError(TypeError, "A file endpoint requires a path inside the repository.");
  });

  it("rejects a read cancelled before it starts or while acquiring the core repository", async () => {
    const strategy = new GitShellOutStrategy(scratch);
    const cancelled = new AbortController();
    cancelled.abort();
    const getCoreRepository = spyOn(strategy, "getCoreRepository").and.callFake(async () => {
      duringAcquisition.abort();
      return coreRepository;
    });
    const duringAcquisition = new AbortController();
    try {
      await expectAsync(
        strategy.readFileAtEndpoint("image.png", { type: "index" }, { signal: cancelled.signal }),
      ).toBeRejectedWithError();
      expect(getCoreRepository).not.toHaveBeenCalled();
      const getIndexFile = spyOn(coreRepository, "getIndexFile").and.callThrough();
      await expectAsync(
        strategy.readFileAtEndpoint(
          "image.png",
          { type: "index" },
          { signal: duringAcquisition.signal },
        ),
      ).toBeRejectedWithError();
      expect(getIndexFile).not.toHaveBeenCalled();
    } finally {
      strategy.destroy();
    }
  });
});
