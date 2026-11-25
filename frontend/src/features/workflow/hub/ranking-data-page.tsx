"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { LoadError } from "@/components/ui/load-error";
import { SelectField } from "@/components/ui/select-field";
import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/errors";
import { errorText } from "@/lib/error-text";
import { DeliverableStatusBadge } from "../badges";
import { useSeasons, useWorkMe } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { useDepartments } from "./dependencies-page";
import {
  QUALITY_DATA_STATUSES,
  saveQualityInput,
  type QualityAudit,
  type QualityDataStatus,
  type QualityFilters,
  type QualityRow,
} from "./hub-api";
import { refreshQuality, useQualityHistory, useQualityInputs } from "./hub-queries";
import { Detail, Empty, TextArea, labelClass, personName, useDates } from "./parts";

const STATUS_TONES: Record<QualityDataStatus, BadgeTone> = {
  incomplete: "warning",
  complete: "success",
  requires_correction: "danger",
  submitted: "strong",
};

/** A mark from 0 to 5 with one decimal at most ("4", "4.5"). */
function validMark(value: string) {
  return /^\d(\.\d)?$/.test(value.trim()) && Number(value) >= 0 && Number(value) <= 5;
}

/**
 * The club admins' ranking-data workspace (front guide §13, as revised: the admins enter the raw quality mark and
 * the data status for every department): the validated Deliverables, the completeness, and every change's history.
 * The API answers 404 to whoever may not see it (Heads included): the page then says only "not found", as for any
 * page that does not exist (guide §2.1, §17).
 */
export function RankingDataPage() {
  const t = useTranslations("WorkHub");
  const workMe = useWorkMe();
  const seasons = useSeasons();
  const departments = useDepartments();
  const [season, setSeason] = useState<number | null>(null);
  const [department, setDepartment] = useState("");
  const [dataStatus, setDataStatus] = useState("");
  const currentSeason = season ?? workMe.data?.current_season?.id ?? undefined;
  const filters: QualityFilters = {
    ...(currentSeason ? { season: currentSeason } : {}),
    ...(department ? { department: Number(department) } : {}),
    ...(dataStatus ? { data_status: dataStatus } : {}),
  };
  const rows = useQualityInputs(filters, workMe.isFetched);

  if (rows.error instanceof ApiError && rows.error.status === 404) {
    return <NotFound />;
  }
  if (!rows.data && !rows.isError) {
    return <LinesPlaceholder lines={6} />;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <WorkflowHeader current="rankingData" description={t("rankingData.intro")} />
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-56">
          <SelectField
            label={t("reports.season")}
            value={currentSeason ?? ""}
            onChange={(event) => setSeason(Number(event.target.value) || null)}
          >
            {(seasons.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-56">
          <SelectField
            label={t("department")}
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="">{t("allDepartments")}</option>
            {departments.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-56">
          <SelectField
            label={t("rankingData.dataStatus")}
            value={dataStatus}
            onChange={(event) => setDataStatus(event.target.value)}
          >
            <option value="">{t("all")}</option>
            {QUALITY_DATA_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`rankingData.status.${value}`)}
              </option>
            ))}
          </SelectField>
        </div>
      </div>
      {rows.isError ? (
        <LoadError error={rows.error} />
      ) : rows.data ? (
        <>
          <Completeness rows={rows.data} />
          <Card title={t("rankingData.inputs")} description={t("rankingData.inputsIntro")}>
            {rows.data.length === 0 ? (
              <Empty>{t("rankingData.empty")}</Empty>
            ) : (
              <ul className="space-y-4">
                {rows.data.map((row) => (
                  <InputRow key={row.deliverable.id} row={row} />
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function NotFound() {
  const tErrors = useTranslations("Errors");
  return (
    <div className="mx-auto max-w-3xl py-10">
      <Alert tone="info">{tErrors("notFound")}</Alert>
    </div>
  );
}

/** Counts by data status (guide §13.4), and the Deliverables still awaiting validation. */
function Completeness({ rows }: { rows: QualityRow[] }) {
  const t = useTranslations("WorkHub");
  const markable = rows.filter((row) => row.deliverable.status === "validated");
  const count = (status: QualityDataStatus) => markable.filter((row) => row.data_status === status).length;
  return (
    <section aria-label={t("rankingData.completeness")} className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {QUALITY_DATA_STATUSES.map((status) => (
        <KpiCard key={status} label={t(`rankingData.status.${status}`)} value={count(status)} />
      ))}
      <KpiCard
        label={t("rankingData.awaiting")}
        value={rows.length - markable.length}
        hint={t("rankingData.awaitingHint")}
      />
    </section>
  );
}

function InputRow({ row }: { row: QualityRow }) {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const tErrors = useTranslations("Errors");
  const { moment } = useDates();
  const queryClient = useQueryClient();
  const markId = useId();
  const [mark, setMark] = useState(row.raw_quality ?? "");
  const [status, setStatus] = useState<QualityDataStatus>(row.data_status);
  const [note, setNote] = useState(row.note);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const validated = row.deliverable.status === "validated";
  const save = useMutation({
    mutationFn: (dataStatus: QualityDataStatus) =>
      saveQualityInput(row.deliverable.id, {
        raw_quality: mark.trim() ? mark.trim() : null,
        data_status: dataStatus,
        note: note.trim(),
        reason: reason.trim(),
      }),
    onSuccess: async (_, dataStatus) => {
      setStatus(dataStatus);
      setReason("");
      setSaved(true);
      await refreshQuality(queryClient);
    },
  });
  const markOk = !mark.trim() || validMark(mark);
  const confirmStatus: QualityDataStatus = status === "incomplete" ? "complete" : status;
  const canConfirm = confirmStatus === "requires_correction" ? markOk : validMark(mark);
  const send = (dataStatus: QualityDataStatus) => {
    if (!save.isPending) {
      setSaved(false);
      save.mutate(dataStatus);
    }
  };

  return (
    <li className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <Link
            href={`/work/deliverables/${row.deliverable.id}`}
            dir="auto"
            className="block font-semibold text-ink hover:text-racing"
          >
            {[row.deliverable.code, row.deliverable.title].filter(Boolean).join(" · ")}
          </Link>
          <p dir="auto" className="text-xs text-muted">
            {[row.work_order.code, row.work_order.title].filter(Boolean).join(" · ")} — {row.department.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <DeliverableStatusBadge status={row.deliverable.status} />
          {validated ? (
            <Badge tone={STATUS_TONES[row.data_status]}>{t(`rankingData.status.${row.data_status}`)}</Badge>
          ) : (
            <Badge tone="neutral">{t("rankingData.awaitingBadge")}</Badge>
          )}
        </div>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Detail label={t("rankingData.members")}>
          {row.members.length ? row.members.map(personName).join(", ") : t("blockers.nobody")}
        </Detail>
        <Detail label={t("rankingData.firstComplete")}>
          {row.first_complete_submission_at ? moment(row.first_complete_submission_at) : t("rankingData.none")}
        </Detail>
        {row.last_modified_at ? (
          <Detail label={t("rankingData.lastModified")}>
            {row.entered_by
              ? t("byOn", { name: personName(row.entered_by), date: moment(row.last_modified_at) })
              : moment(row.last_modified_at)}
          </Detail>
        ) : null}
      </dl>
      <div className="space-y-1.5">
        <p className={labelClass}>{t("rankingData.rounds", { count: row.rounds.length })}</p>
        {row.rounds.length === 0 ? (
          <Empty>{t("rankingData.none")}</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {row.rounds.map((round) => (
              <li key={round.number} className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{t("rankingData.round", { number: round.number })}</span>
                {round.submitted_at ? <span className="text-xs text-muted">{moment(round.submitted_at)}</span> : null}
                {!round.complete ? <Badge tone="neutral">{t("rankingData.incompleteRound")}</Badge> : null}
                {round.severity ? (
                  <Badge tone="warning">{tWorkflow(`revisionSeverity.${round.severity}`)}</Badge>
                ) : null}
                {round.attributable != null ? (
                  <Badge tone={round.attributable ? "danger" : "neutral"}>
                    {round.attributable ? t("rankingData.attributable") : t("rankingData.notAttributable")}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      {validated ? (
        <form
          className="space-y-3 rounded-lg border border-line bg-canvas p-4"
          aria-label={t("rankingData.entry")}
          onSubmit={(event) => {
            event.preventDefault();
            if (canConfirm) {
              send(confirmStatus);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor={markId} className={labelClass}>
                {t("rankingData.mark")}
              </label>
              <input
                id={markId}
                type="number"
                inputMode="decimal"
                min={0}
                max={5}
                step={0.1}
                dir="ltr"
                value={mark}
                aria-invalid={!markOk || undefined}
                onChange={(event) => {
                  setSaved(false);
                  setMark(event.target.value);
                }}
                className="h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none aria-invalid:border-racing"
              />
              {!markOk ? <p className="text-xs text-racing">{t("rankingData.markInvalid")}</p> : null}
            </div>
            <SelectField
              label={t("rankingData.dataStatus")}
              value={status}
              onChange={(event) => {
                setSaved(false);
                setStatus(event.target.value as QualityDataStatus);
              }}
            >
              {QUALITY_DATA_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`rankingData.status.${value}`)}
                </option>
              ))}
            </SelectField>
          </div>
          <TextArea label={t("rankingData.note")} value={note} onChange={setNote} />
          <TextArea label={t("rankingData.reason")} value={reason} onChange={setReason} />
          {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
          {saved ? <p className="text-sm text-success">{t("rankingData.saved")}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={save.isPending && save.variables === "incomplete"}
              disabled={save.isPending || !markOk}
              onClick={() => send("incomplete")}
            >
              {t("rankingData.saveDraft")}
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={save.isPending && save.variables !== "incomplete"}
              disabled={save.isPending || !canConfirm}
            >
              {t("rankingData.confirm")}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted">{t("rankingData.awaitingHint")}</p>
      )}
      <div>
        <Button size="sm" variant="ghost" aria-expanded={showHistory} onClick={() => setShowHistory((open) => !open)}>
          {showHistory ? t("rankingData.hideHistory") : t("rankingData.showHistory")}
        </Button>
        {showHistory ? <History deliverable={row.deliverable.id} /> : null}
      </div>
    </li>
  );
}

/** "raw_quality: 4.5 · data_status: complete" for a change's old or new value. */
function describe(value: unknown): string {
  if (value == null || value === "") {
    return "—";
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${item ?? "—"}`)
      .join(" · ");
  }
  return String(value);
}

function History({ deliverable }: { deliverable: number }) {
  const t = useTranslations("WorkHub");
  const { moment } = useDates();
  const history = useQualityHistory(deliverable, true);
  if (history.isError) {
    return <LoadError error={history.error} className="mt-2" />;
  }
  if (!history.data) {
    return <LinesPlaceholder lines={2} />;
  }
  if (history.data.length === 0) {
    return <p className="mt-2 text-sm text-muted">{t("rankingData.noHistory")}</p>;
  }
  return (
    <ul className="mt-2 space-y-2 border-s-2 border-line ps-3 text-sm">
      {history.data.map((entry: QualityAudit) => (
        <li key={entry.id} className="space-y-0.5">
          <p className="text-ink">
            {t("byOn", { name: personName(entry.actor) || "—", date: moment(entry.occurred_at) })}
          </p>
          <p dir="ltr" className="text-xs text-muted">
            {describe(entry.old_value)} → {describe(entry.new_value)}
          </p>
          {entry.reason ? (
            <p dir="auto" className="text-xs text-muted">
              {entry.reason}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
