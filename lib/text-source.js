/** @babel */
import { TextBuffer } from "lumine";

export function textSource(value = "") {
  return TextBuffer.createTextSnapshot(value);
}

export function joinSources(parts, separator = "") {
  let result = textSource(),
    first = true;
  for (const part of parts) {
    if (!first && separator) result = result.replace(result.length, result.length, separator);
    result = result.replace(result.length, result.length, part);
    first = false;
  }
  return result;
}

export function rowSource(buffer, row) {
  return buffer.getTextSnapshotInRange([
    [row, 0],
    [row, buffer.lineLengthForRow(row)],
  ]);
}

export function chompSource(source) {
  let end = source.length;
  if (end && source.charCodeAt(end - 1) === 10) {
    end--;
    if (end && source.charCodeAt(end - 1) === 13) end--;
  }
  return source.subtext(0, end);
}

export async function* utf8Chunks(value) {
  let carry = "";
  for (const chunk of textSource(value).chunks()) {
    let text = carry + chunk;
    const last = text.charCodeAt(text.length - 1);
    carry = last >= 0xd800 && last <= 0xdbff ? text.slice(-1) : "";
    if (carry) text = text.slice(0, -1);
    if (text) yield Buffer.from(text, "utf8");
  }
  if (carry) yield Buffer.from(carry, "utf8");
}
