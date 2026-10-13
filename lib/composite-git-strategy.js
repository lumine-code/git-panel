/** @babel */
import { createRequire } from "node:module";
import os from "os";

import { firstImplementer } from "./helpers.js";
import AsyncQueue from "./async-queue.js";

const require = import.meta.require ?? createRequire(import.meta.url);

let GitShellOutStrategy;

function getGitShellOutStrategy() {
  if (!GitShellOutStrategy) {
    const gitShellOutStrategyModule = require("./git-shell-out-strategy");
    GitShellOutStrategy = gitShellOutStrategyModule.default || gitShellOutStrategyModule;
  }
  return GitShellOutStrategy;
}

export default {
  create(workingDir, options = {}) {
    return this.withStrategies([getGitShellOutStrategy()])(workingDir, options);
  },

  withStrategies(strategies) {
    return function createForStrategies(workingDir, options = {}) {
      const parallelism = options.parallelism || Math.max(3, os.cpus().length);
      const commandQueue = new AsyncQueue({ parallelism });
      const strategyOptions = { ...options, queue: commandQueue };

      const strategyInstances = strategies.map(
        (Strategy) => new Strategy(workingDir, strategyOptions),
      );
      return firstImplementer(...strategyInstances);
    };
  },
};
