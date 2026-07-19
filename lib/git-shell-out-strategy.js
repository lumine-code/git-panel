/** @babel */
/** @jsx React.createElement */
import path from "path";
import os from "os";
import childProcess from "child_process";
import fs from "fs/promises";
import util from "util";
import { CompositeDisposable } from "atom";
import { parsePatch } from "diff";

function parseDiff(rawDiffStr) {
  const headingRegex = /^@@[^@]*@@[ \t]*(.*)/gm;
  const headings = [];
  let m;
  while ((m = headingRegex.exec(rawDiffStr)) !== null) {
    headings.push(m[1].trimEnd());
  }

  let headingIdx = 0;
  return parsePatch(rawDiffStr).map((patch) => {
    let status;
    if (patch.isCreate) status = "added";
    else if (patch.isDelete) status = "deleted";
    else if (patch.isRename) status = "renamed";
    else status = "modified";

    const normalizePath = (p) => (!p || p === "/dev/null" ? null : p.replace(/^[ab]\//, ""));

    return {
      status,
      oldPath: normalizePath(patch.oldFileName),
      newPath: normalizePath(patch.newFileName),
      oldMode: patch.oldMode || null,
      newMode: patch.newMode || null,
      hunks: (patch.hunks || []).map((hunk) => ({
        oldStartLine: hunk.oldStart,
        oldLineCount: hunk.oldLines,
        newStartLine: hunk.newStart,
        newLineCount: hunk.newLines,
        heading: headings[headingIdx++] || "",
        lines: hunk.lines,
      })),
    };
  });
}
// Git's well-known empty-tree object id, used as the "parent" of a root commit
// so its full change set can be produced with an ordinary commit-to-commit diff.
const EMPTY_TREE_OID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// Derive the `%(upstream:remotename)`/`%(upstream:remoteref)` fields git
// for-each-ref would emit from a fully-qualified tracking ref such as
// `refs/remotes/origin/main` → `{ remoteName: "origin", remoteRef: "refs/heads/main" }`.
function splitRemoteRef(ref) {
  const match = /^refs\/remotes\/([^/]+)\/(.+)$/.exec(ref || "");
  if (!match) {
    return { remoteName: "", remoteRef: "" };
  }
  return { remoteName: match[1], remoteRef: `refs/heads/${match[2]}` };
}

import GitPromptServer from "./git-prompt-server";
import GitTempDir from "./git-temp-dir";
import AsyncQueue from "./async-queue";

import {
  getAtomHelperPath,
  extractCoAuthorsAndRawCommitMessage,
  fileExists,
  isFileExecutable,
  isFileSymlink,
  isBinary,
  normalizeGitHelperPath,
  toNativePathSep,
  toGitPathSep,
  LINE_ENDING_REGEX,
  CO_AUTHOR_REGEX,
} from "./helpers";
import GitTimingsView from "./views/git-timings-view";
import File from "./models/patch/file";
import Author from "./models/author";
import { GitError, LargeRepoError } from "./git-errors";

export { GitError, LargeRepoError };

// Working directories with more changed entries than this put the repository into the
// "too large" state, mirroring the 10 MB raw-output cap that applied when the package
// parsed `git status` itself.
const MAX_STATUS_ENTRY_COUNT = 50000;

/*
 * Rebuild the status bundle shape previously produced by `what-the-status` from Lumine's
 * status snapshot, so the rest of the package keeps consuming the same structure while
 * the `git status` subprocess is owned and shared by the core repository.
 */
function statusBundleFromSnapshot(snapshot) {
  const branch = { aheadBehind: { ahead: null, behind: null } };
  if (snapshot.head) {
    if (snapshot.head.unborn) {
      branch.oid = "(initial)";
    } else if (snapshot.head.oid) {
      branch.oid = snapshot.head.oid;
    }
    if (snapshot.head.detached) {
      branch.head = "(detached)";
    } else if (snapshot.head.name) {
      branch.head = snapshot.head.name;
    }
  }
  if (snapshot.upstream) {
    branch.upstream = snapshot.upstream.name;
    branch.aheadBehind = { ahead: snapshot.upstream.ahead, behind: snapshot.upstream.behind };
  }

  const changedEntries = [];
  const untrackedEntries = [];
  const renamedEntries = [];
  const unmergedEntries = [];

  for (const entry of snapshot.files) {
    if (entry.ignored) {
      continue;
    }
    // Preserve the `--ignore-submodules=dirty` flag of the previous direct status call:
    // worktree-only dirt inside a submodule is not a change of this repository.
    if (
      entry.submodule.isSubmodule &&
      !entry.submodule.commitChanged &&
      entry.indexStatus == null
    ) {
      continue;
    }

    const filePath = toNativePathSep(entry.path);
    const stagedStatus = entry.indexStatus || undefined;
    const unstagedStatus = entry.worktreeStatus || undefined;

    if (entry.kind === "untracked") {
      untrackedEntries.push({ filePath });
    } else if (entry.kind === "renamed" || entry.kind === "copied") {
      renamedEntries.push({
        filePath,
        origFilePath: toNativePathSep(entry.originalPath),
        stagedStatus,
        unstagedStatus,
      });
    } else if (entry.kind === "unmerged") {
      unmergedEntries.push({
        filePath,
        stagedStatus: entry.indexStatus,
        unstagedStatus: entry.worktreeStatus,
      });
    } else {
      changedEntries.push({ filePath, stagedStatus, unstagedStatus });
    }
  }

  return {
    branch,
    changedEntries,
    untrackedEntries,
    renamedEntries,
    unmergedEntries,
    ignoredEntries: [],
  };
}

let headless = null;
let execPathPromise = null;

const DISABLE_COLOR_FLAGS = ["branch", "diff", "showBranch", "status", "ui"].reduce((acc, type) => {
  acc.unshift("-c", `color.${type}=false`);
  return acc;
}, []);

/**
 * Expand config path name per
 * https://git-scm.com/docs/git-config#git-config-pathname
 * this regex attempts to get the specified user's home directory
 * Ex: on Mac ~kuychaco/ is expanded to the specified user’s home directory (/Users/kuychaco)
 * Regex translation:
 * ^~ line starts with tilde
 * ([^\\\\/]*)[\\\\/] captures non-slash characters before first slash
 */
const EXPAND_TILDE_REGEX = new RegExp("^~([^\\\\/]*)[\\\\/]");

export default class GitShellOutStrategy {
  static defaultExecArgs = {
    stdin: null,
    useGitPromptServer: false,
    useGpgWrapper: false,
    useGpgAtomPrompt: false,
    writeOperation: false,
  };

  constructor(workingDir, options = {}) {
    this.workingDir = workingDir;
    if (options.queue) {
      this.commandQueue = options.queue;
    } else {
      const parallelism = options.parallelism || Math.max(3, os.cpus().length);
      this.commandQueue = new AsyncQueue({ parallelism });
    }

    this.prompt = options.prompt || ((query) => Promise.reject());
    this.workerManager = options.workerManager;
    this.destroyed = false;
    this.repositoryLease = null;
    this.coreRepositoryPromise = null;
    this.lastStatusSnapshotGeneration = 0;

    if (headless === null) {
      headless = !atom.getCurrentWindow().isVisible();
    }
  }

  /*
   * Resolve the Lumine repository for this working directory through atom.repositories and hold a
   * lease on it so the registry keeps it alive while this strategy reads from it and delegates
   * operations to it.
   */
  getCoreRepository() {
    const lease = this.repositoryLease;
    if (lease) {
      if (!lease.repository.isDestroyed()) {
        return Promise.resolve(lease.repository);
      }
      lease.dispose();
      this.repositoryLease = null;
    }

    if (!this.coreRepositoryPromise) {
      this.coreRepositoryPromise = atom.repositories
        .add(this.workingDir, { persist: false })
        .then((acquired) => {
          this.coreRepositoryPromise = null;
          if (!acquired) {
            return null;
          }
          if (this.destroyed) {
            acquired.dispose();
            return null;
          }
          if (this.repositoryLease) {
            this.repositoryLease.dispose();
          }
          this.repositoryLease = acquired;
          return acquired.repository;
        })
        .catch((error) => {
          this.coreRepositoryPromise = null;
          throw error;
        });
    }
    return this.coreRepositoryPromise;
  }

  async getRepositoryOperations() {
    const repository = await this.getCoreRepository();
    return repository ? repository.getOperations() : null;
  }

  // Resolve the core refs snapshot for this repository, loading it on first use.
  // The panel's branch/remote caches are invalidated by the core refs-snapshot
  // change event, so an already-initialized snapshot is exactly the fresh data
  // that triggered the invalidation.
  async getRefsSnapshot() {
    const repository = await this.getCoreRepository();
    if (!repository) {
      return null;
    }
    const snapshot = repository.getRefsSnapshot();
    return snapshot.initialized ? snapshot : repository.ensureRefsSnapshot();
  }

  // The base revision for a "staged" (index) diff: HEAD normally, or the empty
  // tree before the first commit so `git diff --cached` still resolves.
  async stagedBaseRevision(repository) {
    const status = repository.getStatusSnapshot();
    const head = status.initialized ? status.head : (await repository.ensureStatusSnapshot()).head;
    return head && head.unborn ? EMPTY_TREE_OID : "HEAD";
  }

  /*
   * Run a repository write operation through the atom.repositories facade. The registry serializes
   * operations per repository and refreshes Lumine's own status, refs, and index caches before the
   * returned promise resolves, so every other consumer of this repository observes the change.
   */
  runRepositoryOperation(operationName, invoke, options = {}) {
    const { useGitPromptServer, useGpgWrapper, useGpgAtomPrompt, writeOperation } = options;
    const diagnosticsEnabled =
      process.env.ATOM_GITHUB_GIT_DIAGNOSTICS || atom.config.get("git-panel.gitDiagnostics");
    const formattedOperation = `git ${operationName} in ${this.workingDir}`;
    const timingMarker = GitTimingsView.generateMarker(`git ${operationName}`);
    timingMarker.mark("queued");

    return this.commandQueue.push(
      async () => {
        timingMarker.mark("prepare");
        const operations = await this.getRepositoryOperations();
        if (!operations) {
          const error = new GitError(
            `${formattedOperation} failed: the directory does not belong to a Git repository`,
          );
          error.command = formattedOperation;
          throw error;
        }

        const { env, config, gitPromptServer } = await this.prepareGitEnvironment({
          useGitPromptServer,
          useGpgWrapper,
          useGpgAtomPrompt,
          diagnosticsEnabled,
        });

        const subscriptions = new CompositeDisposable();
        // The git subprocess runs in the git-host worker, so its pid never
        // reaches the renderer (processCallback cannot cross IPC). Cancel it with
        // an AbortSignal instead — the worker's exec op aborts the child when the
        // signal fires.
        const abortController = new AbortController();
        let expectCancel = false;
        if (gitPromptServer) {
          subscriptions.add(
            gitPromptServer.onDidCancel(async ({ handlerPid }) => {
              expectCancel = true;
              abortController.abort();

              // On Windows the SSH_ASKPASS handler is executed as a non-child process, so it must
              // be killed after the git process to keep git from falling back to GIT_ASKPASS.
              await new Promise((resolveKill, rejectKill) => {
                require("tree-kill")(handlerPid, "SIGTERM", (err) => {
                  /* istanbul ignore if */
                  if (err) {
                    rejectKill(err);
                  } else {
                    resolveKill();
                  }
                });
              });
            }),
          );
        }

        const executionOptions = {
          env,
          config,
          signal: abortController.signal,
        };

        timingMarker.mark("execute");
        try {
          const result = await invoke(operations, executionOptions);
          /* istanbul ignore if */
          if (diagnosticsEnabled) {
            // eslint-disable-next-line no-console
            console.log(`${formattedOperation}: delegated to atom.repositories`);
          }
          return result;
        } catch (error) {
          if (expectCancel) {
            return null;
          }
          throw this.translateRepositoryOperationError(error, formattedOperation);
        } finally {
          timingMarker.finalize();
          if (gitPromptServer) {
            gitPromptServer.terminate();
          }
          subscriptions.dispose();
        }
      },
      { parallel: !writeOperation },
    );
  }

  translateRepositoryOperationError(error, formattedOperation) {
    if (!error || typeof error.exitCode !== "number") {
      return error;
    }
    const stdout = error.stdout != null ? String(error.stdout) : "";
    const stderr = error.stderr != null ? String(error.stderr) : "";
    const gitError = new GitError(
      `${formattedOperation} exited with code ${error.exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`,
    );
    gitError.code = error.exitCode;
    gitError.stdErr = stderr;
    gitError.stdOut = stdout;
    gitError.command = formattedOperation;
    return gitError;
  }

  async withGpgFallback(operationName, invoke, options = {}) {
    try {
      return await this.runRepositoryOperation(operationName, invoke, {
        ...options,
        useGpgWrapper: true,
        useGpgAtomPrompt: false,
      });
    } catch (e) {
      if (/gpg failed/.test(e.stdErr)) {
        return await this.runRepositoryOperation(operationName, invoke, {
          ...options,
          useGitPromptServer: true,
          useGpgWrapper: true,
          useGpgAtomPrompt: true,
        });
      } else {
        throw e;
      }
    }
  }

  /*
   * Provide an asynchronous callback to be used to request input from the user for git operations.
   *
   * `prompt` must be a callable that accepts a query object `{prompt, includeUsername}` and returns a Promise
   * that either resolves with a result object `{[username], password}` or rejects on cancellation.
   */
  setPromptCallback(prompt) {
    this.prompt = prompt;
  }

  /*
   * Assemble the environment and Git configuration shared by direct executions and operations
   * delegated to atom.repositories. Returns the started GitPromptServer when one was requested;
   * the caller is responsible for terminating it.
   */
  async prepareGitEnvironment({
    useGitPromptServer,
    useGpgWrapper,
    useGpgAtomPrompt,
    diagnosticsEnabled,
  }) {
    if (execPathPromise === null) {
      // Attempt to collect the --exec-path from a native git installation.
      execPathPromise = new Promise((resolve) => {
        childProcess.exec("git --exec-path", (error, stdout) => {
          /* istanbul ignore if */
          if (error) {
            // Oh well
            resolve(null);
            return;
          }

          resolve(stdout.trim());
        });
      });
    }
    const execPath = await execPathPromise;

    const pathParts = [];
    if (process.env.PATH) {
      pathParts.push(process.env.PATH);
    }
    if (execPath) {
      pathParts.push(execPath);
    }

    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      PATH: pathParts.join(path.delimiter),
      ELECTRON_ENABLE_LOGGING: "0",
      CHROME_LOG_FILE: process.platform === "win32" ? "nul" : "/dev/null",
    };

    const config = {};
    if (atom.config.get("git-panel.allowDubiousOwnership")) {
      config["safe.directory"] = "*";
    }

    const gitTempDir = new GitTempDir();
    let gitPromptServer = null;

    if (useGpgWrapper) {
      await gitTempDir.ensure();
      config["gpg.program"] = gitTempDir.getGpgWrapperSh();
    }

    if (useGitPromptServer) {
      gitPromptServer = new GitPromptServer(gitTempDir);
      await gitPromptServer.start(this.prompt);

      env.ATOM_GITHUB_TMP = gitTempDir.getRootPath();
      env.ATOM_GITHUB_ASKPASS_PATH = normalizeGitHelperPath(gitTempDir.getAskPassJs());
      env.ATOM_GITHUB_CREDENTIAL_PATH = normalizeGitHelperPath(gitTempDir.getCredentialHelperJs());
      env.ATOM_GITHUB_ELECTRON_PATH = normalizeGitHelperPath(getAtomHelperPath());
      env.ATOM_GITHUB_SOCK_ADDR = gitPromptServer.getAddress();

      env.ATOM_GITHUB_WORKDIR_PATH = this.workingDir;
      env.ATOM_GITHUB_GIT_PATH = atom.repositories.getGitExecutablePath();
      if (!env.ATOM_GITHUB_GIT_PATH) {
        throw new Error("Lumine's repository API did not provide an embedded Git executable");
      }

      // "ssh" won't respect SSH_ASKPASS unless:
      // (a) it's running without a tty
      // (b) DISPLAY is set to something nonempty
      // But, on a Mac, DISPLAY is unset. Ensure that it is so our SSH_ASKPASS is respected.
      if (!process.env.DISPLAY || process.env.DISPLAY.length === 0) {
        env.DISPLAY = "atom-github-placeholder";
      }

      env.ATOM_GITHUB_ORIGINAL_PATH = process.env.PATH || "";
      env.ATOM_GITHUB_ORIGINAL_GIT_ASKPASS = process.env.GIT_ASKPASS || "";
      env.ATOM_GITHUB_ORIGINAL_SSH_ASKPASS = process.env.SSH_ASKPASS || "";
      env.ATOM_GITHUB_ORIGINAL_GIT_SSH_COMMAND = process.env.GIT_SSH_COMMAND || "";
      env.ATOM_GITHUB_SPEC_MODE = atom.inSpecMode() ? "true" : "false";

      env.SSH_ASKPASS = normalizeGitHelperPath(gitTempDir.getAskPassSh());
      env.GIT_ASKPASS = normalizeGitHelperPath(gitTempDir.getAskPassSh());

      if (process.platform === "linux") {
        env.GIT_SSH_COMMAND = gitTempDir.getSshWrapperSh();
      } else if (process.env.GIT_SSH_COMMAND) {
        env.GIT_SSH_COMMAND = process.env.GIT_SSH_COMMAND;
      } else {
        env.GIT_SSH = process.env.GIT_SSH;
      }

      config["credential.helper"] = normalizeGitHelperPath(gitTempDir.getCredentialHelperSh());
    }

    if (useGpgWrapper && useGitPromptServer && useGpgAtomPrompt) {
      env.ATOM_GITHUB_GPG_PROMPT = "true";
    }

    /* istanbul ignore if */
    if (diagnosticsEnabled) {
      env.GIT_TRACE = "true";
      env.GIT_TRACE_CURL = "true";
    }

    return { env, config, gitPromptServer };
  }

  // Execute a command and read the output using the embedded Git environment
  async exec(args, options = GitShellOutStrategy.defaultExecArgs) {
    /* eslint-disable no-console,no-control-regex */
    const { stdin, useGitPromptServer, useGpgWrapper, useGpgAtomPrompt, writeOperation } = options;
    const commandName = args[0];
    const subscriptions = new CompositeDisposable();
    const diagnosticsEnabled =
      process.env.ATOM_GITHUB_GIT_DIAGNOSTICS || atom.config.get("git-panel.gitDiagnostics");

    const formattedArgs = `git ${args.join(" ")} in ${this.workingDir}`;
    const timingMarker = GitTimingsView.generateMarker(`git ${args.join(" ")}`);
    timingMarker.mark("queued");

    args.unshift(...DISABLE_COLOR_FLAGS);

    return this.commandQueue.push(
      async () => {
        timingMarker.mark("prepare");
        const { env, config, gitPromptServer } = await this.prepareGitEnvironment({
          useGitPromptServer,
          useGpgWrapper,
          useGpgAtomPrompt,
          diagnosticsEnabled,
        });
        for (const [key, value] of Object.entries(config)) {
          args.unshift("-c", `${key}=${value}`);
        }

        let opts = { env };

        if (stdin) {
          opts.stdin = stdin;
          opts.stdinEncoding = "utf8";
        }

        /* istanbul ignore if */
        if (process.env.PRINT_GIT_TIMES) {
          console.time(`git:${formattedArgs}`);
        }

        return new Promise(async (resolve, reject) => {
          if (options.beforeRun) {
            const newArgsOpts = await options.beforeRun({ args, opts });
            args = newArgsOpts.args;
            opts = newArgsOpts.opts;
          }
          const { promise, cancel } = this.executeGitCommand(args, opts, timingMarker);
          let expectCancel = false;
          if (gitPromptServer) {
            subscriptions.add(
              gitPromptServer.onDidCancel(async ({ handlerPid }) => {
                expectCancel = true;
                await cancel();

                // On Windows, the SSH_ASKPASS handler is executed as a non-child process, so the bin\git-askpass-atom.sh
                // process does not terminate when the git process is killed.
                // Kill the handler process *after* the git process has been killed to ensure that git doesn't have a
                // chance to fall back to GIT_ASKPASS from the credential handler.
                await new Promise((resolveKill, rejectKill) => {
                  require("tree-kill")(handlerPid, "SIGTERM", (err) => {
                    /* istanbul ignore if */
                    if (err) {
                      rejectKill(err);
                    } else {
                      resolveKill();
                    }
                  });
                });
              }),
            );
          }

          const { stdout, stderr, exitCode, signal, timing } = await promise.catch((err) => {
            if (err.signal) {
              return { signal: err.signal };
            }
            reject(err);
            return {};
          });

          if (timing) {
            const { execTime, spawnTime, ipcTime } = timing;
            const now = performance.now();
            timingMarker.mark("nexttick", now - execTime - spawnTime - ipcTime);
            timingMarker.mark("execute", now - execTime - ipcTime);
            timingMarker.mark("ipc", now - ipcTime);
          }
          timingMarker.finalize();

          /* istanbul ignore if */
          if (process.env.PRINT_GIT_TIMES) {
            console.timeEnd(`git:${formattedArgs}`);
          }

          if (gitPromptServer) {
            gitPromptServer.terminate();
          }
          subscriptions.dispose();

          /* istanbul ignore if */
          if (diagnosticsEnabled) {
            const exposeControlCharacters = (raw) => {
              if (!raw) {
                return "";
              }

              return raw.replace(/\u0000/gu, "<NUL>\n").replace(/\u001F/gu, "<SEP>");
            };

            if (headless) {
              let summary = `git:${formattedArgs}\n`;
              if (exitCode !== undefined) {
                summary += `exit status: ${exitCode}\n`;
              } else if (signal) {
                summary += `exit signal: ${signal}\n`;
              }
              if (stdin && stdin.length !== 0) {
                summary += `stdin:\n${exposeControlCharacters(stdin)}\n`;
              }
              summary += "stdout:";
              if (stdout.length === 0) {
                summary += " <empty>\n";
              } else {
                summary += `\n${exposeControlCharacters(stdout)}\n`;
              }
              summary += "stderr:";
              if (stderr.length === 0) {
                summary += " <empty>\n";
              } else {
                summary += `\n${exposeControlCharacters(stderr)}\n`;
              }

              console.log(summary);
            } else {
              const headerStyle = "font-weight: bold; color: blue;";

              console.groupCollapsed(`git:${formattedArgs}`);
              if (exitCode !== undefined) {
                console.log(
                  "%cexit status%c %d",
                  headerStyle,
                  "font-weight: normal; color: black;",
                  exitCode,
                );
              } else if (signal) {
                console.log(
                  "%cexit signal%c %s",
                  headerStyle,
                  "font-weight: normal; color: black;",
                  signal,
                );
              }
              console.log(
                "%cfull arguments%c %s",
                headerStyle,
                "font-weight: normal; color: black;",
                util.inspect(args, { breakLength: Infinity }),
              );
              if (stdin && stdin.length !== 0) {
                console.log("%cstdin", headerStyle);
                console.log(exposeControlCharacters(stdin));
              }
              console.log("%cstdout", headerStyle);
              console.log(exposeControlCharacters(stdout));
              console.log("%cstderr", headerStyle);
              console.log(exposeControlCharacters(stderr));
              console.groupEnd();
            }
          }

          if (exitCode !== 0 && !expectCancel) {
            const err = new GitError(
              `${formattedArgs} exited with code ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`,
            );
            err.code = exitCode;
            err.stdErr = stderr;
            err.stdOut = stdout;
            err.command = formattedArgs;
            reject(err);
          }

          resolve(stdout);
        });
      },
      { parallel: !writeOperation },
    );
    /* eslint-enable no-console,no-control-regex */
  }

  executeGitCommand(args, options, marker = null) {
    marker && marker.mark("nexttick");

    // The git subprocess runs in the git-host worker, so cancellation goes
    // through an AbortSignal rather than the (IPC-unreachable) child pid.
    const abortController = new AbortController();
    options.signal = abortController.signal;

    const promise = atom.repositories.executeGit(args, this.workingDir, options);
    marker && marker.mark("execute");
    return {
      promise,
      cancel: () => {
        abortController.abort();
        return Promise.resolve();
      },
    };
  }

  async resolveDotGitDir() {
    try {
      await fs.stat(this.workingDir); // fails if folder doesn't exist
      const repository = await this.getCoreRepository();
      return repository ? toNativePathSep(repository.getPath()) : null;
    } catch (e) {
      return null;
    }
  }

  init() {
    return this.exec(["init", this.workingDir]);
  }

  /**
   * Staging/Unstaging files and patches and committing
   */
  stageFiles(paths) {
    if (paths.length === 0) {
      return Promise.resolve(null);
    }
    const gitPaths = paths.map(toGitPathSep);
    return this.runRepositoryOperation(
      "add",
      (operations, options) => operations.stageFiles(gitPaths, options),
      { writeOperation: true },
    );
  }

  async fetchCommitMessageTemplate() {
    let templatePath = await this.getConfig("commit.template");
    if (!templatePath) {
      return null;
    }

    const homeDir = os.homedir();

    templatePath = templatePath.trim().replace(EXPAND_TILDE_REGEX, (_, user) => {
      // if no user is specified, fall back to using the home directory.
      return `${user ? path.join(path.dirname(homeDir), user) : homeDir}/`;
    });
    templatePath = toNativePathSep(templatePath);

    if (!path.isAbsolute(templatePath)) {
      templatePath = path.join(this.workingDir, templatePath);
    }

    if (!(await fileExists(templatePath))) {
      throw new Error(`Invalid commit template path set in Git config: ${templatePath}`);
    }
    return await fs.readFile(templatePath, { encoding: "utf8" });
  }

  unstageFiles(paths, commit = "HEAD") {
    if (paths.length === 0) {
      return Promise.resolve(null);
    }
    const gitPaths = paths.map(toGitPathSep);
    return this.runRepositoryOperation(
      "reset",
      (operations, options) =>
        // Omitting the reference for HEAD lets the facade unstage in an unborn
        // repository, where there is no HEAD to reset against.
        operations.unstageFiles(
          gitPaths,
          commit === "HEAD" ? options : { ...options, reference: commit },
        ),
      { writeOperation: true },
    );
  }

  stageFileModeChange(filename, newMode) {
    return this.runRepositoryOperation(
      "update-index",
      (operations, options) => operations.stageFileModeChange(filename, newMode, options),
      { writeOperation: true },
    );
  }

  stageFileSymlinkChange(filename) {
    return this.runRepositoryOperation(
      "rm",
      (operations, options) => operations.stageFileSymlinkChange(filename, options),
      { writeOperation: true },
    );
  }

  applyPatch(patch, { index } = {}) {
    return this.runRepositoryOperation(
      "apply",
      (operations, options) => operations.applyPatch(patch, { ...options, index }),
      { writeOperation: true },
    );
  }

  async commit(rawMessage, { allowEmpty, amend, coAuthors, verbatim } = {}) {
    let msg;

    // if amending and no new message is passed, use last commit's message. Ensure that we don't
    // mangle it in the process.
    if (amend && rawMessage.length === 0) {
      const { unbornRef, messageBody, messageSubject } = await this.getHeadCommit();
      if (unbornRef) {
        msg = rawMessage;
      } else {
        msg = `${messageSubject}\n\n${messageBody}`.trim();
        verbatim = true;
      }
    } else {
      msg = rawMessage;
    }

    // if commit template is used, strip commented lines from commit
    // to be consistent with command line git.
    const template = await this.fetchCommitMessageTemplate();
    if (template) {
      // respecting the comment character from user settings or fall back to # as default.
      // https://git-scm.com/docs/git-config#git-config-corecommentChar
      let commentChar = await this.getConfig("core.commentChar");
      if (!commentChar) {
        commentChar = "#";
      }
      msg = msg
        .split("\n")
        .filter((line) => !line.startsWith(commentChar))
        .join("\n");
    }

    // Determine the cleanup mode.
    let cleanup;
    if (!verbatim) {
      const configured = await this.getConfig("commit.cleanup");
      cleanup = configured && configured !== "default" ? configured : "strip";
    }

    // add co-author commit trailers if necessary
    if (coAuthors && coAuthors.length > 0) {
      msg = await this.addCoAuthorsToMessage(msg, coAuthors);
    }

    const message = `${msg.trim()}\n`;

    return this.withGpgFallback(
      "commit",
      (operations, options) =>
        operations.commit(message, { ...options, amend, allowEmpty, verbatim, cleanup }),
      { writeOperation: true },
    );
  }

  addCoAuthorsToMessage(message, coAuthors = []) {
    const trimmed = message.trim();
    if (!coAuthors.length) {
      return `${trimmed}\n`;
    }

    const trailers = coAuthors.map((author) => `Co-Authored-By: ${author.name} <${author.email}>`);
    if (!trimmed) {
      return `${trailers.join("\n")}\n`;
    }

    // Append to an existing trailer block, otherwise separate it from the body
    // with a blank line, mirroring `git interpret-trailers`.
    const lines = trimmed.split("\n");
    const endsWithTrailer = /^[\w-]+:\s/.test(lines[lines.length - 1]);
    return `${trimmed}${endsWithTrailer ? "\n" : "\n\n"}${trailers.join("\n")}\n`;
  }

  /**
   * File Status and Diffs
   */
  async getStatusBundle() {
    const repository = await this.getCoreRepository();
    if (!repository) {
      const error = new GitError(
        `git status in ${this.workingDir} failed: the directory does not belong to a Git repository`,
      );
      error.command = `git status in ${this.workingDir}`;
      throw error;
    }

    // Reuse a snapshot that advanced since the last bundle build: the registry refreshes it
    // after every delegated write, and core consumers refresh it on their own triggers, so
    // rebuilding from those events costs no extra subprocess. A background reconcile catches
    // filesystem changes that raced with the advance; its result is deduplicated by content,
    // so it only produces another change event (and rebuild) when something really changed.
    const current = repository.getStatusSnapshot();
    let snapshot;
    if (current.initialized && current.generation !== this.lastStatusSnapshotGeneration) {
      snapshot = current;
      repository.scheduleStatusSnapshotRefresh?.();
    } else {
      snapshot = await repository.refreshStatusSnapshot();
    }
    this.lastStatusSnapshotGeneration = snapshot.generation;

    if (snapshot.counts.total > MAX_STATUS_ENTRY_COUNT) {
      throw new LargeRepoError();
    }

    return statusBundleFromSnapshot(snapshot);
  }

  // Resolve the core getDiff endpoint pair for a "staged"/"target"/worktree diff.
  async diffEndpoints(repository, { staged, target } = {}) {
    if (staged) {
      return {
        from: { type: "commit", revision: await this.stagedBaseRevision(repository) },
        to: { type: "index" },
      };
    }
    if (target) {
      return { from: { type: "commit", revision: target }, to: { type: "worktree" } };
    }
    return { from: { type: "index" }, to: { type: "worktree" } };
  }

  async diffFileStatus(options = {}) {
    const repository = await this.getCoreRepository();
    if (!repository) {
      return {};
    }
    const { from, to } = await this.diffEndpoints(repository, options);
    const { rawPatch } = await repository.getDiff({ from, to, detectRenames: false });

    const statusMap = { added: "added", modified: "modified", deleted: "deleted" };
    const fileStatuses = {};
    for (const diff of parseDiff(rawPatch)) {
      const filePath = toNativePathSep(diff.newPath || diff.oldPath);
      fileStatuses[filePath] = statusMap[diff.status] || diff.status;
    }
    if (!options.staged) {
      for (const filePath of await this.getUntrackedFiles()) {
        fileStatuses[filePath] = "added";
      }
    }
    return fileStatuses;
  }

  async getUntrackedFiles() {
    const repository = await this.getCoreRepository();
    if (!repository) {
      return [];
    }
    const snapshot = repository.getStatusSnapshot().initialized
      ? repository.getStatusSnapshot()
      : await repository.ensureStatusSnapshot();
    return snapshot.files
      .filter((entry) => entry.kind === "untracked" && !entry.ignored)
      .map((entry) => toNativePathSep(entry.path));
  }

  async getDiffsForFilePath(filePath, { staged, baseCommit } = {}) {
    const repository = await this.getCoreRepository();
    if (!repository) {
      return [];
    }

    let from, to;
    if (baseCommit) {
      from = { type: "commit", revision: baseCommit };
      to = staged ? { type: "index" } : { type: "worktree" };
    } else {
      ({ from, to } = await this.diffEndpoints(repository, { staged }));
    }

    const { rawPatch } = await repository.getDiff({
      from,
      to,
      paths: [toGitPathSep(filePath)],
      detectRenames: false,
      diffFilter: "u",
    });

    let rawDiffs = [];
    if (rawPatch) {
      rawDiffs = parseDiff(rawPatch).filter((rawDiff) => rawDiff.status !== "unmerged");

      for (let i = 0; i < rawDiffs.length; i++) {
        const rawDiff = rawDiffs[i];
        if (rawDiff.oldPath) {
          rawDiff.oldPath = toNativePathSep(rawDiff.oldPath);
        }
        if (rawDiff.newPath) {
          rawDiff.newPath = toNativePathSep(rawDiff.newPath);
        }
      }
    }

    if (!staged && (await this.getUntrackedFiles()).includes(filePath)) {
      // add untracked file
      const absPath = path.join(this.workingDir, filePath);
      const executable = await isFileExecutable(absPath);
      const symlink = await isFileSymlink(absPath);
      const contents = await fs.readFile(absPath, { encoding: "utf8" });
      const binary = isBinary(contents);
      let mode;
      let realpath;
      if (executable) {
        mode = File.modes.EXECUTABLE;
      } else if (symlink) {
        mode = File.modes.SYMLINK;
        realpath = await fs.realpath(absPath);
      } else {
        mode = File.modes.NORMAL;
      }

      rawDiffs.push(buildAddedFilePatch(filePath, binary ? null : contents, mode, realpath));
    }
    if (rawDiffs.length > 2) {
      throw new Error(`Expected between 0 and 2 diffs for ${filePath} but got ${rawDiffs.length}`);
    }
    return rawDiffs;
  }

  async getStagedChangesPatch() {
    const repository = await this.getCoreRepository();
    if (!repository) {
      return [];
    }
    const { rawPatch } = await repository.getDiff({
      from: { type: "commit", revision: await this.stagedBaseRevision(repository) },
      to: { type: "index" },
      detectRenames: false,
      diffFilter: "u",
    });

    if (!rawPatch) {
      return [];
    }

    const diffs = parseDiff(rawPatch);
    for (const diff of diffs) {
      if (diff.oldPath) {
        diff.oldPath = toNativePathSep(diff.oldPath);
      }
      if (diff.newPath) {
        diff.newPath = toNativePathSep(diff.newPath);
      }
    }
    return diffs;
  }

  /**
   * Miscellaneous getters
   */
  async getCommit(ref) {
    const [commit] = await this.getCommits({ max: 1, ref, includeUnborn: true });
    return commit;
  }

  async getHeadCommit() {
    const [headCommit] = await this.getCommits({ max: 1, ref: "HEAD", includeUnborn: true });
    return headCommit;
  }

  async getCommits(options = {}) {
    const { max, ref, skip, includeUnborn, includePatch } = {
      max: 1,
      ref: "HEAD",
      skip: 0,
      includeUnborn: false,
      includePatch: false,
      ...options,
    };

    const unborn = () => (includeUnborn ? [{ sha: "", message: "", unbornRef: true }] : []);

    const repository = await this.getCoreRepository();
    if (!repository) {
      return unborn();
    }

    // An unborn or unknown revision resolves to an empty page in the core API.
    const { commits: records } = await repository.getCommits({
      revision: ref,
      limit: max,
      cursor: skip > 0 ? { revision: ref, skip } : null,
    });

    if (records.length === 0) {
      return unborn();
    }

    return Promise.all(
      records.map(async (record) => {
        const { message: messageBody, coAuthors } = extractCoAuthorsAndRawCommitMessage(
          record.body,
        );

        let patch = [];
        if (includePatch) {
          // The commit's own change set: diff its (first) parent against it, or
          // the empty tree for a root commit.
          const from = record.parents.length
            ? { type: "commit", revision: `${record.sha}^` }
            : { type: "commit", revision: EMPTY_TREE_OID };
          const { rawPatch } = await repository.getDiff({
            from,
            to: { type: "commit", revision: record.sha },
            detectRenames: false,
          });
          patch = parseDiff(rawPatch);
        }

        return {
          sha: record.sha,
          author: new Author(record.author.email, record.author.name),
          authorDate: Math.floor(record.author.date.getTime() / 1000),
          messageSubject: record.subject,
          messageBody,
          coAuthors,
          unbornRef: false,
          patch,
        };
      }),
    );
  }

  async getAuthors(options = {}) {
    const { max, ref } = { max: 1, ref: "HEAD", ...options };

    const repository = await this.getCoreRepository();
    if (!repository) {
      return {};
    }

    // An unborn or unknown revision resolves to an empty page.
    const { commits } = await repository.getCommits({ revision: ref, limit: max });

    const authors = {};
    for (const commit of commits) {
      // Co-authors are trailers in the commit body.
      for (const line of String(commit.body).split("\n")) {
        const match = line.match(CO_AUTHOR_REGEX);
        if (match) {
          authors[match[2]] = match[1];
        }
      }
      authors[commit.author.email] = commit.author.name;
      authors[commit.committer.email] = commit.committer.name;
    }
    return authors;
  }

  async readFileFromIndex(filePath) {
    const repository = await this.getCoreRepository();
    // An empty revision resolves to `git show :<path>` (index stage 0).
    return repository ? repository.getFileAtRevision(filePath, "") : null;
  }

  /**
   * Merge
   */
  merge(branchName) {
    return this.withGpgFallback(
      "merge",
      (operations, options) => operations.merge(branchName, options),
      { writeOperation: true },
    );
  }

  isMerging(dotGitDir) {
    return fileExists(path.join(dotGitDir, "MERGE_HEAD")).catch(() => false);
  }

  abortMerge() {
    return this.runRepositoryOperation(
      "merge",
      (operations, options) => operations.abortMerge(options),
      { writeOperation: true },
    );
  }

  checkoutSide(side, paths) {
    if (paths.length === 0) {
      return Promise.resolve();
    }

    const gitPaths = paths.map(toGitPathSep);
    return this.runRepositoryOperation("checkout", (operations, options) =>
      operations.checkoutSide(side, gitPaths, options),
    );
  }

  /**
   * Rebase
   */
  async isRebasing(dotGitDir) {
    const results = await Promise.all([
      fileExists(path.join(dotGitDir, "rebase-merge")),
      fileExists(path.join(dotGitDir, "rebase-apply")),
    ]);
    return results.some((r) => r);
  }

  /**
   * Remote interactions
   */
  clone(remoteUrl, options = {}) {
    const args = ["clone"];
    if (options.noLocal) {
      args.push("--no-local");
    }
    if (options.bare) {
      args.push("--bare");
    }
    if (options.recursive) {
      args.push("--recursive");
    }
    if (options.sourceRemoteName) {
      args.push("--origin", options.sourceRemoteName);
    }
    args.push(remoteUrl, this.workingDir);

    return this.exec(args, { useGitPromptServer: true, writeOperation: true });
  }

  fetch(remoteName, branchName) {
    return this.runRepositoryOperation(
      "fetch",
      (operations, options) => operations.fetch(remoteName, branchName, options),
      { useGitPromptServer: true, writeOperation: true },
    );
  }

  pull(remoteName, branchName, options = {}) {
    return this.withGpgFallback(
      "pull",
      (operations, executionOptions) =>
        operations.pull(remoteName, branchName, {
          ...executionOptions,
          refSpec: options.refSpec,
          ffOnly: options.ffOnly,
        }),
      { useGitPromptServer: true, writeOperation: true },
    );
  }

  push(remoteName, branchName, options = {}) {
    return this.runRepositoryOperation(
      "push",
      (operations, executionOptions) =>
        operations.push(remoteName || "origin", `refs/heads/${branchName}`, {
          ...executionOptions,
          refSpec: options.refSpec,
          setUpstream: options.setUpstream,
          force: options.force,
        }),
      { useGitPromptServer: true, writeOperation: true },
    );
  }

  /**
   * Undo Operations
   */
  reset(type, revision = "HEAD") {
    const validTypes = ["soft"];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid type ${type}. Must be one of: ${validTypes.join(", ")}`);
    }
    return this.runRepositoryOperation("reset", (operations, options) =>
      operations.reset(type, revision, options),
    );
  }

  deleteRef(ref) {
    return this.runRepositoryOperation("update-ref", (operations, options) =>
      operations.deleteRef(ref, options),
    );
  }

  /**
   * Branches
   */
  checkout(branchName, options = {}) {
    return this.runRepositoryOperation(
      "checkout",
      (operations, executionOptions) =>
        operations.checkout(branchName, {
          ...executionOptions,
          createNew: options.createNew,
          startPoint: options.startPoint,
          track: options.startPoint ? options.track : undefined,
        }),
      { writeOperation: true },
    );
  }

  async getBranches() {
    const snapshot = await this.getRefsSnapshot();
    if (!snapshot) {
      return [];
    }
    return snapshot.branches.map((entry) => {
      const branch = { name: entry.name, sha: entry.oid, head: entry.isHead };
      if (entry.upstream) {
        const { remoteName, remoteRef } = splitRemoteRef(entry.upstream.ref);
        branch.upstream = { trackingRef: entry.upstream.ref, remoteName, remoteRef };
      }
      // Push tracking falls back to the upstream's remote when unset, matching
      // git's `%(push)` (empty while `%(push:remote*)` defaults to the upstream).
      if (entry.push) {
        const { remoteName, remoteRef } = splitRemoteRef(entry.push.ref);
        branch.push = { trackingRef: entry.push.ref, remoteName, remoteRef };
      } else if (entry.upstream) {
        const { remoteName, remoteRef } = splitRemoteRef(entry.upstream.ref);
        branch.push = { trackingRef: "", remoteName, remoteRef };
      }
      return branch;
    });
  }

  async getBranchesWithCommit(sha, option = {}) {
    const repository = await this.getCoreRepository();
    return repository ? repository.getBranchesContaining(sha, option) : [];
  }

  checkoutFiles(paths, revision) {
    if (paths.length === 0) {
      return null;
    }
    const gitPaths = paths.map(toGitPathSep);
    return this.runRepositoryOperation(
      "checkout",
      (operations, options) => operations.checkoutFiles(gitPaths, revision, options),
      { writeOperation: true },
    );
  }

  async getSubmodulePaths() {
    const repository = await this.getCoreRepository();
    if (!repository) {
      return [];
    }
    return (await repository.getSubmodulePaths()).map(toNativePathSep);
  }

  updateSubmodules(paths) {
    if (paths.length === 0) {
      return null;
    }
    const gitPaths = paths.map(toGitPathSep);
    return this.runRepositoryOperation(
      "submodule",
      (operations, options) => operations.updateSubmodules(gitPaths, options),
      { writeOperation: true },
    );
  }

  async describeHead() {
    const repository = await this.getCoreRepository();
    return repository ? repository.getDescription() : "";
  }

  async getConfig(option) {
    const repository = await this.getCoreRepository();
    if (!repository) {
      return null;
    }
    const value = await repository.getConfigValueAsync(option);
    return value == null ? null : value.trim();
  }

  setConfig(option, value, { replaceAll, global } = {}) {
    return this.runRepositoryOperation(
      "config",
      (operations, options) =>
        operations.setConfig(option, value, { ...options, replaceAll, global }),
      { writeOperation: true },
    );
  }

  unsetConfig(option) {
    return this.runRepositoryOperation(
      "config",
      (operations, options) => operations.unsetConfig(option, options),
      { writeOperation: true },
    );
  }

  async getRemotes() {
    const snapshot = await this.getRefsSnapshot();
    if (!snapshot) {
      return [];
    }
    return snapshot.remotes
      .filter((remote) => remote.fetchUrl)
      .map((remote) => ({ name: remote.name, url: remote.fetchUrl }));
  }

  addRemote(name, url) {
    return this.runRepositoryOperation("remote", (operations, options) =>
      operations.addRemote(name, url, options),
    );
  }

  async createBlob({ filePath, stdin } = {}) {
    let output;
    if (filePath) {
      try {
        output = (
          await this.runRepositoryOperation(
            "hash-object",
            (operations, options) => operations.createBlob({ ...options, filePath }),
            { writeOperation: true },
          )
        ).trim();
      } catch (e) {
        if (e instanceof GitError) {
          output = null;
        } else {
          throw e;
        }
      }
    } else if (stdin) {
      output = (
        await this.runRepositoryOperation(
          "hash-object",
          (operations, options) => operations.createBlob({ ...options, stdin }),
          { writeOperation: true },
        )
      ).trim();
    } else {
      throw new Error("Must supply file path or stdin");
    }
    return output;
  }

  expandBlobToFile(absFilePath, sha) {
    return this.runRepositoryOperation("cat-file", (operations, options) =>
      operations.expandBlobToFile(absFilePath, sha, options),
    );
  }

  async getBlobContents(sha) {
    const repository = await this.getCoreRepository();
    return repository ? repository.getBlob(sha) : null;
  }

  async mergeFile(oursPath, commonBasePath, theirsPath, resultPath) {
    // The facade resolves a relative resultPath against the repository working directory for
    // consistency with the other arguments, and returns the merge-file exit code.
    const exitCode = await this.runRepositoryOperation("merge-file", (operations, options) =>
      operations.mergeFile(oursPath, commonBasePath, theirsPath, resultPath, {
        ...options,
        labels: ["current", "after discard", "before discard"],
      }),
    );

    return { filePath: oursPath, resultPath, conflict: exitCode === 1 };
  }

  async writeMergeConflictToIndex(filePath, commonBaseSha, oursSha, theirsSha) {
    const gitFilePath = toGitPathSep(filePath);
    const fileMode = await this.getFileMode(filePath);
    return this.runRepositoryOperation(
      "update-index",
      (operations, options) =>
        operations.writeMergeConflictToIndex(gitFilePath, commonBaseSha, oursSha, theirsSha, {
          ...options,
          mode: fileMode,
        }),
      { writeOperation: true },
    );
  }

  async getFileMode(filePath) {
    const repository = await this.getCoreRepository();
    if (repository) {
      const mode = await repository.getFileMode(filePath);
      if (mode) {
        return mode;
      }
    }
    // Untracked path: fall back to the working-tree mode.
    const absolutePath = path.join(this.workingDir, filePath);
    if (await isFileSymlink(absolutePath)) {
      return File.modes.SYMLINK;
    }
    if (await isFileExecutable(absolutePath)) {
      return File.modes.EXECUTABLE;
    }
    return File.modes.NORMAL;
  }

  destroy() {
    this.destroyed = true;
    if (this.repositoryLease) {
      this.repositoryLease.dispose();
      this.repositoryLease = null;
    }
    this.commandQueue.dispose();
  }
}

function buildAddedFilePatch(filePath, contents, mode, realpath) {
  const hunks = [];
  if (contents) {
    let noNewLine;
    let lines;
    if (mode === File.modes.SYMLINK) {
      noNewLine = false;
      lines = [`+${toGitPathSep(realpath)}`, "\\ No newline at end of file"];
    } else {
      noNewLine = contents[contents.length - 1] !== "\n";
      lines = contents
        .trim()
        .split(LINE_ENDING_REGEX)
        .map((line) => `+${line}`);
    }
    if (noNewLine) {
      lines.push("\\ No newline at end of file");
    }
    hunks.push({
      lines,
      oldStartLine: 0,
      oldLineCount: 0,
      newStartLine: 1,
      heading: "",
      newLineCount: noNewLine ? lines.length - 1 : lines.length,
    });
  }
  return {
    oldPath: null,
    newPath: toNativePathSep(filePath),
    oldMode: null,
    newMode: mode,
    status: "added",
    hunks,
  };
}
