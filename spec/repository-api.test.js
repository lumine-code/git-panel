const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getRepositoryWorkingDirectory,
  refreshRepository,
  refreshRepositoryForPath,
  resolveRepositoryForDirectory,
  resolveRepositoryForPath,
} = require("../lib/repository-api");

test("reads a repository working directory through the Lumine API", () => {
  const repository = { getWorkingDirectory: () => "/worktree" };
  assert.equal(getRepositoryWorkingDirectory(repository), "/worktree");
  assert.equal(getRepositoryWorkingDirectory(null), null);
});

test("handles a repository that has already been destroyed", () => {
  const repository = {
    getWorkingDirectory: () => {
      throw new Error("Repository has been destroyed");
    },
  };

  assert.equal(getRepositoryWorkingDirectory(repository), null);
});

test("uses an already registered repository for a path", async () => {
  const repository = {};
  const repositories = {
    getForPath: () => repository,
    resolveForPath: () => assert.fail("should not resolve a cached repository"),
  };

  assert.equal(await resolveRepositoryForPath(repositories, "/worktree/file.js"), repository);
});

test("resolves an unknown path through the registry", async () => {
  const repository = {};
  const repositories = {
    getForPath: () => null,
    resolveForPath: async () => repository,
  };

  assert.equal(await resolveRepositoryForPath(repositories, "/worktree/file.js"), repository);
});

test("resolves a directory through the registry", async () => {
  const repository = {};
  const directory = { getPath: () => "/worktree" };
  const repositories = {
    getForPath: () => null,
    resolveDirectory: async (candidate) => {
      assert.equal(candidate, directory);
      return repository;
    },
  };

  assert.equal(await resolveRepositoryForDirectory(repositories, directory), repository);
});

test("refreshes the Lumine repository caches and initialized snapshots", async () => {
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

  assert.equal(await refreshRepository(repository), repository);
  assert.equal(indexRefreshCount, 1);
  assert.equal(legacyStatusRefreshCount, 1);
  assert.equal(statusRefreshCount, 1);
  assert.equal(refsRefreshCount, 1);
});

test("keeps uninitialized Lumine repository snapshots lazy", async () => {
  const repository = {
    getStatusSnapshot: () => ({ initialized: false }),
    refreshStatusSnapshot: () => assert.fail("should not load the status snapshot"),
    getRefsSnapshot: () => ({ initialized: false }),
    refreshRefsSnapshot: () => assert.fail("should not load the refs snapshot"),
  };

  assert.equal(await refreshRepository(repository), repository);
});

test("refreshes the Lumine repository for a path", async () => {
  let refreshCount = 0;
  const repository = { refreshStatus: async () => refreshCount++ };
  const repositories = {
    getForPath: () => repository,
    resolveForPath: () => assert.fail("should not resolve a cached repository"),
  };

  assert.equal(await refreshRepositoryForPath(repositories, "/worktree"), repository);
  assert.equal(refreshCount, 1);
});
