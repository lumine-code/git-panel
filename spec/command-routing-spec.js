/** @babel */
/** @jsx h */
import { h, flushViews, createViewHost, createViewModel } from "./helpers/etch.js";
import ConflictController from "../lib/controllers/conflict-controller.js";
import Dialog from "../lib/views/dialog-view.js";
import Commands, { Command } from "../lib/lumine/commands.js";

describe("Git command routing and availability", () => {
  let roots, elements, models;
  beforeEach(() => {
    roots = [];
    elements = [];
    models = [];
    jasmine.attachToDOM(lumine.workspace.getElement());
  });
  afterEach(async () => {
    for (const root of roots) await flushViews(async () => root.destroy());
    models.forEach((model) => model.willDestroy());
    elements.forEach((element) => element.remove());
  });
  function host() {
    const element = document.createElement("div");
    document.body.appendChild(element);
    elements.push(element);
    const root = createViewHost(element);
    roots.push(root);
    return root;
  }
  it("stops a clicked conflict action before the editor cursor resolver", async () => {
    const editor = await lumine.workspace.open();
    const target = document.createElement("button");
    editor.getElement().appendChild(target);
    const outer = jasmine.createSpy("editor cursor conflict"),
      inner = jasmine.createSpy("clicked conflict");
    await flushViews(async () =>
      host().update(
        <Commands registry={lumine.commands} target={editor.getElement()}>
          <Command command="git-panel:resolve-as-ours" callback={outer} />
        </Commands>,
      ),
    );
    const model = createViewModel(ConflictController, {
      editor,
      conflict: { getChosenSide: () => null, getSide: () => true },
      resolveAsSequence: inner,
    });
    model.updateState = () => {};
    models.push(model);
    spyOn(lumine.contextMenu, "show").and.returnValue({ destroy() {} });
    model.showResolveMenu({ target, preventDefault() {} });
    await lumine.commands.dispatch(target, "git-panel:resolve-as-ours");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    editor.destroy();
  });
  it("keeps disabled busy dialog acceptance unavailable to commands", async () => {
    const accept = jasmine.createSpy("accept");
    await flushViews(async () =>
      host().update(
        <Dialog
          workspace={lumine.workspace}
          commands={lumine.commands}
          tabGroup={{ appendElement() {}, removeElement() {} }}
          accept={accept}
          cancel={() => {}}
          acceptEnabled={false}
          inProgress={true}
        />,
      ),
    );
    const target = document.querySelector(".git-panel-Dialog");
    expect(target.querySelector("button.btn-primary").disabled).toBe(true);
    expect(lumine.commands.canDispatch(target, "core:confirm")).toBe(false);
    await lumine.commands.dispatch(target, "core:confirm");
    expect(accept).not.toHaveBeenCalled();
  });
});
