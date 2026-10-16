function activeRepository() {
  const repository = lumine.repositories.getActiveRepository();
  return repository && !repository.isDestroyed?.() ? repository : null;
}

function hasHistory() {
  const repository = activeRepository();
  if (!repository) return false;
  const status = repository.getStatusSnapshot?.();
  return !status?.initialized || Boolean(status.head?.oid);
}

function fileContext(event, registry = lumine.repositories) {
  const editor = event?.context?.fileEditor;
  if (!editor || editor === event.context.documentItem)
    return registry.getCommandContext(event, { scope: "file" });
  const path = editor.getPath?.() ?? null;
  return { editor, path, repository: path ? registry.getForPath(path) : null };
}

function fileChanges(stagingStatus, event) {
  const { repository, editor, path } = fileContext(event);
  if (!repository || repository.isDestroyed?.() || !editor || !path || editor.isDestroyed?.())
    return false;
  const status = repository.getStatusSnapshot?.();
  return !status?.initialized || Boolean(repository.getStatusEntry?.(path)?.[stagingStatus]);
}

function hasPatchItems({ empty = false, stagedPreview = false, workingDirectory } = {}) {
  return lumine.workspace.getPaneItems().some((item) => {
    const uri = item.getURI?.();
    if (stagedPreview)
      return (
        uri === `lumine-git://patch/staged-all?workdir=${encodeURIComponent(workingDirectory)}`
      );
    const view = typeof item.getHydratedView === "function" ? item.getHydratedView() : item;
    return Boolean(view?.isPatchItem?.() && (!empty || view.isEmpty?.()));
  });
}

function canPreviewCommit() {
  const repository = activeRepository();
  if (!repository) return false;
  if (hasPatchItems({ stagedPreview: true, workingDirectory: repository.getWorkingDirectory() }))
    return true;
  const status = repository.getStatusSnapshot?.();
  return !status?.initialized || status.counts.staged > 0;
}

module.exports = { canPreviewCommit, fileChanges, fileContext, hasHistory, hasPatchItems };
