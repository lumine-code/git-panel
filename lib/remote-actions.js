/** @babel */

function reportError(error) {
  if (lumine.config.get("git-panel.debug")) {
    console.error(error);
  }
  return null;
}

export async function fetchRepository(repository) {
  try {
    const branch = await repository.getCurrentBranch();
    const upstream = branch.getUpstream();
    return await repository.fetch(upstream.getRemoteRef(), {
      remoteName: upstream.getRemoteName(),
    });
  } catch (error) {
    return reportError(error);
  }
}

export async function pullRepository(repository) {
  try {
    const branch = await repository.getCurrentBranch();
    return await repository.pull(branch.getName(), {
      refSpec: branch.getRefSpec("PULL"),
    });
  } catch (error) {
    return reportError(error);
  }
}

export async function pushRepository(repository, { force = false, setUpstream } = {}) {
  try {
    const branch = await repository.getCurrentBranch();
    const remote = await repository.getRemoteForBranch(branch.getName());
    return await repository.push(branch.getName(), {
      force,
      setUpstream: setUpstream ?? !remote.isPresent(),
      refSpec: branch.getRefSpec("PUSH"),
    });
  } catch (error) {
    return reportError(error);
  }
}
