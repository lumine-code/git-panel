const path = require("node:path");

describe("Git conflict header colors", () => {
  it("retains the original 35 percent color band on light and dark editor surfaces", () => {
    const sheet = lumine.themes.requireStylesheet(path.join(__dirname, "../styles/main.css"));
    const host = document.createElement("lumine-text-editor");
    jasmine.attachToDOM(host);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const rgba = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    try {
      for (const [background, expected, text] of [
        ["white", [236, 201, 183], 0],
        ["black", [70, 35, 18], 255],
      ]) {
        host.style.setProperty("--syntax-background-color", background);
        for (const [side, variable] of [
          ["Ours", "--git-panel-conflict-ours"],
          ["Theirs", "--syntax-color-renamed"],
          ["Base", "--git-panel-conflict-base"],
          ["Modified", "--syntax-color-modified"],
        ]) {
          host.style.setProperty(variable, "rgb(200, 100, 50)");
          const header = document.createElement("div");
          header.className = `git-panel-Conflict${side}Block`;
          host.appendChild(header);
          const style = getComputedStyle(header);
          const actual = rgba(style.backgroundColor);
          for (let i = 0; i < 3; i++)
            expect(Math.abs(actual[i] - expected[i]))
              .withContext(side)
              .toBeLessThanOrEqual(1);
          expect(rgba(style.color)).withContext(side).toEqual([text, text, text, 255]);
          header.remove();
        }
      }
    } finally {
      host.remove();
      sheet.dispose();
    }
  });
});
