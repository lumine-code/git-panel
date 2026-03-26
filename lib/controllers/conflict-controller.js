/** @babel */
/** @jsx React.createElement */
import React from "react";
import { CompositeDisposable } from "atom";

import { autobind, showContextMenu } from "../helpers";
import { OURS, BASE, THEIRS } from "../models/conflicts/source";
import Decoration from "../atom/decoration";
import Octicon from "../atom/octicon";

export default class ConflictController extends React.Component {
  static defaultProps = {
    resolveAsSequence: (sources) => {},
    dismiss: () => {},
  };

  constructor(props, context) {
    super(props, context);
    autobind(this, "showResolveMenu");

    this.state = {
      chosenSide: this.props.conflict.getChosenSide(),
    };

    this.commandSubs = new CompositeDisposable();
  }

  componentWillUnmount() {
    this.commandSubs.dispose();
  }

  resolveAsSequence(sources) {
    this.props.resolveAsSequence(sources);

    this.setState({
      chosenSide: this.props.conflict.getChosenSide(),
    });
  }

  revert(side) {
    side.isModified() && side.revert();
    side.isBannerModified() && side.revertBanner();
  }

  showResolveMenu(event) {
    event.preventDefault();

    this.commandSubs.dispose();
    this.commandSubs = new CompositeDisposable();
    const target = event.target;

    const commands = {
      "git-panel:resolve-as-ours": () => this.resolveAsSequence([OURS]),
      "git-panel:resolve-as-base": () => this.resolveAsSequence([BASE]),
      "git-panel:resolve-as-theirs": () => this.resolveAsSequence([THEIRS]),
      "git-panel:resolve-as-ours-then-theirs": () => this.resolveAsSequence([OURS, THEIRS]),
      "git-panel:resolve-as-theirs-then-ours": () => this.resolveAsSequence([THEIRS, OURS]),
      "git-panel:dismiss-conflict": () => this.props.dismiss(),
    };
    this.commandSubs.add(atom.commands.add(target, commands));

    const template = [
      { label: "Resolve as Ours", command: "git-panel:resolve-as-ours" },
      ...(this.props.conflict.getSide(BASE)
        ? [{ label: "Resolve as Base", command: "git-panel:resolve-as-base" }]
        : []),
      { label: "Resolve as Theirs", command: "git-panel:resolve-as-theirs" },
      { type: "separator" },
      { label: "Resolve as Ours Then Theirs", command: "git-panel:resolve-as-ours-then-theirs" },
      { label: "Resolve as Theirs Then Ours", command: "git-panel:resolve-as-theirs-then-ours" },
      { type: "separator" },
      { label: "Dismiss", command: "git-panel:dismiss-conflict" },
    ];

    showContextMenu(target, template);
  }

  render() {
    if (!this.state.chosenSide) {
      const ours = this.props.conflict.getSide(OURS);
      const base = this.props.conflict.getSide(BASE);
      const theirs = this.props.conflict.getSide(THEIRS);

      return (
        <div>
          {this.renderSide(ours)}
          {base && this.renderSide(base)}
          <Decoration
            key={this.props.conflict.getSeparator().getMarker().id}
            editor={this.props.editor}
            decorable={this.props.conflict.getSeparator().getMarker()}
            type="line"
            className="git-panel-ConflictSeparator"
          />
          {this.renderSide(theirs)}
        </div>
      );
    } else if (!this.state.chosenSide.isEmpty()) {
      return (
        <Decoration
          editor={this.props.editor}
          decorable={this.state.chosenSide.getMarker()}
          type="line"
          className="git-panel-ResolvedLines"
        />
      );
    } else {
      return null;
    }
  }

  renderSide(side) {
    const source = side.getSource();

    return (
      <div>
        <Decoration
          key={side.banner.marker.id}
          editor={this.props.editor}
          decorable={side.getBannerMarker()}
          type="line"
          className={side.getBannerCSSClass()}
        />
        {side.isBannerModified() || (
          <Decoration
            key={"banner-modified-" + side.banner.marker.id}
            editor={this.props.editor}
            decorable={side.getBannerMarker()}
            type="line"
            className="git-panel-ConflictUnmodifiedBanner"
          />
        )}
        <Decoration
          key={side.marker.id}
          editor={this.props.editor}
          decorable={side.getMarker()}
          type="line"
          className={side.getLineCSSClass()}
        />
        <Decoration
          key={"block-" + side.marker.id}
          editor={this.props.editor}
          decorable={side.getBlockMarker()}
          type="block"
          position={side.getBlockPosition()}
        >
          <div className={side.getBlockCSSClasses()}>
            <span className="git-panel-ResolutionControls">
              <button
                className="btn btn-sm inline-block"
                onClick={() => this.resolveAsSequence([source])}
              >
                Use me
              </button>
              {(side.isModified() || side.isBannerModified()) && (
                <button className="btn btn-sm inline-block" onClick={() => this.revert(side)}>
                  Revert
                </button>
              )}
              <Octicon icon="ellipses" className="inline-block" onClick={this.showResolveMenu} />
            </span>
            <span className="git-panel-SideDescription">{source.toUIString()}</span>
          </div>
        </Decoration>
      </div>
    );
  }
}
