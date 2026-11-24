"use client";

import { useMutation } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { findTask } from "@/features/work/api";
import { useRouter } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";

/** The top bar's search of a task by its reference ("EV27-007"), as in the Figma (decision D-022). */
export function ReferenceSearch() {
  const t = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const router = useRouter();
  const inputId = useId();
  const messageId = useId();
  const [reference, setReference] = useState("");
  const find = useMutation({
    mutationFn: (text: string) => findTask(text),
    onSuccess: (task) => {
      if (task) {
        setReference("");
        router.push(`/tasks/${task.id}`);
      }
    },
  });
  const notFound = find.isSuccess && find.data === null;

  return (
    <form
      role="search"
      className="relative hidden sm:block"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const text = reference.trim();
        if (text) {
          find.mutate(text);
        }
      }}
    >
      <label htmlFor={inputId} className="sr-only">
        {t("findTask")}
      </label>
      <Search
        className="pointer-events-none absolute inset-y-0 start-2.5 my-auto size-4 text-muted"
        aria-hidden="true"
      />
      <input
        id={inputId}
        type="search"
        dir="ltr"
        value={reference}
        placeholder={t("findPlaceholder")}
        aria-describedby={notFound || find.isError ? messageId : undefined}
        aria-invalid={notFound || undefined}
        onChange={(event) => {
          setReference(event.target.value);
          find.reset();
        }}
        className="h-9 w-40 rounded-md border border-line bg-canvas ps-8 pe-2 text-sm text-ink uppercase placeholder:text-muted placeholder:normal-case focus:w-48 focus:border-navy focus:bg-surface focus:outline-none aria-invalid:border-racing"
      />
      {notFound || find.isError ? (
        <p
          id={messageId}
          role="status"
          className="absolute end-0 top-full mt-2 w-max max-w-64 rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink shadow-card"
        >
          {notFound ? t("taskNotFound", { reference: reference.trim().toUpperCase() }) : errorText(find.error, tErrors)}
        </p>
      ) : null}
    </form>
  );
}
