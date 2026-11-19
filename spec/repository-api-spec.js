/** @babel */
// Converted from repository-api.test.js (node:test/node:assert → Jasmine).
import {
  getRepositoryWorkingDirectory,
  resolveRepositoryForDirectory,
  resolveRepositoryForPath,
} from "../lib/repository-api.js";

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
});
