/** @babel */
/** @jsx React.createElement */
import React from "react";

import CommitDetailView from "../views/commit-detail-view";

export default class CommitDetailController extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      messageCollapsible: this.props.commit.isBodyLong(),
      messageOpen: !this.props.commit.isBodyLong(),
    };
  }

  render() {
    return (
      <CommitDetailView
        messageCollapsible={this.state.messageCollapsible}
        messageOpen={this.state.messageOpen}
        toggleMessage={this.toggleMessage}
        {...this.props}
      />
    );
  }

  toggleMessage = () => {
    return new Promise((resolve) => {
      this.setState((prevState) => ({ messageOpen: !prevState.messageOpen }), resolve);
    });
  };
}
