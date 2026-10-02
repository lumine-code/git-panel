/** @babel */
import path from "path";
import { TextBuffer, filterPatch } from "lumine";

export const milliseconds = (start) => Number(process.hrtime.bigint() - start) / 1e6;
export const started = () => process.hrtime.bigint();
export const noop = () => {};
export const disposable = () => ({ dispose() {} });

export function normalEditorScheduling() {
  const prototype = customElements.get("lumine-text-editor").prototype;
  const previous = prototype.updatedSynchronously;
  prototype.setUpdatedSynchronously(false);
  return () => prototype.setUpdatedSynchronously(previous);
}

export function ensureNormalEditors(container) {
  for (const element of container.querySelectorAll("lumine-text-editor")) {
    element.setUpdatedSynchronously(false);
  }
}

export function rawReplacement({ files = 1, pairs = 8, lineBytes = 0, tokens = 0, version = 0 }) {
  const chunks = [];
  for (let file = 0; file < files; file++) {
    const fileName = `fixture-${file}.txt`;
    chunks.push(
      `diff --git a/${fileName} b/${fileName}`,
      "index 1111111..2222222 100644",
      `--- a/${fileName}`,
      `+++ b/${fileName}`,
      `@@ -1,${pairs + 2} +1,${pairs + 2} @@ fixture`,
      " context before",
    );
    const before = [],
      after = [];
    for (let row = 0; row < pairs; row++) {
      let previous, next;
      if (tokens) {
        previous = Array.from({ length: tokens }, (_, index) => `left${index}`).join(" ");
        next = Array.from({ length: tokens }, (_, index) => `right${index}`).join(" ");
      } else if (lineBytes) {
        const prefix = "word ".repeat(Math.floor(lineBytes / 5));
        previous = `${prefix}before_${version}`;
        next = `${prefix}after_${version}`;
      } else {
        previous = `const value_${row} = previous_${version};`;
        next = `const value_${row} = current_${version};`;
      }
      before.push(`-${previous}`);
      after.push(`+${next}`);
    }
    chunks.push(...before, ...after, " context after");
  }
  return chunks.join("\n") + "\n";
}

export function profilePipeline(gitRoot) {
  const { parseDiff } = require(path.join(gitRoot, "lib", "git-shell-out-strategy"));
  const { buildMultiFilePatch } = require(path.join(gitRoot, "lib", "models", "patch"));
  const wordDiff = require(path.join(gitRoot, "lib", "models", "patch", "word-diff"));
  const loaded = require(path.join(gitRoot, "lib", "models", "patch", "multi-file-patch"));
  const MultiFilePatch = loaded.default || loaded;
  const originalWordDiff = wordDiff.populateWordDiffs;
  const originalIndex = MultiFilePatch.prototype.populateDiffRowOffsetIndices;
  const counters = { wordMs: 0, indexMs: 0, wordCalls: 0, indexCalls: 0 };
  const wordSpy = globalThis.spyOn(wordDiff, "populateWordDiffs").and.callFake(function (...args) {
    const start = started();
    try {
      return originalWordDiff(...args);
    } finally {
      counters.wordMs += milliseconds(start);
      counters.wordCalls++;
    }
  });
  const indexSpy = globalThis
    .spyOn(MultiFilePatch.prototype, "populateDiffRowOffsetIndices")
    .and.callFake(function (...args) {
      const start = started();
      try {
        return originalIndex.apply(this, args);
      } finally {
        counters.indexMs += milliseconds(start);
        counters.indexCalls++;
      }
    });
  return (raw) => {
    const before = { ...counters };
    const all = started();
    let start = started();
    const { filtered, removed } = filterPatch(raw);
    const filterMs = milliseconds(start);
    start = started();
    const diffs = parseDiff(filtered);
    const parseMs = milliseconds(start);
    start = started();
    const patch = buildMultiFilePatch(diffs, {
      removed,
      preserveOriginal: true,
      largeDiffThreshold: Number.MAX_SAFE_INTEGER,
    });
    const buildMs = milliseconds(start);
    const wordMs = counters.wordMs - before.wordMs;
    const indexMs = counters.indexMs - before.indexMs;
    const result = {
      patch,
      times: {
        filterMs,
        parseMs,
        buildMs,
        wordMs,
        indexMs,
        residualBuildMs: Math.max(0, buildMs - wordMs - indexMs),
        totalPipelineMs: milliseconds(all),
      },
      work: {
        rawBytes: Buffer.byteLength(raw),
        files: diffs.length,
        displayedRows: patch.getBuffer().getLineCount(),
        wordCalls: counters.wordCalls - before.wordCalls,
        indexCalls: counters.indexCalls - before.indexCalls,
        wordDeletionMarkers: patch.getWordDeletionLayer().getMarkerCount(),
        wordAdditionMarkers: patch.getWordAdditionLayer().getMarkerCount(),
        wordDetail: typeof patch.getWordDiffStats === "function" ? patch.getWordDiffStats() : null,
      },
    };
    wordSpy.calls.reset();
    indexSpy.calls.reset();
    return result;
  };
}

export function trackBuffers() {
  const live = new Set();
  const seen = new WeakSet();
  let created = 0,
    destroyed = 0,
    retains = 0,
    releases = 0,
    peak = 0;
  const originalRetain = TextBuffer.prototype.retain;
  const originalRelease = TextBuffer.prototype.release;
  const retainSpy = globalThis.spyOn(TextBuffer.prototype, "retain").and.callFake(function () {
    const result = originalRetain.call(this);
    retains++;
    if (!seen.has(this)) {
      seen.add(this);
      created++;
      this.onDidDestroy(() => {
        live.delete(this);
        destroyed++;
      });
    }
    live.add(this);
    peak = Math.max(peak, live.size);
    return result;
  });
  const releaseSpy = globalThis.spyOn(TextBuffer.prototype, "release").and.callFake(function () {
    releases++;
    return originalRelease.call(this);
  });
  return {
    sample() {
      retainSpy.calls.reset();
      releaseSpy.calls.reset();
      return {
        created,
        destroyed,
        liveRetainedBuffers: live.size,
        peakLiveRetainedBuffers: peak,
        retainCalls: retains,
        releaseCalls: releases,
      };
    },
    cleanup() {
      for (const buffer of [...live]) {
        // Diagnostic cleanup after reporting retains owned by leaked baseline
        // buffers. No view may still be mounted when this method is called.
        while (!buffer.isDestroyed() && buffer.isRetained()) buffer.release();
      }
    },
  };
}

export function releasePatch(patch, releasedLegacyBuffers = new Set()) {
  if (!patch) return;
  if (typeof patch.dispose === "function") {
    patch.dispose();
    return;
  }
  const buffer = patch.getBuffer();
  // Baseline models lack distinct ownership leases after buffer adoption.
  if (!releasedLegacyBuffers.has(buffer) && !buffer.isDestroyed()) {
    releasedLegacyBuffers.add(buffer);
    buffer.release();
  }
}

export async function memorySample() {
  const sample = {
    ...process.memoryUsage(),
    gc: typeof globalThis.gc === "function" ? "available" : "unavailable",
  };
  if (typeof process.getProcessMemoryInfo === "function") {
    try {
      sample.electronMemoryKiB = await process.getProcessMemoryInfo();
    } catch {
      sample.electronMemoryKiB = null;
    }
  }
  return sample;
}

export async function nextUsefulFrame(container) {
  lumine.views.updateDocument(noop);
  await lumine.views.getNextUpdatePromise();
  const editorElements = [...container.querySelectorAll("lumine-text-editor")];
  const renderedRows = editorElements.reduce(
    (count, element) => count + element.querySelectorAll(".line").length,
    0,
  );
  return { editors: editorElements.length, renderedRows };
}

export async function paintOpportunity() {
  // requestAnimationFrame runs before paint. Two callbacks observe a rendering
  // opportunity after the first useful frame, never a compositor acknowledgement.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export function summarize(rows) {
  const result = {};
  for (const key of Object.keys(rows[0] || {})) {
    if (!key.endsWith("Ms")) continue;
    const values = rows.map((row) => row[key]).sort((a, b) => a - b);
    result[key] = {
      p50: Number(values[Math.ceil(values.length * 0.5) - 1].toFixed(3)),
      max: Number(values.at(-1).toFixed(3)),
    };
  }
  return result;
}

export function report(scenario, details) {
  console.log(
    "LUMINE_DIFF_PIPELINE=" +
      JSON.stringify({
        scenario,
        measurement:
          "Electron renderer with production asynchronous editor scheduling (Jasmine's synchronous editor mode disabled); CPU timings exclude fixture generation; RAF opportunity is not compositor latency; memory without forced GC is observational",
        bufferTracking:
          "Still-retained buffers are held for ownership inspection until disposal or final diagnostic cleanup; spy call histories are cleared.",
        ...details,
      }),
  );
}
