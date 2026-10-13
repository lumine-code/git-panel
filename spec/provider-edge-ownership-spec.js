const requireCurrent = require("node:module").createRequire(__filename);
const { Disposable } = require("lumine");
describe("Git Panel independent service edges", () => {
  let main, leases, editors, registrations;
  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    main = (await lumine.packages.activatePackage("git-panel")).mainModule;
    leases = [];
    editors = [];
    registrations = [];
  });
  afterEach(async () => {
    for (const registration of registrations) registration.dispose();
    for (const lease of leases) lease.dispose();
    for (const editor of editors) editor.destroy();
    await lumine.packages.deactivatePackage("git-panel");
  });
  for (const service of ["autocomplete.watch-editor", "linter.editors", "busy-signal"]) {
    function offer(label) {
      const disposed = jasmine.createSpy(label + " disposal");
      const factory = jasmine.createSpy(label).and.callFake(() => new Disposable(disposed));
      const provider = {
        add: jasmine.createSpy(label + " add"),
        remove: jasmine.createSpy(label + " remove"),
        dispose: disposed,
      };
      const api =
        service === "busy-signal"
          ? { create: jasmine.createSpy(label).and.returnValue(provider) }
          : factory;
      const lease = lumine.packages.serviceHub.provide(service, "1.0.0", api);
      leases.push(lease);
      return { api, provider, disposed, lease };
    }
    for (const withdrawal of ["older", "newer", "none"]) {
      it(`uses a remaining ${service} provider after ${withdrawal} withdraws`, async () => {
        const older = offer("older"),
          newer = offer("newer");
        if (withdrawal !== "none") (withdrawal === "older" ? older : newer).lease.dispose();
        const expected = withdrawal === "newer" ? older : newer;
        if (service === "busy-signal") {
          const { withBusyMessage } = requireCurrent("../lib/helpers");
          await withBusyMessage(main.busySignal, "owned operation", async () => {});
          expect(expected.api.create).toHaveBeenCalledTimes(1);
          expect(expected.provider.add).toHaveBeenCalledWith("owned operation");
          expect(expected.provider.dispose).toHaveBeenCalledTimes(1);
        } else {
          const editor = lumine.workspace.buildTextEditor({ mini: true });
          editors.push(editor);
          if (service === "autocomplete.watch-editor")
            registrations.push(
              requireCurrent("../lib/autocomplete-editors").addAutocompleteEditor(editor),
            );
          else registrations.push(requireCurrent("../lib/linter-editors").addLinterEditor(editor));
          expect(expected.api).toHaveBeenCalled();
          expect(expected.api.calls.mostRecent()?.args[0]).toBe(editor);
          expect(expected.disposed).not.toHaveBeenCalled();
        }
      });
    }
  }
});
