const {
  consumeRepositorySetup,
  getRepositorySetup,
  onDidChangeRepositorySetup,
} = require("../lib/repository-setup");

describe("Git Panel repository setup provider edges", () => {
  const leases = [];
  afterEach(() => {
    for (const lease of leases.splice(0).reverse()) lease.dispose();
  });

  function consume(service) {
    const lease = consumeRepositorySetup(service);
    leases.push(lease);
    return lease;
  }

  it("publishes provider changes and removes only the retired edge", () => {
    const changed = jasmine.createSpy("provider changed");
    leases.push(onDidChangeRepositorySetup(changed));
    const first = { openInitializeDialog() {}, openCloneDialog() {} };
    const replacement = { openInitializeDialog() {}, openCloneDialog() {} };
    const firstLease = consume(first);
    expect(getRepositorySetup()).toBe(first);
    const replacementLease = consume(replacement);
    expect(getRepositorySetup()).toBe(replacement);
    firstLease.dispose();
    expect(getRepositorySetup()).toBe(replacement);
    expect(changed).toHaveBeenCalledTimes(2);
    replacementLease.dispose();
    expect(getRepositorySetup()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("restores a still connected provider and retains duplicate connections independently", () => {
    const provider = { openInitializeDialog() {}, openCloneDialog() {} };
    const first = consume(provider);
    const second = consume(provider);
    first.dispose();
    expect(getRepositorySetup()).toBe(provider);
    const replacement = consume({ openInitializeDialog() {}, openCloneDialog() {} });
    replacement.dispose();
    expect(getRepositorySetup()).toBe(provider);
    second.dispose();
    expect(getRepositorySetup()).toBeNull();
  });

  it("does not contribute legacy setup commands to application menus", () => {
    const menu = require("../menus/main.json");
    const commands = [];
    const visit = (items) => {
      for (const item of items) {
        if (item.command) commands.push(item.command);
        if (item.submenu) visit(item.submenu);
      }
    };
    visit(menu.menu);
    expect(commands).not.toContain("git-panel:initialize");
    expect(commands).not.toContain("git-panel:clone");
  });
});
