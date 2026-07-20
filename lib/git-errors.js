/** @babel */

// GitError and LargeRepoError now live in Lumine core and are re-exported from
// the `atom` module, so git-panel and github-panel share a single class
// identity (an `instanceof GitError` check must match the error thrown here).
export { GitError, LargeRepoError } from "atom";
