/** @babel */
/** @jsx React.createElement */
import React from "react";
import { emojify } from "node-emoji";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);

import MultiFilePatchController from "../controllers/multi-file-patch-controller";
import Commands, { Command } from "../atom/commands";
import RefHolder from "../models/ref-holder";

export default class CommitDetailView extends React.Component {
  constructor(props) {
    super(props);

    this.refRoot = new RefHolder();
  }

  render() {
    const commit = this.props.commit;

    return (
      <div className="git-panel-CommitDetailView" ref={this.refRoot.setter}>
        {this.renderCommands()}
        <div className="git-panel-CommitDetailView-header native-key-bindings" tabIndex="-1">
          <div className="git-panel-CommitDetailView-commit">
            <h3 className="git-panel-CommitDetailView-title">
              {emojify(commit.getMessageSubject())}
            </h3>
            <div className="git-panel-CommitDetailView-meta">
              {this.renderAuthors()}
              <span className="git-panel-CommitDetailView-metaText">
                {this.getAuthorInfo()} committed {this.humanizeTimeSince(commit.getAuthorDate())}
              </span>
              <div className="git-panel-CommitDetailView-sha">{this.renderDotComLink()}</div>
            </div>
            {this.renderShowMoreButton()}
            {this.renderCommitMessageBody()}
          </div>
        </div>
        <MultiFilePatchController
          multiFilePatch={commit.getMultiFileDiff()}
          surface={this.props.surfaceCommit}
          {...this.props}
        />
      </div>
    );
  }

  renderCommands() {
    return (
      <Commands registry={this.props.commands} target={this.refRoot}>
        <Command command="git-panel:surface" callback={this.props.surfaceCommit} />
      </Commands>
    );
  }

  renderCommitMessageBody() {
    const collapsed = this.props.messageCollapsible && !this.props.messageOpen;

    return (
      <pre className="git-panel-CommitDetailView-moreText">
        {collapsed ? this.props.commit.abbreviatedBody() : this.props.commit.getMessageBody()}
      </pre>
    );
  }

  renderShowMoreButton() {
    if (!this.props.messageCollapsible) {
      return null;
    }

    const buttonText = this.props.messageOpen ? "Show Less" : "Show More";
    return (
      <button className="git-panel-CommitDetailView-moreButton" onClick={this.props.toggleMessage}>
        {buttonText}
      </button>
    );
  }

  humanizeTimeSince(date) {
    return dayjs(date * 1000).fromNow();
  }

  renderDotComLink() {
    const remote = this.props.currentRemote;
    const sha = this.props.commit.getSha();
    if (remote.isGithubRepo() && this.props.isCommitPushed) {
      const repoUrl = `https://github.com/${remote.getOwner()}/${remote.getRepo()}`;
      return (
        <a href={`${repoUrl}/commit/${sha}`} title={`open commit ${sha} on GitHub.com`}>
          {sha}
        </a>
      );
    } else {
      return <span>{sha}</span>;
    }
  }

  getAuthorInfo() {
    const commit = this.props.commit;
    const coAuthorCount = commit.getCoAuthors().length;
    if (coAuthorCount === 0) {
      return commit.getAuthorName();
    } else if (coAuthorCount === 1) {
      return `${commit.getAuthorName()} and ${commit.getCoAuthors()[0].getFullName()}`;
    } else {
      return `${commit.getAuthorName()} and ${coAuthorCount} others`;
    }
  }

  renderAuthor(author) {
    const email = author.getEmail();
    const avatarUrl = author.getAvatarUrl();

    return (
      <img
        className="git-panel-CommitDetailView-avatar git-panel-RecentCommit-avatar"
        key={email}
        src={avatarUrl || null}
        title={email}
        alt={`${email}'s avatar'`}
      />
    );
  }

  renderAuthors() {
    const coAuthors = this.props.commit.getCoAuthors();
    const authors = [this.props.commit.getAuthor(), ...coAuthors];

    return (
      <span className="git-panel-CommitDetailView-authors git-panel-RecentCommit-authors">
        {authors.map(this.renderAuthor)}
      </span>
    );
  }
}
