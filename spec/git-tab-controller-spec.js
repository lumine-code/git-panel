/** @babel */

import GitTabController from "../lib/controllers/git-tab-controller";

describe("GitTabController identity editor state", () => {
  const repository = {
    isPresent: () => true,
  };

  const propsWith = (overrides = {}) => ({
    fetchInProgress: false,
    repository,
    repositoryDrift: false,
    username: "Author",
    email: "author@example.com",
    ...overrides,
  });

  it("automatically opens while a loaded identity is incomplete", () => {
    const nextState = GitTabController.getDerivedStateFromProps(propsWith({ email: "" }), {
      editingIdentity: false,
      manuallyEditingIdentity: false,
    });

    expect(nextState.editingIdentity).toBe(true);
  });

  it("closes an automatic prompt when a later read finds a complete identity", () => {
    const nextState = GitTabController.getDerivedStateFromProps(propsWith(), {
      editingIdentity: true,
      manuallyEditingIdentity: false,
    });

    expect(nextState.editingIdentity).toBe(false);
  });

  it("does not open automatically for provisional loading data", () => {
    const nextState = GitTabController.getDerivedStateFromProps(
      propsWith({ email: "", fetchInProgress: true }),
      {
        editingIdentity: false,
        manuallyEditingIdentity: false,
      },
    );

    expect(nextState.editingIdentity).toBe(false);
  });

  it("preserves an identity editor that was opened manually", () => {
    const nextState = GitTabController.getDerivedStateFromProps(propsWith(), {
      editingIdentity: true,
      manuallyEditingIdentity: true,
    });

    expect(nextState).toBeNull();
  });
});
