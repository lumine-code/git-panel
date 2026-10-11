/** @babel */

export default function hunkTitle({
  oldStartRow,
  newStartRow,
  oldRowCount,
  newRowCount,
  sectionHeading,
}) {
  const coordinates = `@@ -${oldStartRow},${oldRowCount} +${newStartRow},${newRowCount} @@`;
  return [coordinates, sectionHeading.trim()].filter(Boolean).join(" ");
}
