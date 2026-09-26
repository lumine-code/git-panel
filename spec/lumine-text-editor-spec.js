/** @babel */
/** @jsx React.createElement */
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import LumineTextEditor from "../lib/lumine/lumine-text-editor";

describe("LumineTextEditor", () => {
  let container, root, wasActEnvironment;

  beforeEach(async () => {
    wasActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    await lumine.packages.activatePackage("language-text");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    global.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
  });

  it("uses Plain Text for an editor whose buffer it owns", async () => {
    await act(async () => root.render(<LumineTextEditor />));

    expect(container.querySelector("lumine-text-editor").getModel().getGrammar().scopeName).toBe(
      "text.plain",
    );
  });
});
