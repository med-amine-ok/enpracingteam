"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Trash2, Upload } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useRouter } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import {
  ACCEPTED_FILES,
  CATEGORIES,
  DOCUMENT_TYPES,
  deleteDocument,
  downloadVersion,
  updateDocument,
  uploadVersion,
  type DocumentDetail,
  type DocumentType,
  type DocumentVersion,
  type KnowledgeCategory,
} from "./api";
import { seasonName, textareaClass, useSize } from "./document-parts";
import { documentKeys, refreshDocuments, useDocument } from "./queries";

/** A document: its current version to download, its versions, its information. */
export function DocumentView() {
  const tErrors = useTranslations("Errors");
  const t = useTranslations("Documents");
  const { id } = useParams<{ id: string }>();
  const document = useDocument(Number(id));

  if (document.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <Alert tone="error">{errorText(document.error, tErrors)}</Alert>
      </div>
    );
  }
  if (!document.data) {
    return (
      <div className="mx-auto max-w-4xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={4} />
        </Card>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/documents">{t("title")}</BackLink>
      <Summary document={document.data} />
      <Versions document={document.data} />
    </div>
  );
}

function Summary({ document }: { document: DocumentDetail }) {
  const t = useTranslations("Documents");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const size = useSize();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = document.current_version;
  const download = useMutation({ mutationFn: (version: DocumentVersion) => downloadVersion(document.id, version) });
  const remove = useMutation({
    mutationFn: () => deleteDocument(document.id),
    onSuccess: async () => {
      router.replace("/documents");
      await refreshDocuments(queryClient);
    },
  });
  const error = download.error ?? remove.error;
  const place = [document.org_unit?.name, document.project?.name, document.subsystem?.name].filter(Boolean).join(" · ");

  if (editing) {
    return (
      <Card title={t("editTitle")}>
        <EditDocument document={document} onDone={() => setEditing(false)} />
      </Card>
    );
  }
  return (
    <section className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone="info">{t(`type.${document.type}`)}</Badge>
            {document.category ? <Badge tone="neutral">{t(`category.${document.category}`)}</Badge> : null}
          </span>
          <h1 dir="auto" className="text-2xl font-semibold tracking-tight text-ink rtl:text-right">
            {document.title}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {current ? (
            <Button onClick={() => download.mutate(current)} loading={download.isPending}>
              <Download className="size-4" aria-hidden="true" />
              {t("download")}
            </Button>
          ) : null}
          {document.permissions.edit ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              {t("edit")}
            </Button>
          ) : null}
          {document.permissions.delete ? (
            confirmDelete ? (
              <>
                <Button size="sm" onClick={() => remove.mutate()} loading={remove.isPending} autoFocus>
                  {t("confirmDelete")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  {t("cancel")}
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="size-4" aria-hidden="true" />
                {t("delete")}
              </Button>
            )
          ) : null}
        </div>
      </div>
      {error ? <Alert tone="error">{errorText(error, tErrors)}</Alert> : null}
      {document.description ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {document.description}
        </p>
      ) : null}
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <Detail label={t("placeLabel")}>{place || t("wholeTeam")}</Detail>
        <Detail label={t("seasonLabel")}>{seasonName(document.season)}</Detail>
        <Detail label={t("authorLabel")}>
          {document.uploaded_by.first_name} {document.uploaded_by.last_name}
        </Detail>
        {current ? (
          <Detail label={t("currentLabel")}>
            {t("currentVersion", {
              number: String(current.number),
              date: format.dateTime(new Date(current.uploaded_at), { dateStyle: "medium", numberingSystem: "latn" }),
              size: size(current.size),
            })}
          </Detail>
        ) : null}
      </dl>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted">{label}</dt>
      <dd dir="auto" className="text-ink">
        {children}
      </dd>
    </div>
  );
}

function EditDocument({ document, onDone }: { document: DocumentDetail; onDone: () => void }) {
  const t = useTranslations("Documents");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const descriptionId = useId();
  const [title, setTitle] = useState(document.title);
  const [type, setType] = useState<DocumentType>(document.type);
  const [category, setCategory] = useState<KnowledgeCategory | "">(document.category);
  const [description, setDescription] = useState(document.description);
  const [season, setSeason] = useState(String(document.season));
  // Around its season: a file is moved to the season before or after, rarely further.
  const seasons = [3, 2, 1, 0, -1, -2, -3].map((shift) => document.season + shift);
  const save = useMutation({
    mutationFn: () =>
      updateDocument(document.id, { title: title.trim(), type, category, description, season: Number(season) }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(documentKeys.detail(document.id), saved);
      onDone();
      await refreshDocuments(queryClient);
    },
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      <TextField label={t("titleLabel")} required value={title} onChange={(event) => setTitle(event.target.value)} />
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
        <SelectField label={t("seasonLabel")} value={season} onChange={(event) => setSeason(event.target.value)}>
          {seasons.map((value) => (
            <option key={value} value={value}>
              {seasonName(value)}
            </option>
          ))}
        </SelectField>
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
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending} disabled={!title.trim()}>
          {t("save")}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function Versions({ document }: { document: DocumentDetail }) {
  const t = useTranslations("Documents");
  const [uploading, setUploading] = useState(false);
  return (
    <Card
      title={t("versionsTitle", { count: document.versions.length, shown: String(document.versions.length) })}
      action={
        document.permissions.edit && !uploading ? (
          <Button variant="secondary" size="sm" onClick={() => setUploading(true)}>
            <Upload className="size-4" aria-hidden="true" />
            {t("newVersion")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        {uploading ? <NewVersion document={document} onDone={() => setUploading(false)} /> : null}
        <ul className="space-y-3">
          {document.versions.map((version) => (
            <VersionRow key={version.id} document={document} version={version} />
          ))}
        </ul>
      </div>
    </Card>
  );
}

function NewVersion({ document, onDone }: { document: DocumentDetail; onDone: () => void }) {
  const t = useTranslations("Documents");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const upload = useMutation({
    mutationFn: () => uploadVersion(document.id, file!, note),
    onSuccess: async () => {
      onDone();
      await refreshDocuments(queryClient);
    },
  });
  return (
    <form
      className="space-y-3 rounded-lg border border-line bg-canvas p-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (file) {
          upload.mutate();
        }
      }}
    >
      {upload.isError ? <Alert tone="error">{errorText(upload.error, tErrors)}</Alert> : null}
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
      </div>
      <TextField label={t("noteLabel")} value={note} onChange={(event) => setNote(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={upload.isPending} disabled={!file}>
          {t("sendVersion")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function VersionRow({ document, version }: { document: DocumentDetail; version: DocumentVersion }) {
  const t = useTranslations("Documents");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const size = useSize();
  const download = useMutation({ mutationFn: () => downloadVersion(document.id, version) });
  const day = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" });

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-ink">{t("versionNumber", { number: String(version.number) })}</span>
        {document.current_version?.id === version.id ? <Badge tone="strong">{t("current")}</Badge> : null}
        <button
          type="button"
          onClick={() => download.mutate()}
          className="min-w-0 truncate text-sm font-medium text-navy hover:underline"
          aria-label={t("downloadFile", { name: version.file_name })}
        >
          <bdi>{version.file_name}</bdi>
        </button>
        <span className="text-xs text-muted">{size(version.size)}</span>
      </div>
      <p className="text-xs text-muted">
        {t("uploadedBy", {
          name: `${version.uploaded_by.first_name} ${version.uploaded_by.last_name}`,
          date: day(version.uploaded_at),
        })}
      </p>
      {version.note ? (
        <p dir="auto" className="text-sm text-ink">
          {version.note}
        </p>
      ) : null}
      {download.isError ? <Alert tone="error">{errorText(download.error, tErrors)}</Alert> : null}
    </li>
  );
}
