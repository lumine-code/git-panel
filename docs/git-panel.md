# git-panel

Gives a forge package access to the repository model, the diff pipeline, and the Git panel's active-repository context.

|             |                                                         |
| ----------- | ------------------------------------------------------- |
| Version     | `1.0.0`                                                 |
| Provided by | `provideGitPanel()` returning the bridge                |
| Consumed by | `consumeGitPanel(gitPanel)`                             |
| Owner       | [`git-panel`](https://github.com/lumine-code/git-panel) |

A deliberately wide internal seam, not a general-purpose Git API. It exists so `github-panel` can render a diff fetched from the GitHub API through **the same parser and the same view** the local Git panel uses, rather than reimplementing either and drifting.

To read repository state, use core's `lumine.repositories` registry. Reach for this service when you are building a forge integration that must render diffs identically to the Git panel.

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
  parseDiff(rawDiff: string): object[];
  buildMultiFilePatch(diffs: object[], options?: object): MultiFilePatch;
  readonly MultiFilePatchController: unknown;
  readonly ChangesView: unknown;
  readonly DiffViewToggle: unknown;

  // Repository model
  getAbsentRepository(): Repository;
  getRepositoryForWorkdir(workdir: string): Repository;
  getContextPool(): WorkdirContextPool;

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

type WorkdirContextPool = {
  retain(workdir: string): {
    readonly context: WorkdirContext;
    readonly ready: Promise<WorkdirContext | null>;
    dispose(): void;
  };
  onDidChangePoolContexts(callback: () => void): Disposable;
};

type MultiFilePatch = {
  retain(): Disposable;
  dispose(): void;
  isDisposed(): boolean;
  clone(options?: object): MultiFilePatch;
  createPreviewPatch(fileName: string, diffRow: number, maxRowCount: number): MultiFilePatch;
  getBuffer(): TextBuffer;
  getWordDiffStats(): {
    pairedLines: number;
    detailedPairs: number;
    omittedPairs: number;
    unchangedPairs: number;
    reasons: { lineLength: number; editOrTimeLimit: number; populationBudget: number };
    elapsedMs: number;
  };
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
    return this.gitPanel.buildMultiFilePatch(parsed);
  },
};
```

## Behavior

**Feed diffs through `parseDiff` and `buildMultiFilePatch` rather than constructing patch objects yourself.** The guarantee this service offers is a matching shape; hand-built objects lose it the next time the parser changes.

`getAbsentRepository()` returns a real object representing "no repository", not `null`. Use it where a `Repository` is required but none applies — the model expects the placeholder, and passing `null` breaks callers downstream.

`isContextLocked()` tells you the user has pinned the panel to one repository. Respect it: calling `scheduleActiveContextUpdate` against a locked context fights the user's explicit choice.

`onDidUpdate` fires when the panel's active context changes and carries no payload — re-read the active repository and working directory. Observe the repository model's own updates for changes within that context.

A repository model remains cached when its views close. Each consumer that reads or observes a working directory must call `getContextPool().retain(workdir)`, await the handle's `ready` promise before reading `handle.context.getRepository()`, and dispose the handle when its view closes. The first handle resumes observation and refreshes snapshots; the last stops watchers and core subscriptions without destroying the shared model. Merely resolving a model with `getRepositoryForWorkdir` does not keep it observed.

The handle follows context replacements. Subscribe to `onDidChangePoolContexts`, await the current `ready` promise, and reacquire the repository from its current `context` before mounting readers after a replacement. The active panel and each open pane hold independent handles.

`buildMultiFilePatch()` returns an owned snapshot. Its creator calls `dispose()` after replacing or closing it, including results rejected as stale before publication. Additional consumers call `retain()` and dispose the returned lease when finished. The native diff view owns an independent lease while mounted. A model remains usable until its final owner releases it; `dispose()` is idempotent and releases only the creator's ownership.

`ChangesView` renders a shared header and the Unified / Side by Side control above a `multiFilePatch`. Pass `title`, `workspace`, `commands`, `config`, `keymaps`, and `tooltips` alongside the patch. `readOnly: true` removes index and discard actions and gives the view an independent clone; replacing the supplied patch preserves the native buffer and selected layout without mutating the caller's snapshot. The view releases its clone when replaced or destroyed. `initialDiffView` selects the starting layout, `onDiffViewChange` receives successful layout changes, and `getDiffView()` / `setDiffView()` read or change the current layout. An optional `refPatchController` receives the underlying controller for source navigation.

`DiffViewToggle` renders the same selected-button control for hosts that supply their own header. It accepts `diffView` and `onDiffViewChange`; the supported values are `unified` and `side-by-side`.

`compact: true` keeps the layout control and line decorations while omitting file and hunk headers for small context previews whose host already identifies the file.

`createPreviewPatch(fileName, diffRow, maxRowCount)` returns an owned, independent snapshot of the context window ending at the requested diff row, using the same limits as `getPreviewPatchBuffer()`. It preserves source line numbers and the existing bounded word-highlight layers rather than recalculating them. Dispose the returned preview when its consumer no longer needs it; the source may be released independently.

Repository reads return cached models owned by the repository. A consumer can retain a borrowed model, but must clone it before collapsing, expanding, or adopting a pane's reusable buffer. `clone()` creates independent backing text and marker descriptors, so changing one pane cannot alter another pane or the cache. Adoption acquires the target buffer before releasing the obsolete source. A preview slice returned by `getPreviewPatchBuffer()` is separately owned and must be disposed after its content and markers have been copied.

Word highlighting is a bounded detail layer. `getWordDiffStats()` reports computed and omitted pairs and the reasons for omissions; the complete line diff and staging coordinates remain available. See [Diff performance and ownership](performance.md) for the limits.

This is the widest service in the workspace and the most likely to move. It is versioned like every other, so a breaking change arrives under a new name — but treat a dependency on it as coupling to `git-panel`'s internals rather than to a stable API.

## Teardown

Return a `Disposable` that drops your reference, disposes your observation handles and removes your views. Repositories come from a shared context pool and are not yours to destroy, and the panel's tabs and dialogs belong to `git-panel`.

Dispose each snapshot you built and every consumer lease you acquired. Do not force-destroy a snapshot's `TextBuffer`: a mounted editor or another retained model may still own it.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
