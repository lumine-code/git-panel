# git-panel.diff

Build structured repository diffs and render raw external patches in native editor buffers.

| Field       | Value                            |
| ----------- | -------------------------------- |
| Version     | 1.0.0                            |
| Provided by | Git panel                        |
| Consumed by | Packages displaying file changes |
| Owner       | git-panel                        |

## Registration

Declare `git-panel.diff` in `consumedServices` at `^1.0.0` and return a disposable from the callback. Consumption is passive. Rendering modules load only when a consumer requests them, and rendering does not open the Git panel.

## Contract

```ts
interface DiffService {
  filterDiff(rawPatch: string): { filtered: string; removed: unknown[] };
  parseDiff(rawPatch: string): DiffFile[];
  buildFilePatch(files: DiffFile[], options?: object): MultiFilePatch;
  buildMultiFilePatch(files: DiffFile[], options?: object): MultiFilePatch;
  buildPatch(snapshot: { files?: DiffFile[]; rawPatch?: string }, options?: object): MultiFilePatch;
  ChangesView: new (props: DiffProps) => NativeDiffView;
}
interface DiffProps {
  multiFilePatch: MultiFilePatch;
  readOnly: true;
  workspace: object;
  commands: object;
  config: object;
  keymaps: object;
  tooltips: object;
  title?: string;
  surfaceKind?: "changes" | "file" | "commit";
  initialDiffView?: "unified" | "side-by-side";
  onDiffViewChange?: (layout: string) => void;
}
interface NativeDiffView {
  element: HTMLElement;
  update(props: DiffProps): Promise<void>;
  getDiffView(): "unified" | "side-by-side";
  setDiffView(layout: "unified" | "side-by-side"): Promise<void>;
  destroy(): Promise<void>;
}
```

Patch snapshots expose `getFilePatches()`, `getBuffer()`, `toString()`, `clone()` and `dispose()`. Their internal constructors, buffers, regions and view helpers are private to Git Panel. Repository reads and writes use core's repository API; editable Git workflows remain inside this package.

## Minimal example

```js
consumeDiff(diffService) {
  this.diffService = diffService;
  return new Disposable(() => {
    this.diff?.destroy();
    this.patch?.dispose();
    this.diff = null;
    this.patch = null;
    this.diffService = null;
  });
}
async showDiff(repository) {
  const service = this.diffService;
  if (!service) return;
  const snapshot = await repository.getDiff({format: "structured"});
  if (this.diffService !== service) return;
  this.patch = service.buildPatch(snapshot);
  this.diff = new service.ChangesView({
    multiFilePatch: this.patch,
    readOnly: true,
    title: "Changes",
    workspace: lumine.workspace,
    commands: lumine.commands,
    config: lumine.config,
    keymaps: lumine.keymaps,
    tooltips: lumine.tooltips,
  });
}
```

## Behavior

`buildPatch` prefers structured records when present and normalizes paths for the editor. Raw patches pass through core's patch filter before parsing. Read-only views clone and own their accepted snapshot, preserving their buffer, selection and viewport when its contents are replaced. Git Panel owns the shared styles, commands and context menus.

## Teardown

Each consumer owns the views and source snapshots it creates. Destroy views and dispose patches when their resource changes or Git Panel disappears. Reacquire the service and its view constructor from the next package generation when it returns.

## Versioning

Consumers request `^1.0.0`. Incompatible changes require a new service major version.
