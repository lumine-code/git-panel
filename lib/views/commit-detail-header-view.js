/** @babel */
/** @jsx h */
import { View, h } from "../etch/view.js";
import { emojify } from "node-emoji";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
dayjs.extend(relativeTime);

import Commands, { Command } from "../lumine/commands.js";
import { getCommitURL } from "../commit-links.js";
import DiffViewToggle from "./diff-view-toggle.js";

export default class CommitDetailHeaderView extends View {
  static deriveState(props, state) {
    const documentURI = props.document?.getURI() ?? props.commit.getSha();
    if (documentURI === state.documentURI) return null;
    return { documentURI, messageOpen: !props.commit.isBodyLong() };
  }

  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  render() {
    const commit = this.props.commit;
    return (
      <div className="git-panel-CommitDetailView-header native-key-bindings" tabIndex="-1">
        <Commands registry={this.props.commands} target={this.props.commandTarget}>
          <Command
            command="git-panel:surface"
            description="Go back out to the list this view was opened from."
            callback={this.props.surface}
          />
        </Commands>
        <div className="git-panel-CommitDetailView-commit">
          <div className="git-panel-CommitDetailView-titleRow">
            <h3 className="git-panel-CommitDetailView-title">
              {emojify(commit.getMessageSubject())}
            </h3>
            <DiffViewToggle
              diffView={this.props.diffView}
              onDiffViewChange={this.props.onDiffViewChange}
            />
          </div>
          <div className="git-panel-CommitDetailView-meta">
            {this.renderAuthors()}
            <span className="git-panel-CommitDetailView-metaText">
              {this.getAuthorInfo()} committed {dayjs(commit.getAuthorDate() * 1000).fromNow()}
            </span>
            <div className="git-panel-CommitDetailView-sha">{this.renderDotComLink()}</div>
          </div>
          {this.renderShowMoreButton()}
          <pre className="git-panel-CommitDetailView-moreText">
            {commit.isBodyLong() && !this.state.messageOpen
              ? commit.abbreviatedBody()
              : commit.getMessageBody()}
          </pre>
        </div>
      </div>
    );
  }

  toggleMessage = () => this.updateState(({ messageOpen }) => ({ messageOpen: !messageOpen }));

  renderShowMoreButton() {
    if (!this.props.commit.isBodyLong()) return null;
    return (
      <button className="git-panel-CommitDetailView-moreButton" onClick={this.toggleMessage}>
        {this.state.messageOpen ? "Show Less" : "Show More"}
      </button>
    );
  }

  renderDotComLink() {
    const sha = this.props.commit.getSha();
    const url = this.props.isCommitPushed ? getCommitURL(this.props.currentRemote, sha) : null;
    return url ? (
      <a href={url} title={`Open commit ${sha}`}>
        {sha}
      </a>
    ) : (
      <span>{sha}</span>
    );
  }

  getAuthorInfo() {
    const commit = this.props.commit;
    const coAuthorCount = commit.getCoAuthors().length;
    if (coAuthorCount === 0) return commit.getAuthorName();
    if (coAuthorCount === 1)
      return `${commit.getAuthorName()} and ${commit.getCoAuthors()[0].getFullName()}`;
    return `${commit.getAuthorName()} and ${coAuthorCount} others`;
  }

  renderAuthor(author) {
    const email = author.getEmail();
    return (
      <img
        className="git-panel-CommitDetailView-avatar git-panel-RecentCommit-avatar"
        key={email}
        src={author.getAvatarUrl() || null}
        title={email}
        alt={`${email}'s avatar`}
      />
    );
  }

  renderAuthors() {
    const authors = [this.props.commit.getAuthor(), ...this.props.commit.getCoAuthors()];
    return (
      <span className="git-panel-CommitDetailView-authors git-panel-RecentCommit-authors">
        {authors.map(this.renderAuthor)}
      </span>
    );
  }
}
