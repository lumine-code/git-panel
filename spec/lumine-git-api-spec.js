/** @babel */
/* global describe, expect, it */

import fs from "fs";
import os from "os";
import path from "path";

import GitShellOutStrategy from "../lib/git-shell-out-strategy";

describe("Lumine Git transport", () => {
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

  it("loads only native CSS stylesheets", () => {
    const packagePath = path.resolve(__dirname, "..");
    const pack = atom.packages.loadPackage(packagePath);

    try {
      pack.activateStylesheets();
      const styleElements = atom.styles
        .getStyleElements()
        .filter((element) => element.sourcePath?.startsWith(path.join(packagePath, "styles")));

      expect(styleElements.length).toBe(25);
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
