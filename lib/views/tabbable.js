/** @babel */
/** @jsx React.createElement */
import React, { Fragment } from "react";
import Select from "react-select";

import Commands, { Command } from "../atom/commands";
import AtomTextEditor from "../atom/atom-text-editor";
import RefHolder from "../models/ref-holder";
import { unusedProps } from "../helpers";

export function makeTabbable(Component, options = {}) {
  return class extends React.Component {
    static propTypes = {
      tabGroup: true,
      autofocus: true,
      commands: true,
    };

    static defaultProps = {
      autofocus: false,
    };

    constructor(props) {
      super(props);

      this.rootRef = new RefHolder();
      this.elementRef = new RefHolder();

      if (options.rootRefProp) {
        this.rootRef = new RefHolder();
        this.rootRefProps = { [options.rootRefProp]: this.rootRef };
      } else {
        this.rootRef = this.elementRef;
        this.rootRefProps = {};
      }

      if (options.passCommands) {
        this.commandProps = { commands: this.props.commands };
      } else {
        this.commandProps = {};
      }
    }

    render() {
      return (
        <Fragment>
          <Commands registry={this.props.commands} target={this.rootRef}>
            <Command command="core:focus-next" callback={this.focusNext} />
            <Command command="core:focus-previous" callback={this.focusPrevious} />
          </Commands>
          <Component
            ref={this.elementRef.setter}
            tabIndex={-1}
            {...unusedProps(this.props, this.constructor.propTypes)}
            {...this.rootRefProps}
            {...this.commandProps}
          />
        </Fragment>
      );
    }

    componentDidMount() {
      this.elementRef.map((element) =>
        this.props.tabGroup.appendElement(element, this.props.autofocus),
      );
    }

    componentWillUnmount() {
      this.elementRef.map((element) => this.props.tabGroup.removeElement(element));
    }

    focusNext = (e) => {
      this.elementRef.map((element) => this.props.tabGroup.focusAfter(element));
      e.stopPropagation();
    };

    focusPrevious = (e) => {
      this.elementRef.map((element) => this.props.tabGroup.focusBefore(element));
      e.stopPropagation();
    };
  };
}

export const TabbableInput = makeTabbable("input");

export const TabbableButton = makeTabbable("button");

export const TabbableSummary = makeTabbable("summary");

export const TabbableTextEditor = makeTabbable(AtomTextEditor, { rootRefProp: "refElement" });

// KeyboardEvent is a DOM primitive, which v8 can't access
// so we're essentially lazy loading to keep snapshotting from breaking.
let FakeKeyDownEvent;

const KEY_CODE_TO_KEY = {
  8: "Backspace",
  9: "Tab",
  13: "Enter",
  27: "Escape",
  33: "PageUp",
  34: "PageDown",
  35: "End",
  36: "Home",
  38: "ArrowUp",
  40: "ArrowDown",
  46: "Delete",
};

class WrapSelect extends React.Component {
  static propTypes = {
    refElement: true,
    commands: true,
  };

  constructor(props) {
    super(props);

    this.refSelect = new RefHolder();
  }

  render() {
    return (
      <div className="git-panel-TabbableWrapper" ref={this.props.refElement.setter}>
        <Commands registry={this.props.commands} target={this.props.refElement}>
          <Command command="git-panel:selectbox-down" callback={this.proxyKeyCode(40)} />
          <Command command="git-panel:selectbox-up" callback={this.proxyKeyCode(38)} />
          <Command command="git-panel:selectbox-enter" callback={this.proxyKeyCode(13)} />
          <Command command="git-panel:selectbox-tab" callback={this.proxyKeyCode(9)} />
          <Command command="git-panel:selectbox-backspace" callback={this.proxyKeyCode(8)} />
          <Command command="git-panel:selectbox-pageup" callback={this.proxyKeyCode(33)} />
          <Command command="git-panel:selectbox-pagedown" callback={this.proxyKeyCode(34)} />
          <Command command="git-panel:selectbox-end" callback={this.proxyKeyCode(35)} />
          <Command command="git-panel:selectbox-home" callback={this.proxyKeyCode(36)} />
          <Command command="git-panel:selectbox-delete" callback={this.proxyKeyCode(46)} />
          <Command command="git-panel:selectbox-escape" callback={this.proxyKeyCode(27)} />
        </Commands>
        <Select
          ref={this.refSelect.setter}
          {...unusedProps(this.props, this.constructor.propTypes)}
        />
      </div>
    );
  }

  focus() {
    return this.refSelect.map((select) => select.focus());
  }

  proxyKeyCode(keyCode) {
    return (e) =>
      this.props.refElement.map((el) => {
        const input = el.querySelector("input");
        if (!input) return null;

        if (!FakeKeyDownEvent) {
          FakeKeyDownEvent = class extends KeyboardEvent {
            constructor(kCode) {
              super("keydown", {
                key: KEY_CODE_TO_KEY[kCode] || "",
                keyCode: kCode,
                which: kCode,
                bubbles: true,
                cancelable: true,
              });
            }
          };
        }

        const fakeEvent = new FakeKeyDownEvent(keyCode);
        input.dispatchEvent(fakeEvent);
        return null;
      });
  }
}

export const TabbableSelect = makeTabbable(WrapSelect, {
  rootRefProp: "refElement",
  passCommands: true,
});
