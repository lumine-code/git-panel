/** @babel */

import Repository from "../lib/models/repository";
import State from "../lib/models/repository-states/state";

describe("Repository state lifecycle", () => {
  it("does not resolve a target constructor for a state that has been replaced", async () => {
    const repository = { state: {}, transition: jasmine.createSpy("transition") };
    const state = new State(repository);

    await state.transitionTo("UnregisteredState");

    expect(repository.transition).not.toHaveBeenCalled();
  });

  it("does not resume a loading transition after the repository was destroyed", async () => {
    let finishDiscovery;
    const discovery = new Promise((resolve) => (finishDiscovery = resolve));
    const repository = new Repository("/moving-repository", {
      resolveDotGitDir: () => discovery,
    });
    const loading = repository.state;
    repository.destroy();
    const transition = spyOn(repository, "transition").and.callThrough();
    // Capture the resumed transition to await it without relying on timers or
    // the load promise, which has already settled as the repository vanished.
    let completedTransition;
    spyOn(loading, "transitionTo").and.callFake((...args) => {
      completedTransition = State.prototype.transitionTo.call(loading, ...args);
      return completedTransition;
    });

    finishDiscovery(null);
    await discovery;
    await completedTransition;

    expect(loading.transitionTo).toHaveBeenCalledOnceWith("Empty");
    expect(transition).not.toHaveBeenCalled();
    expect(repository.isDestroyed()).toBe(true);
  });
});
