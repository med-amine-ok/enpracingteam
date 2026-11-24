"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, RotateCcw, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import { ACCEPTED_SOURCES, addSource, deleteSource, rereadSource, type Source, type SourceStatus } from "./api";
import { AssistantTabs, seasonName } from "./assistant-page";
import { refreshAssistant, useAssistantRights, useSources } from "./queries";

const TONES: Record<SourceStatus, BadgeTone> = { reading: "warning", ready: "success", failed: "danger" };

/** The Executive Bureau's window: the files the assistant answers from, read as soon as they are dropped. */
export function AssistantSourcesPage() {
  const t = useTranslations("Assistant");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const rights = useAssistantRights();
  const allowed = Boolean(rights.data?.manage_sources);
  const sources = useSources(allowed);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow={tShell("groups.execution")} title={t("title")} description={t("sourcesIntro")} />
      <AssistantTabs current="sources" />
      {rights.isError ? <Alert tone="error">{errorText(rights.error, tErrors)}</Alert> : null}
      {rights.data && !allowed ? <Alert tone="info">{t("sourcesForbidden")}</Alert> : null}
      {allowed ? (
        <>
          <AddSource />
          <Card title={t("sourcesTitle")}>
            {sources.isError ? (
              <Alert tone="error">{errorText(sources.error, tErrors)}</Alert>
            ) : !sources.data ? (
              <LinesPlaceholder lines={3} />
            ) : sources.data.length === 0 ? (
              <p className="text-sm text-muted">{t("noSources")}</p>
            ) : (
              <ul className="space-y-3">
                {sources.data.map((source) => (
                  <SourceRow key={source.id} source={source} />
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function AddSource() {
  const t = useTranslations("Assistant");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const fileId = useId();
  // Drawn once the rights are known, in the browser: "today" is never frozen at build time.
  const today = clubToday(new Date());
  const [year, month] = today.split("-").map(Number);
  const current = month >= 9 ? year : year - 1;
  const [title, setTitle] = useState("");
  const [season, setSeason] = useState(String(current));
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const add = useMutation({
    mutationFn: () => addSource({ title: title.trim(), season: Number(season), file: file! }),
    onSuccess: async () => {
      setTitle("");
      setFile(null);
      setInputKey((key) => key + 1);
      await refreshAssistant(queryClient);
    },
  });

  return (
    <Card title={t("addTitle")} description={t("addIntro")}>
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (title.trim() && file) {
            add.mutate();
          }
        }}
      >
        {add.isError ? <Alert tone="error">{errorText(add.error, tErrors)}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <TextField
            label={t("sourceTitle")}
            maxLength={255}
            placeholder={t("sourceTitlePlaceholder")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <SelectField label={t("season")} value={season} onChange={(event) => setSeason(event.target.value)}>
            {[current + 1, current, current - 1, current - 2, current - 3].map((value) => (
              <option key={value} value={value}>
                {seasonName(value)}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={fileId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t("fileLabel")}
          </label>
          <input
            key={inputKey}
            id={fileId}
            type="file"
            aria-required="true"
            accept={ACCEPTED_SOURCES}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink file:me-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <p className="text-xs text-muted">{t("fileHint")}</p>
        </div>
        <Button type="submit" loading={add.isPending} disabled={!title.trim() || !file}>
          <FileUp className="size-4" aria-hidden="true" />
          {t("addSource")}
        </Button>
      </form>
    </Card>
  );
}

function SourceRow({ source }: { source: Source }) {
  const t = useTranslations("Assistant");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const change = useMutation({
    mutationFn: async (action: "reread" | "delete") => {
      if (action === "reread") {
        await rereadSource(source.id);
      } else {
        await deleteSource(source.id);
      }
    },
    onSuccess: async () => {
      setConfirm(false);
      await refreshAssistant(queryClient);
    },
  });
  const date = format.dateTime(new Date(source.created_at), { dateStyle: "medium", numberingSystem: "latn" });

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span dir="auto" className="font-medium text-ink">
          {source.title}
        </span>
        <Badge tone="neutral">{seasonName(source.season)}</Badge>
        <Badge tone={TONES[source.status]}>{t(`status.${source.status}`)}</Badge>
      </div>
      <p className="text-xs text-muted">
        <bdi>{source.file_name}</bdi>
        {" · "}
        {t("addedBy", { name: `${source.uploaded_by.first_name} ${source.uploaded_by.last_name}`, date })}
        {source.status === "ready" ? ` · ${t("readCounts", { pages: source.pages, passages: source.passages })}` : ""}
      </p>
      {/* Why it failed, or the pages left out of a source read (a scanned page whose picture could not be read). */}
      {source.status !== "reading" && source.error ? <Alert tone="warning">{source.error}</Alert> : null}
      {change.isError ? <Alert tone="error">{errorText(change.error, tErrors)}</Alert> : null}
      {confirm ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-racing/30 bg-racing-soft p-3">
          <p className="text-sm text-ink">{t("deleteWarning")}</p>
          <Button size="sm" onClick={() => change.mutate("delete")} loading={change.isPending}>
            {t("yesDelete")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            {t("cancel")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {source.status !== "reading" ? (
            <Button size="sm" variant="secondary" onClick={() => change.mutate("reread")} loading={change.isPending}>
              <RotateCcw className="size-4" aria-hidden="true" />
              {t("reread")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t("delete")}
          </Button>
        </div>
      )}
    </li>
  );
}
