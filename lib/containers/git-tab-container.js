/** @babel */
/** @jsx h */
import { View, h } from "../etch/view.js";
import { resolveQuery } from "../helpers.js";

import { nullCommit } from "../models/commit.js";
import { nullBranch } from "../models/branch.js";
import ObserveModel from "../views/observe-model.js";
import GitTabController from "../controllers/git-tab-controller.js";

const RECENT_COMMITS_PAGE_SIZE = 15;

const DEFAULT_REPO_DATA = {
  repository: null,
  username: "",
  email: "",
  lastCommit: nullCommit,
  recentCommits: [],
  hasMoreRecentCommits: false,
  isMerging: false,
  isRebasing: false,
  hasUndoHistory: false,
  currentBranch: nullBranch,
  unstagedChanges: [],
  stagedChanges: [],
  mergeConflicts: [],
  workingDirectoryPath: null,
  mergeMessage: null,
  fetchInProgress: true,
};

export default class GitTabContainer extends View {
  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  lastData = null;

  recentCommitsRequest = null;

  state = {
    extraRecentCommits: [],
    hasMoreExtraRecentCommits: null,
    recentCommitsBaseSha: null,
    recentCommitsLoading: false,
    recentCommitsRepository: this.props.repository,
  };

  static deriveState(props, state) {
    if (props.repository !== state.recentCommitsRepository) {
      return {
        extraRecentCommits: [],
        hasMoreExtraRecentCommits: null,
        recentCommitsBaseSha: null,
        recentCommitsLoading: false,
        recentCommitsRepository: props.repository,
      };
    }

    return null;
  }

  fetchData = (repository) => {
    // Capture this before any reads settle. Repository is a mutable state
    // machine, so a fetch started in Loading may finish after it has become
    // Present; publishing that provisional data as complete briefly triggers
    // UI that depends on missing values, such as the identity editor.
    const fetchInProgress = repository.showGitTabLoading();
    const recentCommits = repository.getRecentCommits({ max: RECENT_COMMITS_PAGE_SIZE + 1 });

    return resolveQuery({
      repository,
      username: repository.getConfig("user.name").then((n) => n || ""),
      email: repository.getConfig("user.email").then((n) => n || ""),
      lastCommit: repository.getLastCommit(),
      recentCommits: recentCommits.then((commits) => commits.slice(0, RECENT_COMMITS_PAGE_SIZE)),
      hasMoreRecentCommits: recentCommits.then(
        (commits) => commits.length > RECENT_COMMITS_PAGE_SIZE,
      ),
      isMerging: repository.isMerging(),
      isRebasing: repository.isRebasing(),
      hasUndoHistory: repository.hasDiscardHistory(),
      currentBranch: repository.getCurrentBranch(),
      unstagedChanges: repository.getUnstagedChanges(),
      stagedChanges: repository.getStagedChanges(),
      mergeConflicts: repository.getMergeConflicts(),
      workingDirectoryPath: repository.getWorkingDirectoryPath(),
      mergeMessage: async (query) => {
        const isMerging = await query.isMerging;
        return isMerging ? repository.getMergeMessage() : null;
      },
      fetchInProgress,
    });
  };

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <ObserveModel model={this.props.repository} fetchData={this.fetchData}>
        {(data) => {
          let dataProps = data || DEFAULT_REPO_DATA;
          let isSwitchingRepository = false;

          if (this.lastData && repositoryIsDestroyed(this.lastData.repository)) {
            this.lastData = null;
          }

          if (
            data &&
            data.repository === this.props.repository &&
            !repositoryIsDestroyed(data.repository)
          ) {
            this.lastData = data;
          } else if (this.lastData && this.lastData.repository !== this.props.repository) {
            dataProps = this.lastData;
            isSwitchingRepository = true;
          }

          const recentCommitProps = this.getRecentCommitProps(dataProps);

          return (
            <GitTabController
              {...dataProps}
              {...this.props}
              recentCommits={recentCommitProps.recentCommits}
              hasMoreRecentCommits={recentCommitProps.hasMoreRecentCommits}
              repository={dataProps.repository || this.props.repository}
              isSwitchingRepository={isSwitchingRepository}
              repositoryDrift={this.props.repository !== dataProps.repository}
              loadMoreRecentCommits={this.loadMoreRecentCommits}
            />
          );
        }}
      </ObserveModel>,
    );
  }

  getRecentCommitProps(dataProps) {
    const baseSha = getFirstCommitSha(dataProps.recentCommits);
    const useExtraCommits =
      dataProps.repository === this.state.recentCommitsRepository &&
      baseSha === this.state.recentCommitsBaseSha;

    const recentCommits = useExtraCommits
      ? dataProps.recentCommits.concat(this.state.extraRecentCommits)
      : dataProps.recentCommits;
    const hasMoreRecentCommits =
      useExtraCommits && this.state.hasMoreExtraRecentCommits !== null
        ? this.state.hasMoreExtraRecentCommits
        : dataProps.hasMoreRecentCommits;

    this.recentCommitPage = {
      repository: dataProps.repository,
      baseSha,
      count: recentCommits.length,
      hasMore: hasMoreRecentCommits,
    };

    return { recentCommits, hasMoreRecentCommits };
  }

  loadMoreRecentCommits = () => {
    const page = this.recentCommitPage;
    if (!page || !page.repository || !page.hasMore || repositoryIsDestroyed(page.repository)) {
      return Promise.resolve();
    }

    const currentRequest = this.recentCommitsRequest;
    if (
      currentRequest?.page.repository === page.repository &&
      currentRequest.page.baseSha === page.baseSha &&
      currentRequest.page.count === page.count
    ) {
      return currentRequest.promise;
    }

    if (this.state.recentCommitsLoading) {
      return Promise.resolve();
    }

    const request = { page };
    request.promise = Promise.resolve().then(() => this.loadRecentCommitPage(request));
    this.recentCommitsRequest = request;
    this.updateState({ recentCommitsLoading: true });
    return request.promise;
  };

  async loadRecentCommitPage(request) {
    const { page } = request;
    try {
      let commits;
      try {
        commits = await page.repository.getRecentCommits({
          max: RECENT_COMMITS_PAGE_SIZE + 1,
          skip: page.count,
          ref: page.baseSha,
        });
      } catch {
        return;
      }

      const extraRecentCommits = commits.slice(0, RECENT_COMMITS_PAGE_SIZE);
      const hasMoreExtraRecentCommits = commits.length > RECENT_COMMITS_PAGE_SIZE;

      await this.updateState((state) => {
        const currentPage = this.recentCommitPage;
        if (
          this.recentCommitsRequest !== request ||
          page.repository !== state.recentCommitsRepository ||
          page.repository !== currentPage?.repository ||
          page.baseSha !== currentPage.baseSha ||
          page.count !== currentPage.count
        ) {
          return null;
        }

        const previousExtraRecentCommits =
          page.baseSha === state.recentCommitsBaseSha ? state.extraRecentCommits : [];

        return {
          extraRecentCommits: previousExtraRecentCommits.concat(extraRecentCommits),
          hasMoreExtraRecentCommits,
          recentCommitsBaseSha: page.baseSha,
        };
      });
    } finally {
      // A response from a previous repository must not unlock a newer request.
      if (this.recentCommitsRequest === request) {
        this.recentCommitsRequest = null;
        await this.updateState({ recentCommitsLoading: false });
      }
    }
  }
}

function repositoryIsDestroyed(repository) {
  return !repository || (repository.isDestroyed && repository.isDestroyed());
}

function getFirstCommitSha(commits) {
  const [commit] = commits;
  return commit ? commit.getSha() : null;
}
