/** @babel */
import { textSource } from "./text-source.js";

export const MAX_COMMIT_UNITS = 32 * 1024 * 1024;

export function commitText(value) {
  const source = textSource(value);
  if (!source.canMaterialize(MAX_COMMIT_UNITS))
    throw Object.assign(
      new RangeError(
        "Commit messages exceed the 32 Mi UTF-16 Git input budget. The complete draft remains editable.",
      ),
      { code: "ERR_GIT_COMMIT_MESSAGE_TOO_LARGE" },
    );
  return source.toString();
}

export function hasMessageContent(value, { comments = true } = {}) {
  const source = textSource(value);
  if (source.length > MAX_COMMIT_UNITS) return false;
  let lineStart = true,
    comment = false;
  for (const chunk of source.chunks()) {
    let offset = 0;
    while (offset < chunk.length) {
      if (lineStart) {
        comment = comments && chunk[offset] === "#";
        lineStart = false;
      }
      const newline = chunk.indexOf("\n", offset),
        end = newline < 0 ? chunk.length : newline;
      if (!comment && /\S/.test(chunk.slice(offset, end))) return true;
      if (newline < 0) break;
      offset = newline + 1;
      lineStart = true;
    }
  }
  return false;
}
