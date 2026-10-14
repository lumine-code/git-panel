/** @babel */
/** @jsx h */
import { View, h } from "../etch/view.js";

import { CompositeDisposable } from "lumine";

import PatchDocument from "../models/patch-document.js";
import RecentCommitsView from "../views/recent-commits-view.js";
import RefHolder from "../models/ref-holder.js";

export default class RecentCommitsController extends View {
  static focus = RecentCommitsView.focus;

  constructor(props, children) {
    super(props, children);

    this.subscriptions = new CompositeDisposable(
      this.props.workspace.onDidChangeActivePaneItem(this.updateSelectedCommit),
      this.props.workspace.onDidDestroyPaneItem(this.clearDestroyedCommit),
    );

    this.refView = new RefHolder();

    this.state = { selectedCommitSha: "", repository: this.props.repository };
    this.selectionRevision = 0;

    this.initialize();
  }

  willDestroy() {
    this.subscriptions.dispose();
  }

  static deriveState(props, state) {
    if (props.repository !== state.repository) {
      return { selectedCommitSha: "", repository: props.repository };
    }
    if (
      state.selectedCommitSha &&
      !props.isLoading &&
      !props.commits.some((commit) => commit.getSha() === state.selectedCommitSha)
    ) {
      return { selectedCommitSha: "" };
    }
    return null;
  }

  updateSelectedCommit = () => {
    const activeItem = this.props.workspace.getActivePaneItem();

    const document = PatchDocument.fromURI(activeItem?.getURI?.());
    if (
      document?.kind === "commit" &&
      document.workingDirectory === this.props.repository.getWorkingDirectoryPath()
    ) {
      const sha = this.props.commits.some((commit) => commit.getSha() === document.sha)
        ? document.sha
        : "";
      if (sha !== this.state.selectedCommitSha) return this.selectCommit(sha);
    }
    return Promise.resolve();
  };

  clearDestroyedCommit = ({ item }) => {
    const document = PatchDocument.fromURI(item?.getURI?.());
    if (
      document?.kind === "commit" &&
      document.workingDirectory === this.props.repository.getWorkingDirectoryPath() &&
      document.sha === this.state.selectedCommitSha
    ) {
      return this.selectCommit("");
    }
    return Promise.resolve();
  };

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <RecentCommitsView
        ref={this.refView.setter}
        repository={this.props.repository}
        commits={this.props.commits}
        hasMoreCommits={this.props.hasMoreCommits}
        isLoading={this.props.isLoading}
        undoLastCommit={this.props.undoLastCommit}
        checkout={this.props.checkout}
        openCommit={this.openCommit}
        loadMoreCommits={this.props.loadMoreCommits}
        selectCommit={this.selectCommit}
        selectNextCommit={this.selectNextCommit}
        selectPreviousCommit={this.selectPreviousCommit}
        selectFirstCommit={this.selectFirstCommit}
        selectLastCommit={this.selectLastCommit}
        selectedCommitSha={this.state.selectedCommitSha}
        commands={this.props.commands}
        clipboard={lumine.clipboard}
      />,
    );
  }

  openCommit = async ({ sha, preserveFocus }) => {
    const repository = this.props.repository;
    if (this.destroyed || !this.props.commits.some((commit) => commit.getSha() === sha)) return;

    // A pending preview keeps the dock active, so pane-focus events cannot
    // select the clicked row. List selection changes as soon as it is opened.
    this.selectCommit(sha);
    const request = {
      repository,
      selectionRevision: this.selectionRevision,
      focusedElement: document.activeElement,
    };
    this.commitOpenRequest = request;
    const workdir = repository.getWorkingDirectoryPath();
    const uri = PatchDocument.commit(workdir, sha).getURI();
    const item = await this.props.workspace.open(uri, {
      pending: true,
      activatePane: !preserveFocus,
    });
    // An open can decline, e.g. when the workspace center is full.
    if (
      !this.destroyed &&
      item &&
      preserveFocus &&
      this.commitOpenRequest === request &&
      this.props.repository === repository &&
      this.selectionRevision === request.selectionRevision &&
      this.state.selectedCommitSha === sha &&
      document.activeElement === request.focusedElement
    ) {
      this.setFocus(this.constructor.focus.RECENT_COMMIT);
    }
  };

  selectCommit = (sha) => {
    this.selectionRevision++;
    return this.updateState({ selectedCommitSha: sha });
  };

  // When no commit is selected, `getSelectedCommitIndex` returns -1 & the commit at index 0 (first commit) is selected
  selectNextCommit = async () => {
    const nextIndex = this.getSelectedCommitIndex() + 1;
    if (nextIndex < this.props.commits.length) return this.setSelectedCommitIndex(nextIndex);
    if (
      !this.props.hasMoreCommits ||
      !this.props.loadMoreCommits ||
      this.nextCommitRequest?.repository === this.props.repository
    )
      return;

    const request = {
      repository: this.props.repository,
      selectionRevision: this.selectionRevision,
      sha: this.state.selectedCommitSha,
    };
    this.nextCommitRequest = request;
    try {
      await this.props.loadMoreCommits();
      if (
        !this.destroyed &&
        this.props.repository === request.repository &&
        this.selectionRevision === request.selectionRevision &&
        this.state.selectedCommitSha === request.sha
      ) {
        return this.setSelectedCommitIndex(this.getSelectedCommitIndex() + 1);
      }
    } finally {
      if (this.nextCommitRequest === request) this.nextCommitRequest = null;
    }
  };

  selectPreviousCommit = () =>
    this.setSelectedCommitIndex(Math.max(this.getSelectedCommitIndex() - 1, 0));

  selectFirstCommit = () => this.setSelectedCommitIndex(0);

  selectLastCommit = () => this.setSelectedCommitIndex(this.props.commits.length - 1);

  getSelectedCommitIndex() {
    return this.props.commits.findIndex(
      (commit) => commit.getSha() === this.state.selectedCommitSha,
    );
  }

  setSelectedCommitIndex(ind) {
    const commit = this.props.commits[ind];
    if (commit) {
      return this.selectCommit(commit.getSha());
    } else {
      return Promise.resolve();
    }
  }

  getFocus(element) {
    return this.refView.map((view) => view.getFocus(element)).getOr(null);
  }

  setFocus(focus) {
    return this.refView
      .map((view) => {
        const wasFocused = view.setFocus(focus);
        if (wasFocused && this.getSelectedCommitIndex() === -1) {
          this.setSelectedCommitIndex(0);
        }
        return wasFocused;
      })
      .getOr(false);
  }

  advanceFocusFrom(focus) {
    return this.refView.map((view) => view.advanceFocusFrom(focus)).getOr(Promise.resolve(null));
  }

  retreatFocusFrom(focus) {
    return this.refView.map((view) => view.retreatFocusFrom(focus)).getOr(Promise.resolve(null));
  }
}
