# git-panel

A Git integration panel.

Fork of [github](https://github.com/pulsar-edit/github), but forge-agnostic Git operations only.

## Features

- **Staging area**: Stage, unstage, and discard changes per-file or per-hunk.
- **Commit**: Compose commit messages with co-author support and automatic message wrapping.
- **Branching**: Create, switch, and manage branches from the status bar.
- **Push / Pull / Fetch**: Sync with remotes directly from the status bar.
- **Diff viewer**: Inline diff view with hunk and line-level selection, including word-level highlights within changed lines.
- **Merge conflict resolution**: Graphical in-editor conflict resolution controls.
- **Clone / Init**: Initialize new repositories or clone from a URL.
- **Multi-repo support**: Scan project subdirectories for nested git repositories.

## Installation

To install, search for [git-panel](https://web.pulsar-edit.dev/packages/git-panel) in the Install pane of the Pulsar settings or run `ppm install git-panel`. Alternatively, run `ppm install asiloisad/pulsar-git-panel` to install directly from the GitHub repository.

**Note**: This package automatically disables the built-in `github` package to avoid conflicts.

## Commands

Commands available in `.workspace`:

- `git-panel:toggle-git-tab-focus`: <kbd>Ctrl+9</kbd> toggle and focus the Git tab,
- `git-panel:toggle-git-tab`: <kbd>Ctrl+Shift+9</kbd> toggle Git tab visibility,
- `git-panel:commit`: <kbd>Alt+G Enter</kbd> commit staged changes,
- `git-panel:fetch`: <kbd>Alt+G F</kbd> fetch from remote,
- `git-panel:pull`: <kbd>Alt+G Shift+F</kbd> pull from remote,
- `git-panel:push`: <kbd>Alt+G P</kbd> push to remote,
- `git-panel:force-push`: <kbd>Alt+G Shift+P</kbd> force push to remote,
- `git-panel:clone`: <kbd>Alt+G =</kbd> open clone dialog,
- `git-panel:initialize`: initialize a new git repository,
- `git-panel:open-commit`: <kbd>Alt+G O</kbd> open commit by SHA dialog,
- `git-panel:toggle-commit-preview`: <kbd>Alt+G V</kbd> toggle commit preview pane,
- `git-panel:view-unstaged-changes-for-current-file`: show unstaged diff for current file,
- `git-panel:view-staged-changes-for-current-file`: show staged diff for current file,
- `git-panel:close-all-diff-views`: close all open diff views,
- `git-panel:close-empty-diff-views`: close empty diff views.

Commands available in `atom-text-editor` (conflict resolution):

- `git-panel:resolve-as-ours`: <kbd>Alt+M 1</kbd> resolve conflict as ours,
- `git-panel:resolve-as-theirs`: <kbd>Alt+M 2</kbd> resolve conflict as theirs,
- `git-panel:resolve-as-base`: <kbd>Alt+M 3</kbd> resolve conflict as base,
- `git-panel:resolve-as-current`: <kbd>Alt+M Enter</kbd> resolve as current side,
- `git-panel:revert-current`: <kbd>Alt+M R</kbd> revert conflict marker,
- `git-panel:resolve-as-ours-then-theirs`: resolve as ours then theirs,
- `git-panel:resolve-as-theirs-then-ours`: resolve as theirs then ours,
- `git-panel:revert-conflict-modifications`: revert all conflict modifications,
- `git-panel:dismiss-conflict`: dismiss current conflict.

Commands available in `.git-panel-StagingView`:

- `git-panel:jump-to-file`: <kbd>O</kbd> open file in editor,
- `git-panel:discard-changes-in-selected-files`: <kbd>Ctrl+Backspace</kbd> discard changes in selected files,
- `git-panel:show-diff-view`: show diff for selected file,
- `git-panel:activate-next-list`: move focus to next file list,
- `git-panel:activate-previous-list`: move focus to previous file list,
- `git-panel:resolve-file-as-ours`: resolve selected file as ours,
- `git-panel:resolve-file-as-theirs`: resolve selected file as theirs,
- `git-panel:stage-all-changes`: <kbd>Alt+G A</kbd> stage all unstaged changes,
- `git-panel:unstage-all-changes`: <kbd>Alt+G Shift+A</kbd> unstage all staged changes,
- `git-panel:discard-all-changes`: discard all unstaged changes,
- `git-panel:undo-last-discard-in-git-tab`: undo last discard.

Commands available in `.git-panel-CommitView`:

- `git-panel:commit`: <kbd>Ctrl+Enter</kbd> commit staged changes,
- `git-panel:amend-last-commit`: <kbd>Alt+G Shift+Enter</kbd> amend the last commit,
- `git-panel:toggle-expanded-commit-message-editor`: toggle expanded editor,
- `git-panel:dive`: <kbd>Left</kbd> open commit preview,
- `git-panel:co-author-exclude`: <kbd>Shift+Backspace</kbd> exclude co-author from list.

Commands available in `.git-panel-RecentCommits`:

- `git-panel:dive`: <kbd>Enter</kbd> open commit detail view,
- `git-panel:copy-commit-sha`: copy commit SHA to clipboard,
- `git-panel:copy-commit-subject`: copy commit subject to clipboard.

Commands available in `.git-panel-FilePatchView` (diff view):

- `git-panel:toggle-patch-selection-mode`: <kbd>/</kbd> or <kbd>Ctrl+/</kbd> toggle hunk/line selection mode,
- `git-panel:discard-selected-lines`: <kbd>Backspace</kbd> or <kbd>Ctrl+Backspace</kbd> discard selected lines,
- `git-panel:jump-to-file`: <kbd>O</kbd> or <kbd>Ctrl+O</kbd> jump to file at selected line,
- `git-panel:surface`: <kbd>Right</kbd> or <kbd>Ctrl+Right</kbd> navigate back to parent view,
- `git-panel:select-next-hunk`: <kbd>Down</kbd> select next hunk (in hunk mode),
- `git-panel:select-previous-hunk`: <kbd>Up</kbd> select previous hunk (in hunk mode).

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
