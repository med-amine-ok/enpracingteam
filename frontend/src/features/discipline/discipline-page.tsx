"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileWarning, Flag, ShieldAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { useMe } from "@/features/auth/use-me";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import {
  SERIOUS_GROUNDS,
  abandonExclusion,
  confirmExclusion,
  dismissReport,
  proposeExclusion,
  type BreachReport,
  type Exclusion,
  type MemberWarning,
  type SeriousGround,
} from "./api";
import { refreshDiscipline, useDisciplineRights, useExclusions, useReports, useTargets, useWarnings } from "./queries";

export const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

const RULES = ["authority", "grounds", "first", "second", "third", "immediate", "season"] as const;

export function personName(person: { first_name: string; last_name: string } | null | undefined) {
  return person ? `${person.first_name} ${person.last_name}` : "—";
}

/** The charter's rules, the viewer's warnings and, for who follows others, the reports, warnings and exclusions. */
export function DisciplinePage() {
  const t = useTranslations("Discipline");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const me = useMe();
  const rights = useDisciplineRights();
  const follows = Boolean(rights.data?.report || rights.data?.sees_all);
  const warnings = useWarnings();
  const reports = useReports({}, follows);
  const exclusions = useExclusions(Boolean(rights.data?.sees_all));
  const mine = warnings.data?.filter((warning) => warning.member.id === me.data?.id) ?? [];
  const others =
    warnings.data?.filter((warning) => warning.member.id !== me.data?.id && warning.season === rights.data?.season) ??
    [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow={tShell("groups.team")} title={t("title")} description={t("intro")}>
        <div className="flex flex-wrap gap-2">
          {rights.data?.report ? (
            <Link href="/discipline/report" className={buttonClassName("secondary", "sm")}>
              <Flag className="size-4" aria-hidden="true" />
              {t("report")}
            </Link>
          ) : null}
          {rights.data?.issue ? (
            <Link href="/discipline/new" className={buttonClassName("primary", "sm")}>
              <FileWarning className="size-4" aria-hidden="true" />
              {t("give")}
            </Link>
          ) : null}
        </div>
      </PageHeader>
      <Card title={t("rulesTitle")}>
        <ul className="list-disc space-y-1.5 ps-5 text-sm text-ink">
          {RULES.map((rule) => (
            <li key={rule}>{t(`rules.${rule}`)}</li>
          ))}
        </ul>
      </Card>
      {warnings.isError ? <Alert tone="error">{errorText(warnings.error, tErrors)}</Alert> : null}
      <Card title={t("mineTitle")}>
        {!warnings.data ? (
          <LinesPlaceholder lines={2} />
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted">{t("noMine")}</p>
        ) : (
          <ul className="space-y-3">
            {mine.map((warning) => (
              <WarningRow key={warning.id} warning={warning} />
            ))}
          </ul>
        )}
      </Card>
      {follows ? (
        <>
          <Card title={t("reportsTitle")}>
            {reports.isError ? (
              <Alert tone="error">{errorText(reports.error, tErrors)}</Alert>
            ) : !reports.data ? (
              <LinesPlaceholder lines={2} />
            ) : reports.data.length === 0 ? (
              <p className="text-sm text-muted">{t("noReports")}</p>
            ) : (
              <ul className="space-y-3">
                {reports.data.map((report) => (
                  <ReportRow key={report.id} report={report} />
                ))}
              </ul>
            )}
          </Card>
          <Card title={t("teamTitle")}>
            {!warnings.data ? (
              <LinesPlaceholder lines={2} />
            ) : others.length === 0 ? (
              <p className="text-sm text-muted">{t("noTeam")}</p>
            ) : (
              <ul className="space-y-3">
                {others.map((warning) => (
                  <WarningRow key={warning.id} warning={warning} showMember />
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
      {rights.data?.sees_all ? (
        <Card title={t("exclusionsTitle")}>
          <div className="space-y-4">
            <ProposeExclusion />
            {exclusions.isError ? (
              <Alert tone="error">{errorText(exclusions.error, tErrors)}</Alert>
            ) : !exclusions.data ? (
              <LinesPlaceholder lines={2} />
            ) : exclusions.data.length === 0 ? (
              <p className="text-sm text-muted">{t("noExclusions")}</p>
            ) : (
              <ul className="space-y-3">
                {exclusions.data.map((exclusion) => (
                  <ExclusionRow key={exclusion.id} exclusion={exclusion} />
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export function WarningRow({ warning, showMember = false }: { warning: MemberWarning; showMember?: boolean }) {
  const t = useTranslations("Discipline");
  const format = useFormatter();
  const date = format.dateTime(new Date(warning.issued_at), { dateStyle: "medium", numberingSystem: "latn" });
  return (
    <li>
      <Link
        href={`/discipline/warnings/${warning.id}`}
        className="block space-y-1 rounded-lg border border-line p-3 hover:border-navy/30"
      >
        <span className="flex flex-wrap items-center gap-2">
          <ShieldAlert className="size-4 text-racing" aria-hidden="true" />
          <span className="font-medium text-ink">
            {showMember
              ? t("warningOf", { level: String(warning.level), name: personName(warning.member) })
              : t("warningNumber", { level: String(warning.level) })}
          </span>
          <Badge tone="neutral">{t(`ground.${warning.ground}`)}</Badge>
          {warning.status === "cancelled" ? <Badge tone="warning">{t("cancelled")}</Badge> : null}
        </span>
        <span className="block text-xs text-muted">{t("givenBy", { name: personName(warning.issued_by), date })}</span>
      </Link>
    </li>
  );
}

function ReportRow({ report }: { report: BreachReport }) {
  const t = useTranslations("Discipline");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [dismissing, setDismissing] = useState(false);
  const [note, setNote] = useState("");
  const dismiss = useMutation({
    mutationFn: () => dismissReport(report.id, note.trim()),
    onSuccess: async () => {
      setDismissing(false);
      await refreshDiscipline(queryClient);
    },
  });
  const date = format.dateTime(new Date(report.created_at), { dateStyle: "medium", numberingSystem: "latn" });
  const tone = report.status === "open" ? "warning" : report.status === "warned" ? "danger" : "neutral";

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{personName(report.member)}</span>
        <Badge tone="neutral">{t(`ground.${report.ground}`)}</Badge>
        <Badge tone={tone}>{t(`reportStatus.${report.status}`)}</Badge>
      </div>
      <p dir="auto" className="text-sm whitespace-pre-line text-ink">
        {report.facts}
      </p>
      <p className="text-xs text-muted">{t("reportedBy", { name: personName(report.reported_by), date })}</p>
      {report.handling_note ? <Alert tone="info">{t("motive", { note: report.handling_note })}</Alert> : null}
      {dismiss.isError ? <Alert tone="error">{errorText(dismiss.error, tErrors)}</Alert> : null}
      {report.permissions.handle && !dismissing ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/discipline/new?member=${report.member.id}&report=${report.id}`}
            className={buttonClassName("primary", "sm")}
          >
            {t("handle")}
          </Link>
          <Button size="sm" variant="secondary" onClick={() => setDismissing(true)}>
            {t("dismiss")}
          </Button>
        </div>
      ) : null}
      {dismissing ? (
        <form
          className="space-y-3 rounded-lg border border-line bg-canvas p-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            dismiss.mutate();
          }}
        >
          <label htmlFor={noteId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t("dismissReason")}
          </label>
          <textarea
            id={noteId}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={textareaClass}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!note.trim()} loading={dismiss.isPending}>
              {t("confirmDismiss")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDismissing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function ExclusionRow({ exclusion }: { exclusion: Exclusion }) {
  const t = useTranslations("Discipline");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [step, setStep] = useState<"confirm" | "abandon" | null>(null);
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (confirm: boolean) =>
      confirm ? confirmExclusion(exclusion.id) : abandonExclusion(exclusion.id, note.trim()),
    onSuccess: async () => {
      setStep(null);
      await refreshDiscipline(queryClient);
    },
  });
  const date = format.dateTime(new Date(exclusion.proposed_at), { dateStyle: "medium", numberingSystem: "latn" });
  const name = personName(exclusion.member);
  const tone = exclusion.status === "pending" ? "warning" : exclusion.status === "confirmed" ? "danger" : "neutral";

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{name}</span>
        <Badge tone="neutral">{t(`cause.${exclusion.cause}`)}</Badge>
        {exclusion.serious_ground ? <Badge tone="neutral">{t(`serious.${exclusion.serious_ground}`)}</Badge> : null}
        <Badge tone={tone}>{t(`exclusionStatus.${exclusion.status}`)}</Badge>
      </div>
      {exclusion.facts ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {exclusion.facts}
        </p>
      ) : null}
      <p className="text-xs text-muted">{t("proposedBy", { name: personName(exclusion.proposed_by), date })}</p>
      {exclusion.decision_note ? <Alert tone="info">{t("motive", { note: exclusion.decision_note })}</Alert> : null}
      {decide.isError ? <Alert tone="error">{errorText(decide.error, tErrors)}</Alert> : null}
      {exclusion.permissions.decide && step === null ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setStep("confirm")}>
            {t("confirmExclusion")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setStep("abandon")}>
            {t("abandon")}
          </Button>
        </div>
      ) : null}
      {step === "confirm" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-racing/30 bg-racing-soft p-3">
          <p className="text-sm text-ink">{t("confirmExclusionWarning", { name })}</p>
          <Button size="sm" onClick={() => decide.mutate(true)} loading={decide.isPending}>
            {t("yesExclude")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStep(null)}>
            {t("cancel")}
          </Button>
        </div>
      ) : null}
      {step === "abandon" ? (
        <form
          className="space-y-3 rounded-lg border border-line bg-canvas p-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            decide.mutate(false);
          }}
        >
          <label htmlFor={noteId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t("abandonReason")}
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
              {t("confirmAbandon")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setStep(null)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/** Art. 28: an immediate exclusion, proposed by the Bureau, then confirmed. */
function ProposeExclusion() {
  const t = useTranslations("Discipline");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const targets = useTargets();
  const factsId = useId();
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState("");
  const [ground, setGround] = useState<SeriousGround>("violence");
  const [facts, setFacts] = useState("");
  const propose = useMutation({
    mutationFn: () => proposeExclusion({ member_id: Number(member), serious_ground: ground, facts: facts.trim() }),
    onSuccess: async () => {
      setOpen(false);
      setMember("");
      setFacts("");
      await refreshDiscipline(queryClient);
    },
  });

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("propose")}
      </Button>
    );
  }
  return (
    <form
      className="space-y-3 rounded-lg border border-line bg-canvas p-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (member && facts.trim()) {
          propose.mutate();
        }
      }}
    >
      {propose.isError ? <Alert tone="error">{errorText(propose.error, tErrors)}</Alert> : null}
      <SelectField label={t("memberLabel")} value={member} onChange={(event) => setMember(event.target.value)}>
        <option value="">{t("chooseMember")}</option>
        {(targets.data ?? []).map((target) => (
          <option key={target.id} value={target.id}>
            {personName(target)}
          </option>
        ))}
      </SelectField>
      <SelectField
        label={t("seriousLabel")}
        value={ground}
        onChange={(event) => setGround(event.target.value as SeriousGround)}
      >
        {SERIOUS_GROUNDS.map((value) => (
          <option key={value} value={value}>
            {t(`serious.${value}`)}
          </option>
        ))}
      </SelectField>
      <div className="space-y-1.5">
        <label htmlFor={factsId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("factsLabel")}
        </label>
        <textarea
          id={factsId}
          rows={3}
          value={facts}
          onChange={(event) => setFacts(event.target.value)}
          className={textareaClass}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!member || !facts.trim()} loading={propose.isPending}>
          {t("sendProposal")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
