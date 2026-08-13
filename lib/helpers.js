/** @babel */
import path from "path";
import { constants as fsConstants } from "fs";
import fs from "fs/promises";
import os from "os";

import RefHolder from "./models/ref-holder";
import Author from "./models/author";

export const LINE_ENDING_REGEX = /\r?\n/;
export const CO_AUTHOR_REGEX = /^co-authored-by. (.+?) <(.+?)>$/i;

export function autobind(self, ...methods) {
  for (const method of methods) {
    if (typeof self[method] !== "function") {
      throw new Error(`Unable to autobind method ${method}`);
    }
    self[method] = self[method].bind(self);
  }
}

// Extract a subset of props whose keys appear in a {key: true} dictionary.
//
// Usage:
//
// ```js
// const apiProps = {zero: true, one: true, two: true};
//
// class Component extends React.Component {
//   action() {
//     const options = extractProps(this.props, apiProps);
//     // options contains zero, one, and two only
//   }
// }
// ```
export function extractProps(props, propTypes, nameMap = {}) {
  return Object.keys(propTypes).reduce((opts, propName) => {
    if (props[propName] !== undefined) {
      const destPropName = nameMap[propName] || propName;
      opts[destPropName] = props[propName];
    }
    return opts;
  }, {});
}

// The opposite of extractProps. Return a subset of props that do *not* appear in a component's prop types.
export function unusedProps(props, propTypes) {
  return Object.keys(props).reduce((opts, propName) => {
    if (propTypes[propName] === undefined) {
      opts[propName] = props[propName];
    }
    return opts;
  }, {});
}

export function getPackageRoot() {
  const resourcePath = lumine.application.getResourcePath();
  const currentFileWasRequiredFromSnapshot = !path.isAbsolute(__dirname);
  if (currentFileWasRequiredFromSnapshot) {
    return path.join(resourcePath, "node_modules", "github");
  } else {
    const packageRoot = path.resolve(__dirname, "..");
    if (path.extname(resourcePath) === ".asar") {
      if (packageRoot.indexOf(resourcePath) === 0) {
        return path.join(`${resourcePath}.unpacked`, "node_modules", "github");
      }
    }
    return packageRoot;
  }
}

export function isBinary(data) {
  for (let i = 0; i < 50; i++) {
    const code = data.charCodeAt(i);
    // Char code 65533 is the "replacement character";
    // 8 and below are control characters.
    if (code === 65533 || code < 9) {
      return true;
    }
  }

  return false;
}

function descriptorsFromProto(proto) {
  return Object.getOwnPropertyNames(proto).reduce((acc, name) => {
    Object.assign(acc, {
      [name]: Reflect.getOwnPropertyDescriptor(proto, name),
    });
    return acc;
  }, {});
}

/**
 * Takes an array of targets and returns a proxy. The proxy intercepts property accessor calls and
 * returns the value of that property on the first object in `targets` where the target implements that property.
 */
export function firstImplementer(...targets) {
  return new Proxy(
    { __implementations: targets },
    {
      get(target, name) {
        if (name === "getImplementers") {
          return () => targets;
        }

        if (Reflect.has(target, name)) {
          return target[name];
        }

        const firstValidTarget = targets.find((t) => Reflect.has(t, name));
        if (firstValidTarget) {
          return firstValidTarget[name];
        } else {
          return undefined;
        }
      },

      set(target, name, value) {
        const firstValidTarget = targets.find((t) => Reflect.has(t, name));
        // The trap must return a boolean: returning the assigned value throws
        // a TypeError in strict mode whenever the value is falsy.
        (firstValidTarget || target)[name] = value;
        return true;
      },

      // Used by sinon
      has(target, name) {
        if (name === "getImplementers") {
          return true;
        }

        return targets.some((t) => Reflect.has(t, name));
      },

      // Used by sinon
      getOwnPropertyDescriptor(target, name) {
        const firstValidTarget = targets.find((t) => Reflect.getOwnPropertyDescriptor(t, name));
        const compositeOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor(target, name);
        if (firstValidTarget) {
          return Reflect.getOwnPropertyDescriptor(firstValidTarget, name);
        } else if (compositeOwnPropertyDescriptor) {
          return compositeOwnPropertyDescriptor;
        } else {
          return undefined;
        }
      },

      // Used by sinon
      getPrototypeOf(target) {
        return targets.reduceRight((acc, t) => {
          return Object.create(acc, descriptorsFromProto(Object.getPrototypeOf(t)));
        }, Object.prototype);
      },
    },
  );
}

function isRoot(dir) {
  return path.resolve(dir, "..") === dir;
}

export function isValidWorkdir(dir) {
  return dir !== os.homedir() && !isRoot(dir);
}

/**
 * Map over items with at most `limit` calls to `fn` in flight. A plain
 * `Promise.all` over a working directory's file list opens every file at once,
 * which exhausts descriptors and stalls the renderer on a large repository.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function fileExists(absoluteFilePath) {
  try {
    await fs.access(absoluteFilePath);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") {
      return false;
    }

    throw e;
  }
}

export async function getTempDir(options = {}) {
  const dir = options.dir || os.tmpdir();
  const prefix = options.prefix || "tmp-";
  const folder = await fs.mkdtemp(path.join(dir, prefix));
  if (options.symlinkOk) {
    return folder;
  }
  return fs.realpath(folder);
}

export async function isFileExecutable(absoluteFilePath) {
  const stat = await fs.stat(absoluteFilePath);
  return stat.mode & fsConstants.S_IXUSR;
}

export async function isFileSymlink(absoluteFilePath) {
  const stat = await fs.lstat(absoluteFilePath);
  return stat.isSymbolicLink();
}

export const classNameForStatus = {
  added: "added",
  deleted: "removed",
  modified: "modified",
  typechange: "modified",
  equivalent: "ignored",
};

/*
 * Apply any platform-specific munging to a path before presenting it as
 * a git environment variable or option.
 *
 * Convert a Windows-style "C:\foo\bar\baz" path to a "/c/foo/bar/baz" UNIX-y
 * path that the sh.exe used to execute git's credential helpers will
 * understand.
 */
export function normalizeGitHelperPath(inPath) {
  if (process.platform === "win32") {
    return inPath.replace(/\\/g, "/").replace(/^([^:]+):/, "/$1");
  } else {
    return inPath;
  }
}

/*
 * On Windows, git commands report paths with / delimiters. Convert them to \-delimited paths
 * so that the editor uniformly treats paths with native path separators.
 */
export function toNativePathSep(rawPath) {
  if (process.platform !== "win32") {
    return rawPath;
  } else {
    return rawPath.split("/").join(path.sep);
  }
}

/*
 * Convert Windows paths back to /-delimited paths to be presented to git.
 */
export function toGitPathSep(rawPath) {
  if (process.platform !== "win32") {
    return rawPath;
  } else {
    return rawPath.split(path.sep).join("/");
  }
}

export function filePathEndsWith(filePath, ...segments) {
  return filePath.endsWith(path.join(...segments));
}

export function pushAtKey(map, key, value) {
  let existing = map.get(key);
  if (!existing) {
    existing = [];
    map.set(key, existing);
  }
  existing.push(value);
}

// Repository and workspace helpers

export function getCommitMessagePath(repository) {
  return path.join(repository.getGitDirectoryPath(), "LUMINE_COMMIT_EDITMSG");
}

export function getCommitMessageEditors(repository, workspace) {
  if (!repository.isPresent()) {
    return [];
  }
  return workspace
    .getTextEditors()
    .filter((editor) => editor.getPath() === getCommitMessagePath(repository));
}

export function getFilePatchPaneItems({ onlyStaged, empty } = {}, workspace) {
  return workspace.getPaneItems().filter((item) => {
    const realItem = item && item.getRealItem && item.getRealItem();
    const isFilePatchItem =
      realItem && typeof realItem.isFilePatchItem === "function" && realItem.isFilePatchItem();
    if (onlyStaged) {
      return isFilePatchItem && item.stagingStatus === "staged";
    } else if (empty) {
      return isFilePatchItem ? item.isEmpty() : false;
    } else {
      return isFilePatchItem;
    }
  });
}

// Report a git operation on the status bar's busy indicator while `fn` runs.
// The busy-signal service is optional: without it the operation just runs.
export async function withBusyMessage(busySignal, title, fn) {
  const provider = busySignal ? busySignal.create() : null;
  if (provider) {
    provider.add(title);
  }
  try {
    return await fn();
  } finally {
    if (provider) {
      provider.dispose();
    }
  }
}

export function destroyFilePatchPaneItems({ onlyStaged } = {}, workspace) {
  const itemsToDestroy = getFilePatchPaneItems({ onlyStaged }, workspace);
  itemsToDestroy.forEach((item) => item.destroy());
}

export function destroyEmptyFilePatchPaneItems(workspace) {
  const itemsToDestroy = getFilePatchPaneItems({ empty: true }, workspace);
  itemsToDestroy.forEach((item) => item.destroy());
}

export function extractCoAuthorsAndRawCommitMessage(commitMessage) {
  const messageLines = [];
  const coAuthors = [];

  for (const line of commitMessage.split(LINE_ENDING_REGEX)) {
    const match = line.match(CO_AUTHOR_REGEX);
    if (match) {
      const [_, name, email] = match;
      coAuthors.push(new Author(email, name));
    } else {
      messageLines.push(line);
    }
  }

  return { message: messageLines.join("\n"), coAuthors };
}

// Pane item manipulation

export function createItem(node, componentHolder = null, uri = null, extra = {}) {
  const holder = componentHolder || new RefHolder();

  const override = {
    getElement: () => node,

    getRealItem: () => holder.getOr(null),

    getRealItemPromise: () => holder.getPromise(),

    ...extra,
  };

  if (uri) {
    override.getURI = () => uri;
  }

  if (componentHolder) {
    return new Proxy(override, {
      get(target, name) {
        if (Reflect.has(target, name)) {
          return target[name];
        }

        // The {value: ...} wrapper prevents .map() from flattening a returned RefHolder.
        // If component[name] is a RefHolder, we want to return that RefHolder as-is.
        const { value } = holder
          .map((component) => ({ value: component[name] }))
          .getOr({ value: undefined });
        return value;
      },

      set(target, name, value) {
        return holder
          .map((component) => {
            component[name] = value;
            return true;
          })
          .getOr(true);
      },

      has(target, name) {
        return (
          holder.map((component) => Reflect.has(component, name)).getOr(false) ||
          Reflect.has(target, name)
        );
      },
    });
  } else {
    return override;
  }
}

// Set functions

export function equalSets(left, right) {
  if (left.size !== right.size) {
    return false;
  }

  for (const each of left) {
    if (!right.has(each)) {
      return false;
    }
  }

  return true;
}

// Show a native context menu popup using the editor's built-in context-menu infrastructure.
// `template` is an array of {label, command, enabled?, visible?} or {type: 'separator'}.
// Commands are dispatched to `target` when clicked.
export function showContextMenu(target, template) {
  return lumine.contextMenu.show(target, template);
}

// Constants

export const NBSP_CHARACTER = "\u00a0";

export function blankLabel() {
  return NBSP_CHARACTER;
}

// Inlined from the archived kuychaco/compare-sets.
//
// `newSet` only has to be iterable via `forEach` -- it is not required to be a
// Set -- and `oldSet` only has to answer `has`, so this deliberately avoids
// `Set.prototype.difference`, which rejects anything that is not a real Set.
export function compareSets(oldSet, newSet) {
  const added = new Set();
  const retained = new Set();
  const removed = new Set(oldSet);

  newSet.forEach((item) => {
    if (oldSet.has(item)) {
      retained.add(item);
      removed.delete(item);
    } else {
      added.add(item);
    }
  });

  return { added, retained, removed };
}

// Inlined from the archived yubikiri.
//
// Resolves an object whose values are plain values, promises, or functions.
// A function value is called with a `query` object holding the already-resolved
// promises of the non-function keys, which is what lets one key be derived from
// another -- `aheadCount` needs `currentBranch`, for example.
//
// The original did this lazily through a Proxy, which additionally allowed a
// function key to read *another function key*, memoized each one, and detected
// cycles. Nothing here needs that: every function key reads only non-function
// keys. Reading a function key is therefore rejected outright rather than
// silently resolving to undefined, so if that ever changes it fails loudly.
export function resolveQuery(spec) {
  const query = {};
  const functionKeys = new Set();

  for (const [key, value] of Object.entries(spec)) {
    if (typeof value === "function") {
      functionKeys.add(key);
    } else {
      query[key] = Promise.resolve(value);
    }
  }

  for (const key of functionKeys) {
    Object.defineProperty(query, key, {
      enumerable: true,
      get() {
        throw new Error(
          `resolveQuery: '${key}' is derived from other keys and cannot be read by one of them. ` +
            `Depend on a plain key instead, or restore a lazy resolver.`,
        );
      },
    });
  }

  const results = {};
  for (const [key, value] of Object.entries(spec)) {
    results[key] = functionKeys.has(key) ? Promise.resolve(value(query)) : query[key];
  }

  const keys = Object.keys(results);
  return Promise.all(keys.map((key) => results[key])).then((values) =>
    Object.fromEntries(keys.map((key, i) => [key, values[i]])),
  );
}
