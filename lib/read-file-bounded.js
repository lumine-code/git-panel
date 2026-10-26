/** @babel */
import fs from "node:fs/promises";

export const MAX_DIFF_BYTES = 256 * 1024 * 1024;

export default async function readFileBounded(
  filePath,
  { maxBytes = MAX_DIFF_BYTES, signal, encoding = null } = {},
) {
  signal?.throwIfAborted();
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const tooLarge = () =>
      Object.assign(
        new RangeError(
          `Git preview exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB input limit. Open the complete file in the text editor.`,
        ),
        { code: "ERR_GIT_DIFF_TOO_LARGE", path: filePath, limit: maxBytes },
      );
    if (stat.size > maxBytes) throw tooLarge();
    const chunks = [];
    let size = 0;
    for (;;) {
      signal?.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(65536, maxBytes - size + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maxBytes) throw tooLarge();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    signal?.throwIfAborted();
    const bytes = Buffer.concat(chunks, size);
    return encoding ? bytes.toString(encoding) : bytes;
  } finally {
    await handle.close();
  }
}
