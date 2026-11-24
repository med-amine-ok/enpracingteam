"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { updateProject, type ProjectDetail } from "@/features/work/api";
import { refreshWork } from "@/features/work/queries";
import { errorText } from "@/lib/error-text";

/** The prefix of the project's task references (EV27 → EV27-001), set by who may change the project. Without
 * one, the references use P and the project's number (P16-001), as the API does: the field says so. */
export function ProjectKey({ project }: { project: ProjectDetail }) {
  const t = useTranslations("Projects");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [key, setKey] = useState(project.key ?? "");
  const fallback = `P${project.id}`;
  const save = useMutation({
    mutationFn: (value: string) => updateProject(project.id, { key: value }),
    onSuccess: (saved) => setKey(saved.key ?? ""),
    onSettled: () => refreshWork(queryClient),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(key.trim().toUpperCase());
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            label={t("keyLabel")}
            valueDir="ltr"
            maxLength={10}
            placeholder={fallback}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            className="uppercase"
          />
        </div>
        <Button type="submit" size="sm" variant="secondary" loading={save.isPending} className="h-11">
          {t("keySave")}
        </Button>
      </div>
      <p className="text-xs text-muted">{t("keyHint", { example: `${key.trim().toUpperCase() || fallback}-001` })}</p>
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">{t("keySaved")}</Alert> : null}
    </form>
  );
}
