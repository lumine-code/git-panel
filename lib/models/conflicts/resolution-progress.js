/** @babel */
import { Emitter } from "lumine";
import path from "path";

export function keyForPath(filePath) {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export default class ResolutionProgress {
  constructor() {
    this.emitter = new Emitter();
    this.progressByPath = new Map();
  }

  didUpdate() {
    this.emitter.emit("did-update");
  }

  onDidUpdate(cb) {
    return this.emitter.on("did-update", cb);
  }

  update(filePath, changes) {
    const key = keyForPath(filePath);
    const previous = this.progressByPath.get(key) || {};
    const next = { ...previous, ...changes };
    if (Object.keys(changes).some((name) => previous[name] !== next[name])) {
      this.progressByPath.set(key, next);
      this.didUpdate();
    }
  }

  reportDiskMarkerCount(filePath, count) {
    this.update(filePath, { diskCount: count, ...(count > 0 ? { hadMarkers: true } : {}) });
  }

  reportBufferMarkerCount(filePath, count, { modified = false } = {}) {
    this.update(filePath, {
      bufferCount: count,
      bufferModified: modified,
      hasBuffer: true,
      ...(count > 0 ? { hadMarkers: true } : {}),
    });
  }

  // Compatibility for callers that only know about persisted file contents.
  reportMarkerCount(filePath, count) {
    this.reportDiskMarkerCount(filePath, count);
  }

  clearBuffer(filePath) {
    const key = keyForPath(filePath);
    const previous = this.progressByPath.get(key);
    if (!previous || !previous.hasBuffer) return;

    const next = { ...previous };
    delete next.bufferCount;
    delete next.bufferModified;
    delete next.hasBuffer;
    this.progressByPath.set(key, next);
    this.didUpdate();
  }

  markResolutionSelected(filePath) {
    this.update(filePath, { resolutionSelected: true });
  }

  retainPaths(filePaths) {
    const retained = new Set(Array.from(filePaths, keyForPath));
    let changed = false;
    for (const key of this.progressByPath.keys()) {
      if (!retained.has(key)) {
        this.progressByPath.delete(key);
        changed = true;
      }
    }
    if (changed) this.didUpdate();
  }

  getStatus(filePath) {
    const progress = this.progressByPath.get(keyForPath(filePath));
    if (!progress || progress.diskCount === undefined) {
      return { ready: false, remaining: undefined, reason: "calculating" };
    }

    const counts = [progress.diskCount];
    if (progress.hasBuffer && progress.bufferCount !== undefined) {
      counts.push(progress.bufferCount);
    }
    const remaining = Math.max(...counts);
    if (remaining > 0) {
      return { ready: false, remaining, reason: "conflicts" };
    }
    if (progress.hasBuffer && progress.bufferModified) {
      return { ready: false, remaining: 0, reason: "unsaved" };
    }
    if (!progress.hadMarkers && !progress.resolutionSelected) {
      return { ready: false, remaining: 0, reason: "choice" };
    }
    return { ready: true, remaining: 0, reason: "ready" };
  }

  getRemaining(filePath) {
    return this.getStatus(filePath).remaining;
  }

  isStagingReady(filePath) {
    return this.getStatus(filePath).ready;
  }

  isEmpty() {
    return this.progressByPath.size === 0;
  }
}
