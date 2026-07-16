function getRepositoryWorkingDirectory(repository) {
  try {
    return repository?.getWorkingDirectory?.() || null;
  } catch (_error) {
    return null;
  }
}

async function resolveRepositoryForPath(repositories, filePath) {
  if (!repositories || !filePath) {
    return null;
  }

  return repositories.getForPath(filePath) || repositories.resolveForPath(filePath);
}

async function resolveRepositoryForDirectory(repositories, directory) {
  if (!repositories || !directory) {
    return null;
  }

  const directoryPath = directory.getPath?.();
  return (
    (directoryPath && repositories.getForPath(directoryPath)) ||
    repositories.resolveDirectory(directory)
  );
}

async function refreshRepository(repository) {
  if (!repository) {
    return null;
  }

  repository.refreshIndex?.();

  const refreshes = [];
  if (repository.refreshStatus) {
    refreshes.push(repository.refreshStatus());
  }
  if (repository.refreshStatusSnapshot && repository.getStatusSnapshot?.().initialized) {
    refreshes.push(repository.refreshStatusSnapshot());
  }
  if (repository.refreshRefsSnapshot && repository.getRefsSnapshot?.().initialized) {
    refreshes.push(repository.refreshRefsSnapshot());
  }
  await Promise.all(refreshes);

  return repository;
}

async function refreshRepositoryForPath(repositories, filePath) {
  return refreshRepository(await resolveRepositoryForPath(repositories, filePath));
}

module.exports = {
  getRepositoryWorkingDirectory,
  refreshRepository,
  refreshRepositoryForPath,
  resolveRepositoryForDirectory,
  resolveRepositoryForPath,
};
