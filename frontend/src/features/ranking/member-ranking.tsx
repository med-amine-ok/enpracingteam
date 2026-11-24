"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNow, useTranslations } from "next-intl";
import { useParams, useSearchParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { errorText } from "@/lib/error-text";
import { saveAssessment, type Assessment, type MemberMonth } from "./api";
import { ContributionList } from "./contributions";
import { rankingKeys, refreshRanking, useMemberMonth } from "./queries";
import { ScoreBreakdown, monthKey, textareaClass, useMonthName } from "./ranking-parts";

const MARKS = ["0", "1", "2", "3", "4", "5"];

/** A member's month for their department head or the Team Manager: the score, the marks, the points. */
export function MemberRanking() {
  const t = useTranslations("Ranking");
  const tErrors = useTranslations("Errors");
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const now = useNow();
  const month = search.get("month") || monthKey(now);
  const data = useMemberMonth(Number(id), month);
  const monthName = useMonthName();

  if (data.isError) {
    return (
      <div className="mx-auto max-w-5xl">
        <Alert tone="error">{errorText(data.error, tErrors)}</Alert>
      </div>
    );
  }
  if (!data.data) {
    return (
      <div className="mx-auto max-w-5xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={6} />
        </Card>
      </div>
    );
  }
  const memberMonth = data.data;
  const name = `${memberMonth.member.first_name} ${memberMonth.member.last_name}`;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <BackLink href="/ranking/team">{t("backToTeam")}</BackLink>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{name}</h1>
        <p className="text-sm text-muted">
          {monthName(memberMonth.month)}
          {memberMonth.department ? (
            <>
              {" · "}
              <bdi>{memberMonth.department.name}</bdi>
            </>
          ) : null}
        </p>
      </header>
      <Card>
        <ScoreBreakdown score={memberMonth.score} />
      </Card>
      {memberMonth.permissions.assess ? (
        <Card title={t("assessTitle")} description={t("assessIntro")}>
          <AssessmentForm memberMonth={memberMonth} />
        </Card>
      ) : null}
      <Card title={t("contributionsTitle")}>
        <ContributionList contributions={memberMonth.contributions} empty={t("noContributions")} />
      </Card>
    </div>
  );
}

/** "" (not marked), "na" (with a reason), or the mark. */
function criterionValue(mark: number | null | undefined, reason?: string) {
  if (mark != null) {
    return String(mark);
  }
  return reason ? "na" : "";
}

function AssessmentForm({ memberMonth }: { memberMonth: MemberMonth }) {
  const t = useTranslations("Ranking");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const ids = useId();
  const initial: Partial<Assessment> = memberMonth.assessment ?? {};
  const [communication, setCommunication] = useState(criterionValue(initial.communication_mark));
  const [workshop, setWorkshop] = useState(criterionValue(initial.workshop_mark, initial.workshop_na_reason));
  const [workshopReason, setWorkshopReason] = useState(initial.workshop_na_reason ?? "");
  const [events, setEvents] = useState(criterionValue(initial.events_mark, initial.events_na_reason));
  const [eventsReason, setEventsReason] = useState(initial.events_na_reason ?? "");
  const [logistics, setLogistics] = useState(criterionValue(initial.logistics_mark));
  const [effort, setEffort] = useState(criterionValue(initial.effort_mark));
  const [evidence, setEvidence] = useState(initial.effort_evidence ?? "");
  const [excused, setExcused] = useState(initial.excused_weeks ? String(Number(initial.excused_weeks)) : "0");
  const [noWork, setNoWork] = useState(initial.no_work_available ?? false);
  const [note, setNote] = useState(initial.note ?? "");
  const markOf = (value: string) => (value === "" || value === "na" ? null : Number(value));

  const save = useMutation({
    mutationFn: () =>
      saveAssessment(memberMonth.member.id, {
        month: memberMonth.month,
        communication_mark: markOf(communication),
        workshop_mark: markOf(workshop),
        workshop_na_reason: workshop === "na" ? workshopReason.trim() : "",
        events_mark: markOf(events),
        events_na_reason: events === "na" ? eventsReason.trim() : "",
        logistics_mark: markOf(logistics),
        effort_mark: markOf(effort),
        effort_evidence: evidence,
        excused_weeks: excused || "0",
        no_work_available: noWork,
        note,
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(rankingKeys.member(saved.member.id, saved.month), saved);
      await refreshRanking(queryClient);
    },
  });
  const missingReason = (workshop === "na" && !workshopReason.trim()) || (events === "na" && !eventsReason.trim());

  const markSelect = (label: string, value: string, onChange: (value: string) => void, na = false) => (
    <SelectField label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{t("markNone")}</option>
      {na ? <option value="na">{t("markNa")}</option> : null}
      {MARKS.map((mark) => (
        <option key={mark} value={mark}>
          {mark}/5
        </option>
      ))}
    </SelectField>
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!missingReason) {
          save.mutate();
        }
      }}
    >
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">{t("saved")}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {markSelect(t("communicationLabel"), communication, setCommunication)}
        <div />
        <div className="space-y-2">
          {markSelect(t("workshopLabel"), workshop, setWorkshop, true)}
          {workshop === "na" ? (
            <TextField
              label={`${t("naReasonLabel")} (${t("workshop")})`}
              required
              value={workshopReason}
              onChange={(event) => setWorkshopReason(event.target.value)}
            />
          ) : null}
        </div>
        <div className="space-y-2">
          {markSelect(t("eventsLabel"), events, setEvents, true)}
          {events === "na" ? (
            <TextField
              label={`${t("naReasonLabel")} (${t("events")})`}
              required
              value={eventsReason}
              onChange={(event) => setEventsReason(event.target.value)}
            />
          ) : null}
        </div>
        {markSelect(t("logisticsLabel"), logistics, setLogistics)}
        {markSelect(t("effortLabel"), effort, setEffort)}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${ids}-evidence`} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("effortEvidenceLabel")}
        </label>
        <textarea
          id={`${ids}-evidence`}
          rows={2}
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
          className={textareaClass}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("excusedWeeksLabel")}
          type="number"
          min={0}
          max={5}
          step="0.5"
          value={excused}
          onChange={(event) => setExcused(event.target.value)}
        />
      </div>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-1"
          checked={noWork}
          onChange={(event) => setNoWork(event.target.checked)}
        />
        {t("noWorkLabel")}
      </label>
      <div className="space-y-1.5">
        <label htmlFor={`${ids}-note`} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("noteLabel")}
        </label>
        <textarea
          id={`${ids}-note`}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={textareaClass}
        />
      </div>
      {memberMonth.assessment?.assessed_by ? (
        <p className="text-xs text-muted">
          {t("assessedBy", {
            name: `${memberMonth.assessment.assessed_by.first_name} ${memberMonth.assessment.assessed_by.last_name}`,
          })}
        </p>
      ) : null}
      <Button type="submit" loading={save.isPending} disabled={missingReason}>
        {t("saveAssessment")}
      </Button>
    </form>
  );
}
