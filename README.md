# git-panel

A forge-agnostic Git integration panel for Lumine.

Derived from Pulsar's [`github`](https://github.com/pulsar-edit/github) package, with hosting-provider features removed.

## Features

- **Staging area**: stage, unstage, and discard changes per file, hunk, or selected line.
- **Commits and branches**: compose commits and create, switch, or manage branches.
- **Remote synchronization**: fetch, pull, push, and force-push with Git remotes.
- **Diff viewer**: inspect changes with hunk, line, and word-level highlighting.
- **Conflict resolution**: resolve merge conflicts with in-editor controls.
- **Repository management**: initialize, clone, and work with multiple repositories.

## Installation

`git-panel` is delivered as a bundled Lumine package and does not need to be installed separately.

## Commands

Commands available in `.workspace`:

- `git-panel:toggle-focus`: open and focus the Git tab, or return focus to editor if already focused,
- `git-panel:toggle-git-tab`: toggle Git tab visibility,
- `git-panel:commit`: commit staged changes,
- `git-panel:fetch`: fetch from remote,
- `git-panel:pull`: pull from remote,
- `git-panel:push`: push to remote,
- `git-panel:force-push`: force push to remote,
- `git-panel:clone`: open clone dialog,
- `git-panel:initialize`: initialize a new git repository,
- `git-panel:update-repositories`: rescan all project paths, refresh existing repositories, add newly found ones, and remove stale ones,
- `git-panel:open-commit`: open commit by SHA dialog,
- `git-panel:toggle-commit-preview`: toggle commit preview pane,
- `git-panel:view-unstaged-changes-for-current-file`: show unstaged diff for current file,
- `git-panel:view-staged-changes-for-current-file`: show staged diff for current file,
- `git-panel:close-all-diff-views`: close all open diff views,
- `git-panel:close-empty-diff-views`: close empty diff views.

Commands available in `atom-text-editor` (conflict resolution):

- `git-panel:resolve-as-ours`: resolve conflict as ours,
- `git-panel:resolve-as-theirs`: resolve conflict as theirs,
- `git-panel:resolve-as-base`: resolve conflict as base,
- `git-panel:resolve-as-current`: resolve as current side,
- `git-panel:revert-current`: revert conflict marker,
- `git-panel:resolve-as-ours-then-theirs`: resolve as ours then theirs,
- `git-panel:resolve-as-theirs-then-ours`: resolve as theirs then ours,
- `git-panel:revert-conflict-modifications`: revert all conflict modifications,
- `git-panel:dismiss-conflict`: dismiss current conflict.

Commands available in `.git-panel-Git`:

- `git-panel:focus-project`: focus project selector,
- `git-panel:focus-unstaged`: focus unstaged changes,
- `git-panel:focus-staged`: focus staged changes,
- `git-panel:focus-commit`: focus commit message,
- `git-panel:focus-recent-commits`: focus recent commits.

Commands available in `.git-panel-StagingView`:

- `git-panel:jump-to-file`: open file in editor,
- `git-panel:discard-changes-in-selected-files`: discard changes in selected files,
- `git-panel:show-diff-view`: show diff for selected file,
- `git-panel:focus-diff-view`: show and focus diff for selected file,
- `git-panel:activate-next-list`: move focus to next file list,
- `git-panel:activate-previous-list`: move focus to previous file list,
- `git-panel:resolve-file-as-ours`: resolve selected file as ours,
- `git-panel:resolve-file-as-theirs`: resolve selected file as theirs,
- `git-panel:stage-all-changes`: stage all unstaged changes,
- `git-panel:unstage-all-changes`: unstage all staged changes,
- `git-panel:discard-all-changes`: discard all unstaged changes,
- `git-panel:undo-last-discard-in-git-tab`: undo last discard.

Commands available in `.git-panel-CommitView`:

- `git-panel:commit`: commit staged changes,
- `git-panel:amend-last-commit`: amend the last commit,
- `git-panel:toggle-co-authors`: toggle the co-authors editor,
- `git-panel:toggle-expanded-commit-message-editor`: toggle expanded editor,
- `git-panel:dive`: open commit preview,
- `git-panel:co-author-exclude`: exclude co-author from list.

Commands available in `.git-panel-CoAuthorForm`:

- `core:cancel`: close the new co-author form,
- `core:focus-next`: switch between name and e-mail,
- `core:focus-previous`: switch between name and e-mail,
- `core:confirm`: add the co-author.

Commands available in `.git-panel-RecentCommits`:

- `git-panel:dive`: open commit detail view,
- `git-panel:undo-last-commit`: undo the last commit,
- `git-panel:copy-commit-sha`: copy commit SHA to clipboard,
- `git-panel:copy-commit-subject`: copy commit subject to clipboard.

Commands available in `.git-panel-FilePatchView` (diff view):

- `git-panel:toggle-patch-selection-mode`: toggle hunk/line selection mode,
- `git-panel:discard-selected-lines`: discard selected lines,
- `git-panel:jump-to-file`: jump to file at selected line,
- `git-panel:surface`: navigate back to parent view,
- `git-panel:select-next-hunk`: select next hunk (in hunk mode),
- `git-panel:select-previous-hunk`: select previous hunk (in hunk mode).

## Customization

Override the package custom properties in your `styles.css` to adjust its accent and diff colors:

```css
.git-panel-Git {
  --git-panel-color-blue: var(--text-color-info);
  --git-panel-diff-added: color-mix(in srgb, var(--syntax-color-added) 22%, transparent);
  --git-panel-diff-deleted: color-mix(in srgb, var(--syntax-color-removed) 22%, transparent);
}
```

## Services

- **status-bar** (`^1.0.0`): consumed to display branch and synchronization controls in the status bar.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
