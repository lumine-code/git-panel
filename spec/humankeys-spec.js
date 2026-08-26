const { humanizeKeystroke } = require("../lib/lumine/humankeys");

describe("humanizeKeystroke", () => {
  it("treats letter case insensitively and requires explicit shift", () => {
    expect(humanizeKeystroke("ctrl-N", "linux")).toBe("Ctrl+N");
    expect(humanizeKeystroke("ctrl-shift-N", "linux")).toBe("Ctrl+Shift+N");
  });
});
