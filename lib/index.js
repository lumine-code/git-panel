const { CompositeDisposable, Disposable } = require("lumine");
const registerGlobalCommands = require("./bootstrap-commands");
let packageOptions;
let pack;
let activation;

function createPackageOptions() {
  return {
    workspace: lumine.workspace,
    project: lumine.project,
    repositories: lumine.repositories,
    commands: lumine.commands,
    notificationManager: lumine.notifications,
    tooltips: lumine.tooltips,
    styles: lumine.styles,
    keymaps: lumine.keymaps,
    grammars: lumine.grammars,
    config: lumine.config,
    deserializers: lumine.deserializers,

    confirm: lumine.window.confirm.bind(lumine.window),
    getInitialPaths: lumine.window.getInitialPaths.bind(lumine.window),

    configDirPath: lumine.getConfigDirPath(),
  };
}

function ensurePackage() {
  if (!pack) {
    require("@lumine-code/etch").setScheduler(lumine.views);
    const gitPackageModule = require("./git-package");
    const GitPackage = gitPackageModule.default || gitPackageModule;
    pack = new GitPackage(packageOptions || createPackageOptions());
  }
  const owner = activation;
  if (owner?.error) throw owner.error;
  if (owner && !owner.starting && !pack.activated) {
    owner.starting = true;
    try {
      pack.activate({ ...owner.context, entryPointsRegistered: true });
      for (const edge of owner.busySignalEdges) {
        const runtime = pack.consumeBusySignal(edge.service);
        if (activation === owner && owner.busySignalEdges.has(edge)) edge.runtime = runtime;
        else runtime.dispose();
      }
    } catch (error) {
      owner.error = error;
      void pack.deactivate().catch((cleanupError) => console.error(cleanupError));
      throw error;
    } finally {
      owner.starting = false;
    }
  }
  if (owner && activation !== owner) throw new Error("Git panel activation was cancelled");
  return pack;
}

const entry = {
  provideBackgroundTips() {
    return {
      packageName: "git-panel",
      tips: [
        "You can stage and commit without leaving the editor using {{ 'git-panel:toggle-focus' | keystroke }}",
      ],
    };
  },

  initialize() {
    packageOptions = createPackageOptions();
  },

  activate(context) {
    context.signal?.throwIfAborted();
    const owner = (activation = {
      context,
      busySignalEdges: new Set(),
      subscriptions: new CompositeDisposable(),
    });
    owner.subscriptions.add(
      registerGlobalCommands(lumine.commands, ensurePackage),
      lumine.workspace.addOpener((uri) => {
        if (uri === "lumine-git://dock-item/git") return ensurePackage().createGitPaneItem({ uri });
      }),
    );
    if (pack || lumine.config.get("git-panel.openGitTabOnStart")) ensurePackage();
  },

  deactivate() {
    const owner = activation;
    activation = null;
    owner?.subscriptions.dispose();
    return pack?.deactivate();
  },

  // Declared here rather than left to the proxy below. These are the methods
  // `package.json` names — the package's wiring, which belongs in the module a
  // reader opens rather than behind a proxy trap that answers to any name.
  // Constructing the implementation remains lazy: `ensurePackage` runs when
  // the service is first requested, not while this facade module loads.
  provideGitPanel() {
    const owner = activation;
    const invoke = (method) => {
      if (!owner || activation !== owner) return Promise.reject(new Error("Git panel is inactive"));
      return ensurePackage()[method]();
    };
    return {
      openGitTab: () => invoke("openGitTab"),
    };
  },

  consumeRepositorySetup(service) {
    const owner = activation;
    if (!owner) return new Disposable();
    const runtime = require("./repository-setup").consumeRepositorySetup(service);
    const lease = new Disposable(() => {
      owner.subscriptions.remove(lease);
      runtime.dispose();
    });
    owner.subscriptions.add(lease);
    return lease;
  },

  provideDiff() {
    return require("./diff-service");
  },
  provideNavigationAdapter() {
    return require("./navigation-adapter");
  },
  consumeCommitLinks(service) {
    return require("./commit-links").consumeCommitLinks(service);
  },

  consumeBusySignal(busySignal) {
    const owner = activation;
    if (!owner) return new Disposable();
    const edge = { service: busySignal, runtime: null };
    owner.busySignalEdges.add(edge);
    if (pack?.activated) edge.runtime = pack.consumeBusySignal(busySignal);
    const lease = new Disposable(() => {
      owner.subscriptions.remove(lease);
      owner.busySignalEdges.delete(edge);
      edge.runtime?.dispose();
      edge.runtime = null;
    });
    owner.subscriptions.add(lease);
    return lease;
  },

  // These two go to a holder module, not the package instance: the commit box
  // may be built before or after the linter or autocomplete connects, and
  // neither side should force the other to exist first.
  consumeLinterEditors(register) {
    return require("./linter-editors").consumeLinterEditors(register);
  },

  consumeAutocompleteWatchEditor(watchEditor) {
    return require("./autocomplete-editors").consumeAutocompleteWatchEditor(watchEditor);
  },
  consumeScrollmapWidget(Widget) {
    return require("./scrollmap-widget").consumeScrollmapWidget(Widget);
  },
};

module.exports = new Proxy(entry, {
  get(target, name) {
    if (Reflect.has(target, name)) {
      return target[name];
    }
    if (
      typeof name === "symbol" ||
      [
        "__esModule",
        "default",
        "then",
        "config",
        "activateConfig",
        "deactivateConfig",
        "prepareToSerialize",
        "serialize",
        "restoreState",
        "serializeSessionState",
        "restoreSessionState",
      ].includes(name)
    )
      return undefined;

    const packageInstance = ensurePackage();
    if (Reflect.has(packageInstance, name)) {
      let item = packageInstance[name];
      if (typeof item === "function") {
        item = item.bind(packageInstance);
      }
      return item;
    } else {
      return target[name];
    }
  },
});
