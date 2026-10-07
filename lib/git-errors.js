/** @babel */

export { LargeRepoError } from "lumine";

// Core preserves typed operation codes and diagnostics across worker transport.
export function isGitError(error) {
  return Boolean(error?.code?.startsWith?.("ERR_GIT_"));
}
