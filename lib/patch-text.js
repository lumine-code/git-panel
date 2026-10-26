/** @babel */
import { constants } from "node:buffer";
export const MAX_PATCH_UNITS = Math.min(256 * 1024 * 1024, constants.MAX_STRING_LENGTH);

export function assertPatchLength(length) {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_PATCH_UNITS)
    throw Object.assign(
      new RangeError(
        "The selected patch exceeds the 256 Mi UTF-16 Git transport budget. Stage complete files or select fewer hunks.",
      ),
      { code: "ERR_GIT_DIFF_TOO_LARGE", length, limit: MAX_PATCH_UNITS },
    );
}
