# git-panel

Open the local Git panel and its repository setup dialogs.

| Field       | Value                               |
| ----------- | ----------------------------------- |
| Version     | 1.0.0                               |
| Provided by | Git panel                           |
| Consumed by | Packages navigating to local Git UI |
| Owner       | git-panel                           |

## Registration

Declare `git-panel` in `consumedServices` at `^1.0.0`. Consumption is passive and returns a disposable that removes only that provider edge.

## Contract

| Required field         | Type                     | Description                                |
| ---------------------- | ------------------------ | ------------------------------------------ |
| `openGitTab`           | `() => Promise<unknown>` | Show and focus the Git panel.              |
| `openCloneDialog`      | `() => Promise<unknown>` | Open the clone dialog.                     |
| `openInitializeDialog` | `() => Promise<unknown>` | Open the repository initialization dialog. |

Repository discovery, selection, snapshots, typed reads, operations and policy are owned by `lumine.repositories`. This package also provides native patch rendering through `git-panel.diff`.

## Minimal example

```js
consumeGitPanel(service) {
  this.gitPanel = service;
  return new Disposable(() => {
    if (this.gitPanel === service) this.gitPanel = null;
  });
}
openLocalChanges() {
  return this.gitPanel?.openGitTab();
}
```

## Behavior

The methods construct the panel view graph on demand. The separate `git-panel.diff` service can render a diff without opening the panel. Both services follow this package's lifecycle; core repository APIs remain available independently.

## Teardown

Clear the consumer's reference when the provider disappears. Navigation promises may reject when package activation or rendering is cancelled.

## Versioning

Incompatible changes require a new service major version.
