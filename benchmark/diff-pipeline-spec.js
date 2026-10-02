/** @babel */
import path from "path";
import { Emitter } from "lumine";
import {
  profilePipeline,
  rawReplacement,
  trackBuffers,
  releasePatch,
  started,
  milliseconds,
  memorySample,
  nextUsefulFrame,
  paintOpportunity,
  summarize,
  report,
  noop,
  disposable,
  normalEditorScheduling,
  ensureNormalEditors,
} from "./helpers/pipeline";

const cases = [
  { name: "expanded-10k-changed-lines", pairs: 5000 },
  { name: "expanded-20k-changed-lines", pairs: 10000 },
  { name: "expanded-250-files", files: 250, pairs: 8 },
  { name: "shared-prefix-100KiB-line", pairs: 1, lineBytes: 100 * 1024 },
  { name: "shared-prefix-500KiB-line", pairs: 1, lineBytes: 500 * 1024 },
  { name: "high-edit-distance-512-tokens", pairs: 1, tokens: 512 },
  { name: "twenty-refreshes-1000-changed-lines", pairs: 500, cycles: 21 },
];
// Baseline has an unbounded edit-distance search, so deliberately do not submit
// the pathological 500KiB pair to it. The bounded production implementation
// must show both complete lines while declaring omitted intraline detail.
const { WORD_DIFF_LIMITS } = require("../lib/models/patch/word-diff");
if (WORD_DIFF_LIMITS) cases.push({ name: "bounded-500KiB-disjoint-line", pairs: 1, tokens: 50000 });

describe("complete Git diff pipeline benchmark", () => {
  for (const fixture of cases) {
    it(`profiles ${fixture.name} through parsing, markers, native adoption and visible frames`, async () => {
      await lumine.packages.activatePackage("language-text");
      const restoreScheduling = normalEditorScheduling();
      const loadedView = require("../lib/views/multi-file-patch-view");
      const MultiFilePatchView = loadedView.default || loadedView;
      const { transaction } = require("../lib/etch/view");
      const publication = new Emitter();
      const build = profilePipeline(path.join(__dirname, ".."));
      const tracker = trackBuffers();
      const legacyReleased = new Set();
      const stylesheet = lumine.themes.requireStylesheet(
        path.join(__dirname, "..", "styles", "main.css"),
      );
      const container = document.createElement("div");
      container.style.cssText = "width:950px;height:600px;overflow:auto";
      jasmine.attachToDOM(container);
      const samples = [],
        frameSamples = [],
        work = [];
      const memoryBefore = await memorySample();
      let view = null,
        currentPatch = null;
      let hasManagedOwnership = false;
      const propsFor = (patch) => ({
        multiFilePatch: patch,
        workspace: lumine.workspace,
        commands: lumine.commands,
        config: lumine.config,
        keymaps: lumine.keymaps,
        tooltips: { add: disposable, addComposite: disposable },
        stagingStatus: "unstaged",
        selectedRows: new Set(),
        selectionMode: "hunk",
        selectedRowsChanged: noop,
        toggleRows: noop,
        discardRows: noop,
        toggleFile: noop,
        toggleModeChange: noop,
        toggleSymlinkChange: noop,
        openFile: noop,
        surface: noop,
        undoLastDiscard: noop,
        diveIntoMirrorPatch: noop,
        onWillUpdatePatch: (callback) => publication.on("will-update", callback),
        onDidUpdatePatch: (callback) => publication.on("did-update", callback),
      });
      try {
        for (let cycle = 0; cycle < (fixture.cycles || 3); cycle++) {
          ensureNormalEditors(container);
          const raw = rawReplacement({ ...fixture, version: cycle });
          const fullPipeline = started();
          const pipeline = build(raw);
          hasManagedOwnership = typeof pipeline.patch.dispose === "function";
          samples.push(pipeline.times);
          work.push(pipeline.work);
          expect(pipeline.patch.getFilePatches().length).toBe(fixture.files || 1);
          expect(
            pipeline.patch.getFilePatches().every((file) => file.getRenderStatus().isVisible()),
          ).toBe(true);
          const diffPosition = fixture.pairs + 2;
          const bufferRow = pipeline.patch.getBufferRowForDiffPosition(
            "fixture-0.txt",
            diffPosition,
          );
          expect(bufferRow).toBe(fixture.pairs + 1);
          if (fixture.name === "bounded-500KiB-disjoint-line") {
            expect(pipeline.patch.getBuffer().getLineCount()).toBe(4);
            const deletedLine = pipeline.patch.getBuffer().lineForRow(1);
            const addedLine = pipeline.patch.getBuffer().lineForRow(2);
            expect(deletedLine.length).toBe(488889);
            expect(addedLine.length).toBe(538889);
            expect(deletedLine.endsWith("left49999")).toBe(true);
            expect(addedLine.endsWith("right49999")).toBe(true);
            expect(pipeline.work.wordDetail.omittedPairs).toBe(1);
            expect(pipeline.work.wordDetail.reasons.lineLength).toBe(1);
            expect(pipeline.work.wordAdditionMarkers).toBe(0);
            expect(pipeline.work.wordDeletionMarkers).toBe(0);
          }
          const frame = started();
          let adoptMs = 0;
          let publishBarrierMs = 0;
          if (view) {
            const previous = currentPatch;
            const publicationStart = started();
            let update;
            transaction(() => {
              publication.emit("will-update");
              const adoption = started();
              pipeline.patch.adoptBuffer(previous.getPatchBuffer());
              adoptMs = milliseconds(adoption);
              currentPatch = pipeline.patch;
              publication.emit("did-update", currentPatch);
              update = view.update(propsFor(currentPatch));
            });
            publishBarrierMs = milliseconds(publicationStart);
            await update;
            releasePatch(previous, legacyReleased);
          } else {
            currentPatch = pipeline.patch;
            view = new MultiFilePatchView(propsFor(currentPatch));
            container.appendChild(view.element);
          }
          const constructedMs = milliseconds(frame);
          const useful = await nextUsefulFrame(container);
          const firstUsefulFrameMs = milliseconds(frame);
          const rawToUsefulFrameMs = milliseconds(fullPipeline);
          await paintOpportunity();
          const secondRafOpportunityMs = milliseconds(frame);
          expect(useful.editors).toBe(1);
          expect(container.querySelector("lumine-text-editor").isUpdatedSynchronously()).toBe(
            false,
          );
          // The diff editor's text rows remain virtualized even for 20k lines.
          expect(useful.renderedRows).toBeLessThan(1000);
          expect(container.querySelector("lumine-text-editor").getModel().getBuffer()).toBe(
            currentPatch.getBuffer(),
          );
          frameSamples.push({
            adoptMs,
            publishBarrierMs,
            constructedMs,
            firstUsefulFrameMs,
            rawToUsefulFrameMs,
            secondRafOpportunityMs,
            renderedRows: useful.renderedRows,
          });
        }
        const buffersOpen = tracker.sample();
        const memoryOpen = await memorySample();
        await view.destroy();
        view = null;
        releasePatch(currentPatch, legacyReleased);
        currentPatch = null;
        await nextUsefulFrame(container);
        const buffersClosed = tracker.sample();
        const memoryClosed = await memorySample();
        report(fixture.name, {
          package: "git-panel",
          iterations: samples.length,
          fixture,
          pipelineCpuMs: summarize(samples),
          nativeAndFrameMs: summarize(frameSamples),
          work,
          buffersOpen,
          buffersClosed,
          memoryBefore,
          memoryOpen,
          memoryClosed,
          compositorMeasured: false,
          hasManagedOwnership,
          nativeSamples: frameSamples,
          baselinePath: __dirname.includes("large-diff-baseline"),
        });
        expect(container.querySelectorAll("lumine-text-editor").length).toBe(0);
        if (hasManagedOwnership) expect(buffersClosed.liveRetainedBuffers).toBe(0);
      } finally {
        await view?.destroy();
        releasePatch(currentPatch, legacyReleased);
        tracker.cleanup();
        publication.dispose();
        restoreScheduling();
        container.remove();
        stylesheet.dispose();
      }
    }, 120000);
  }
});
