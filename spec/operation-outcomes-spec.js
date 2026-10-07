/** @babel */
import GitShellOutStrategy from "../lib/git-shell-out-strategy";
import createPipelineManager from "../lib/get-repo-pipeline-manager";
import OperationStates from "../lib/models/operation-states";

describe("shared Git operation outcomes", () => {
  it("reports queued operations from another surface's shared workflow", () => {
    let pending = [
      { name: "workflow:commit", status: "queued" },
      { name: "workflow:push", status: "running" },
    ];
    const states = new OperationStates({
      getOperations: () => ({ getPendingOperations: () => pending }),
    });
    expect(states.isCommitInProgress()).toBe(true);
    expect(states.isPushInProgress()).toBe(true);
    expect(states.isFetchInProgress()).toBe(false);
    pending = [];
    expect(states.isCommitInProgress()).toBe(false);
    expect(states.isPushInProgress()).toBe(false);
  });
  it("preserves the core operation error and all of its diagnostics", async () => {
    const strategy = new GitShellOutStrategy("/repository");
    const failure = Object.assign(new Error("Commit refused"), {
      code: "ERR_GIT_COMMIT",
      exitCode: 1,
      stderr: "hook refused",
      stdout: "hook output",
      outcome: "unknown",
    });
    spyOn(strategy, "getRepositoryOperations").and.resolveTo({
      commit: () => Promise.reject(failure),
    });
    spyOn(strategy, "fetchCommitMessageTemplate").and.resolveTo(null);
    spyOn(strategy, "getConfig").and.resolveTo(null);
    try {
      await expectAsync(strategy.commit("Message", {})).toBeRejectedWith(failure);
      expect(failure.code).toBe("ERR_GIT_COMMIT");
      expect(failure.exitCode).toBe(1);
      expect(failure.stderr).toBe("hook refused");
      expect(failure.stdErr).toBeUndefined();
    } finally {
      strategy.destroy();
    }
  });
  for (const [code, warnings] of [
    ["ERR_GIT_OPERATION_CANCELLED", 0],
    ["ERR_GIT_OPERATION_BLOCKED", 1],
  ]) {
    it(`reports ${code} without describing an unstarted action as a failed push`, async () => {
      const notifications = {
        addWarning: jasmine.createSpy("warning"),
        addError: jasmine.createSpy("error"),
      };
      const manager = createPipelineManager({
        notificationManager: notifications,
        workspace: lumine.workspace,
      });
      const refusal = Object.assign(new Error("The operation was not started."), {
        code,
        outcome: "not-started",
      });
      const pipeline = manager.getPipeline(manager.actionKeys.PUSH);
      await expectAsync(pipeline.run(() => Promise.reject(refusal), {})).toBeRejectedWith(refusal);
      expect(notifications.addError).not.toHaveBeenCalled();
      expect(notifications.addWarning).toHaveBeenCalledTimes(warnings);
    });
  }
});
