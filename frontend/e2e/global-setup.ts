import { mkdirSync, rmSync } from "node:fs";
import { MAIL_DIR, MEDIA_DIR } from "./support/env";

/** Every run starts with an empty mailbox and no uploaded file (the database is recreated by e2e_reset). */
export default function globalSetup() {
  for (const folder of [MAIL_DIR, MEDIA_DIR]) {
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
  }
}
