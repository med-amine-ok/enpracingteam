"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMe } from "@/features/auth/use-me";
import { useMembers } from "@/features/members/use-members";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import {
  createContribution,
  rejectContribution,
  validateContribution,
  type Contribution,
  type ContributionStatus,
} from "./api";
import { refreshRanking, useContributions } from "./queries";
import { RankingTabs, textareaClass } from "./ranking-parts";

const STATUS_TONES: Record<ContributionStatus, BadgeTone> = {
  proposed: "warning",
  validated: "success",
  rejected: "danger",
};

/** Propose contribution points (for oneself, or for a member who helped); decide them (the department heads). */
export function ContributionsPage() {
  const t = useTranslations("Ranking");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const points = useContributions();
  const toDecide = points.data?.filter((point) => point.permissions.decide) ?? [];
  const others = points.data?.filter((point) => !point.permissions.decide) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow={tShell("groups.team")}
        title={t("contributionsTitle")}
        description={t("contributionsIntro")}
      />
      <RankingTabs current="contributions" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card title={t("proposeTitle")}>
          <ProposeForm />
        </Card>
        <div className="space-y-6">
          {points.isError ? (
            <Alert tone="error">{errorText(points.error, tErrors)}</Alert>
          ) : !points.data ? (
            <Card>
              <LinesPlaceholder lines={4} />
            </Card>
          ) : (
            <>
              {toDecide.length > 0 ? (
                <Card title={t("toDecideTitle")}>
                  <ContributionList contributions={toDecide} empty="" />
                </Card>
              ) : null}
              <Card title={t("allTitle")}>
                <ContributionList contributions={others} empty={t("noContributions")} />
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProposeForm() {
  const t = useTranslations("Ranking");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const me = useMe();
  const members = useMembers();
  const now = useNow();
  const today = clubToday(now);
  const descriptionId = useId();
  const [member, setMember] = useState("");
  const [count, setCount] = useState("1");
  const [description, setDescription] = useState("");
  const [day, setDay] = useState(today);
  const people = useMemo(
    () =>
      (members.data ?? [])
        .filter((person) => person.status !== "alumni" && person.id !== me.data?.id)
        .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)),
    [members.data, me.data?.id],
  );
  const save = useMutation({
    mutationFn: () =>
      createContribution({
        member_id: member ? Number(member) : me.data!.id,
        points: Number(count),
        description: description.trim(),
        occurred_on: day,
      }),
    onSuccess: async () => {
      setDescription("");
      await refreshRanking(queryClient);
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (description.trim() && me.data) {
          save.mutate();
        }
      }}
    >
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      <SelectField label={t("beneficiaryLabel")} value={member} onChange={(event) => setMember(event.target.value)}>
        <option value="">{t("myself")}</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.first_name} {person.last_name}
          </option>
        ))}
      </SelectField>
      <SelectField label={t("pointsLabel")} value={count} onChange={(event) => setCount(event.target.value)}>
        {["1", "2", "3"].map((value) => (
          <option key={value} value={value}>
            {t(`pointsOption.${value as "1" | "2" | "3"}`)}
          </option>
        ))}
      </SelectField>
      <div className="space-y-1.5">
        <label htmlFor={descriptionId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("descriptionLabel")}
        </label>
        <textarea
          id={descriptionId}
          rows={3}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={textareaClass}
        />
      </div>
      <TextField
        label={t("dateLabel")}
        type="date"
        max={today}
        value={day}
        onChange={(event) => setDay(event.target.value)}
      />
      <Button type="submit" loading={save.isPending} disabled={!description.trim() || !day}>
        {t("propose")}
      </Button>
    </form>
  );
}

export function ContributionList({ contributions, empty }: { contributions: Contribution[]; empty: string }) {
  if (contributions.length === 0) {
    return empty ? <p className="text-sm text-muted">{empty}</p> : null;
  }
  return (
    <ul className="space-y-3">
      {contributions.map((point) => (
        <ContributionRow key={point.id} point={point} />
      ))}
    </ul>
  );
}

function ContributionRow({ point }: { point: Contribution }) {
  const t = useTranslations("Ranking");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (approve: boolean) => (approve ? validateContribution(point.id) : rejectContribution(point.id, note)),
    onSuccess: async () => {
      setRefusing(false);
      await refreshRanking(queryClient);
    },
  });
  const date = format.dateTime(new Date(point.occurred_on), { dateStyle: "medium", numberingSystem: "latn" });

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          {t("contributionLine", {
            count: point.points,
            name: `${point.member.first_name} ${point.member.last_name}`,
            date,
          })}
        </p>
        <Badge tone={STATUS_TONES[point.status]}>{t(`contributionStatus.${point.status}`)}</Badge>
      </div>
      <p dir="auto" className="text-sm whitespace-pre-line text-ink">
        {point.description}
      </p>
      {point.proposed_by ? (
        <p className="text-xs text-muted">
          {t("proposedBy", { name: `${point.proposed_by.first_name} ${point.proposed_by.last_name}` })}
        </p>
      ) : null}
      {point.decision_note ? <Alert tone="warning">{t("decisionNote", { note: point.decision_note })}</Alert> : null}
      {decide.isError ? <Alert tone="error">{errorText(decide.error, tErrors)}</Alert> : null}
      {point.permissions.decide && !refusing ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => decide.mutate(true)} loading={decide.isPending}>
            <Check className="size-4" aria-hidden="true" />
            {t("validate")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setRefusing(true)}>
            <X className="size-4" aria-hidden="true" />
            {t("reject")}
          </Button>
        </div>
      ) : null}
      {refusing ? (
        <form
          className="space-y-3 rounded-lg border border-line bg-canvas p-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            decide.mutate(false);
          }}
        >
          <label htmlFor={noteId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t("rejectReason")}
          </label>
          <textarea
            id={noteId}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={textareaClass}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!note.trim()} loading={decide.isPending}>
              {t("rejectConfirm")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRefusing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
