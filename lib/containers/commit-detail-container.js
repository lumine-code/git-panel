/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";
import { resolveQuery } from "../helpers";
import { CompositeDisposable } from "lumine";

import ObserveModel from "../views/observe-model";
import LoadingView from "../views/loading-view";
import CommitDetailController from "../controllers/commit-detail-controller";

export default class CommitDetailContainer extends View {
  constructor(props, children) {
    super(props, children);

    this.lastCommit = null;
    this.lastSourceCommit = null;
    this.ownedCommit = null;
    this.sub = new CompositeDisposable();

    this.initialize();
  }

  fetchData = (repository) => {
    return resolveQuery({
      commit: repository.getCommit(this.props.sha),
      currentBranch: repository.getCurrentBranch(),
      currentRemote: async (query) =>
        repository.getRemoteForBranch((await query.currentBranch).getName()),
      isCommitPushed: repository.isCommitPushed(this.props.sha),
    });
  };

  prepareData = (data) => {
    const source = data.commit;
    if (!source.isPresent() || !source.clone) return;
    if (source.isDisposed?.())
      throw Object.assign(new Error("Git commit was superseded"), { name: "AbortError" });
    if (source === this.lastSourceCommit && this.ownedCommit) {
      data.commit = this.ownedCommit;
      return;
    }
    const previous = this.ownedCommit;
    this.ownedCommit = source.clone();
    this.lastSourceCommit = source;
    data.commit = this.ownedCommit;
    if (previous) queueMicrotask(() => previous.dispose());
  };

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <ObserveModel
        model={this.props.repository}
        fetchData={this.fetchData}
        prepareData={this.prepareData}
      >
        {this.renderResult}
      </ObserveModel>,
    );
  }

  renderResult = (data) => {
    const currentCommit = data && data.commit;
    if (currentCommit !== this.lastCommit) {
      this.sub.dispose();
      if (currentCommit && currentCommit.isPresent()) {
        this.sub = new CompositeDisposable(
          ...currentCommit
            .getMultiFileDiff()
            .getFilePatches()
            .map((fp) =>
              fp.onDidChangeRenderStatus(() => {
                this.invalidate();
              }),
            ),
        );
      }
      this.lastCommit = currentCommit;
    }

    if (this.props.repository.isLoading() || data === null || !data.commit.isPresent()) {
      return <LoadingView />;
    }

    return <CommitDetailController {...data} {...this.props} />;
  };

  willDestroy() {
    this.sub.dispose();
    this.ownedCommit?.dispose();
    this.ownedCommit = null;
  }
}
