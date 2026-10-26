/** @babel */
export const MAX_SCALAR_UNITS = 65536;

export function scalarInputsFit(...buffers) {
  return buffers.every((buffer) => buffer.getLength() <= MAX_SCALAR_UNITS);
}

export function acceptScalarInputs(...buffers) {
  if (scalarInputsFit(...buffers)) return true;
  lumine.notifications.addError("Git input is too long", {
    detail:
      "Repository URLs, paths, references and identity fields accept at most 64 Ki UTF-16 units each. The entered text has not been changed.",
    dismissable: true,
  });
  return false;
}
