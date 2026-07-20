/** @babel */
/* global describe, it, expect */
// Converted from repository-api.test.js (node:test/node:assert → Jasmine).
import {
  getRepositoryWorkingDirectory,
  refreshRepository,
  refreshRepositoryForPath,
  resolveRepositoryForDirectory,
  resolveRepositoryForPath,
} from "../lib/repository-api";

describe("repository-api", () => {
  it("reads a repository working directory through the Lumine API", () => {
    const repository = { getWorkingDirectory: () => "/worktree" };
    expect(getRepositoryWorkingDirectory(repository)).toBe("/worktree");
    expect(getRepositoryWorkingDirectory(null)).toBeNull();
  });

  it("handles a repository that has already been destroyed", () => {
    const repository = {
      getWorkingDirectory: () => {
        throw new Error("Repository has been destroyed");
      },
    };

    expect(getRepositoryWorkingDirectory(repository)).toBeNull();
  });

  it("uses an already registered repository for a path", async () => {
    const repository = {};
    const repositories = {
      getForPath: () => repository,
      resolveForPath: () => {
        throw new Error("should not resolve a cached repository");
      },
    };

    expect(await resolveRepositoryForPath(repositories, "/worktree/file.js")).toBe(repository);
  });

  it("resolves an unknown path through the registry", async () => {
    const repository = {};
    const repositories = {
      getForPath: () => null,
      resolveForPath: async () => repository,
    };

    expect(await resolveRepositoryForPath(repositories, "/worktree/file.js")).toBe(repository);
  });

  it("resolves a directory through the registry", async () => {
    const repository = {};
    const directory = { getPath: () => "/worktree" };
    const repositories = {
      getForPath: () => null,
      resolveDirectory: async (candidate) => {
        expect(candidate).toBe(directory);
        return repository;
      },
    };

    expect(await resolveRepositoryForDirectory(repositories, directory)).toBe(repository);
  });

  it("refreshes the Lumine repository caches and initialized snapshots", async () => {
    let indexRefreshCount = 0;
    let legacyStatusRefreshCount = 0;
    let statusRefreshCount = 0;
    let refsRefreshCount = 0;
    const repository = {
      refreshIndex: () => indexRefreshCount++,
      refreshStatus: async () => legacyStatusRefreshCount++,
      getStatusSnapshot: () => ({ initialized: true }),
      refreshStatusSnapshot: async () => statusRefreshCount++,
      getRefsSnapshot: () => ({ initialized: true }),
      refreshRefsSnapshot: async () => refsRefreshCount++,
    };

    expect(await refreshRepository(repository)).toBe(repository);
    expect(indexRefreshCount).toBe(1);
    expect(legacyStatusRefreshCount).toBe(1);
    expect(statusRefreshCount).toBe(1);
    expect(refsRefreshCount).toBe(1);
  });

  it("keeps uninitialized Lumine repository snapshots lazy", async () => {
    const repository = {
      getStatusSnapshot: () => ({ initialized: false }),
      refreshStatusSnapshot: () => {
        throw new Error("should not load the status snapshot");
      },
      getRefsSnapshot: () => ({ initialized: false }),
      refreshRefsSnapshot: () => {
        throw new Error("should not load the refs snapshot");
      },
    };

    expect(await refreshRepository(repository)).toBe(repository);
  });

  it("refreshes the Lumine repository for a path", async () => {
    let refreshCount = 0;
    const repository = { refreshStatus: async () => refreshCount++ };
    const repositories = {
      getForPath: () => repository,
      resolveForPath: () => {
        throw new Error("should not resolve a cached repository");
      },
    };

    expect(await refreshRepositoryForPath(repositories, "/worktree")).toBe(repository);
    expect(refreshCount).toBe(1);
  });
});
