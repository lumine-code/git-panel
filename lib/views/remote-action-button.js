/** @babel */
/** @jsx React.createElement */
import React, { Fragment } from "react";
import cx from "classnames";

import Tooltip from "../lumine/tooltip";
import RefHolder from "../models/ref-holder";
import { fetchRepository, pullRepository, pushRepository } from "../remote-actions";

function iconClass(icon, animation) {
  return cx("git-panel-RemoteActionButton-icon", "icon", `icon-${icon}`, {
    [`animate-${animation}`]: Boolean(animation),
  });
}

export function remoteActionState({
  aheadCount = 0,
  behindCount = 0,
  currentBranch,
  currentRemote,
  isFetching = false,
  isPulling = false,
  isPushing = false,
  originExists = false,
}) {
  if (isFetching) {
    return {
      disabled: true,
      tooltip: "Fetching from remote",
      icon: "sync",
      text: "Fetching",
      iconAnimation: "rotate",
    };
  }
  if (isPulling) {
    return {
      disabled: true,
      tooltip: "Pulling from remote",
      icon: "arrow-down",
      text: "Pulling",
      iconAnimation: "down",
    };
  }
  if (isPushing) {
    return {
      disabled: true,
      tooltip: "Pushing to remote",
      icon: "arrow-up",
      text: "Pushing",
      iconAnimation: "up",
    };
  }

  const isAhead = aheadCount > 0;
  const isBehind = behindCount > 0;
  const isUnpublished = !currentRemote.isPresent();
  const isDetached = currentBranch.isDetached();

  if (isAhead && !isBehind && !isUnpublished) {
    return {
      action: "push",
      tooltipEntries: [
        { title: "Push", keyBindingExtra: "LMB" },
        { title: "Force push", keyBindingExtra: "cmdorctrl+LMB" },
        { title: "More actions", keyBindingExtra: "RMB" },
      ],
      icon: "arrow-up",
      text: `Push ${aheadCount}`,
    };
  }
  if (isBehind && !isAhead && !isUnpublished) {
    return {
      action: "pull",
      tooltipEntries: [
        { title: "Pull", keyBindingExtra: "LMB" },
        { title: "More actions", keyBindingExtra: "RMB" },
      ],
      icon: "arrow-down",
      text: `Pull ${behindCount}`,
    };
  }
  if (isBehind && isAhead && !isUnpublished) {
    return {
      action: "pull-or-force-push",
      tooltipEntries: [
        { title: "Pull", keyBindingExtra: "LMB" },
        { title: "Force push", keyBindingExtra: "cmdorctrl+LMB" },
        { title: "More actions", keyBindingExtra: "RMB" },
      ],
      icon: "arrow-down",
      text: `Pull ${behindCount}`,
      secondaryIcon: "arrow-up",
      secondaryText: String(aheadCount),
    };
  }
  if (!isUnpublished && !isDetached) {
    return {
      action: "fetch",
      tooltipEntries: [
        { title: "Fetch", keyBindingExtra: "LMB" },
        { title: "More actions", keyBindingExtra: "RMB" },
      ],
      icon: "sync",
      text: "Fetch",
    };
  }
  if (isUnpublished && !isDetached && originExists) {
    return {
      action: "publish",
      tooltipEntries: [
        { title: "Set up a remote tracking branch", keyBindingExtra: "LMB" },
        { title: "More actions", keyBindingExtra: "RMB" },
      ],
      icon: "cloud-upload",
      text: "Publish",
    };
  }
  if (isUnpublished && !isDetached) {
    return {
      disabled: true,
      tooltip: 'There is no remote named "origin"',
      icon: "stop",
      text: "No remote",
    };
  }
  return {
    disabled: true,
    tooltip: "Create a branch if you wish to push your work anywhere",
    icon: "stop",
    text: "Not on branch",
  };
}

export default class RemoteActionButton extends React.Component {
  constructor(props) {
    super(props);
    this.refButton = new RefHolder();
  }

  setButtonRef = (element) => {
    this.refButton.setter(element);
    this.props.buttonRef?.setter(element);
  };

  handleClick = (event) => {
    const state = remoteActionState(this.props);
    if (this.props.disabled || state.disabled) {
      return;
    }

    const force = event.metaKey || event.ctrlKey;
    switch (state.action) {
      case "push":
        return pushRepository(this.props.repository, { force });
      case "pull":
        return pullRepository(this.props.repository);
      case "pull-or-force-push":
        return force
          ? pushRepository(this.props.repository, { force: true })
          : pullRepository(this.props.repository);
      case "fetch":
        return fetchRepository(this.props.repository);
      case "publish":
        return pushRepository(this.props.repository, { setUpstream: true });
      default:
        return undefined;
    }
  };

  render() {
    const state = remoteActionState(this.props);
    const disabled = this.props.disabled || state.disabled;

    return (
      <Fragment>
        <button
          type="button"
          ref={this.setButtonRef}
          className={cx("git-panel-RemoteActionButton", "btn", "btn-small", {
            "git-panel-branch-detached": this.props.currentBranch.isDetached(),
          })}
          disabled={disabled}
          onClick={this.handleClick}
        >
          {state.secondaryText && (
            <span className="secondary">
              <span className={iconClass(state.secondaryIcon)} />
              {state.secondaryText}
            </span>
          )}
          <span className={iconClass(state.icon, state.iconAnimation)} />
          {state.text}
        </button>
        <Tooltip
          manager={this.props.tooltipManager}
          target={this.refButton}
          title={state.tooltip}
          entries={state.tooltipEntries}
          showDelay={lumine.tooltips.hoverDefaults.delay.show}
          hideDelay={lumine.tooltips.hoverDefaults.delay.hide}
        />
      </Fragment>
    );
  }
}
