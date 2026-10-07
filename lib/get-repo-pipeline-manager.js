/** @babel */
import fs from "fs/promises";

import ActionPipelineManager from "./action-pipeline";
import { isGitError } from "./git-errors";
import {
  getCommitMessagePath,
  getCommitMessageEditors,
  destroyFilePatchPaneItems,
} from "./helpers";

// Note: Middleware that catches errors should re-throw the errors so that they propogate
// and other middleware in the pipeline can be made aware of the errors.
// Ultimately, the views are responsible for catching the errors and handling them accordingly

export default function ({ confirm, notificationManager, workspace }) {
  const pipelineManager = new ActionPipelineManager({
    actionNames: ["PUSH", "PULL", "FETCH", "COMMIT", "CHECKOUT", "ADDREMOTE"],
  });

  for (const actionKey of Object.values(pipelineManager.actionKeys)) {
    pipelineManager.getPipeline(actionKey).addMiddleware("report-policy-refusal", async (next) => {
      try {
        return await next();
      } catch (error) {
        if (error.outcome === "not-started" && error.code !== "ERR_GIT_OPERATION_CANCELLED")
          notificationManager.addWarning(error.message, { dismissable: true });
        throw error;
      }
    });
  }

  const pushPipeline = pipelineManager.getPipeline(pipelineManager.actionKeys.PUSH);

  pushPipeline.addMiddleware(
    "failed-to-push-error",
    async (next, repository, branchName, options) => {
      try {
        const result = await next();
        return result;
      } catch (error) {
        if (isGitError(error) && error.outcome !== "not-started") {
          if (/rejected[\s\S]*failed to push/.test(error.stderr)) {
            notificationManager.addError("Push rejected", {
              description:
                "The tip of your current branch is behind its remote counterpart." +
                " Try pulling before pushing.<br />To force push, hold `cmd` or `ctrl` while clicking.",
              dismissable: true,
            });
          } else {
            notificationManager.addError("Unable to push", {
              detail: error.stderr || error.message,
              dismissable: true,
            });
          }
        }
        throw error;
      }
    },
  );

  const pullPipeline = pipelineManager.getPipeline(pipelineManager.actionKeys.PULL);

  pullPipeline.addMiddleware("failed-to-pull-error", async (next, repository, branchName) => {
    try {
      const result = await next();
      return result;
    } catch (error) {
      if (isGitError(error) && error.outcome !== "not-started") {
        repository.didPullError();
        if (
          /error: Your local changes to the following files would be overwritten by merge/.test(
            error.stderr,
          )
        ) {
          const lines = error.stderr.split("\n");
          const files = lines
            .slice(3, lines.length - 3)
            .map((l) => `\`${l.trim()}\``)
            .join("\n");
          notificationManager.addError("Pull aborted", {
            description:
              "Local changes to the following would be overwritten by merge:<br/>" +
              files +
              "<br/>Please commit your changes or stash them before you merge.",
            dismissable: true,
          });
        } else if (
          /Automatic merge failed; fix conflicts and then commit the result./.test(error.stdout)
        ) {
          notificationManager.addWarning("Merge conflicts", {
            description: `Your local changes conflicted with changes made on the remote branch. Resolve the conflicts
              with the Git panel and commit to continue.`,
            dismissable: true,
          });
        } else if (/fatal: Not possible to fast-forward, aborting./.test(error.stderr)) {
          notificationManager.addWarning("Unmerged changes", {
            description:
              "Your local branch has diverged from its remote counterpart.<br/>" +
              "Merge or rebase your local work to continue.",
            dismissable: true,
          });
        } else {
          notificationManager.addError("Unable to pull", {
            detail: error.stderr || error.message,
            dismissable: true,
          });
        }
      }
      throw error;
    }
  });

  const fetchPipeline = pipelineManager.getPipeline(pipelineManager.actionKeys.FETCH);

  fetchPipeline.addMiddleware("failed-to-fetch-error", async (next, repository) => {
    try {
      const result = await next();
      return result;
    } catch (error) {
      if (isGitError(error) && error.outcome !== "not-started") {
        notificationManager.addError("Unable to fetch", {
          detail: error.stderr || error.message,
          dismissable: true,
        });
      }
      throw error;
    }
  });

  const checkoutPipeline = pipelineManager.getPipeline(pipelineManager.actionKeys.CHECKOUT);

  checkoutPipeline.addMiddleware(
    "failed-to-checkout-error",
    async (next, repository, branchName, options) => {
      try {
        const result = await next();
        return result;
      } catch (error) {
        if (isGitError(error) && error.outcome !== "not-started") {
          const message = options.createNew ? "Cannot create branch" : "Checkout aborted";
          let detail = undefined;
          let description = undefined;

          if ((error.stderr || "").match(/local changes.*would be overwritten/)) {
            const files = error.stderr
              .split(/\r?\n/)
              .filter((l) => l.startsWith("\t"))
              .map((l) => `\`${l.trim()}\``)
              .join("<br/>");
            description =
              "Local changes to the following would be overwritten:<br/>" +
              files +
              "<br/>Please commit your changes or stash them.";
          } else if ((error.stderr || "").match(/branch.*already exists/)) {
            description = `\`${branchName}\` already exists. Choose another branch name.`;
          } else if (
            (error.stderr || "").match(/error: you need to resolve your current index first/)
          ) {
            description = "You must first resolve merge conflicts.";
          }

          if (description === undefined && detail === undefined) {
            detail = error.stderr;
          }
          notificationManager.addError(message, { description, detail, dismissable: true });
        }
        throw error;
      }
    },
  );

  const commitPipeline = pipelineManager.getPipeline(pipelineManager.actionKeys.COMMIT);
  commitPipeline.addMiddleware("confirm-commit", async (next, repository) => {
    async function confirmCommit() {
      const choice = await confirm({
        message: "One or more text editors for the commit message are unsaved.",
        detail: "Do you want to commit and close all open commit message editors?",
        buttons: ["Commit", "Cancel"],
      });
      return choice === 0;
    }

    const commitMessageEditors = getCommitMessageEditors(repository, workspace);
    if (commitMessageEditors.length > 0) {
      if (
        !commitMessageEditors.some((e) => e.getFileState() !== "unmodified") ||
        (await confirmCommit())
      ) {
        await next();
        commitMessageEditors.forEach((editor) => editor.destroy());
      }
    } else {
      await next();
    }
  });
  commitPipeline.addMiddleware("clean-up-disk-commit-msg", async (next, repository) => {
    await next();
    try {
      await fs.rm(getCommitMessagePath(repository), { recursive: true, force: true });
    } catch (error) {
      // do nothing
    }
  });

  commitPipeline.addMiddleware("failed-to-commit-error", async (next, repository) => {
    try {
      const result = await next();
      const template = await repository.fetchCommitMessageTemplate();
      repository.setCommitMessage(template || "");
      destroyFilePatchPaneItems({ onlyStaged: true }, workspace);
      return result;
    } catch (error) {
      if (isGitError(error) && error.outcome !== "not-started") {
        notificationManager.addError("Unable to commit", {
          detail: error.stderr || error.message,
          dismissable: true,
        });
      }
      throw error;
    }
  });

  const addRemotePipeline = pipelineManager.getPipeline(pipelineManager.actionKeys.ADDREMOTE);
  addRemotePipeline.addMiddleware("failed-to-add-remote", async (next, repository, remoteName) => {
    try {
      return await next();
    } catch (error) {
      if (isGitError(error) && error.outcome !== "not-started") {
        let detail = error.stderr || error.message;
        if ((error.stderr || "").match(/^fatal: remote .* already exists\./)) {
          detail = `The repository already contains a remote named ${remoteName}.`;
        }
        notificationManager.addError("Cannot create remote", {
          detail,
          dismissable: true,
        });
      }

      throw error;
    }
  });

  return pipelineManager;
}
