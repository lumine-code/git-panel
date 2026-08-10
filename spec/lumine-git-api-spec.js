/** @babel */

import fs from "fs";
import os from "os";
import path from "path";

import GitShellOutStrategy from "../lib/git-shell-out-strategy";
import ModelObserver from "../lib/models/model-observer";
import Repository from "../lib/models/repository";
import WorkdirContext from "../lib/models/workdir-context";
import { Keys } from "../lib/models/repository-states/cache/keys";

// A tick budget, not a wall-clock one: the specs run with the clock frozen, so
// setImmediate turns are all there is to wait on. The condition is usually met
// within a handful, but a git worker round trip is real I/O — 500 turns burn
// away in a millisecond or two and expire before the answer comes back. 10000
// matches the other suites here and costs nothing when the wait is short.
async function waitUntil(check, attempts = 10000) {
  for (let i = 0; i < attempts; i++) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Condition was not met");
}

describe("Lumine Git transport", () => {
  it("reads effective Git config without a repository", async () => {
    spyOn(lumine.repositories, "add").and.returnValue(Promise.resolve(null));
    const executeGit = spyOn(lumine.repositories, "executeGit").and.callFake((args) => {
      const configured = args[args.length - 1] === "user.name";
      return Promise.resolve({
        stdout: configured ? "Global Author\0" : "",
        stderr: "",
        exitCode: configured ? 0 : 1,
      });
    });
    const strategy = new GitShellOutStrategy(path.parse(process.cwd()).root);

    try {
      expect(await strategy.getConfig("user.name")).toBe("Global Author");
      expect(executeGit.calls.mostRecent().args[0].slice(-4)).toEqual([
        "config",
        "-z",
        "--get",
        "user.name",
      ]);
      expect(await strategy.getConfig("identity.not-configured")).toBeNull();
    } finally {
      strategy.destroy();
    }
  });

  it("provides a github bridge exposing the diff pipeline and active-context accessors", () => {
    const bridgeModule = require("../lib/github-bridge");
    const createGitHubBridge = bridgeModule.default || bridgeModule;
    const fakePool = {};
    const pack = {
      getRepositoryForWorkdir: () => "repo",
      getContextPool: () => fakePool,
      getActiveRepository: () => "active-repo",
      getActiveWorkdir: () => "/work",
      isContextLocked: () => true,
      scheduleActiveContextUpdate: () => "scheduled",
      openGitTab: () => "opened",
      openCloneDialog: () => "clone-dialog",
      openInitializeDialog: () => "init-dialog",
      clone: (url) => `cloned ${url}`,
      onDidUpdate: () => "disposable",
    };
    const bridge = createGitHubBridge(pack);

    // Diff → MultiFilePatch pipeline, parsed with git-panel's own parser.
    expect(typeof bridge.filterDiff).toBe("function");
    expect(typeof bridge.buildMultiFilePatch).toBe("function");
    const parsed = bridge.parseDiff("diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-a\n+b\n");
    expect(parsed[0].newPath).toBe("a.txt");
    expect(typeof bridge.MultiFilePatchController).toBe("function");

    // Active-context accessors delegate to the package.
    expect(bridge.getContextPool()).toBe(fakePool);
    expect(bridge.getActiveRepository()).toBe("active-repo");
    expect(bridge.getActiveWorkdir()).toBe("/work");
    expect(bridge.openGitTab()).toBe("opened");
    expect(bridge.openCloneDialog()).toBe("clone-dialog");
    expect(bridge.clone("git://x")).toBe("cloned git://x");
  });

  it("stages through the panel repository model and its composite strategy proxy", async () => {
    // The model wraps strategies in the firstImplementer Proxy, so `this`
    // inside delegated operations is the proxy rather than the strategy.
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-model-stage-")),
    );
    const coreRepository = await lumine.repositories.initialize(workingDirectory, {
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
      lumine.repositories.forget(coreRepository);
    }
  });

  it("undoes the last commit and restages its files", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-undo-commit-")),
    );
    const coreRepository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const panelRepository = new Repository(workingDirectory);

    try {
      await panelRepository.getLoadPromise();
      await panelRepository.setConfig("user.name", "Lumine Specs");
      await panelRepository.setConfig("user.email", "specs@lumine.invalid");

      fs.writeFileSync(path.join(workingDirectory, "first.txt"), "first\n");
      await panelRepository.stageFiles(["first.txt"]);
      await panelRepository.commit("First commit");
      fs.writeFileSync(path.join(workingDirectory, "second.txt"), "second\n");
      await panelRepository.stageFiles(["second.txt"]);
      await panelRepository.commit("Second commit");

      await panelRepository.undoLastCommit();

      // HEAD moved back one commit and the undone commit's files are staged.
      const lastCommit = await panelRepository.getLastCommit();
      expect(lastCommit.getMessageSubject()).toBe("First commit");
      const statuses = await panelRepository.getStatusesForChangedFiles();
      expect(statuses.stagedFiles["second.txt"]).toBe("added");
    } finally {
      panelRepository.destroy();
      lumine.repositories.forget(coreRepository);
    }
  });

  it("lists submodule paths once across repeated discards", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-submodule-cache-")),
    );
    const coreRepository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const panelRepository = new Repository(workingDirectory);

    const originalGetSubmodulePaths = coreRepository.getSubmodulePaths.bind(coreRepository);
    let submoduleListings = 0;
    coreRepository.getSubmodulePaths = (...args) => {
      submoduleListings++;
      return originalGetSubmodulePaths(...args);
    };

    // Both files exist before the initial load: a bare Repository has no
    // filesystem watcher, so only files present at load (or writes routed
    // through the model) are visible to its cached status.
    fs.writeFileSync(path.join(workingDirectory, "one.txt"), "one\n");
    fs.writeFileSync(path.join(workingDirectory, "two.txt"), "two\n");

    try {
      await panelRepository.getLoadPromise();
      await panelRepository.discardWorkDirChangesForPaths(["one.txt"]);
      await panelRepository.discardWorkDirChangesForPaths(["two.txt"]);

      // `git submodule status` runs once; the second discard reads the cache.
      expect(submoduleListings).toBe(1);
      expect(fs.existsSync(path.join(workingDirectory, "one.txt"))).toBe(false);
      expect(fs.existsSync(path.join(workingDirectory, "two.txt"))).toBe(false);
    } finally {
      panelRepository.destroy();
      lumine.repositories.forget(coreRepository);
    }
  });

  it("ignores .git internals that are not watched cache signals", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-reflog-events-")),
    );
    const coreRepository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const panelRepository = new Repository(workingDirectory);

    try {
      await panelRepository.getLoadPromise();
      await panelRepository.getStatusBundle();
      expect(panelRepository.getCache().storage.has("status-bundle")).toBe(true);

      let updates = 0;
      const subscription = panelRepository.onDidUpdate(() => updates++);

      // A reflog append (every commit, reset, pull) is not a cache signal: it
      // must neither invalidate the status bundle nor trigger a refetch round.
      panelRepository.observeFilesystemChange([
        { path: path.join(workingDirectory, ".git", "logs", "HEAD"), action: "modified" },
      ]);
      expect(updates).toBe(0);
      expect(panelRepository.getCache().storage.has("status-bundle")).toBe(true);

      // A real ref event still invalidates and repaints.
      panelRepository.observeFilesystemChange([
        { path: path.join(workingDirectory, ".git", "refs", "heads", "main"), action: "modified" },
      ]);
      expect(updates).toBe(1);

      subscription.dispose();
    } finally {
      panelRepository.destroy();
      lumine.repositories.forget(coreRepository);
    }
  });

  it("only resets the commit message when the template actually changed", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-commit-template-")),
    );
    const coreRepository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const panelRepository = new Repository(workingDirectory);
    const configEvent = [
      { path: path.join(workingDirectory, ".git", "config"), action: "modified" },
    ];

    try {
      await panelRepository.getLoadPromise();

      // A config write with no template configured — what every discard's
      // history save produces — must not wipe a typed message.
      panelRepository.setCommitMessage("WIP");
      await panelRepository.updateCommitMessageAfterFileSystemChange(configEvent);
      expect(panelRepository.getCommitMessage()).toBe("WIP");

      // A template appearing while the box is clean is adopted.
      const templatePath = path.join(workingDirectory, "template.txt");
      fs.writeFileSync(templatePath, "TEMPLATE\n");
      await panelRepository.setConfig("commit.template", templatePath);
      panelRepository.setCommitMessage("");
      await panelRepository.updateCommitMessageAfterFileSystemChange(configEvent);
      expect(panelRepository.getCommitMessage()).toBe("TEMPLATE\n");

      // The template disappearing while the box still equals it clears the box.
      await panelRepository.unsetConfig("commit.template");
      await panelRepository.updateCommitMessageAfterFileSystemChange(configEvent);
      expect(panelRepository.getCommitMessage()).toBe("");

      // The template disappearing under a user-modified box preserves it.
      await panelRepository.setConfig("commit.template", templatePath);
      await panelRepository.updateCommitMessageAfterFileSystemChange(configEvent);
      expect(panelRepository.getCommitMessage()).toBe("TEMPLATE\n");
      panelRepository.setCommitMessage("TEMPLATE\nplus my notes");
      await panelRepository.unsetConfig("commit.template");
      await panelRepository.updateCommitMessageAfterFileSystemChange(configEvent);
      expect(panelRepository.getCommitMessage()).toBe("TEMPLATE\nplus my notes");
    } finally {
      panelRepository.destroy();
      lumine.repositories.forget(coreRepository);
    }
  });

  it("drops cached status and repaints through the acceptInvalidation delegate", async () => {
    // proceedWithLastDiscardUndo restores files with plain fs calls and then
    // invalidates the restored paths through this delegate — pin the contract.
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-accept-invalidation-")),
    );
    const coreRepository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const panelRepository = new Repository(workingDirectory);

    try {
      await panelRepository.getLoadPromise();
      await panelRepository.getStatusBundle();
      expect(panelRepository.getCache().storage.has("status-bundle")).toBe(true);

      let updates = 0;
      const subscription = panelRepository.onDidUpdate(() => updates++);
      panelRepository.acceptInvalidation(() => Keys.workdirOperationKeys(["a.txt"]));

      expect(updates).toBe(1);
      expect(panelRepository.getCache().storage.has("status-bundle")).toBe(false);
      subscription.dispose();
    } finally {
      panelRepository.destroy();
      lumine.repositories.forget(coreRepository);
    }
  });

  it("shares one in-flight status refresh between concurrent bundle rebuilds", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-status-refresh-share-")),
    );
    const coreRepository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const strategy = new GitShellOutStrategy(workingDirectory);

    try {
      // Consume the initial generation so both concurrent reads below fall
      // into the awaited-refresh branch.
      await strategy.getStatusBundle();

      const originalRefresh = coreRepository.refreshStatusSnapshot.bind(coreRepository);
      let refreshes = 0;
      coreRepository.refreshStatusSnapshot = (...args) => {
        refreshes++;
        return originalRefresh(...args);
      };

      const [bundleA, bundleB] = await Promise.all([
        strategy.getStatusBundle(),
        strategy.getStatusBundle(),
      ]);

      expect(refreshes).toBe(1);
      expect(bundleA).toEqual(bundleB);
    } finally {
      strategy.destroy();
      lumine.repositories.forget(coreRepository);
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
    const coreRepository = await lumine.repositories.initialize(workingDirectory, {
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
      lumine.repositories.forget(coreRepository);
    }
  });

  it("executes with Lumine's embedded Git without a package-local Dugite", async () => {
    const strategy = new GitShellOutStrategy(process.cwd());

    try {
      const output = await strategy.exec(["--version"]);
      expect(output).toMatch(/^git version /);
      expect(lumine.repositories.getGitExecutablePath()).toBeTruthy();
    } finally {
      strategy.destroy();
    }
  });

  it("resolves no repository once the environment has dropped its registry", async () => {
    // A window reload destroys the environment without deactivating packages
    // first, so panel reads can still be in flight when `lumine.repositories`
    // goes away. They have to resolve to "no repository" rather than crash.
    const strategy = new GitShellOutStrategy(process.cwd());
    const registry = lumine.repositories;

    try {
      lumine.repositories = null;
      expect(await strategy.getCoreRepository()).toBeNull();
      expect(await strategy.getRepositoryOperations()).toBeNull();
      expect(await strategy.getUntrackedFiles()).toEqual([]);
      expect(await strategy.getRefsSnapshot()).toBeNull();
    } finally {
      lumine.repositories = registry;
      strategy.destroy();
    }
  });

  it("delegates write operations to lumine.repositories and refreshes core state", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-operations-")),
    );
    const repository = await lumine.repositories.initialize(workingDirectory, {
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
      lumine.repositories.forget(repository);
    }
  });

  it("drives staging, branches, and conflict plumbing through lumine.repositories", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-plumbing-")),
    );
    const repository = await lumine.repositories.initialize(workingDirectory, {
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

      // Index reads resolve through the core getFileAtRevision(":path").
      expect(await strategy.readFileFromIndex("file.txt")).toBe("base\n");

      await strategy.checkout("feature", { createNew: true });
      expect((await strategy.exec(["branch", "--show-current"])).trim()).toBe("feature");

      // Blob and conflict plumbing used by the discard history. The two blob
      // creations run concurrently through the panel queue (createBlob is not
      // a writeOperation) and must both land intact.
      const [oursSha, theirsSha] = await Promise.all([
        strategy.createBlob({ stdin: "ours\n" }),
        strategy.createBlob({ stdin: "theirs\n" }),
      ]);
      expect(await strategy.getBlobContents(oursSha)).toBe("ours\n");
      expect(await strategy.getBlobContents(theirsSha)).toBe("theirs\n");
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
      lumine.repositories.forget(repository);
    }
  });

  it("reads branches, remotes, and config through the core typed APIs", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-reads-")),
    );
    const repository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const strategy = new GitShellOutStrategy(workingDirectory);

    try {
      await strategy.setConfig("user.name", "Git Panel Specs");
      await strategy.setConfig("user.email", "specs@lumine.invalid");
      fs.writeFileSync(path.join(workingDirectory, "a.txt"), "one\n");
      await strategy.stageFiles(["a.txt"]);
      await strategy.commit("Initial commit", {});

      await strategy.addRemote("origin", "https://example.com/repo.git");
      await strategy.setConfig("branch.main.remote", "origin");
      await strategy.setConfig("branch.main.merge", "refs/heads/main");
      await repository.refreshRefsSnapshot();

      const branches = await strategy.getBranches();
      const main = branches.find((branch) => branch.name === "main");
      expect(main.head).toBe(true);
      expect(main.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(main.upstream).toEqual({
        trackingRef: "refs/remotes/origin/main",
        remoteName: "origin",
        remoteRef: "refs/heads/main",
      });

      expect(await strategy.getRemotes()).toEqual([
        { name: "origin", url: "https://example.com/repo.git" },
      ]);

      expect(await strategy.getConfig("user.name")).toBe("Git Panel Specs");
      expect(await strategy.getConfig("does.not.exist")).toBeNull();

      // Niche reads now routed through typed core wrappers.
      expect(await strategy.describeHead()).toMatch(/\S/);
      expect(await strategy.getBranchesWithCommit(main.sha)).toContain("refs/heads/main");
      expect(await strategy.getSubmodulePaths()).toEqual([]);
      expect(await strategy.getFileMode("a.txt")).toBe("100644");
      expect(await strategy.resolveDotGitDir()).toContain(".git");
    } finally {
      strategy.destroy();
      lumine.repositories.forget(repository);
    }
  });

  it("reads commit history, patches, and co-authors through the core log APIs", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-log-")),
    );
    const repository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const strategy = new GitShellOutStrategy(workingDirectory);

    try {
      await strategy.setConfig("user.name", "Author One");
      await strategy.setConfig("user.email", "one@example.com");
      fs.writeFileSync(path.join(workingDirectory, "a.txt"), "one\n");
      await strategy.stageFiles(["a.txt"]);
      await strategy.commit("First commit", {
        coAuthors: [{ name: "Co Author", email: "co@example.com" }],
      });

      const head = await strategy.getHeadCommit();
      expect(head.unbornRef).toBe(false);
      expect(head.messageSubject).toBe("First commit");
      expect(head.authorDate).toBeGreaterThan(0);
      expect(head.coAuthors.length).toBe(1);

      // includePatch diffs a root commit against the empty tree.
      const [withPatch] = await strategy.getCommits({
        max: 1,
        ref: head.sha,
        includePatch: true,
      });
      expect(withPatch.patch.length).toBe(1);
      expect(withPatch.patch[0].status).toBe("added");
      expect(withPatch.patch[0].newPath).toBe("a.txt");

      // getAuthors aggregates authors and co-author trailers into a name map.
      const authors = await strategy.getAuthors({ max: 10 });
      expect(authors["one@example.com"]).toBe("Author One");
      expect(authors["co@example.com"]).toBe("Co Author");
    } finally {
      strategy.destroy();
      lumine.repositories.forget(repository);
    }
  });

  it("reports an unborn repository as an empty commit history", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-unborn-log-")),
    );
    const repository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const strategy = new GitShellOutStrategy(workingDirectory);

    try {
      expect(await strategy.getHeadCommit()).toEqual({ sha: "", message: "", unbornRef: true });
      expect(await strategy.getCommits({ max: 5 })).toEqual([]);
      expect(await strategy.getAuthors()).toEqual({});
    } finally {
      strategy.destroy();
      lumine.repositories.forget(repository);
    }
  });

  it("reads file diffs and per-file status through the core diff APIs", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-diff-")),
    );
    const repository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const strategy = new GitShellOutStrategy(workingDirectory);

    try {
      await strategy.setConfig("user.name", "Author One");
      await strategy.setConfig("user.email", "one@example.com");
      fs.writeFileSync(path.join(workingDirectory, "tracked.txt"), "one\ntwo\n");
      await strategy.stageFiles(["tracked.txt"]);
      await strategy.commit("seed", {});

      fs.writeFileSync(path.join(workingDirectory, "tracked.txt"), "one\nTWO\n");
      fs.writeFileSync(path.join(workingDirectory, "new.txt"), "brand new\n");
      fs.writeFileSync(path.join(workingDirectory, "staged.txt"), "staged\n");
      await strategy.stageFiles(["staged.txt"]);
      await repository.refreshStatusSnapshot();

      expect(await strategy.getUntrackedFiles()).toEqual(["new.txt"]);

      const unstaged = await strategy.getDiffsForFilePath("tracked.txt", { staged: false });
      expect(unstaged.length).toBe(1);
      expect(unstaged[0].newPath).toBe("tracked.txt");
      expect(unstaged[0].hunks[0].lines).toContain("-two");
      expect(unstaged[0].hunks[0].lines).toContain("+TWO");

      // An untracked file is synthesized as an added patch from disk.
      const untracked = await strategy.getDiffsForFilePath("new.txt", { staged: false });
      expect(untracked.length).toBe(1);
      expect(untracked[0].status).toBe("added");
      expect(untracked[0].newPath).toBe("new.txt");

      // A staged addition diffs against the empty tree base when needed.
      const staged = await strategy.getDiffsForFilePath("staged.txt", { staged: true });
      expect(staged[0].status).toBe("added");

      const stagedPatch = await strategy.getStagedChangesPatch();
      expect(stagedPatch.some((diff) => diff.newPath === "staged.txt")).toBe(true);

      const statusToHead = await strategy.diffFileStatus({ target: "HEAD" });
      expect(statusToHead["tracked.txt"]).toBe("modified");
      expect(statusToHead["staged.txt"]).toBe("added");
      expect(statusToHead["new.txt"]).toBe("added");
    } finally {
      strategy.destroy();
      lumine.repositories.forget(repository);
    }
  });

  it("stages and unstages all changes through the panel repository model", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-stageall-")),
    );
    const coreRepository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const context = new WorkdirContext(workingDirectory);

    const stagedNames = async () =>
      Object.keys((await panelRepository.getStatusesForChangedFiles()).stagedFiles).sort();
    const unstagedNames = async () =>
      Object.keys((await panelRepository.getStatusesForChangedFiles()).unstagedFiles).sort();
    let panelRepository;

    try {
      panelRepository = context.getRepository();
      await panelRepository.getLoadPromise();
      await waitUntil(() => context.coreRepositoryLease);

      await coreRepository.getOperations().setConfig("user.name", "Git Panel Specs");
      await coreRepository.getOperations().setConfig("user.email", "specs@lumine.invalid");
      fs.writeFileSync(path.join(workingDirectory, "a.txt"), "1\n");
      fs.writeFileSync(path.join(workingDirectory, "b.txt"), "1\n");
      await panelRepository.stageFiles(["a.txt", "b.txt"]);
      await panelRepository.commit("seed", {});

      fs.writeFileSync(path.join(workingDirectory, "a.txt"), "2\n");
      fs.writeFileSync(path.join(workingDirectory, "b.txt"), "2\n");
      await coreRepository.refreshStatusSnapshot();
      await waitUntil(async () => (await unstagedNames()).length === 2);

      // Stage All uses the "." pathspec through the model.
      await panelRepository.stageFiles(["."]);
      await waitUntil(async () => (await stagedNames()).length === 2);
      expect(await stagedNames()).toEqual(["a.txt", "b.txt"]);

      // Unstage All uses the "." pathspec through the model. The model must fire
      // onDidUpdate so ObserveModel re-fetches and the panel re-renders (the
      // button disables and the files move back to the unstaged list).
      let updateCount = 0;
      const updateSub = panelRepository.onDidUpdate(() => {
        updateCount++;
      });
      await panelRepository.unstageFiles(["."]);
      await waitUntil(async () => (await stagedNames()).length === 0);
      updateSub.dispose();
      expect(await unstagedNames()).toEqual(["a.txt", "b.txt"]);
      expect(updateCount).toBeGreaterThan(0);
    } finally {
      await context.destroy();
      lumine.repositories.forget(coreRepository);
    }
  });

  it("reuses the post-stage status snapshot for the panel refresh", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-stage-refresh-")),
    );
    const coreRepository = await lumine.repositories.initialize(workingDirectory, {
      initialBranch: "main",
    });
    const context = new WorkdirContext(workingDirectory);
    let observer;
    let originalRefresh;

    try {
      const panelRepository = context.getRepository();
      await panelRepository.getLoadPromise();
      await waitUntil(() => context.coreRepositoryLease);

      fs.writeFileSync(path.join(workingDirectory, "a.txt"), "one\n");
      await coreRepository.refreshStatusSnapshot();

      observer = new ModelObserver({
        fetchData: async (repository) => ({
          unstaged: await repository.getUnstagedChanges(),
          staged: await repository.getStagedChanges(),
        }),
      });
      observer.setActiveModel(panelRepository);
      await waitUntil(() => observer.getActiveModelData()?.unstaged.length === 1);

      originalRefresh = coreRepository.refreshStatusSnapshot.bind(coreRepository);
      let refreshCount = 0;
      coreRepository.refreshStatusSnapshot = (...args) => {
        refreshCount++;
        return originalRefresh(...args);
      };

      await panelRepository.stageFiles(["a.txt"]);
      await waitUntil(() => observer.getActiveModelData()?.staged.length === 1);

      expect(refreshCount).toBe(1);
    } finally {
      observer?.destroy();
      if (originalRefresh) {
        coreRepository.refreshStatusSnapshot = originalRefresh;
      }
      await context.destroy();
      lumine.repositories.forget(coreRepository);
    }
  });

  it("builds the status bundle from the core status snapshot", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-status-bundle-")),
    );
    const repository = await lumine.repositories.initialize(workingDirectory, {
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
      lumine.repositories.forget(repository);
    }
  });

  it("refreshes panel status caches from core snapshot events", async () => {
    const workingDirectory = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-core-events-")),
    );
    const coreRepository = await lumine.repositories.initialize(workingDirectory, {
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
      lumine.repositories.forget(coreRepository);
    }
  });

  it("follows opened files with the window's active repository", async () => {
    const workdirA = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-active-a-")),
    );
    const workdirB = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "git-panel-active-b-")),
    );
    const repoA = await lumine.repositories.initialize(workdirA, { initialBranch: "main" });
    const repoB = await lumine.repositories.initialize(workdirB, { initialBranch: "main" });

    try {
      fs.writeFileSync(path.join(workdirA, "a.txt"), "a\n");
      fs.writeFileSync(path.join(workdirB, "b.txt"), "b\n");

      await lumine.workspace.open(path.join(workdirA, "a.txt"));
      expect(lumine.repositories.getActiveRepository()).toBe(repoA);

      await lumine.workspace.open(path.join(workdirB, "b.txt"));
      expect(lumine.repositories.getActiveRepository()).toBe(repoB);

      // A pinned manual selection survives item changes; clearing it follows
      // the current item again.
      lumine.repositories.setActiveRepository(repoA, { pin: true });
      await lumine.workspace.open(path.join(workdirB, "b2.txt"));
      expect(lumine.repositories.getActiveRepository()).toBe(repoA);
      expect(lumine.repositories.isActiveRepositoryPinned()).toBe(true);

      lumine.repositories.setActiveRepository(null);
      expect(lumine.repositories.getActiveRepository()).toBe(repoB);
      expect(lumine.repositories.isActiveRepositoryPinned()).toBe(false);
    } finally {
      lumine.repositories.setActiveRepository(null);
      lumine.repositories.forget(repoA);
      lumine.repositories.forget(repoB);
    }
  });

  it("loads only native CSS stylesheets", () => {
    const packagePath = path.resolve(__dirname, "..");
    const pack = lumine.packages.loadPackage(packagePath);

    try {
      pack.activateStylesheets();
      const styleElements = lumine.styles
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
      lumine.packages.unloadPackage(pack.name);
    }
  });
});
