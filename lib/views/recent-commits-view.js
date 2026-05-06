/** @babel */
/** @jsx React.createElement */
import React from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);
import cx from "classnames";
import { emojify } from "node-emoji";

import Commands, { Command } from "../atom/commands";
import RefHolder from "../models/ref-holder";

import CommitView from "./commit-view";
import Timeago from "./timeago";

class RecentCommitView extends React.Component {
  constructor(props) {
    super(props);

    this.refRoot = new RefHolder();
  }

  componentDidMount() {
    if (this.props.isSelected) {
      this.refRoot.map((root) => root.scrollIntoViewIfNeeded(false));
    }
  }

  componentDidUpdate(prevProps) {
    if (this.props.isSelected && !prevProps.isSelected) {
      this.refRoot.map((root) => root.scrollIntoViewIfNeeded(false));
    }
  }

  render() {
    const authorMoment = dayjs(this.props.commit.getAuthorDate() * 1000);
    const fullMessage = this.props.commit.getFullMessage();

    return (
      <li
        ref={this.refRoot.setter}
        className={cx("git-panel-RecentCommit", {
          "most-recent": this.props.isMostRecent,
          "is-selected": this.props.isSelected,
        })}
        onClick={this.props.openCommit}
      >
        <Commands registry={this.props.commands} target={this.refRoot}>
          <Command command="git-panel:copy-commit-sha" callback={this.copyCommitSha} />
          <Command command="git-panel:copy-commit-subject" callback={this.copyCommitSubject} />
        </Commands>
        {this.renderAuthors()}
        <span className="git-panel-RecentCommit-message" title={emojify(fullMessage)}>
          {emojify(this.props.commit.getMessageSubject())}
        </span>
        {this.props.isMostRecent && (
          <button className="btn git-panel-RecentCommit-undoButton" onClick={this.undoLastCommit}>
            Undo
          </button>
        )}
        <Timeago
          className="git-panel-RecentCommit-time"
          type="time"
          displayStyle="short"
          time={authorMoment}
          title={authorMoment.format("MMM D, YYYY")}
        />
      </li>
    );
  }

  renderAuthor(author) {
    const email = author.getEmail();
    const avatarUrl = author.getAvatarUrl();

    return (
      <img
        className="git-panel-RecentCommit-avatar"
        key={email}
        src={avatarUrl || null}
        title={email}
        alt={`${email}'s avatar'`}
      />
    );
  }

  renderAuthors() {
    const coAuthors = this.props.commit.getCoAuthors();
    const seen = new Set();
    const authors = [this.props.commit.getAuthor(), ...coAuthors].filter(a => {
      const email = a.getEmail();
      if (seen.has(email)) return false;
      seen.add(email);
      return true;
    });

    return <span className="git-panel-RecentCommit-authors">{authors.map(this.renderAuthor)}</span>;
  }

  copyCommitSha = (event) => {
    event.stopPropagation();
    const { commit, clipboard } = this.props;
    clipboard.write(commit.sha);
  };

  copyCommitSubject = (event) => {
    event.stopPropagation();
    const { commit, clipboard } = this.props;
    clipboard.write(commit.messageSubject);
  };

  undoLastCommit = (event) => {
    event.stopPropagation();
    this.props.undoLastCommit();
  };
}

export default class RecentCommitsView extends React.Component {
  static focus = {
    RECENT_COMMIT: Symbol("recent_commit"),
  };

  static firstFocus = RecentCommitsView.focus.RECENT_COMMIT;

  static lastFocus = RecentCommitsView.focus.RECENT_COMMIT;

  constructor(props) {
    super(props);
    this.refRoot = new RefHolder();
  }

  setFocus(focus) {
    if (focus === this.constructor.focus.RECENT_COMMIT) {
      return this.refRoot
        .map((element) => {
          element.focus();
          return true;
        })
        .getOr(false);
    }

    return false;
  }

  getFocus(element) {
    return this.refRoot.map((e) => e.contains(element)).getOr(false)
      ? this.constructor.focus.RECENT_COMMIT
      : null;
  }

  render() {
    return (
      <div className="git-panel-RecentCommits" tabIndex="-1" ref={this.refRoot.setter}>
        <Commands registry={this.props.commands} target={this.refRoot}>
          <Command command="core:move-down" callback={this.props.selectNextCommit} />
          <Command command="core:move-up" callback={this.props.selectPreviousCommit} />
          <Command command="git-panel:dive" callback={this.openSelectedCommit} />
        </Commands>
        {this.renderCommits()}
      </div>
    );
  }

  renderCommits() {
    if (this.props.commits.length === 0) {
      if (this.props.isLoading) {
        return <div className="git-panel-RecentCommits-message">Recent commits</div>;
      } else {
        return <div className="git-panel-RecentCommits-message">Make your first commit</div>;
      }
    } else {
      return (
        <ul className="git-panel-RecentCommits-list">
          {this.props.commits.map((commit, i) => {
            return (
              <RecentCommitView
                key={commit.getSha()}
                commands={this.props.commands}
                clipboard={this.props.clipboard}
                isMostRecent={i === 0}
                commit={commit}
                undoLastCommit={this.props.undoLastCommit}
                openCommit={() =>
                  this.props.openCommit({ sha: commit.getSha(), preserveFocus: true })
                }
                isSelected={this.props.selectedCommitSha === commit.getSha()}
              />
            );
          })}
        </ul>
      );
    }
  }

  openSelectedCommit = () =>
    this.props.openCommit({ sha: this.props.selectedCommitSha, preserveFocus: false });

  advanceFocusFrom(focus) {
    if (focus === this.constructor.focus.RECENT_COMMIT) {
      return Promise.resolve(this.constructor.focus.RECENT_COMMIT);
    }

    return Promise.resolve(null);
  }

  retreatFocusFrom(focus) {
    if (focus === this.constructor.focus.RECENT_COMMIT) {
      return Promise.resolve(CommitView.lastFocus);
    }

    return Promise.resolve(null);
  }
}
