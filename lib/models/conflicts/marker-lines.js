/** @babel */
import { StringDecoder } from "node:string_decoder";
import { setImmediate as yieldWork } from "node:timers/promises";

// Only marker metadata survives a chunk boundary. Ordinary lines may be
// arbitrarily long; their text is never accumulated by the scanner.
export class MarkerLineScanner {
  constructor() {
    this.reset();
  }
  reset() {
    this.kind = null;
    this.width = 0;
    this.phase = "run";
    this.label = false;
    this.cr = false;
  }
  part(text) {
    if (!text.length || this.phase === "invalid") return;
    if (this.cr) {
      this.phase = "invalid";
      return;
    }
    let index = 0;
    if (!this.kind) {
      this.kind = text[0];
      if (!"<|=>".includes(this.kind)) {
        this.phase = "invalid";
        return;
      }
    }
    if (this.phase === "run") {
      while (index < text.length && text[index] === this.kind) {
        this.width++;
        index++;
      }
      if (index === text.length) return;
      if (this.kind === "=") {
        if (text[index] === "\r" && index === text.length - 1) this.cr = true;
        else this.phase = "invalid";
        return;
      }
      if (text[index++] !== " ") {
        this.phase = "invalid";
        return;
      }
      this.phase = "label";
    }
    const rest = text.slice(index);
    if (/\r/.test(rest)) {
      if (rest.endsWith("\r") && !/\r/.test(rest.slice(0, -1))) this.cr = true;
      else {
        this.phase = "invalid";
        return;
      }
    }
    if (rest.length > (this.cr ? 1 : 0)) this.label = true;
  }
  end() {
    const marker =
      this.phase !== "invalid" &&
      this.width >= 7 &&
      (this.kind === "=" || (this.phase === "label" && this.label))
        ? { kind: this.kind, width: this.width }
        : null;
    this.reset();
    return marker;
  }
}

export async function* streamMarkers(stream, { stopAtBinary = false } = {}) {
  const decoder = new StringDecoder("utf8"),
    scanner = new MarkerLineScanner();
  let deadline = performance.now() + 4;
  for await (const bytes of stream) {
    for (let chunkOffset = 0; chunkOffset < bytes.length; chunkOffset += 65536) {
      const part = bytes.slice(chunkOffset, chunkOffset + 65536);
      if (stopAtBinary && (typeof part === "string" ? part.includes("\0") : part.includes(0)))
        return;
      const text = typeof part === "string" ? part : decoder.write(part);
      let offset = 0;
      while (offset < text.length) {
        const newline = text.indexOf("\n", offset);
        scanner.part(text.slice(offset, newline < 0 ? text.length : newline));
        if (newline < 0) break;
        const marker = scanner.end();
        if (marker) yield marker;
        offset = newline + 1;
        if (performance.now() >= deadline) {
          await yieldWork();
          deadline = performance.now() + 4;
        }
      }
      if (performance.now() >= deadline) {
        await yieldWork();
        deadline = performance.now() + 4;
      }
    }
  }
  scanner.part(decoder.end());
  const marker = scanner.end();
  if (marker) yield marker;
}
