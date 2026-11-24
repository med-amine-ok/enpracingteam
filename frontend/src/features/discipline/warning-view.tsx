"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ShieldAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { cancelWarning, recordCouncil, respondToWarning, type MemberWarning } from "./api";
import { personName, textareaClass } from "./discipline-page";
import { disciplineKeys, refreshDiscipline, useWarning } from "./queries";

/** A warning: what it is about, the member's version, the council of a second one, its cancellation. */
export function WarningView() {
  const t = useTranslations("Discipline");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const { id } = useParams<{ id: string }>();
  const warning = useWarning(Number(id));

  if (warning.isError) {
    return (
      <div className="mx-auto max-w-4xl">
        <Alert tone="error">{errorText(warning.error, tErrors)}</Alert>
      </div>
    );
  }
  if (!warning.data) {
    return (
      <div className="mx-auto max-w-4xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={5} />
        </Card>
      </div>
    );
  }
  const data = warning.data;
  const day = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" });
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/discipline">{t("back")}</BackLink>
      <section className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
        <div className="space-y-2">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone="danger">
              <ShieldAlert className="size-3.5" aria-hidden="true" />
              {t("warningNumber", { level: String(data.level) })}
            </Badge>
            <Badge tone="neutral">{t(`ground.${data.ground}`)}</Badge>
            {data.status === "cancelled" ? <Badge tone="warning">{t("cancelled")}</Badge> : null}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{personName(data.member)}</h1>
          <p className="text-sm text-muted">
            {t("givenBy", { name: personName(data.issued_by), date: day(data.issued_at) })}
          </p>
        </div>
        {data.status === "cancelled" ? (
          <Alert tone="warning">
            {t("cancelledBy", { name: personName(data.cancelled_by), reason: data.cancel_reason })}
          </Alert>
        ) : null}
        <dl className="space-y-3">
          {data.rule ? <Item term={t("detailRule")} value={data.rule} /> : null}
          <Item term={t("detailFacts")} value={data.facts} />
          {data.expected ? <Item term={t("detailExpected")} value={data.expected} /> : null}
          {data.project ? <Item term={t("detailProject")} value={data.project.name} /> : null}
        </dl>
      </section>
      <Card title={t("responseTitle")}>
        {data.permissions.respond ? (
          <ResponseForm warning={data} />
        ) : data.member_response ? (
          <p dir="auto" className="text-sm whitespace-pre-line text-ink">
            {data.member_response}
          </p>
        ) : (
          <p className="text-sm text-muted">{t("noResponse")}</p>
        )}
      </Card>
      {data.council ? (
        <Card title={t("councilTitle")}>
          <div className="space-y-4">
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <CalendarDays className="size-4 text-muted" aria-hidden="true" />
              {t("councilSession", {
                date: format.dateTime(new Date(data.council.starts_at), {
                  dateStyle: "medium",
                  timeStyle: "short",
                  numberingSystem: "latn",
                }),
              })}
              <Link href={`/meetings/${data.council.id}`} className="font-medium text-navy hover:underline">
                {t("openSession")}
              </Link>
            </p>
            {data.permissions.record_council ? (
              <DecisionForm warning={data} />
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-ink">{t("councilDecision")}</p>
                <p dir="auto" className="text-sm whitespace-pre-line text-ink">
                  {data.council_decision || t("noDecision")}
                </p>
              </div>
            )}
          </div>
        </Card>
      ) : null}
      {data.permissions.cancel ? <CancelForm warning={data} /> : null}
    </div>
  );
}

function Item({ term, value }: { term: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-sm font-semibold text-ink">{term}</dt>
      <dd dir="auto" className="text-sm whitespace-pre-line text-ink">
        {value}
      </dd>
    </div>
  );
}

/** A text saved on the warning: the member's response, or the council's decision. */
function TextForm({
  warning,
  label,
  initial,
  submit,
  save,
}: {
  warning: MemberWarning;
  label: string;
  initial: string;
  submit: string;
  save: (text: string) => Promise<MemberWarning>;
}) {
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const id = useId();
  const [text, setText] = useState(initial);
  const mutation = useMutation({
    mutationFn: () => save(text.trim()),
    onSuccess: async (saved) => {
      queryClient.setQueryData(disciplineKeys.warning(warning.id), saved);
      await refreshDiscipline(queryClient);
    },
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      {mutation.isError ? <Alert tone="error">{errorText(mutation.error, tErrors)}</Alert> : null}
      <label htmlFor={id} className="block text-xs font-semibold tracking-widest text-muted uppercase">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className={textareaClass}
      />
      <Button type="submit" size="sm" disabled={!text.trim()} loading={mutation.isPending}>
        {submit}
      </Button>
    </form>
  );
}

function ResponseForm({ warning }: { warning: MemberWarning }) {
  const t = useTranslations("Discipline");
  return (
    <TextForm
      warning={warning}
      label={t("responseLabel")}
      initial={warning.member_response}
      submit={t("saveResponse")}
      save={(text) => respondToWarning(warning.id, text)}
    />
  );
}

function DecisionForm({ warning }: { warning: MemberWarning }) {
  const t = useTranslations("Discipline");
  return (
    <TextForm
      warning={warning}
      label={t("decisionLabel")}
      initial={warning.council_decision}
      submit={t("saveDecision")}
      save={(text) => recordCouncil(warning.id, text)}
    />
  );
}

function CancelForm({ warning }: { warning: MemberWarning }) {
  const t = useTranslations("Discipline");
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {t("cancelWarning")}
      </Button>
    );
  }
  return (
    <Card>
      <TextForm
        warning={warning}
        label={t("cancelReason")}
        initial=""
        submit={t("confirmCancel")}
        save={(text) => cancelWarning(warning.id, text)}
      />
    </Card>
  );
}
