import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { MAIL_DIR } from "./env";

export type LoginEmail = { code: string; body: string };

// Django's file e-mail backend writes each message followed by a line of 79 dashes.
const SEPARATOR = /^-{79}$/m;

/**
 * The login e-mail sent to `address` after `since` (a Date.now() value taken before asking for the
 * code), with its 6-digit code. Waits for it up to `timeout` ms.
 */
export function waitForLoginEmail(address: string, since: number, timeout = 10_000): Promise<LoginEmail> {
  return waitForMessage(address, since, timeout, "login e-mail", (body) => {
    const code = body.match(/\b(\d{6})\b/)?.[1];
    return code ? { code, body } : null;
  });
}

/** The text of the e-mail sent to `address` after `since` that contains `text` (a notification…). */
export function waitForEmail(address: string, since: number, text: string, timeout = 10_000): Promise<string> {
  return waitForMessage(address, since, timeout, `e-mail with "${text}"`, (body) =>
    body.includes(text) ? body : null,
  );
}

async function waitForMessage<T>(
  address: string,
  since: number,
  timeout: number,
  what: string,
  accept: (body: string) => T | null,
): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const found = findMessage(address, since, accept);
    if (found) {
      return found;
    }
    if (Date.now() > deadline) {
      throw new Error(`No ${what} for ${address} in ${MAIL_DIR}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** The newest message to `address` written after `since` that `accept` takes. */
function findMessage<T>(address: string, since: number, accept: (body: string) => T | null): T | null {
  let files: { file: string; time: number }[];
  try {
    files = readdirSync(MAIL_DIR)
      .map((name) => path.join(MAIL_DIR, name))
      .map((file) => ({ file, time: statSync(file).mtimeMs }))
      // 1 s of margin: the file system and the clock may round differently.
      .filter(({ time }) => time >= since - 1000)
      .sort((a, b) => b.time - a.time);
  } catch {
    return null; // no e-mail written yet
  }
  for (const { file } of files) {
    for (const message of readFileSync(file, "utf8").split(SEPARATOR).reverse()) {
      const [headers, ...rest] = message.trim().split(/\r?\n\r?\n/);
      if (!headers.split(/\r?\n/).some((line) => line.trim().toLowerCase() === `to: ${address.toLowerCase()}`)) {
        continue;
      }
      const found = accept(decodeBody(headers, rest.join("\n\n")));
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * The text of the e-mail, as a mail client shows it. Django picks the most compact encoding: plain
 * 8-bit text for French or English, base64 for Arabic (mostly non-Latin letters), and
 * quoted-printable when lines are long.
 */
function decodeBody(headers: string, body: string) {
  const encoding = headers.match(/^content-transfer-encoding:\s*(\S+)/im)?.[1].toLowerCase();
  if (encoding === "base64") {
    return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  }
  if (encoding === "quoted-printable") {
    const bytes = body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, "latin1").toString("utf8");
  }
  return body;
}
