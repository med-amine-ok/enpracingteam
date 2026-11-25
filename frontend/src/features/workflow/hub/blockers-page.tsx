"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { useMe } from "@/features/auth/use-me";
import { useMembers, useOrgUnits } from "@/features/members/use-members";
import { Link } from "@/i18n/navigation";
import {
  BLOCKER_IMPACTS,
  BLOCKER_ORIGINS,
  BLOCKER_SEVERITIES,
  cancelBlocker,
  fetchBlockers,
  reportBlocker,
  resolveBlocker,
  updateBlocker,
  validateBlockerImpact,
  type Blocker,
  type BlockerChange,
  type BlockerImpact,
  type BlockerOrigin,
  type BlockerSeverity,
  type BlockerStatus,
} from "../api";
import { BlockerStatusBadge, ImpactBadge, SeverityBadge } from "../badges";
import { refreshWorkflow, useBlockers, useWorkMe, workflowKeys } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { ActionPanel, Detail, Empty, TextArea, WorkTargetPicker, personName, useDates, type WorkTarget } from "./parts";

type StatusFilter = "all" | BlockerStatus;
type BlockerQuery = NonNullable<Parameters<typeof fetchBlockers>[0]>;
const STATUSES: StatusFilter[] = ["all", "open", "resolved", "cancelled"];

/** The Blocker Center (front guide §10): what stops the work, who acts on it, and its impact on delivery. */
export function BlockersPage() {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const params = useSearchParams();
  const initialStatus = params.get("status");
  const [status, setStatus] = useState<StatusFilter>(
    STATUSES.includes(initialStatus as StatusFilter) ? (initialStatus as StatusFilter) : "all",
  );
  const [mine, setMine] = useState(params.get("mine") === "1");
  const [reporting, setReporting] = useState(false);
  const mineId = useId();
  // The list's filters (status, deliverable, work_order, department, mine) are not in the generated schema.
  const filters = {
    ...(status !== "all" ? { status } : {}),
    ...(mine ? { mine: 1 } : {}),
  } as unknown as BlockerQuery;
  const blockers = useBlockers(filters);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <WorkflowHeader current="blockers" description={t("blockers.intro")}>
        {!reporting ? (
          <Button onClick={() => setReporting(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("blockers.report")}
          </Button>
        ) : null}
      </WorkflowHeader>
      {reporting ? <ReportForm onClose={() => setReporting(false)} /> : null}
      <Card title={t("blockers.list")}>
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <Segmented
            label={t("blockers.statusFilter")}
            value={status}
            onChange={setStatus}
            options={STATUSES.map((value) => ({
              value,
              label: value === "all" ? t("all") : tWorkflow(`blockerStatus.${value}`),
            }))}
          />
          <label htmlFor={mineId} className="flex items-center gap-2 text-sm text-ink">
            <input
              id={mineId}
              type="checkbox"
              checked={mine}
              onChange={(event) => setMine(event.target.checked)}
              className="size-4 accent-navy"
            />
            {t("blockers.mine")}
          </label>
        </div>
        {blockers.isError ? (
          <LoadError error={blockers.error} />
        ) : !blockers.data ? (
          <LinesPlaceholder lines={4} />
        ) : blockers.data.length === 0 ? (
          <Empty>{t("blockers.empty")}</Empty>
        ) : (
          <ul className="space-y-4">
            {blockers.data.map((blocker) => (
              <BlockerCard key={blocker.id} blocker={blocker} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ReportForm({ onClose }: { onClose: () => void }) {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<WorkTarget | null>(null);
  const [origin, setOrigin] = useState<BlockerOrigin>("technical");
  const [severity, setSeverity] = useState<BlockerSeverity>("medium");
  const [impact, setImpact] = useState<BlockerImpact>("partial");
  const [description, setDescription] = useState("");
  const [requiredAction, setRequiredAction] = useState("");
  const [previous, setPrevious] = useState("");
  const targetQuery = target
    ? ({ [target.kind]: target.id, status: "resolved" } as unknown as BlockerQuery)
    : ({} as BlockerQuery);
  // The earlier resolved blockers of the same work, when the problem comes back (spec §11.1).
  const earlier = useQuery({
    queryKey: workflowKeys.blockers({ ...targetQuery, earlier: true }),
    queryFn: () => fetchBlockers(targetQuery),
    enabled: !!target,
  });
  const report = useMutation({
    mutationFn: () =>
      reportBlocker({
        deliverable: target?.kind === "deliverable" ? target.id : null,
        work_order: target?.kind === "work_order" ? target.id : null,
        previous: previous ? Number(previous) : null,
        origin,
        severity,
        impact,
        description: description.trim(),
        required_action: requiredAction.trim(),
      }),
    onSuccess: async () => {
      onClose();
      await refreshWorkflow(queryClient);
    },
  });
  const ready = !!target && !!description.trim() && !!requiredAction.trim();
  return (
    <section className="space-y-2">
      <p className="text-sm text-muted">{t("blockers.reportIntro")}</p>
      <ActionPanel
        title={t("blockers.reportTitle")}
        confirm={t("blockers.reportConfirm")}
        pending={report.isPending}
        disabled={!ready}
        error={report.error}
        onSubmit={() => report.mutate()}
        onClose={onClose}
      >
        <WorkTargetPicker
          value={target}
          onChange={(value) => {
            setTarget(value);
            setPrevious("");
          }}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            label={t("blockers.origin")}
            value={origin}
            onChange={(event) => setOrigin(event.target.value as BlockerOrigin)}
          >
            {BLOCKER_ORIGINS.map((value) => (
              <option key={value} value={value}>
                {tWorkflow(`origin.${value}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t("blockers.severity")}
            value={severity}
            onChange={(event) => setSeverity(event.target.value as BlockerSeverity)}
          >
            {BLOCKER_SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {tWorkflow(`severity.${value}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t("blockers.impact")}
            value={impact}
            onChange={(event) => setImpact(event.target.value as BlockerImpact)}
          >
            {BLOCKER_IMPACTS.map((value) => (
              <option key={value} value={value}>
                {tWorkflow(`impact.${value}`)}
              </option>
            ))}
          </SelectField>
        </div>
        <TextArea label={t("blockers.description")} value={description} onChange={setDescription} required rows={3} />
        <TextArea label={t("blockers.requiredAction")} value={requiredAction} onChange={setRequiredAction} required />
        {target && earlier.data && earlier.data.length > 0 ? (
          <SelectField
            label={t("blockers.previous")}
            value={previous}
            onChange={(event) => setPrevious(event.target.value)}
          >
            <option value="">{t("blockers.noPrevious")}</option>
            {earlier.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.description.slice(0, 80)}
              </option>
            ))}
          </SelectField>
        ) : null}
      </ActionPanel>
    </section>
  );
}

type Mode = null | "edit" | "resolve" | "cancel" | "impact";

function BlockerCard({ blocker }: { blocker: Blocker }) {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const { moment } = useDates();
  const me = useMe();
  const workMe = useWorkMe();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState<"" | "yes" | "no">("");
  const done = async () => {
    setMode(null);
    setText("");
    await refreshWorkflow(queryClient);
  };
  const resolve = useMutation({ mutationFn: () => resolveBlocker(blocker.id, text.trim()), onSuccess: done });
  const cancel = useMutation({ mutationFn: () => cancelBlocker(blocker.id, text.trim()), onSuccess: done });
  const impact = useMutation({
    mutationFn: () => validateBlockerImpact(blocker.id, confirmed === "yes", text.trim()),
    onSuccess: done,
  });
  const open = (next: Mode) => {
    resolve.reset();
    cancel.reset();
    impact.reset();
    setText("");
    setConfirmed("");
    setMode(next);
  };
  const reporter = !!me.data && blocker.reported_by?.id === me.data.id;
  // A Head may validate the impact (until done) and edit a blocker they did not report; a club admin heads all.
  const head = !!workMe.data?.is_club_admin || blocker.rights.validate_impact || (blocker.rights.edit && !reporter);
  const target = blocker.target;
  const rights = blocker.rights;
  const anyAction = rights.edit || rights.resolve || rights.cancel || rights.validate_impact;

  return (
    <li className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <BlockerStatusBadge status={blocker.status ?? "open"} />
        <SeverityBadge severity={blocker.severity} />
        {blocker.impact ? <ImpactBadge impact={blocker.impact} /> : null}
        {blocker.origin ? <Badge tone="neutral">{tWorkflow(`origin.${blocker.origin}`)}</Badge> : null}
        {blocker.previous ? <Badge tone="info">{t("blockers.recurring")}</Badge> : null}
      </div>
      <p dir="auto" className="text-sm whitespace-pre-line text-ink">
        {blocker.description}
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {target ? (
          <Detail label={tWorkflow(`entity.${target.kind}`)}>
            <Link
              href={target.kind === "deliverable" ? `/work/deliverables/${target.id}` : `/work/orders/${target.id}`}
              className="hover:text-racing"
            >
              {[target.code, target.title].filter(Boolean).join(" · ")}
            </Link>
          </Detail>
        ) : null}
        {blocker.required_action ? (
          <Detail label={t("blockers.requiredAction")}>{blocker.required_action}</Detail>
        ) : null}
        <Detail label={t("blockers.reported")}>
          {t("byOn", { name: personName(blocker.reported_by), date: moment(blocker.reported_at) })}
        </Detail>
        <Detail label={t("blockers.resolver")}>{personName(blocker.resolver) || t("blockers.nobody")}</Detail>
        <Detail label={t("blockers.unit")}>{blocker.responsible_unit?.name || t("blockers.nobody")}</Detail>
        <Detail label={t("blockers.updated")}>{moment(blocker.updated_at)}</Detail>
        {blocker.resolved_at ? (
          <Detail label={t("blockers.resolution")}>
            {t("byOn", { name: personName(blocker.resolved_by), date: moment(blocker.resolved_at) })}
            {blocker.resolution_note ? <span className="block text-muted">{blocker.resolution_note}</span> : null}
          </Detail>
        ) : blocker.status !== "open" && blocker.resolution_note ? (
          <Detail label={t("reason")}>{blocker.resolution_note}</Detail>
        ) : null}
        {blocker.validation ? (
          <Detail label={t("blockers.validation")}>
            {blocker.validation.impact_confirmed ? t("blockers.impactConfirmed") : t("blockers.impactNotConfirmed")}
            <span className="block text-muted">
              {t("byOn", {
                name: personName(blocker.validation.validated_by) || tWorkflow("system"),
                date: moment(blocker.validation.validated_at),
              })}
            </span>
            {blocker.validation.impact_note ? (
              <span className="block text-muted">{blocker.validation.impact_note}</span>
            ) : null}
          </Detail>
        ) : null}
      </dl>
      {mode === null && anyAction ? (
        <div className="flex flex-wrap gap-2">
          {rights.resolve ? (
            <Button size="sm" onClick={() => open("resolve")}>
              {t("blockers.resolve")}
            </Button>
          ) : null}
          {rights.edit ? (
            <Button size="sm" variant="secondary" onClick={() => open("edit")}>
              {t("edit")}
            </Button>
          ) : null}
          {rights.validate_impact ? (
            <Button size="sm" variant="secondary" onClick={() => open("impact")}>
              {t("blockers.validateImpact")}
            </Button>
          ) : null}
          {rights.cancel ? (
            <Button size="sm" variant="ghost" onClick={() => open("cancel")}>
              {t("blockers.cancel")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {mode === "edit" ? (
        <EditPanel blocker={blocker} head={head} reporter={reporter} onClose={() => setMode(null)} />
      ) : null}
      {mode === "resolve" ? (
        <ActionPanel
          title={t("blockers.resolveTitle")}
          confirm={t("blockers.resolveConfirm")}
          pending={resolve.isPending}
          disabled={!text.trim()}
          error={resolve.error}
          onSubmit={() => resolve.mutate()}
          onClose={() => setMode(null)}
        >
          <Alert tone="info">{t("blockers.notReopened")}</Alert>
          <TextArea label={t("blockers.resolutionNote")} value={text} onChange={setText} required />
        </ActionPanel>
      ) : null}
      {mode === "cancel" ? (
        <ActionPanel
          title={t("blockers.cancelTitle")}
          confirm={t("blockers.cancelConfirm")}
          pending={cancel.isPending}
          disabled={!text.trim()}
          error={cancel.error}
          onSubmit={() => cancel.mutate()}
          onClose={() => setMode(null)}
        >
          <TextArea label={t("reasonRequired")} value={text} onChange={setText} required />
        </ActionPanel>
      ) : null}
      {mode === "impact" ? (
        <ActionPanel
          title={t("blockers.impactTitle")}
          confirm={t("blockers.impactConfirm")}
          pending={impact.isPending}
          disabled={!confirmed}
          error={impact.error}
          onSubmit={() => impact.mutate()}
          onClose={() => setMode(null)}
        >
          <p className="text-sm text-muted">{t("blockers.impactHint")}</p>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="sr-only">{t("blockers.impactTitle")}</legend>
            {(["yes", "no"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`impact-${blocker.id}`}
                  value={value}
                  checked={confirmed === value}
                  onChange={() => setConfirmed(value)}
                  className="size-4 accent-navy"
                />
                {value === "yes" ? t("blockers.impactYes") : t("blockers.impactNo")}
              </label>
            ))}
          </fieldset>
          <TextArea label={t("noteOptional")} value={text} onChange={setText} />
        </ActionPanel>
      ) : null}
    </li>
  );
}

/** Heads: severity, impact, resolver, responsible unit; the reporter: description, required action, severity, impact. */
function EditPanel({
  blocker,
  head,
  reporter,
  onClose,
}: {
  blocker: Blocker;
  head: boolean;
  reporter: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const queryClient = useQueryClient();
  const members = useMembers();
  const units = useOrgUnits();
  const [severity, setSeverity] = useState<BlockerSeverity>(blocker.severity);
  const [impact, setImpact] = useState<BlockerImpact>(blocker.impact ?? "partial");
  const [description, setDescription] = useState(blocker.description);
  const [requiredAction, setRequiredAction] = useState(blocker.required_action ?? "");
  const [resolver, setResolver] = useState(blocker.resolver ? String(blocker.resolver.id) : "");
  const [unit, setUnit] = useState(blocker.responsible_unit ? String(blocker.responsible_unit.id) : "");
  const people = useMemo(
    () =>
      (members.data ?? [])
        .filter((member) => member.status !== "alumni")
        .sort((a, b) => personName(a).localeCompare(personName(b))),
    [members.data],
  );
  const save = useMutation({
    mutationFn: () => {
      const body: BlockerChange = { severity, impact };
      if (reporter) {
        body.description = description.trim();
        body.required_action = requiredAction.trim();
      }
      if (head) {
        body.resolver = resolver ? Number(resolver) : null;
        body.responsible_unit = unit ? Number(unit) : null;
      }
      return updateBlocker(blocker.id, body);
    },
    onSuccess: async () => {
      onClose();
      await refreshWorkflow(queryClient);
    },
  });
  return (
    <ActionPanel
      title={t("blockers.editTitle")}
      confirm={t("save")}
      pending={save.isPending}
      disabled={reporter && !description.trim()}
      error={save.error}
      onSubmit={() => save.mutate()}
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t("blockers.severity")}
          value={severity}
          onChange={(event) => setSeverity(event.target.value as BlockerSeverity)}
        >
          {BLOCKER_SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {tWorkflow(`severity.${value}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("blockers.impact")}
          value={impact}
          onChange={(event) => setImpact(event.target.value as BlockerImpact)}
        >
          {BLOCKER_IMPACTS.map((value) => (
            <option key={value} value={value}>
              {tWorkflow(`impact.${value}`)}
            </option>
          ))}
        </SelectField>
        {head ? (
          <>
            <SelectField label={t("blockers.resolver")} value={resolver} onChange={(e) => setResolver(e.target.value)}>
              <option value="">{t("blockers.nobody")}</option>
              {people.map((member) => (
                <option key={member.id} value={member.id}>
                  {personName(member)}
                </option>
              ))}
            </SelectField>
            <SelectField label={t("blockers.unit")} value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">{t("blockers.nobody")}</option>
              {(units.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
          </>
        ) : null}
      </div>
      {reporter ? (
        <>
          <TextArea label={t("blockers.description")} value={description} onChange={setDescription} required rows={3} />
          <TextArea label={t("blockers.requiredAction")} value={requiredAction} onChange={setRequiredAction} />
        </>
      ) : null}
    </ActionPanel>
  );
}
