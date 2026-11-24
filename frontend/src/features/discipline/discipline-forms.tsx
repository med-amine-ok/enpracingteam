"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { fromLocalInput } from "@/features/meetings/meeting-parts";
import { useRouter } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { GROUNDS, createReport, createWarning, type Ground } from "./api";
import { personName, textareaClass } from "./discipline-page";
import { refreshDiscipline, useStanding, useTargets } from "./queries";

function GroundSelect({ value, onChange }: { value: Ground; onChange: (ground: Ground) => void }) {
  const t = useTranslations("Discipline");
  return (
    <SelectField label={t("groundLabel")} value={value} onChange={(event) => onChange(event.target.value as Ground)}>
      {GROUNDS.map((ground) => (
        <option key={ground} value={ground}>
          {t(`ground.${ground}`)}
        </option>
      ))}
    </SelectField>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold tracking-widest text-muted uppercase">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={textareaClass}
      />
    </div>
  );
}

/** Report a breach (art. 27.3): the project manager or the Bureau is told; the member does not see it. */
export function ReportForm() {
  const t = useTranslations("Discipline");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const targets = useTargets();
  const [member, setMember] = useState("");
  const [ground, setGround] = useState<Ground>("work_not_done");
  const [facts, setFacts] = useState("");
  const send = useMutation({
    mutationFn: () => createReport({ member_id: Number(member), ground, facts: facts.trim() }),
    onSuccess: async () => {
      await refreshDiscipline(queryClient);
      router.replace("/discipline");
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/discipline">{t("back")}</BackLink>
      <PageHeader eyebrow={tShell("groups.team")} title={t("reportTitle")} description={t("reportIntro")} />
      <Card>
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (member && facts.trim()) {
              send.mutate();
            }
          }}
        >
          {send.isError ? <Alert tone="error">{errorText(send.error, tErrors)}</Alert> : null}
          <SelectField label={t("memberLabel")} value={member} onChange={(event) => setMember(event.target.value)}>
            <option value="">{t("chooseMember")}</option>
            {(targets.data ?? []).map((target) => (
              <option key={target.id} value={target.id}>
                {personName(target)}
              </option>
            ))}
          </SelectField>
          <GroundSelect value={ground} onChange={setGround} />
          <TextArea label={t("factsLabel")} value={facts} onChange={setFacts} />
          <Button type="submit" loading={send.isPending} disabled={!member || !facts.trim()}>
            {t("sendReport")}
          </Button>
        </form>
      </Card>
    </div>
  );
}

/** Give a warning (art. 27.1): its number in the season; the second one calls a council, created here. */
export function WarningForm() {
  const t = useTranslations("Discipline");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const search = useSearchParams();
  const targets = useTargets();
  const report = search.get("report");
  const [member, setMember] = useState(search.get("member") ?? "");
  const [ground, setGround] = useState<Ground>("work_not_done");
  const [rule, setRule] = useState("");
  const [facts, setFacts] = useState("");
  const [expected, setExpected] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [place, setPlace] = useState("");
  const standing = useStanding(Number(member) || 0);
  const level = standing.data?.next_level;
  const issuable = (targets.data ?? []).filter((target) => target.can_issue);
  const save = useMutation({
    mutationFn: () =>
      createWarning({
        member_id: Number(member),
        ground,
        rule: rule.trim(),
        facts: facts.trim(),
        expected: expected.trim(),
        report_id: report ? Number(report) : null,
        council_location: place.trim(),
        ...(level === 2 ? { council_starts_at: fromLocalInput(start), council_ends_at: fromLocalInput(end) } : {}),
      }),
    onSuccess: async (warning) => {
      await refreshDiscipline(queryClient);
      router.replace(`/discipline/warnings/${warning.id}`);
    },
  });
  const ready = Boolean(member && facts.trim() && level && level <= 3 && (level !== 2 || (start && end)));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/discipline">{t("back")}</BackLink>
      <PageHeader eyebrow={tShell("groups.team")} title={t("giveTitle")} description={t("giveIntro")} />
      <Card>
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (ready) {
              save.mutate();
            }
          }}
        >
          {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
          <SelectField label={t("memberLabel")} value={member} onChange={(event) => setMember(event.target.value)}>
            <option value="">{t("chooseMember")}</option>
            {issuable.map((target) => (
              <option key={target.id} value={target.id}>
                {personName(target)}
              </option>
            ))}
          </SelectField>
          {level ? (
            level > 3 ? (
              <Alert tone="error">{t("alreadyThree")}</Alert>
            ) : (
              <Alert tone={level === 1 ? "info" : "warning"}>
                {t("nextLevel", { level: String(level) })}
                {level === 3 ? ` ${t("thirdNotice")}` : ""}
              </Alert>
            )
          ) : null}
          <GroundSelect value={ground} onChange={setGround} />
          <TextField
            label={t("ruleLabel")}
            maxLength={255}
            value={rule}
            onChange={(event) => setRule(event.target.value)}
          />
          <TextArea label={t("factsLabel")} value={facts} onChange={setFacts} />
          <TextArea label={t("expectedLabel")} value={expected} onChange={setExpected} rows={2} />
          {level === 2 ? (
            <fieldset className="space-y-3 rounded-xl border border-line p-4">
              <legend className="px-1 text-2xs font-semibold tracking-widest text-muted uppercase">
                {t("councilTitle")}
              </legend>
              <p className="text-xs text-muted">{t("councilIntro")}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label={t("councilStart")}
                  type="datetime-local"
                  required
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
                <TextField
                  label={t("councilEnd")}
                  type="datetime-local"
                  required
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </div>
              <TextField label={t("councilPlace")} value={place} onChange={(event) => setPlace(event.target.value)} />
            </fieldset>
          ) : null}
          <Button type="submit" loading={save.isPending} disabled={!ready}>
            {t("submitWarning")}
          </Button>
        </form>
      </Card>
    </div>
  );
}
