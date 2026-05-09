/** @babel */
/** @jsx React.createElement */
import React from "react";
import yubikiri from "yubikiri";

import { nullCommit } from "../models/commit";
import { nullBranch } from "../models/branch";
import ObserveModel from "../views/observe-model";
import GitTabController from "../controllers/git-tab-controller";

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

export default class GitTabContainer extends React.Component {
  lastData = null;

  state = {
    extraRecentCommits: [],
    hasMoreExtraRecentCommits: null,
    recentCommitsBaseSha: null,
    recentCommitsLoading: false,
    recentCommitsRepository: this.props.repository,
  };

  static getDerivedStateFromProps(props, state) {
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
    const recentCommits = repository.getRecentCommits({ max: RECENT_COMMITS_PAGE_SIZE + 1 });

    return yubikiri({
      repository,
      username: repository.getConfig("user.name").then((n) => n || ""),
      email: repository.getConfig("user.email").then((n) => n || ""),
      lastCommit: repository.getLastCommit(),
      recentCommits: recentCommits.then((commits) =>
        commits.slice(0, RECENT_COMMITS_PAGE_SIZE),
      ),
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
      fetchInProgress: false,
    });
  };

  render() {
    return (
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
      </ObserveModel>
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

  loadMoreRecentCommits = async () => {
    const page = this.recentCommitPage;
    if (
      !page ||
      !page.repository ||
      this.state.recentCommitsLoading ||
      !page.hasMore ||
      repositoryIsDestroyed(page.repository)
    ) {
      return;
    }

    this.setState({ recentCommitsLoading: true });

    let commits;
    try {
      commits = await page.repository.getRecentCommits({
        max: RECENT_COMMITS_PAGE_SIZE + 1,
        skip: page.count,
      });
    } catch {
      this.setState({ recentCommitsLoading: false });
      return;
    }

    const extraRecentCommits = commits.slice(0, RECENT_COMMITS_PAGE_SIZE);
    const hasMoreExtraRecentCommits = commits.length > RECENT_COMMITS_PAGE_SIZE;

    this.setState((state) => {
      if (page.repository !== state.recentCommitsRepository) {
        return { recentCommitsLoading: false };
      }

      const previousExtraRecentCommits =
        page.baseSha === state.recentCommitsBaseSha ? state.extraRecentCommits : [];

      return {
        extraRecentCommits: previousExtraRecentCommits.concat(extraRecentCommits),
        hasMoreExtraRecentCommits,
        recentCommitsBaseSha: page.baseSha,
        recentCommitsLoading: false,
      };
    });
  };
}

function repositoryIsDestroyed(repository) {
  return !repository || (repository.isDestroyed && repository.isDestroyed());
}

function getFirstCommitSha(commits) {
  const [commit] = commits;
  return commit ? commit.getSha() : null;
}
