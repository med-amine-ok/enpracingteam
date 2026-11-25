"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PencilLine, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useWorkMe } from "@/features/workflow/queries";
import { errorText } from "@/lib/error-text";
import { QUALITY_DATA_STATUSES, saveQualityInput, type QualityDataStatus, type QualityInputRow } from "./api";
import { refreshScoring, useQualityInputs, useValidationIssues } from "./queries";
import {
  PanelPlaceholder,
  QueryFailure,
  ScoringGate,
  ScoringHeader,
  SeasonSelect,
  TextArea,
  memberName,
  severityLabel,
  useDecimal,
  useWhen,
} from "./scoring-parts";
import { ValidationIssueList } from "./validation-issues";

const STATUS_TONES: Record<QualityDataStatus, BadgeTone> = {
  incomplete: "warning",
  complete: "success",
  requires_correction: "danger",
  submitted: "info",
};

/** Ranking Data (guide §14.1, screen 29): the season's validation issues and every quality input, which the
 * admins enter or correct (each change audited with its reason). */
export function ScoringDataPage() {
  return (
    <ScoringGate>
      <ScoringData />
    </ScoringGate>
  );
}

function ScoringData() {
  const t = useTranslations("Scoring");
  const me = useWorkMe();
  const [chosen, setChosen] = useState<number | null>(null);
  const season = chosen ?? me.data?.current_season?.id ?? null;
  const issues = useValidationIssues(season);
  const inputs = useQualityInputs(season);
  const [status, setStatus] = useState<QualityDataStatus | "">("");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const words = search.trim().toLocaleLowerCase();
    return (inputs.data ?? []).filter(
      (row) =>
        (!status || row.data_status === status) &&
        (!words ||
          [row.deliverable.code, row.deliverable.title, row.work_order.code, row.work_order.title, row.department.name]
            .join(" ")
            .toLocaleLowerCase()
            .includes(words)),
    );
  }, [inputs.data, search, status]);

  if (issues.isError) {
    return <QueryFailure error={issues.error} />;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <ScoringHeader current="data" title={t("data.title")} description={t("data.intro")} />
      <div className="w-64">
        <SeasonSelect value={chosen} onChange={setChosen} />
      </div>
      <Card title={t("data.issuesTitle")}>
        {!issues.data ? (
          <p className="text-sm text-muted">{t("loading")}</p>
        ) : (
          <ValidationIssueList issues={issues.data} />
        )}
      </Card>
      <Card title={t("data.inputsTitle")} description={t("data.inputsIntro")}>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-56">
            <SelectField
              label={t("data.status")}
              value={status}
              onChange={(event) => setStatus(event.target.value as QualityDataStatus | "")}
            >
              <option value="">{t("data.allStatuses")}</option>
              {QUALITY_DATA_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`dataStatus.${value}`)}
                </option>
              ))}
            </SelectField>
          </div>
          <div className="w-64">
            <TextField
              label={t("data.search")}
              type="search"
              icon={<Search />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {inputs.isError ? (
          <QueryFailure error={inputs.error} />
        ) : !inputs.data ? (
          <PanelPlaceholder />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted">{t("data.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <QualityRow key={row.deliverable.id} row={row} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function QualityRow({ row }: { row: QualityInputRow }) {
  const t = useTranslations("Scoring");
  const decimal = useDecimal();
  const when = useWhen();
  const [editing, setEditing] = useState(false);
  // The backend takes a mark once the Deliverable is validated.
  const canEdit = row.deliverable.status === "validated";
  return (
    <li className="rounded-lg border border-line p-4" data-testid="quality-row">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            <bdi>
              {row.deliverable.code ? `${row.deliverable.code} — ${row.deliverable.title}` : row.deliverable.title}
            </bdi>
          </p>
          <p className="text-xs text-muted">
            <bdi>{row.work_order.code ? `${row.work_order.code} — ${row.work_order.title}` : row.work_order.title}</bdi>{" "}
            · <bdi>{row.department.name}</bdi>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONES[row.data_status]}>{t(`dataStatus.${row.data_status}`)}</Badge>
          {canEdit && !editing ? (
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <PencilLine className="size-4" aria-hidden="true" />
              {t("data.edit")}
            </Button>
          ) : null}
        </div>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">{t("member.rawQuality")}</dt>
          <dd className="text-ink">
            {row.raw_quality == null ? "—" : t("member.outOfFive", { value: decimal(row.raw_quality, 1) })}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t("member.firstSubmission")}</dt>
          <dd className="text-ink">{when.dateTime(row.first_complete_submission_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t("data.members")}</dt>
          <dd className="text-ink">
            <bdi>{row.members.map(memberName).join(", ") || "—"}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{t("data.lastModified")}</dt>
          <dd className="text-ink">
            {when.dateTime(row.last_modified_at)}
            {row.entered_by ? (
              <span className="block text-xs text-muted">
                <bdi>{memberName(row.entered_by)}</bdi>
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      {row.note ? (
        <p className="mt-2 text-sm text-muted" dir="auto">
          {t("data.noteLine", { note: row.note })}
        </p>
      ) : null}
      {row.rounds.length ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-navy">{t("data.submissions", { count: row.rounds.length })}</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {row.rounds.map((round) => (
              <li key={round.number}>
                {t("data.submissionLine", {
                  number: round.number,
                  date: when.dateTime(round.submitted_at),
                  decision: round.decision ?? "—",
                })}
                {round.severity
                  ? ` · ${severityLabel(t, round.severity)} · ${round.attributable ? t("member.attributable") : t("data.notAttributable")}`
                  : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {editing ? <QualityForm row={row} onClose={() => setEditing(false)} /> : null}
    </li>
  );
}

/** Enters or corrects the mark (0–5) and its data status, with a reason kept in the audit log. */
function QualityForm({ row, onClose }: { row: QualityInputRow; onClose: () => void }) {
  const t = useTranslations("Scoring");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [mark, setMark] = useState(row.raw_quality ?? "");
  const [status, setStatus] = useState<QualityDataStatus>(row.data_status);
  const [note, setNote] = useState(row.note);
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () =>
      saveQualityInput(row.deliverable.id, {
        raw_quality: mark.trim() === "" ? null : mark.trim(),
        data_status: status,
        note: note.trim(),
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      onClose();
      await refreshScoring(queryClient);
    },
  });
  const ready = Boolean(reason.trim());
  return (
    <form
      className="mt-3 space-y-3 rounded-lg border border-line bg-canvas p-3"
      aria-label={t("data.edit")}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (ready && !save.isPending) {
          save.mutate();
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={t("data.mark")}
          type="number"
          inputMode="decimal"
          min={0}
          max={5}
          step="0.1"
          valueDir="ltr"
          value={mark}
          onChange={(event) => setMark(event.target.value)}
        />
        <SelectField
          label={t("data.status")}
          value={status}
          onChange={(event) => setStatus(event.target.value as QualityDataStatus)}
        >
          {QUALITY_DATA_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`dataStatus.${value}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <TextArea label={t("data.note")} value={note} onChange={setNote} />
      <TextArea label={t("reason")} value={reason} onChange={setReason} required />
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" loading={save.isPending} disabled={!ready}>
          {t("data.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={save.isPending}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
