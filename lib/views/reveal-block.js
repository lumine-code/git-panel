/** @babel */

// A file with no text can share its row with several other block headers.
// Reveal its actual spacer after native rendering has materialized that row.
export default async function revealBlock(editor, position, getSpacer, isCurrent) {
  const element = editor.getElement();
  const component = element.getComponent();
  editor.scrollToBufferPosition(position, { mode: "zone" });
  const painted = element.getNextUpdatePromise();
  component.scheduleUpdate();
  let stop;
  const destroyed = new Promise((resolve) => {
    stop = editor.onDidDestroy(resolve);
  });
  try {
    await Promise.race([painted, destroyed]);
  } finally {
    stop.dispose();
  }
  if (!isCurrent()) return false;
  const spacer = getSpacer();
  if (!spacer?.isConnected) return false;
  component.scrollAnimator.cancel();
  const bounds = spacer.getBoundingClientRect();
  // DOM geometry follows the painted pixel boundary, while the model keeps
  // an exact fractional offset. Reconstruct document coordinates from paint.
  const renderedTop = component.renderedScrollTop ?? component.getScrollTop();
  const top = renderedTop + bounds.top - element.getBoundingClientRect().top;
  component.autoscrollVerticallyIntoZone(
    top,
    top + bounds.height,
    editor.getScrollZone(),
    component.getVerticalAutoscrollMargin(),
    true,
  );
  return true;
}
