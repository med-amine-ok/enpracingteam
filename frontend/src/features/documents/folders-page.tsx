"use client";

import { ChevronRight, FilePlus, Folder as FolderIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import type { Folder } from "./api";
import { KnowledgeTabs, seasonName } from "./document-parts";
import { DocumentRow } from "./documents-page";
import { useDocuments, useFolders } from "./queries";
import { buttonClassName } from "@/components/ui/button";

type Entry = { key: string; label: string; count: number };

function unitKey(folder: Folder) {
  return folder.unit ? String(folder.unit.id) : "none";
}

function projectKey(folder: Folder) {
  return folder.project ? String(folder.project.id) : "none";
}

/** The folders, one level at a time, adding up the files below each. */
function entries(folders: Folder[], keyOf: (folder: Folder) => string, labelOf: (folder: Folder) => string) {
  const rows = new Map<string, Entry>();
  for (const folder of folders) {
    const key = keyOf(folder);
    const row = rows.get(key) ?? { key, label: labelOf(folder), count: 0 };
    row.count += folder.count;
    rows.set(key, row);
  }
  return [...rows.values()];
}

function folderHref(unit?: string, project?: string, season?: string) {
  const params = new URLSearchParams();
  if (unit) params.set("unit", unit);
  if (project) params.set("project", project);
  if (season) params.set("season", season);
  const query = params.toString();
  return query ? `/documents/folders?${query}` : "/documents/folders";
}

/** The team's files arranged by department, then project, then season (decision D-020). */
export function FoldersPage() {
  const t = useTranslations("Documents");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const params = useSearchParams();
  const unit = params.get("unit") ?? "";
  const project = unit ? (params.get("project") ?? "") : "";
  const season = project ? (params.get("season") ?? "") : "";
  const folders = useFolders();
  const all = folders.data ?? [];
  const inUnit = all.filter((folder) => unitKey(folder) === unit);
  const inProject = inUnit.filter((folder) => projectKey(folder) === project);
  const unitName = inUnit[0]?.unit?.name ?? (unit === "none" ? t("wholeTeam") : "");
  const projectName = inProject[0]?.project?.name ?? (project === "none" ? t("noProject") : "");
  // A new file lands in the folder it is added from.
  const prefill = new URLSearchParams();
  if (unit && unit !== "none") prefill.set("unit", unit);
  if (project && project !== "none") prefill.set("project", project);
  if (season) prefill.set("season", season);
  const newHref = prefill.toString() ? `/documents/new?${prefill.toString()}` : "/documents/new";

  const crumbs = [
    { label: t("allFolders"), href: folderHref() },
    ...(unit ? [{ label: unitName, href: folderHref(unit) }] : []),
    ...(project ? [{ label: projectName, href: folderHref(unit, project) }] : []),
    ...(season ? [{ label: seasonName(Number(season)), href: folderHref(unit, project, season) }] : []),
  ];

  let level: Entry[] | null = null;
  if (!unit) {
    level = entries(all, unitKey, (folder) => folder.unit?.name ?? t("wholeTeam"));
  } else if (!project) {
    level = entries(inUnit, projectKey, (folder) => folder.project?.name ?? t("noProject"));
  } else if (!season) {
    level = entries(
      inProject,
      (folder) => String(folder.season),
      (folder) => seasonName(folder.season),
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.execution")} title={t("title")} description={t("foldersIntro")}>
        <Link href={newHref} className={buttonClassName("primary", "sm")}>
          <FilePlus className="size-4" aria-hidden="true" />
          {unit ? t("addHere") : t("new")}
        </Link>
      </PageHeader>
      <KnowledgeTabs current="folders" />
      <nav aria-label={t("folderPath")}>
        <ol className="flex flex-wrap items-center gap-1 text-sm">
          {crumbs.map((crumb, index) => (
            <li key={crumb.href} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden="true" /> : null}
              {index === crumbs.length - 1 ? (
                <span aria-current="page" className="font-medium text-ink">
                  <bdi>{crumb.label}</bdi>
                </span>
              ) : (
                <Link href={crumb.href} className="text-muted hover:text-ink hover:underline">
                  <bdi>{crumb.label}</bdi>
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {folders.isError ? (
        <Alert tone="error">{errorText(folders.error, tErrors)}</Alert>
      ) : !folders.data ? (
        <LinesPlaceholder lines={4} />
      ) : level ? (
        level.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
            {t("noFolders")}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {level.map((entry) => (
              <li key={entry.key}>
                <Link
                  href={
                    !unit
                      ? folderHref(entry.key)
                      : !project
                        ? folderHref(unit, entry.key)
                        : folderHref(unit, project, entry.key)
                  }
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs transition-colors hover:border-navy/30"
                >
                  <FolderIcon className="size-5 shrink-0 text-navy" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <bdi className="block truncate font-medium text-ink">{entry.label}</bdi>
                    <span className="block text-xs text-muted">{t("filesCount", { count: entry.count })}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        <FolderFiles unit={unit} project={project} season={Number(season)} />
      )}
    </div>
  );
}

function FolderFiles({ unit, project, season }: { unit: string; project: string; season: number }) {
  const t = useTranslations("Documents");
  const tErrors = useTranslations("Errors");
  const documents = useDocuments({ unit, project, season });
  if (documents.isError) {
    return <Alert tone="error">{errorText(documents.error, tErrors)}</Alert>;
  }
  if (!documents.data) {
    return <LinesPlaceholder lines={3} />;
  }
  if (documents.data.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-muted">
        {t("empty")}
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {documents.data.map((document) => (
        <DocumentRow key={document.id} document={document} />
      ))}
    </ul>
  );
}
