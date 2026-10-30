# git-panel

Open and focus the local Git panel.

| Field       | Value                               |
| ----------- | ----------------------------------- |
| Version     | 1.0.0                               |
| Provided by | Git panel                           |
| Consumed by | Packages navigating to local Git UI |
| Owner       | git-panel                           |

## Registration

Declare `git-panel` in `consumedServices` at `^1.0.0`. Consumption is passive and returns a disposable that removes only that provider edge.

## Contract

| Required field | Type                     | Description                   |
| -------------- | ------------------------ | ----------------------------- |
| `openGitTab`   | `() => Promise<unknown>` | Show and focus the Git panel. |

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

The method constructs the panel view graph on demand. Repository initialization and cloning belong to `git-center.repository-setup`; the empty panel consumes that service and disables its setup buttons while no provider is connected. The separate `git-panel.diff` service can render a diff without opening the panel. Both Git Panel services follow this package's lifecycle; core repository APIs remain available independently.

## Teardown

Clear the consumer's reference when the provider disappears. Navigation promises may reject when package activation or rendering is cancelled.

## Versioning

Incompatible changes require a new service major version.
