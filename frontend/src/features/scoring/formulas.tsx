"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/text-field";
import { errorText } from "@/lib/error-text";
import {
  FORMULA_CONSTANTS,
  FORMULA_GROUPS,
  createFormulaVersion,
  setCurrentFormula,
  type FormulaConstant,
  type FormulaVersion,
} from "./api";
import { refreshScoring, useFormulaVersions } from "./queries";
import {
  PanelPlaceholder,
  QueryFailure,
  ScoringGate,
  ScoringHeader,
  TextArea,
  memberName,
  useDecimal,
  useScoringRights,
  useWhen,
} from "./scoring-parts";

const GROUP_KEYS = Object.keys(FORMULA_GROUPS) as (keyof typeof FORMULA_GROUPS)[];

/** The scoring configuration (guide §14.5): versions are never edited, a change is a new version. */
export function FormulasPage() {
  return (
    <ScoringGate>
      <Formulas />
    </ScoringGate>
  );
}

function Formulas() {
  const t = useTranslations("Scoring");
  const rights = useScoringRights();
  const versions = useFormulaVersions();
  const [creating, setCreating] = useState(false);

  if (versions.isError) {
    return <QueryFailure error={versions.error} />;
  }
  const current = versions.data?.find((version) => version.is_current);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <ScoringHeader current="formulas" title={t("formulas.title")} description={t("formulas.intro")}>
        {rights.config && !creating && versions.data ? (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("formulas.new")}
          </Button>
        ) : null}
      </ScoringHeader>
      <Alert tone="info">{t("formulas.immutable")}</Alert>
      {rights.config && creating && versions.data ? (
        <NewVersionForm from={current} onClose={() => setCreating(false)} />
      ) : null}
      {!versions.data ? (
        <PanelPlaceholder />
      ) : versions.data.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{t("formulas.empty")}</p>
        </Card>
      ) : (
        versions.data.map((version) => <VersionCard key={version.id} version={version} config={rights.config} />)
      )}
    </div>
  );
}

function VersionCard({ version, config }: { version: FormulaVersion; config: boolean }) {
  const t = useTranslations("Scoring");
  const decimal = useDecimal();
  const when = useWhen();
  return (
    <section
      className="space-y-4 rounded-lg border border-line bg-surface p-5 shadow-card"
      aria-label={version.code}
      data-testid="formula-version"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex flex-wrap items-center gap-2 font-display text-lg font-bold text-navy">
            <bdi>{version.code}</bdi>
            {version.is_current ? <Badge tone="success">{t("formulas.current")}</Badge> : null}
          </h2>
          <p className="text-xs text-muted">
            {t("formulas.createdBy", { name: memberName(version.created_by), date: when.dateTime(version.created_at) })}
          </p>
          {version.description ? (
            <p className="text-sm text-ink" dir="auto">
              {version.description}
            </p>
          ) : null}
        </div>
        {config && !version.is_current ? <SetCurrent version={version} /> : null}
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {GROUP_KEYS.map((group) => (
          <div key={group}>
            <h3 className="mb-1.5 text-xs font-semibold tracking-widest text-muted uppercase">
              {t(`formulas.group.${group}`)}
            </h3>
            <dl className="space-y-1 text-sm">
              {FORMULA_GROUPS[group].map((key) => (
                <div key={key} className="flex justify-between gap-3">
                  <dt className="text-muted">{t(`formulas.constant.${key}`)}</dt>
                  <dd className="font-medium text-ink tabular-nums">{decimal(version[key])}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Makes a version the current one, with a reason (configuration admins). */
function SetCurrent({ version }: { version: FormulaVersion }) {
  const t = useTranslations("Scoring");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => setCurrentFormula(version.id, reason.trim()),
    onSuccess: async () => {
      setOpen(false);
      setReason("");
      await refreshScoring(queryClient);
    },
  });
  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("formulas.setCurrent")}
      </Button>
    );
  }
  return (
    <form
      role="dialog"
      aria-label={t("formulas.setCurrentTitle", { code: version.code })}
      className="w-80 space-y-3 rounded-lg border border-line bg-canvas p-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (reason.trim() && !mutation.isPending) {
          mutation.mutate();
        }
      }}
    >
      <p className="text-sm text-ink">{t("formulas.setCurrentConfirm", { code: version.code })}</p>
      <TextArea label={t("reason")} value={reason} onChange={setReason} required />
      {mutation.isError ? <Alert tone="error">{errorText(mutation.error, tErrors)}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" loading={mutation.isPending} disabled={!reason.trim()}>
          {t("formulas.confirmSetCurrent")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={mutation.isPending}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function initialValues(from: FormulaVersion | undefined) {
  return Object.fromEntries(FORMULA_CONSTANTS.map((key) => [key, from?.[key] ?? ""])) as Record<
    FormulaConstant,
    string
  >;
}

/** A new version with every constant, prefilled from the current one, and a required reason. */
function NewVersionForm({ from, onClose }: { from: FormulaVersion | undefined; onClose: () => void }) {
  const t = useTranslations("Scoring");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [description, setDescription] = useState(from?.description ?? "");
  const [values, setValues] = useState(() => initialValues(from));
  const [makeCurrent, setMakeCurrent] = useState(false);
  const [reason, setReason] = useState("");
  const create = useMutation({
    mutationFn: () =>
      createFormulaVersion({
        code: code.trim(),
        description,
        ...values,
        is_current: makeCurrent,
        reason: reason.trim(),
      }),
    onSuccess: async () => {
      await refreshScoring(queryClient);
      onClose();
    },
  });
  const ready = Boolean(code.trim() && reason.trim() && FORMULA_CONSTANTS.every((key) => values[key] !== ""));

  return (
    <Card title={t("formulas.newTitle")} description={from ? t("formulas.prefilled", { code: from.code }) : undefined}>
      <form
        className="space-y-5"
        aria-label={t("formulas.newTitle")}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (ready && !create.isPending) {
            create.mutate();
          }
        }}
      >
        {create.isError ? <Alert tone="error">{errorText(create.error, tErrors)}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("formulas.code")}
            required
            valueDir="ltr"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <TextArea label={t("formulas.description")} value={description} onChange={setDescription} />
        </div>
        {GROUP_KEYS.map((group) => (
          <fieldset key={group} className="space-y-2">
            <legend className="text-sm font-semibold text-navy">{t(`formulas.group.${group}`)}</legend>
            {group === "rubric" ? <p className="text-xs text-muted">{t("formulas.rubricHint")}</p> : null}
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {FORMULA_GROUPS[group].map((key) => (
                <TextField
                  key={key}
                  label={t(`formulas.constant.${key}`)}
                  type="number"
                  inputMode="decimal"
                  step="0.001"
                  min={0}
                  max={9.999}
                  required
                  valueDir="ltr"
                  value={values[key]}
                  onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                />
              ))}
            </div>
          </fieldset>
        ))}
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-1"
            checked={makeCurrent}
            onChange={(event) => setMakeCurrent(event.target.checked)}
          />
          {t("formulas.makeCurrent")}
        </label>
        <TextArea label={t("reason")} value={reason} onChange={setReason} required />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={create.isPending} disabled={!ready}>
            {t("formulas.create")}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>
            {t("cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
