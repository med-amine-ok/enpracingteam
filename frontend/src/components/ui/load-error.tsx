"use client";

import { useTranslations } from "next-intl";
import { errorText } from "@/lib/error-text";
import { Alert } from "./alert";

/** In place of a part of a page whose data could not be read: why, in the reader's language, rather than a
 * placeholder that never ends. */
export function LoadError({ error, className }: { error: unknown; className?: string }) {
  const t = useTranslations("Errors");
  return (
    <Alert tone="error" className={className}>
      {errorText(error, t)}
    </Alert>
  );
}
