// Merges messages/_fragments/<Namespace>.<locale>.json into messages/<locale>.json, each fragment replacing its
// top-level namespace (never an existing namespace of the app: each fragment brings a new one). Used while the work module's screens were written in parallel; safe to re-run.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const messages = path.resolve(import.meta.dirname, "..", "messages");
const fragments = path.join(messages, "_fragments");
if (!existsSync(fragments)) {
  console.log("No fragments.");
  process.exit(0);
}
for (const locale of ["fr", "en", "ar"]) {
  const file = path.join(messages, `${locale}.json`);
  const catalog = JSON.parse(readFileSync(file, "utf8"));
  for (const name of readdirSync(fragments).sort()) {
    const match = name.match(/^(\w+)\.(fr|en|ar)\.json$/);
    if (match && match[2] === locale) {
      catalog[match[1]] = JSON.parse(readFileSync(path.join(fragments, name), "utf8"));
    }
  }
  writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
}
// The project's formatting (prettier), so that the files only gain the new namespaces.
execFileSync("npx", ["prettier", "--write", ...["fr", "en", "ar"].map((locale) => `messages/${locale}.json`)], {
  cwd: path.resolve(messages, ".."),
  shell: true,
  stdio: "ignore",
});
console.log("Merged.");
