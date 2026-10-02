/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";

import { CompositeDisposable } from "lumine";

import CommitDetailItem from "../items/commit-detail-item";
import { URIPattern } from "../lumine/uri-pattern-core";
import RecentCommitsView from "../views/recent-commits-view";
import RefHolder from "../models/ref-holder";

export default class RecentCommitsController extends View {
  static focus = RecentCommitsView.focus;

  constructor(props, children) {
    super(props, children);

    this.subscriptions = new CompositeDisposable(
      this.props.workspace.onDidChangeActivePaneItem(this.updateSelectedCommit),
    );

    this.refView = new RefHolder();

    this.state = { selectedCommitSha: "" };

    this.initialize();
  }

  willDestroy() {
    this.subscriptions.dispose();
  }

  updateSelectedCommit = () => {
    const activeItem = this.props.workspace.getActivePaneItem();

    const pattern = new URIPattern(
      decodeURIComponent(
        CommitDetailItem.buildURI(this.props.repository.getWorkingDirectoryPath(), "{sha}"),
      ),
    );

    if (activeItem && activeItem.getURI) {
      const match = pattern.matches(activeItem.getURI());
      const { sha } = match.getParams();
      if (match.ok() && sha && sha !== this.state.selectedCommitSha) {
        return this.updateState({ selectedCommitSha: sha });
      }
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
        selectedCommitSha={this.state.selectedCommitSha}
        commands={this.props.commands}
        clipboard={lumine.clipboard}
      />,
    );
  }

  openCommit = async ({ sha, preserveFocus }) => {
    const workdir = this.props.repository.getWorkingDirectoryPath();
    const uri = CommitDetailItem.buildURI(workdir, sha);
    const item = await this.props.workspace.open(uri, { pending: true });
    // An open can decline, e.g. when the workspace center is full.
    if (!this.destroyed && item && preserveFocus) {
      const view = item.whenHydrated ? await item.whenHydrated() : item;
      view?.preventFocus();
      this.setFocus(this.constructor.focus.RECENT_COMMIT);
    }
  };

  selectCommit = (sha) => this.updateState({ selectedCommitSha: sha });

  // When no commit is selected, `getSelectedCommitIndex` returns -1 & the commit at index 0 (first commit) is selected
  selectNextCommit = () => this.setSelectedCommitIndex(this.getSelectedCommitIndex() + 1);

  selectPreviousCommit = () =>
    this.setSelectedCommitIndex(Math.max(this.getSelectedCommitIndex() - 1, 0));

  getSelectedCommitIndex() {
    return this.props.commits.findIndex(
      (commit) => commit.getSha() === this.state.selectedCommitSha,
    );
  }

  setSelectedCommitIndex(ind) {
    const commit = this.props.commits[ind];
    if (commit) {
      return this.updateState({ selectedCommitSha: commit.getSha() });
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
