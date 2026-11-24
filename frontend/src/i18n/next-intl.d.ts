import type messages from "../../messages/fr.json";
import type { routing } from "./routing";

// Typed translations: a key missing from messages/fr.json is a TypeScript error. The other
// languages must have the same keys (checked by src/i18n/messages.test.ts).
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
