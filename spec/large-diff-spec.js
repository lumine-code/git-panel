/** @babel */

import fs from "fs";
import os from "os";
import path from "path";
import GitShellOutStrategy from "../lib/git-shell-out-strategy.js";
import StagingView from "../lib/views/staging-view.js";

async function removeFixture(workingDirectory, temporaryRoot) {
  const resolved = fs.realpathSync.native(workingDirectory);
  const relative = path.relative(temporaryRoot, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error("Fixture cleanup escaped its owned temporary root.");
  await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}

describe("large Git diffs", () => {
  it("requests the panel's larger budget for file, status, staged and commit diffs", async () => {
    const repository = {
      getDiff: jasmine.createSpy("getDiff").and.resolveTo({ files: [] }),
      getStatusSnapshot: () => ({ initialized: true, head: { unborn: false } }),
      getCommits: async () => ({
        commits: [
          {
            sha: "a".repeat(40),
            parents: [],
            subject: "Large addition",
            body: "",
            author: { name: "Author", email: "author@example.com", date: new Date(0) },
          },
        ],
      }),
    };
    const strategy = new GitShellOutStrategy(process.cwd());
    spyOn(strategy, "getCoreRepository").and.resolveTo(repository);
    spyOn(strategy, "getUntrackedFiles").and.resolveTo([]);

    try {
      await strategy.getDiffsForFilePath("large.txt", { staged: true });
      await strategy.diffFileStatus({ target: "HEAD" });
      await strategy.getStagedChangesPatch();
      await strategy.getCommits({ includePatch: true });

      expect(repository.getDiff).toHaveBeenCalledTimes(4);
      for (const [options] of repository.getDiff.calls.allArgs()) {
        expect(options.maxBytes).toBe(256 * 1024 * 1024);
        expect(options.format).toBe("structured");
      }
    } finally {
      strategy.destroy();
    }
  });

  it("reads a real tracked diff larger than the core's default 10 MiB budget", async () => {
    const temporaryRoot = fs.realpathSync.native(os.tmpdir());
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(temporaryRoot, "git-panel-large-diff-")),
    );
    const repository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const strategy = new GitShellOutStrategy(workingDirectory);

    try {
      const filePath = path.join(workingDirectory, "large.txt");
      fs.writeFileSync(filePath, "before\n");
      await strategy.stageFiles(["large.txt"]);
      // Long ordinary lines keep the fixture above 10 MiB without allocating
      // hundreds of thousands of patch objects just to exercise the byte cap.
      const line = "x".repeat(2047) + "\n";
      const lineCount = 5500;
      fs.writeFileSync(filePath, line.repeat(lineCount));

      await expectAsync(repository.getDiff({ paths: ["large.txt"] })).toBeRejectedWith(
        jasmine.objectContaining({ code: "ERR_GIT_DIFF_TOO_LARGE" }),
      );
      const diffs = await strategy.getDiffsForFilePath("large.txt", { staged: false });
      expect(diffs).toHaveSize(1);
      const added = diffs[0].hunks.flatMap((hunk) =>
        hunk.lines.filter((entry) => entry.kind === "added"),
      );
      expect(added).toHaveSize(lineCount);
      expect(added[0].text).toBe(line.trimEnd());
      expect(added.at(-1).text).toBe(line.trimEnd());
    } finally {
      strategy.destroy();
      lumine.repositories.forget(repository);
      await removeFixture(workingDirectory, temporaryRoot);
    }
  });

  for (const code of ["ERR_GIT_DIFF_TOO_LARGE", "ERR_GIT_HOST_RESULT_TOO_LARGE"]) {
    it(`reports ${code} when opening a pending diff`, async () => {
      const error = Object.assign(new Error("Git diff exceeds the output limit"), { code });
      const notificationManager = { addError: jasmine.createSpy("addError") };
      const view = {
        props: {
          workingDirectoryPath: "example-repository",
          workspace: { open: jasmine.createSpy("open").and.rejectWith(error) },
          notificationManager,
        },
      };

      await StagingView.prototype.showFilePatchItem.call(view, "large.txt", "unstaged");

      expect(notificationManager.addError).toHaveBeenCalledOnceWith("Unable to display Git diff", {
        description: error.message,
        dismissable: true,
      });
    });
  }

  it("preserves other errors from opening a pending diff", async () => {
    const error = new Error("Repository read failed");
    const notificationManager = { addError: jasmine.createSpy("addError") };
    const view = {
      props: {
        workingDirectoryPath: "example-repository",
        workspace: { open: jasmine.createSpy("open").and.rejectWith(error) },
        notificationManager,
      },
    };

    await expectAsync(
      StagingView.prototype.showFilePatchItem.call(view, "large.txt", "unstaged"),
    ).toBeRejectedWith(error);
    expect(notificationManager.addError).not.toHaveBeenCalled();
  });
});
