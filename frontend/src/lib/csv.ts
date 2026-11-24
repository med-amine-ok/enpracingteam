type Cell = string | number | null | undefined;

/** The mark that tells Excel the file is UTF-8 (accents, Arabic). */
const BOM = String.fromCharCode(0xfeff);

function cell(value: Cell) {
  let text = value == null ? "" : String(value);
  // A cell starting like a formula would run in Excel: it stays text.
  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A table as a CSV file the French Excel opens as columns: semicolons, quotes where needed. */
export function toCsv(rows: Cell[][]) {
  return BOM + rows.map((row) => row.map(cell).join(";")).join("\r\n");
}

/** Offers the text to the viewer as a file to save. */
export function downloadFile(name: string, text: string, type = "text/csv;charset=utf-8") {
  saveBlob(new Blob([text], { type }), name);
}

/** Offers a file (a fetched one, or one made here) to the viewer, to save under `name`. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Released after the click has been handled: some browsers (Firefox, Safari) start the download
  // later, and would find no file if it were released at once.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
