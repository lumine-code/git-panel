/** @babel */
/** @jsx h */
import path from "path";
import { View, h } from "../etch/view";
import { resolveQuery } from "../helpers";
import { CompositeDisposable } from "lumine";

import ObserveModel from "../views/observe-model";
import ResolutionProgress, { keyForPath } from "../models/conflicts/resolution-progress";
import EditorConflictController from "./editor-conflict-controller";

const DEFAULT_REPO_DATA = {
  mergeConflictPaths: [],
  isRebasing: false,
};

/**
 * Render an `EditorConflictController` for each `TextEditor` open on a file that contains git conflict markers.
 */
export default class RepositoryConflictController extends View {
  static defaultProps = {
    refreshResolutionProgress: () => {},
    resolutionProgress: new ResolutionProgress(),
  };

  constructor(props, children) {
    super(props, children);

    this.state = { openEditors: this.props.workspace.getTextEditors() };
    this.subscriptions = new CompositeDisposable();

    this.initialize();
  }

  didMount() {
    if (this.props.workspace.isDestroyed()) return;

    const updateState = () => {
      this.updateState({
        openEditors: this.props.workspace.getTextEditors(),
      });
    };

    this.subscriptions.add(
      this.props.workspace.observeTextEditors(updateState),
      this.props.workspace.onDidDestroyPaneItem(updateState),
      this.props.config.observe("git-panel.graphicalConflictResolution", () => this.invalidate()),
    );
  }

  fetchData = (repository) => {
    return resolveQuery({
      workingDirectoryPath: repository.getWorkingDirectoryPath(),
      mergeConflictPaths: repository.getMergeConflicts().then((conflicts) => {
        return conflicts.map((conflict) => conflict.filePath);
      }),
      isRebasing: repository.isRebasing(),
    });
  };

  render() {
    return h(
      "span",
      { style: { display: "contents" } },
      <ObserveModel model={this.props.repository} fetchData={this.fetchData}>
        {(data) => this.renderWithData(data || DEFAULT_REPO_DATA)}
      </ObserveModel>,
    );
  }

  renderWithData(repoData) {
    const conflictingEditors = this.getConflictingEditors(repoData);

    return (
      <div>
        {conflictingEditors.map((editor) => (
          <EditorConflictController
            key={editor.id}
            commands={this.props.commands}
            resolutionProgress={this.props.resolutionProgress}
            editor={editor}
            isRebase={repoData.isRebasing}
            refreshResolutionProgress={this.props.refreshResolutionProgress}
          />
        ))}
      </div>
    );
  }

  getConflictingEditors(repoData) {
    if (
      repoData.mergeConflictPaths.length === 0 ||
      this.state.openEditors.length === 0 ||
      !this.props.config.get("git-panel.graphicalConflictResolution")
    ) {
      return [];
    }

    const commonBasePath = this.props.repository.getWorkingDirectoryPath();
    const fullMergeConflictPaths = new Set(
      repoData.mergeConflictPaths.map((relativePath) =>
        keyForPath(path.join(commonBasePath, relativePath)),
      ),
    );

    return this.state.openEditors.filter((editor) => {
      const editorPath = editor.getPath();
      return editorPath && fullMergeConflictPaths.has(keyForPath(editorPath));
    });
  }

  willDestroy() {
    this.subscriptions.dispose();
  }
}
