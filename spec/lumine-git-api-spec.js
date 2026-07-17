/** @babel */
/* global describe, expect, it */

import fs from "fs";
import os from "os";
import path from "path";

import GitShellOutStrategy from "../lib/git-shell-out-strategy";
import Repository from "../lib/models/repository";
import WorkdirContext from "../lib/models/workdir-context";

async function waitUntil(check, attempts = 500) {
  for (let i = 0; i < attempts; i++) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Condition was not met");
}

describe("Lumine Git transport", () => {
  it("stages through the panel repository model and its composite strategy proxy", async () => {
    // The model wraps strategies in the firstImplementer Proxy, so `this`
    // inside delegated operations is the proxy rather than the strategy.
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-model-stage-")),
    );
    const coreRepository = await atom.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const panelRepository = new Repository(workingDirectory);

    try {
      await panelRepository.getLoadPromise();
      fs.writeFileSync(path.join(workingDirectory, "a.txt"), "panel\n");
      await panelRepository.stageFiles(["a.txt"]);
      const statuses = await panelRepository.getStatusesForChangedFiles();
      expect(statuses.stagedFiles["a.txt"]).toBe("added");
    } finally {
      panelRepository.destroy();
      atom.repositories.forget(coreRepository);
    }
  });

  it("reports the unborn branch as the current branch before the first commit", async () => {
    // A freshly initialized repository is on an unborn branch: HEAD names it
    // but `git for-each-ref` lists nothing, so the branch set is empty. The
    // current branch must still be reported (not a detached HEAD), matching the
    // core status snapshot other consumers read.
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-unborn-")),
    );
    const coreRepository = await atom.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const panelRepository = new Repository(workingDirectory);

    try {
      await panelRepository.getLoadPromise();
      const branch = await panelRepository.getCurrentBranch();
      expect(branch.isPresent()).toBe(true);
      expect(branch.isDetached()).toBe(false);
      expect(branch.getName()).toBe("main");
    } finally {
      panelRepository.destroy();
      atom.repositories.forget(coreRepository);
    }
  });

  it("executes with Lumine's embedded Git without a package-local Dugite", async () => {
    const strategy = new GitShellOutStrategy(process.cwd());

    try {
      const output = await strategy.exec(["--version"]);
      expect(output).toMatch(/^git version /);
      expect(atom.repositories.getGitExecutablePath()).toBeTruthy();
    } finally {
      strategy.destroy();
    }
  });

  it("delegates write operations to atom.repositories and refreshes core state", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-operations-")),
    );
    const repository = await atom.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const strategy = new GitShellOutStrategy(workingDirectory);
    const finishedOperations = [];
    const subscription = repository
      .getOperations()
      .onDidFinishOperation((event) => finishedOperations.push(event.name));

    try {
      await strategy.setConfig("user.name", "Git Panel Specs");
      await strategy.setConfig("user.email", "specs@lumine.invalid");
      await repository.refreshStatusSnapshot();

      fs.writeFileSync(path.join(workingDirectory, "a.txt"), "panel\n");
      await strategy.stageFiles(["a.txt"]);
      // The registry refreshed the snapshot after the operation; no explicit refresh here.
      expect(repository.getStatusEntry("a.txt").indexStatus).toBe("A");

      await strategy.commit("Panel commit", {});
      expect(repository.getStatusEntry("a.txt")).toBeNull();
      expect(repository.getShortHead()).toBe("main");
      expect((await strategy.getHeadCommit()).messageSubject).toBe("Panel commit");

      expect(finishedOperations).toEqual(["setConfig", "setConfig", "stageFiles", "commit"]);
    } finally {
      subscription.dispose();
      strategy.destroy();
      atom.repositories.forget(repository);
    }
  });

  it("drives staging, branches, and conflict plumbing through atom.repositories", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-plumbing-")),
    );
    const repository = await atom.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const strategy = new GitShellOutStrategy(workingDirectory);

    try {
      await strategy.setConfig("user.name", "Git Panel Specs");
      await strategy.setConfig("user.email", "specs@lumine.invalid");

      // Unstaging works before the first commit exists.
      fs.writeFileSync(path.join(workingDirectory, "file.txt"), "base\n");
      await strategy.stageFiles(["file.txt"]);
      await strategy.unstageFiles(["file.txt"]);
      expect((await strategy.exec(["ls-files", "-s"])).trim()).toBe("");

      await strategy.stageFiles(["file.txt"]);
      await strategy.commit("Initial commit", {});

      await strategy.checkout("feature", { createNew: true });
      expect((await strategy.exec(["branch", "--show-current"])).trim()).toBe("feature");

      // Blob and conflict plumbing used by the discard history.
      const oursSha = await strategy.createBlob({ stdin: "ours\n" });
      const theirsSha = await strategy.createBlob({ stdin: "theirs\n" });
      const expanded = path.join(workingDirectory, "expanded.txt");
      await strategy.expandBlobToFile(expanded, oursSha);
      expect(fs.readFileSync(expanded, "utf8")).toBe("ours\n");

      fs.writeFileSync(path.join(workingDirectory, "ours.txt"), "ours\n");
      fs.writeFileSync(path.join(workingDirectory, "base.txt"), "base\n");
      fs.writeFileSync(path.join(workingDirectory, "theirs.txt"), "theirs\n");
      const mergeResult = await strategy.mergeFile(
        "ours.txt",
        "base.txt",
        "theirs.txt",
        "merged.txt",
      );
      expect(mergeResult.conflict).toBe(true);
      expect(fs.readFileSync(path.join(workingDirectory, "merged.txt"), "utf8")).toContain(
        "<<<<<<< current",
      );

      await strategy.writeMergeConflictToIndex("file.txt", null, oursSha, theirsSha);
      const stageLines = (await strategy.exec(["ls-files", "-s", "--", "file.txt"]))
        .trim()
        .split("\n");
      expect(stageLines.map((line) => line.split(/\s+/)[2])).toEqual(["2", "3"]);
      expect(stageLines.every((line) => line.startsWith("100644"))).toBe(true);
    } finally {
      strategy.destroy();
      atom.repositories.forget(repository);
    }
  });

  it("builds the status bundle from the core status snapshot", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-status-bundle-")),
    );
    const repository = await atom.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const strategy = new GitShellOutStrategy(workingDirectory);

    try {
      await strategy.setConfig("user.name", "Git Panel Specs");
      await strategy.setConfig("user.email", "specs@lumine.invalid");
      fs.writeFileSync(path.join(workingDirectory, "a.txt"), "one\n");
      fs.writeFileSync(path.join(workingDirectory, "b.txt"), "two\n");
      await strategy.stageFiles(["a.txt", "b.txt"]);
      await strategy.commit("Initial commit", {});

      fs.writeFileSync(path.join(workingDirectory, "a.txt"), "one!\n");
      fs.writeFileSync(path.join(workingDirectory, "c.txt"), "three\n");
      await strategy.exec(["mv", "b.txt", "d.txt"]);

      const bundle = await strategy.getStatusBundle();
      expect(bundle.branch.head).toBe("main");
      expect(bundle.branch.aheadBehind).toEqual({ ahead: null, behind: null });
      expect(bundle.changedEntries.length).toBe(1);
      expect(bundle.changedEntries[0].filePath).toBe("a.txt");
      expect(bundle.changedEntries[0].unstagedStatus).toBe("M");
      expect(bundle.changedEntries[0].stagedStatus).toBeFalsy();
      expect(bundle.untrackedEntries).toEqual([{ filePath: "c.txt" }]);
      expect(bundle.renamedEntries.length).toBe(1);
      expect(bundle.renamedEntries[0].filePath).toBe("d.txt");
      expect(bundle.renamedEntries[0].origFilePath).toBe("b.txt");
      expect(bundle.renamedEntries[0].stagedStatus).toBe("R");
      expect(bundle.unmergedEntries).toEqual([]);

      // A bundle built right after a delegated write reuses the snapshot the registry
      // already refreshed instead of spawning another status subprocess.
      await strategy.stageFiles(["c.txt"]);
      const generation = repository.getStatusSnapshot().generation;
      const afterWrite = await strategy.getStatusBundle();
      expect(afterWrite.changedEntries.some((entry) => entry.filePath === "c.txt")).toBe(true);
      expect(repository.getStatusSnapshot().generation).toBe(generation);
    } finally {
      strategy.destroy();
      atom.repositories.forget(repository);
    }
  });

  it("refreshes panel status caches from core snapshot events", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-core-events-")),
    );
    const coreRepository = await atom.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const context = new WorkdirContext(workingDirectory);

    try {
      const panelRepository = context.getRepository();
      await panelRepository.getLoadPromise();
      await waitUntil(() => context.coreRepositoryLease);

      expect((await panelRepository.getStatusesForChangedFiles()).unstagedFiles).toEqual({});

      // A change observed by core (no panel filesystem watcher is running here) invalidates
      // the panel's cached status through the snapshot change event.
      fs.writeFileSync(path.join(workingDirectory, "external.txt"), "external\n");
      await coreRepository.refreshStatusSnapshot();

      await waitUntil(async () => {
        const { unstagedFiles } = await panelRepository.getStatusesForChangedFiles();
        return unstagedFiles["external.txt"] === "added";
      });
    } finally {
      await context.destroy();
      atom.repositories.forget(coreRepository);
    }
  });

  it("follows opened files with the window's active repository", async () => {
    const workdirA = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-active-a-")),
    );
    const workdirB = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-active-b-")),
    );
    const repoA = await atom.repositories.initialize(workdirA, { initialBranch: "main" });
    const repoB = await atom.repositories.initialize(workdirB, { initialBranch: "main" });

    try {
      fs.writeFileSync(path.join(workdirA, "a.txt"), "a\n");
      fs.writeFileSync(path.join(workdirB, "b.txt"), "b\n");

      await atom.workspace.open(path.join(workdirA, "a.txt"));
      expect(atom.repositories.getActiveRepository()).toBe(repoA);

      await atom.workspace.open(path.join(workdirB, "b.txt"));
      expect(atom.repositories.getActiveRepository()).toBe(repoB);

      // A pinned manual selection survives item changes; clearing it follows
      // the current item again.
      atom.repositories.setActiveRepository(repoA, { pin: true });
      await atom.workspace.open(path.join(workdirB, "b2.txt"));
      expect(atom.repositories.getActiveRepository()).toBe(repoA);
      expect(atom.repositories.isActiveRepositoryPinned()).toBe(true);

      atom.repositories.setActiveRepository(null);
      expect(atom.repositories.getActiveRepository()).toBe(repoB);
      expect(atom.repositories.isActiveRepositoryPinned()).toBe(false);
    } finally {
      atom.repositories.setActiveRepository(null);
      atom.repositories.forget(repoA);
      atom.repositories.forget(repoB);
    }
  });

  it("loads only native CSS stylesheets", () => {
    const packagePath = path.resolve(__dirname, "..");
    const pack = atom.packages.loadPackage(packagePath);

    try {
      pack.activateStylesheets();
      const styleElements = atom.styles
        .getStyleElements()
        .filter((element) => element.sourcePath?.startsWith(path.join(packagePath, "styles")));

      expect(styleElements.length).toBe(24);
      expect(styleElements.every((element) => element.sourcePath.endsWith(".css"))).toBe(true);
      expect(() => {
        for (const element of styleElements) {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync(element.textContent);
        }
      }).not.toThrow();
      for (const element of styleElements) {
        // Negated custom properties need calc(-1 * var(...)); a bare -var() is
        // invalid and the browser silently drops the whole declaration.
        expect(element.textContent).not.toMatch(/-var\(/);
      }
      expect(CSS.supports("color", "color-mix(in srgb, red 50%, blue)")).toBe(true);
      expect(CSS.supports("color", "hsl(from red calc(h + 80) s l)")).toBe(true);
    } finally {
      atom.packages.unloadPackage(pack.name);
    }
  });
});
