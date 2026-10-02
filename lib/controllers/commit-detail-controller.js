/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";

import CommitDetailView from "../views/commit-detail-view";

export default class CommitDetailController extends View {
  constructor(props, children) {
    super(props, children);

    this.state = {
      messageCollapsible: this.props.commit.isBodyLong(),
      messageOpen: !this.props.commit.isBodyLong(),
    };

    this.initialize();
  }

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <CommitDetailView
        messageCollapsible={this.state.messageCollapsible}
        messageOpen={this.state.messageOpen}
        toggleMessage={this.toggleMessage}
        {...this.props}
      />,
    );
  }

  toggleMessage = () => {
    return this.updateState((prevState) => ({ messageOpen: !prevState.messageOpen }));
  };
}
