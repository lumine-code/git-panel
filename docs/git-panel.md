# git-panel

Gives a forge package access to the repository model, the diff pipeline, and the Git panel's active-repository context.

|             |                                                         |
| ----------- | ------------------------------------------------------- |
| Version     | `1.0.0`                                                 |
| Provided by | `provideGitPanel()` returning the bridge                |
| Consumed by | `consumeGitPanel(gitPanel)`                             |
| Owner       | [`git-panel`](https://github.com/lumine-code/git-panel) |

A deliberately wide internal seam, not a general-purpose Git API. It exists so `github-panel` can render a diff fetched from the GitHub API through **the same parser and the same view** the local Git panel uses, rather than reimplementing either and drifting.

If you want to read repository state, use core's `lumine.project.repositoryForPath` and the repository registry instead. Reach for this only when you are building a forge integration that must render diffs identically to the Git panel.

## Registration

In your `package.json`:

```json
{
  "consumedServices": {
    "git-panel": {
      "versions": { "^1.0.0": "consumeGitPanel" }
    }
  }
}
```

## Contract

```ts
type GitPanelBridge = {
  // Diff pipeline
  filterDiff(patch: object, ...args: unknown[]): object;
  parseDiff(rawDiff: string): object;
  buildMultiFilePatch(diffs: object[]): object;
  readonly MultiFilePatchController: unknown;

  // Repository model
  getAbsentRepository(): Repository;
  getRepositoryForWorkdir(workdir: string): Promise<Repository>;
  getContextPool(): object;

  // Active context and panel control
  getActiveRepository(): Repository;
  getActiveWorkdir(): string | null;
  isContextLocked(): boolean;
  scheduleActiveContextUpdate(options?: object): Promise<void>;
  onDidUpdate(callback: () => void): Disposable;
  openGitTab(): void;
  openCloneDialog(): void;
  openInitializeDialog(): void;
  clone(remoteUrl: string, projectPath: string, sourceRemoteName?: string): Promise<void>;
};
```

| Group          | Purpose                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Diff pipeline  | Turn a raw unified diff into the `MultiFilePatch` the panel's view renders. `MultiFilePatchController` is a lazy getter that loads the controller on first access. |
| Repository     | Resolve a `Repository` for a working directory, or the absent placeholder for "no repository here".                                                                |
| Active context | Read and refresh which repository the panel is showing, and open its tabs and dialogs.                                                                             |

## Minimal example

```js
const { Disposable } = require("lumine");

module.exports = {
  consumeGitPanel(gitPanel) {
    this.gitPanel = gitPanel;
    return new Disposable(() => (this.gitPanel = null));
  },

  renderRemoteDiff(rawDiff) {
    const parsed = this.gitPanel.parseDiff(rawDiff);
    return this.gitPanel.buildMultiFilePatch([parsed]);
  },
};
```

## Behavior

**Feed diffs through `parseDiff` and `buildMultiFilePatch` rather than constructing patch objects yourself.** The guarantee this service offers is a matching shape; hand-built objects lose it the next time the parser changes.

`getAbsentRepository()` returns a real object representing "no repository", not `null`. Use it where a `Repository` is required but none applies — the model expects the placeholder, and passing `null` breaks callers downstream.

`isContextLocked()` tells you the user has pinned the panel to one repository. Respect it: calling `scheduleActiveContextUpdate` against a locked context fights the user's explicit choice.

`onDidUpdate` fires when the panel's model changes and carries no payload — re-read what you need.

This is the widest service in the workspace and the most likely to move. It is versioned like every other, so a breaking change arrives under a new name — but treat a dependency on it as coupling to `git-panel`'s internals rather than to a stable API.

## Teardown

Return a `Disposable` that drops your reference. Repositories come from a shared context pool and are not yours to destroy, and the panel's tabs and dialogs belong to `git-panel`.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
