"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { useSeasons, useWorkMe } from "@/features/workflow/queries";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { publishRun, startRun, type Run } from "./api";
import { refreshScoring, useFormulaVersions, useRuns } from "./queries";
import {
  PanelPlaceholder,
  PublishedBadge,
  QueryFailure,
  RunStatusBadge,
  ScoringGate,
  ScoringHeader,
  SeasonSelect,
  TableFrame,
  TextArea,
  memberName,
  td,
  tdEnd,
  th,
  thEnd,
  useScoringRights,
  useWhen,
} from "./scoring-parts";

/** The calculation runs (guide §14.4); the publication admins run and publish them. */
export function RunsPage() {
  return (
    <ScoringGate>
      <Runs />
    </ScoringGate>
  );
}

function Runs() {
  const t = useTranslations("Scoring");
  const when = useWhen();
  const rights = useScoringRights();
  const [season, setSeason] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const runs = useRuns(season);

  if (runs.isError) {
    return <QueryFailure error={runs.error} />;
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <ScoringHeader current="runs" title={t("runs.title")} description={t("runs.intro")}>
        {rights.publish && !starting ? (
          <Button onClick={() => setStarting(true)}>
            <Play className="size-4" aria-hidden="true" />
            {t("runs.start")}
          </Button>
        ) : null}
      </ScoringHeader>
      {rights.publish && starting ? <StartRunForm onClose={() => setStarting(false)} /> : null}
      <div className="w-64">
        <SeasonSelect value={season} onChange={setSeason} allowAll />
      </div>
      {!runs.data ? (
        <PanelPlaceholder />
      ) : (
        <Card title={t("runs.listTitle")}>
          {runs.data.length === 0 ? (
            <p className="text-sm text-muted">{t("runs.empty")}</p>
          ) : (
            <TableFrame minWidth="62rem">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>{t("runs.id")}</th>
                  <th className={th}>{t("runs.time")}</th>
                  <th className={th}>{t("season")}</th>
                  <th className={th}>{t("formula")}</th>
                  <th className={thEnd}>{t("runs.records")}</th>
                  <th className={thEnd}>{t("runs.warnings")}</th>
                  <th className={thEnd}>{t("runs.errors")}</th>
                  <th className={th}>{t("runs.status")}</th>
                  <th className={th}>{t("runs.publication")}</th>
                  {rights.publish ? <th className={th}>{t("runs.actions")}</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {runs.data.map((run) => (
                  <tr key={run.id}>
                    <td className={td}>
                      <Link href={`/scoring/runs/${run.id}`} className="font-medium text-navy hover:underline">
                        #{run.id}
                      </Link>
                    </td>
                    <td className={td}>
                      {when.dateTime(run.triggered_at)}
                      <span className="block text-xs text-muted">
                        <bdi>{memberName(run.triggered_by)}</bdi>
                      </span>
                    </td>
                    <td className={td}>
                      <bdi>{run.season_label}</bdi>
                    </td>
                    <td className={td}>
                      <bdi>{run.formula_version}</bdi>
                    </td>
                    <td className={tdEnd}>{run.records_processed ?? 0}</td>
                    <td className={tdEnd}>{run.warnings_count ?? 0}</td>
                    <td className={tdEnd}>{run.errors_count ?? 0}</td>
                    <td className={td}>
                      <RunStatusBadge status={run.status} />
                    </td>
                    <td className={td}>
                      <PublishedBadge published={run.is_published} />
                      {run.is_published && run.published_at ? (
                        <span className="block text-xs text-muted">{when.dateTime(run.published_at)}</span>
                      ) : null}
                    </td>
                    {rights.publish ? (
                      <td className={td}>
                        <PublishControl run={run} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </Card>
      )}
    </div>
  );
}

/** Scoring starts with the 2026–2027 season: the backend refuses a calculation for an earlier one. */
const FIRST_SCORED_YEAR = 2026;

/** "Run a calculation": a season, the current formula unless another is chosen, notes (publication admins). */
function StartRunForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Scoring");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const me = useWorkMe();
  const seasons = useSeasons();
  const formulas = useFormulaVersions();
  const [season, setSeason] = useState<string>(
    me.data?.current_season && me.data.current_season.year >= FIRST_SCORED_YEAR
      ? String(me.data.current_season.id)
      : "",
  );
  const [formula, setFormula] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<Run | null>(null);
  const start = useMutation({
    mutationFn: () =>
      startRun({ season: Number(season), notes, ...(formula ? { formula_version: Number(formula) } : {}) }),
    onSuccess: async (run) => {
      setDone(run);
      await refreshScoring(queryClient);
    },
  });

  return (
    <Card title={t("runs.startTitle")} description={t("runs.startIntro")}>
      <form
        className="space-y-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (season && !start.isPending) {
            start.mutate();
          }
        }}
      >
        {start.isError ? <Alert tone="error">{errorText(start.error, tErrors)}</Alert> : null}
        {done ? (
          <Alert tone={done.status === "failed" ? "error" : "success"}>
            {t("runs.started", { id: done.id })}{" "}
            <Link href={`/scoring/runs/${done.id}`} className="underline">
              {t("runs.open")}
            </Link>
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label={t("season")} required value={season} onChange={(event) => setSeason(event.target.value)}>
            <option value="">{t("runs.chooseSeason")}</option>
            {(seasons.data ?? [])
              .filter((item) => item.year >= FIRST_SCORED_YEAR)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
          </SelectField>
          <SelectField label={t("formula")} value={formula} onChange={(event) => setFormula(event.target.value)}>
            <option value="">{t("runs.currentFormula")}</option>
            {(formulas.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.code}
                {item.is_current ? ` (${t("formulas.current")})` : ""}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="text-xs text-muted">{t("runs.seasonRule")}</p>
        <TextArea label={t("runs.notes")} value={notes} onChange={setNotes} />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={start.isPending} disabled={!season}>
            <Play className="size-4" aria-hidden="true" />
            {t("runs.confirmStart")}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={start.isPending}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** "Publish" on a completed, unpublished run, after a confirmation (guide §17). */
export function PublishControl({ run }: { run: Run }) {
  const t = useTranslations("Scoring");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const publish = useMutation({
    mutationFn: () => publishRun(run.id, reason.trim()),
    onSuccess: async () => {
      setConfirming(false);
      await refreshScoring(queryClient);
    },
  });
  if (run.status !== "completed" || run.is_published) {
    return null;
  }
  if (!confirming) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
        <Megaphone className="size-4" aria-hidden="true" />
        {t("runs.publish")}
      </Button>
    );
  }
  return (
    <div
      role="dialog"
      aria-label={t("runs.publishTitle", { id: run.id })}
      className="w-72 space-y-3 rounded-lg border border-line bg-canvas p-3"
    >
      <p className="text-sm text-ink">{t("runs.publishConfirm", { id: run.id, season: run.season_label })}</p>
      <TextArea label={t("runs.publishReason")} value={reason} onChange={setReason} />
      {publish.isError ? <Alert tone="error">{errorText(publish.error, tErrors)}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => publish.mutate()} loading={publish.isPending} autoFocus>
          {t("runs.confirmPublish")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={publish.isPending}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}
