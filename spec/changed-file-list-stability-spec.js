/** @babel */
import { Emitter } from "lumine";

import Repository from "../lib/models/repository.js";
import ModelObserver from "../lib/models/model-observer.js";

function repositoryWithBundle(bundle = {}) {
  const fixture = {
    bundle: { unstagedFiles: {}, stagedFiles: {}, mergeConflictFiles: {}, ...bundle },
    repository: Object.create(Repository.prototype),
  };
  fixture.repository.getStatusBundle = jasmine
    .createSpy("read status bundle")
    .and.callFake(async () => {
      // Each read has the same object allocation pattern as a fresh status snapshot.
      return structuredClone(fixture.bundle);
    });
  return fixture;
}

const conflict = () => ({ ours: "modified", theirs: "added", file: "modified" });

describe("changed file list stability", () => {
  const lists = [
    { method: "getUnstagedChanges", field: "unstagedFiles", status: () => "modified" },
    { method: "getStagedChanges", field: "stagedFiles", status: () => "added" },
    { method: "getMergeConflicts", field: "mergeConflictFiles", status: conflict },
  ];

  for (const { method, field, status } of lists) {
    it(`reuses ${field} when a new bundle describes the same rows`, async () => {
      const { repository } = repositoryWithBundle({ [field]: { "file.txt": status() } });

      const initial = await repository[method]();
      const next = await repository[method]();

      expect(repository.getStatusBundle).toHaveBeenCalledTimes(2);
      expect(next).toBe(initial);
      expect(next[0]).toBe(initial[0]);
    });

    it(`replaces ${field} when a file is renamed or removed`, async () => {
      const fixture = repositoryWithBundle({ [field]: { "before.txt": status() } });
      const initial = await fixture.repository[method]();

      fixture.bundle[field] = { "after.txt": status() };
      const renamed = await fixture.repository[method]();
      expect(renamed).not.toBe(initial);
      expect(renamed.map(({ filePath }) => filePath)).toEqual(["after.txt"]);

      fixture.bundle[field] = {};
      const removed = await fixture.repository[method]();
      expect(removed).not.toBe(renamed);
      expect(removed).toEqual([]);
      expect(await fixture.repository[method]()).toBe(removed);
    });

    it(`keeps ${field} caches independent between repositories`, async () => {
      const first = repositoryWithBundle({ [field]: { "file.txt": status() } });
      const second = repositoryWithBundle({ [field]: { "file.txt": status() } });
      const firstRows = await first.repository[method]();
      const secondRows = await second.repository[method]();

      expect(secondRows).not.toBe(firstRows);
      expect(secondRows).toEqual(firstRows);
      first.bundle[field] = {};
      await first.repository[method]();
      expect(await second.repository[method]()).toBe(secondRows);
    });
  }

  for (const { method, field } of lists.slice(0, 2)) {
    it(`replaces ${field} when an existing row changes status`, async () => {
      const fixture = repositoryWithBundle({ [field]: { "file.txt": "modified" } });
      const initial = await fixture.repository[method]();

      fixture.bundle[field]["file.txt"] = "deleted";
      const next = await fixture.repository[method]();

      expect(next).not.toBe(initial);
      expect(next).toEqual([{ filePath: "file.txt", status: "deleted" }]);
      expect(initial).toEqual([{ filePath: "file.txt", status: "modified" }]);
    });

    it(`preserves alphabetical ${field} ordering across different insertion orders`, async () => {
      const fixture = repositoryWithBundle({
        [field]: { "z.txt": "modified", "a.txt": "added" },
      });
      const initial = await fixture.repository[method]();
      expect(initial.map(({ filePath }) => filePath)).toEqual(["a.txt", "z.txt"]);

      fixture.bundle[field] = { "a.txt": "added", "z.txt": "modified" };
      expect(await fixture.repository[method]()).toBe(initial);
    });
  }

  for (const field of ["ours", "theirs", "file"]) {
    it(`replaces a conflict list when its ${field} status changes`, async () => {
      const fixture = repositoryWithBundle({ mergeConflictFiles: { "file.txt": conflict() } });
      const initial = await fixture.repository.getMergeConflicts();
      const previous = structuredClone(initial);

      fixture.bundle.mergeConflictFiles["file.txt"][field] = "deleted";
      const next = await fixture.repository.getMergeConflicts();

      expect(next).not.toBe(initial);
      expect(next[0].status[field]).toBe("deleted");
      expect(initial).toEqual(previous);
      expect(await fixture.repository.getMergeConflicts()).toBe(next);
    });
  }

  it("preserves the conflict bundle's row ordering", async () => {
    const fixture = repositoryWithBundle({
      mergeConflictFiles: { "z.txt": conflict(), "a.txt": conflict() },
    });
    const initial = await fixture.repository.getMergeConflicts();
    expect(initial.map(({ filePath }) => filePath)).toEqual(["z.txt", "a.txt"]);

    fixture.bundle.mergeConflictFiles = { "a.txt": conflict(), "z.txt": conflict() };
    const reordered = await fixture.repository.getMergeConflicts();
    expect(reordered).not.toBe(initial);
    expect(reordered.map(({ filePath }) => filePath)).toEqual(["a.txt", "z.txt"]);
  });

  it("keeps the three lists independent in one repository", async () => {
    const fixture = repositoryWithBundle({
      unstagedFiles: { "file.txt": "modified" },
      stagedFiles: { "file.txt": "added" },
      mergeConflictFiles: { "file.txt": conflict() },
    });
    const initial = await Promise.all(lists.map(({ method }) => fixture.repository[method]()));
    expect(initial[0]).not.toBe(initial[1]);
    expect(initial[1]).not.toBe(initial[2]);

    fixture.bundle.unstagedFiles["file.txt"] = "deleted";
    const next = await Promise.all(lists.map(({ method }) => fixture.repository[method]()));
    expect(next[0]).not.toBe(initial[0]);
    expect(next[1]).toBe(initial[1]);
    expect(next[2]).toBe(initial[2]);
  });

  it("retains the displayed lists through a generic model update", async () => {
    const { repository } = repositoryWithBundle({
      unstagedFiles: { "worktree.txt": "modified" },
      stagedFiles: { "index.txt": "added" },
      mergeConflictFiles: { "conflict.txt": conflict() },
    });
    const emitter = new Emitter();
    repository.isDestroyed = () => false;
    repository.onDidUpdate = (callback) => emitter.on("update", callback);
    const observer = new ModelObserver({
      fetchData: async (model) => Promise.all(lists.map(({ method }) => model[method]())),
    });
    try {
      await observer.setActiveModel(repository);
      const initial = observer.getActiveModelData();

      emitter.emit("update");
      await observer.getLastModelDataRefreshPromise();
      const next = observer.getActiveModelData();

      for (let index = 0; index < lists.length; index++) expect(next[index]).toBe(initial[index]);
    } finally {
      observer.destroy();
      emitter.dispose();
    }
  });
});
