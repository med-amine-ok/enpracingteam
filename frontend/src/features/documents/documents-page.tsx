"use client";

import { FilePlus, Search } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useOrgUnits } from "@/features/members/use-members";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import {
  CATEGORIES,
  DOCUMENT_TYPES,
  type DocumentFilters,
  type DocumentItem,
  type DocumentType,
  type KnowledgeCategory,
} from "./api";
import { KnowledgeTabs, seasonName, useSize } from "./document-parts";
import { useDocuments, useFolders } from "./queries";

/** All the team's files the viewer sees: search and filters (category, type, unit, season). */
export function DocumentsPage() {
  const t = useTranslations("Documents");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const units = useOrgUnits();
  const folders = useFolders();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<KnowledgeCategory | "">("");
  const [type, setType] = useState<DocumentType | "">("");
  const [unit, setUnit] = useState("");
  const [season, setSeason] = useState("");
  const words = useDeferredValue(query.trim());
  const filters: DocumentFilters = {
    ...(words ? { q: words } : {}),
    ...(category ? { category } : {}),
    ...(type ? { type } : {}),
    ...(unit ? { org_unit: Number(unit) } : {}),
    ...(season ? { season: Number(season) } : {}),
  };
  const documents = useDocuments(filters);
  // The seasons that have files, newest first: nothing to compute from today's date.
  const seasons = [...new Set((folders.data ?? []).map((folder) => folder.season))].sort((a, b) => b - a);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.execution")} title={t("title")} description={t("intro")}>
        <Link href="/documents/new" className={buttonClassName("primary", "sm")}>
          <FilePlus className="size-4" aria-hidden="true" />
          {t("new")}
        </Link>
      </PageHeader>
      <KnowledgeTabs current="documents" />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <TextField
            label={t("search")}
            type="search"
            icon={<Search />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="w-48">
          <SelectField
            label={t("categoryLabel")}
            value={category}
            onChange={(event) => setCategory(event.target.value as KnowledgeCategory | "")}
          >
            <option value="">{t("allCategories")}</option>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`category.${value}`)}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-44">
          <SelectField
            label={t("typeLabel")}
            value={type}
            onChange={(event) => setType(event.target.value as DocumentType | "")}
          >
            <option value="">{t("allTypes")}</option>
            {DOCUMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`type.${value}`)}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-48">
          <SelectField label={t("unitLabel")} value={unit} onChange={(event) => setUnit(event.target.value)}>
            <option value="">{t("allUnits")}</option>
            {(units.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-40">
          <SelectField label={t("seasonLabel")} value={season} onChange={(event) => setSeason(event.target.value)}>
            <option value="">{t("allSeasons")}</option>
            {seasons.map((value) => (
              <option key={value} value={value}>
                {seasonName(value)}
              </option>
            ))}
          </SelectField>
        </div>
      </div>
      {documents.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(documents.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => documents.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !documents.data ? (
        <LinesPlaceholder lines={5} />
      ) : documents.data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {documents.data.map((document) => (
            <DocumentRow key={document.id} document={document} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function DocumentRow({ document }: { document: DocumentItem }) {
  const t = useTranslations("Documents");
  const format = useFormatter();
  const size = useSize();
  const current = document.current_version;
  const place = [document.org_unit?.name, document.project?.name, document.subsystem?.name].filter(Boolean).join(" · ");
  return (
    <li>
      <Link
        href={`/documents/${document.id}`}
        className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs transition-colors hover:border-navy/30"
      >
        <span className="min-w-0 flex-1 space-y-1.5">
          <span dir="auto" className="block font-medium text-ink">
            {document.title}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone="info">{t(`type.${document.type}`)}</Badge>
            {document.category ? <Badge tone="neutral">{t(`category.${document.category}`)}</Badge> : null}
          </span>
          <span className="block text-xs text-muted">
            {place ? <bdi>{place}</bdi> : t("wholeTeam")}
            {current
              ? ` · ${t("currentVersion", {
                  number: String(current.number),
                  date: format.dateTime(new Date(current.uploaded_at), {
                    dateStyle: "medium",
                    numberingSystem: "latn",
                  }),
                  size: size(current.size),
                })}`
              : ""}
          </span>
        </span>
        <Badge tone="neutral">{t("season", { season: seasonName(document.season) })}</Badge>
      </Link>
    </li>
  );
}
