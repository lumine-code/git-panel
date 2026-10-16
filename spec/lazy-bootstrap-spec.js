const path = require("node:path");
const { spawnSync } = require("node:child_process");

describe("git-panel lazy bootstrap", () => {
  it("publishes commands and connects services before loading its runtime", () => {
    const root = path.dirname(__dirname);
    const eventKit = require.resolve("@lumine-code/event-kit", {
      paths: [lumine.application.getResourcePath()],
    });
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `
      const assert = require('node:assert/strict');
      const Module = require('node:module');
      const api = require(${JSON.stringify(eventKit)});
      let runtimeLoads = 0, activations = 0, invocations = 0, connected = null, retireOnConnect = false;
      class Runtime {
        activate(context) {
          assert.equal(context.entryPointsRegistered, true);
          this.activated = true;
          activations++;
        }
        consumeBusySignal() { return new api.Disposable(); }
        consumeGitPanel() { return new api.Disposable(); }
        consumeDiff(service) {
          connected = service;
          if (retireOnConnect) main.deactivate();
          return new api.Disposable(() => { if (connected === service) connected = null; });
        }
        invokeGitController() { invocations++; }
        invokeRootController() { invocations++; }
        deactivate() { this.activated = false; return Promise.resolve(); }
      }
      const originalLoad = Module._load;
      Module._load = function(request, ...args) {
        if(request === 'lumine') return api;
        if(request === './git-package') { runtimeLoads++; return Runtime; }
        if(request === '@lumine-code/etch') return {setScheduler() {}};
        if(request === './diff-service') return {setDiffService(service) {connected = service;}};
        return originalLoad.call(this, request, ...args);
      };
      let commands, registrations = 0;
      global.lumine = {
        views: {}, config: {get: () => false},
        repositories: { getActiveRepositoryContext: () => ({workingDirectory: 'current', pinned: true}) },
        window: {confirm() {}, getInitialPaths() {}},
        getConfigDirPath: () => '/unused',
        commands: {add(_selector, entries) {
          commands = entries; registrations++;
          return new api.Disposable(() => registrations--);
        }},
        workspace: {addOpener() {return new api.Disposable();}},
      };
      const main = require(${JSON.stringify(path.join(root, "lib/index.js"))});
      assert.equal(main.__esModule, undefined);
      assert.equal(main.then, undefined);
      assert.equal(main.config, undefined);
      assert.equal(main.restoreState, undefined);
      main.initialize();
      main.activate({});
      const service = main.provideGitPanel(); const lease = main.consumeBusySignal({ marker: true });
      assert.equal(runtimeLoads, 0);
      assert.equal(registrations, 1);
      assert.equal(main.serialize, undefined);
      assert.equal(commands['git-panel:toggle-commit-preview'].description.length > 0, true);
      lease.dispose();
      commands['git-panel:toggle-commit-preview'].didDispatch();
      assert.equal(runtimeLoads, 1);
      assert.equal(activations, 1);
      assert.equal(invocations, 1);
      assert.equal(registrations, 1);
      
      (async () => {
        await main.deactivate();
        assert.equal(registrations, 0);
        main.activate({});
        assert.equal(runtimeLoads, 1);
        assert.equal(activations, 2);
        await main.deactivate();
        assert.equal(registrations, 0);
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        timeout: 20000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status)
      .withContext(result.stderr || result.stdout)
      .toBe(0);
  });
});
