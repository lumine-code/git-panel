/** @babel */
/** @jsx h */
import { View, h } from "../etch/view";

import InitDialog from "../views/init-dialog";
import CloneDialog from "../views/clone-dialog";
import OpenCommitDialog from "../views/open-commit-dialog";

const DIALOG_COMPONENTS = {
  null: null,
  init: InitDialog,
  clone: CloneDialog,
  commit: OpenCommitDialog,
};

export default class DialogsController extends View {
  constructor(props, children) {
    super(props, children);
    this.initialize();
  }

  state = {
    requestInProgress: null,
    requestError: [null, null],
  };

  render() {
    const DialogComponent = DIALOG_COMPONENTS[this.props.request.identifier];
    return h(
      "span",
      { style: { display: "contents" } },
      DialogComponent ? <DialogComponent {...this.getCommonProps()} /> : null,
    );
  }

  getCommonProps() {
    const { request } = this.props;
    const accept = request.isProgressing
      ? async (...args) => {
          this.updateState({ requestError: [null, null], requestInProgress: request });
          try {
            const result = await request.accept(...args);
            this.updateState({ requestInProgress: null });
            return result;
          } catch (error) {
            this.updateState({ requestError: [request, error], requestInProgress: null });
            return undefined;
          }
        }
      : (...args) => {
          this.updateState({ requestError: [null, null] });
          try {
            return request.accept(...args);
          } catch (error) {
            this.updateState({ requestError: [request, error] });
            return undefined;
          }
        };
    const wrapped = wrapDialogRequest(request, { accept });

    return {
      request: wrapped,
      inProgress: this.state.requestInProgress === request,
      workspace: this.props.workspace,
      commands: this.props.commands,
      config: this.props.config,
      error: this.state.requestError[0] === request ? this.state.requestError[1] : null,
    };
  }
}

class DialogRequest {
  constructor(identifier, params = {}) {
    this.identifier = identifier;
    this.params = params;
    this.isProgressing = false;
    this.accept = () => {};
    this.cancel = () => {};
  }

  onAccept(cb) {
    this.accept = cb;
  }

  onProgressingAccept(cb) {
    this.isProgressing = true;
    this.onAccept(cb);
  }

  onCancel(cb) {
    this.cancel = cb;
  }

  getParams() {
    return this.params;
  }
}

function wrapDialogRequest(original, { accept }) {
  const dup = new DialogRequest(original.identifier, original.params);
  dup.isProgressing = original.isProgressing;
  dup.onAccept(accept);
  dup.onCancel(original.cancel);
  return dup;
}

export const dialogRequests = {
  null: {
    identifier: "null",
    isProgressing: false,
    params: {},
    accept: () => {},
    cancel: () => {},
  },

  init({ dirPath }) {
    return new DialogRequest("init", { dirPath });
  },

  clone(opts) {
    return new DialogRequest("clone", {
      sourceURL: "",
      destPath: "",
      ...opts,
    });
  },

  credential(opts) {
    return new DialogRequest("credential", {
      includeUsername: false,
      includeRemember: false,
      prompt: "Please authenticate",
      ...opts,
    });
  },

  commit() {
    return new DialogRequest("commit");
  },
};
