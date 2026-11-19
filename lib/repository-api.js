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

module.exports = {
  getRepositoryWorkingDirectory,
  resolveRepositoryForDirectory,
  resolveRepositoryForPath,
};
