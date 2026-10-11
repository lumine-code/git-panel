/** @babel */

export default async function openInNextPane(workspace, openers, sourceElement) {
  if (openers.length === 0) return [];

  const center = workspace.getCenter();
  const panes = center.getPanes();
  const sourcePane = sourceElement?.closest?.("lumine-pane")?.getModel?.();
  const anchor = panes.includes(sourcePane) ? sourcePane : center.getActivePane();
  const next = panes[(panes.indexOf(anchor) + 1) % panes.length];
  let options = next && next !== anchor ? { pane: next } : { pane: anchor, split: "right" };
  const items = [];

  for (const open of openers) {
    // Workspace creates the requested split only after an item can be opened.
    const item = await open(options);
    if (!item) break;
    const destination = workspace.paneForItem(item);
    if (!destination || destination.isDestroyed()) break;
    items.push(item);
    options = { pane: destination };
  }
  return items;
}
