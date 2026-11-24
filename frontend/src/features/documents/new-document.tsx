"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useOrgUnits } from "@/features/members/use-members";
import { useProjects, useSubsystems } from "@/features/work/queries";
import { useRouter } from "@/i18n/navigation";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import {
  ACCEPTED_FILES,
  CATEGORIES,
  DOCUMENT_TYPES,
  createDocument,
  type DocumentType,
  type KnowledgeCategory,
} from "./api";
import { seasonName, seasonOf, textareaClass } from "./document-parts";
import { refreshDocuments } from "./queries";

/** A new file of the team, visible at once to its department's or project's members; prefilled from a folder
 * (?unit=, ?project=, ?season=). */
export function NewDocument() {
  const t = useTranslations("Documents");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const units = useOrgUnits();
  const projects = useProjects();
  const params = useSearchParams();
  const descriptionId = useId();
  const fileId = useId();
  // Read once the address is known (inside Suspense): "today" is never frozen at build time.
  const current = seasonOf(clubToday(new Date()));
  const seasons = [current + 1, current, current - 1, current - 2, current - 3, current - 4];
  const asId = (value: string | null) => (value && /^\d+$/.test(value) ? value : "");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DocumentType>("technical_doc");
  const [category, setCategory] = useState<KnowledgeCategory | "">("");
  const [unit, setUnit] = useState(asId(params.get("unit")));
  const [project, setProject] = useState(asId(params.get("project")));
  const [season, setSeason] = useState(asId(params.get("season")) || String(current));
  const [subsystem, setSubsystem] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const subsystems = useSubsystems(project ? Number(project) : null);

  const save = useMutation({
    mutationFn: () =>
      createDocument({
        title: title.trim(),
        description,
        type,
        category,
        org_unit_id: unit ? Number(unit) : null,
        project_id: project ? Number(project) : null,
        subsystem_id: subsystem ? Number(subsystem) : null,
        season: Number(season),
        file: file!,
        note,
      }),
    onSuccess: async (document) => {
      await refreshDocuments(queryClient);
      router.replace(`/documents/${document.id}`);
    },
  });

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim() && file) {
      save.mutate();
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/documents">{t("title")}</BackLink>
      <PageHeader eyebrow={tShell("groups.execution")} title={t("newTitle")} description={t("newIntro")} />
      <Card>
        <form onSubmit={send} className="space-y-5">
          {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
          <TextField
            label={t("titleLabel")}
            required
            maxLength={255}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={t("typeLabel")}
              value={type}
              onChange={(event) => setType(event.target.value as DocumentType)}
            >
              {DOCUMENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`type.${value}`)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t("categoryLabel")}
              value={category}
              onChange={(event) => setCategory(event.target.value as KnowledgeCategory | "")}
            >
              <option value="">{t("noCategory")}</option>
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`category.${value}`)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("unitLabel")} value={unit} onChange={(event) => setUnit(event.target.value)}>
              <option value="">{t("wholeTeam")}</option>
              {(units.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t("projectLabel")}
              value={project}
              onChange={(event) => {
                setProject(event.target.value);
                setSubsystem("");
              }}
            >
              <option value="">{t("noProject")}</option>
              {(projects.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("seasonLabel")} value={season} onChange={(event) => setSeason(event.target.value)}>
              {[...new Set([...seasons, Number(season)])].map((value) => (
                <option key={value} value={value}>
                  {seasonName(value)}
                </option>
              ))}
            </SelectField>
            {project && subsystems.data && subsystems.data.length > 0 ? (
              <SelectField
                label={t("subsystemLabel")}
                value={subsystem}
                onChange={(event) => setSubsystem(event.target.value)}
              >
                <option value="">{t("noSubsystem")}</option>
                {subsystems.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SelectField>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={descriptionId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
              {t("descriptionLabel")}
            </label>
            <textarea
              id={descriptionId}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={textareaClass}
            />
          </div>
          <fieldset className="space-y-3 rounded-xl border border-line p-4">
            <legend className="px-1 text-2xs font-semibold tracking-widest text-muted uppercase">
              {t("firstVersion")}
            </legend>
            <div className="space-y-1.5">
              <label htmlFor={fileId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
                {t("fileLabel")}
              </label>
              <input
                id={fileId}
                type="file"
                aria-required="true"
                accept={ACCEPTED_FILES}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="block w-full text-sm text-ink file:me-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium"
              />
              <p className="text-xs text-muted">{t("fileHint")}</p>
            </div>
            <TextField label={t("noteLabel")} value={note} onChange={(event) => setNote(event.target.value)} />
          </fieldset>
          <Button type="submit" loading={save.isPending} disabled={!title.trim() || !file}>
            {t("create")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
