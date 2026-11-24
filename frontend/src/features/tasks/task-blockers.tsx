"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMembers, useOrgUnits } from "@/features/members/use-members";
import {
  BLOCKER_ORIGINS,
  BLOCKER_SEVERITIES,
  decideBlocker,
  declareBlocker,
  resolveBlocker,
  type Blocker,
  type BlockerOrigin,
  type BlockerSeverity,
  type TaskDetail,
} from "@/features/work/api";
import { BlockerStatusBadge, SeverityBadge } from "@/features/work/badges";
import { refreshWork } from "@/features/work/queries";
import { errorText } from "@/lib/error-text";
import { Panel, PanelButtons, textareaClass } from "./task-steps";

/** Today in Algiers, as the API's dates (YYYY-MM-DD). */
function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Algiers" }).format(new Date());
}

/**
 * What stops the task: declared by its people, validated (the due date is frozen) or rejected by its
 * leaders, then resolved. A blocker declared more than 2 working days after the problem is "late".
 */
export function TaskBlockers({ task }: { task: TaskDetail }) {
  const t = useTranslations("Tasks");
  const [declaring, setDeclaring] = useState(false);
  const count = task.blockers.length;
  if (count === 0 && !task.permissions.declare_blocker) {
    return null;
  }
  return (
    <Card
      title={t("blockersTitle", { count, shown: String(count) })}
      description={t("blockersIntro")}
      action={
        task.permissions.declare_blocker && !declaring ? (
          <Button variant="secondary" size="sm" onClick={() => setDeclaring(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("declareBlocker")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        {declaring ? <DeclareForm task={task} onClose={() => setDeclaring(false)} /> : null}
        {count === 0 && !declaring ? <p className="text-sm text-muted">{t("noBlockers")}</p> : null}
        {count > 0 ? (
          <ul className="space-y-4">
            {[...task.blockers].reverse().map((blocker) => (
              <BlockerItem key={blocker.id} task={task} blocker={blocker} />
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function DeclareForm({ task, onClose }: { task: TaskDetail; onClose: () => void }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const members = useMembers();
  const units = useOrgUnits();
  const descriptionId = useId();
  const actionId = useId();
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BlockerSeverity>("medium");
  const [origin, setOrigin] = useState<BlockerOrigin>("technical");
  const [dependency, setDependency] = useState("");
  const [requiredAction, setRequiredAction] = useState("");
  const [responsible, setResponsible] = useState("");
  const [unit, setUnit] = useState("");
  const [knownSince, setKnownSince] = useState(today());
  const people = useMemo(
    () =>
      (members.data ?? [])
        .filter((member) => member.status !== "alumni")
        .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)),
    [members.data],
  );

  const declare = useMutation({
    mutationFn: () =>
      declareBlocker(task.id, {
        description: description.trim(),
        severity,
        origin,
        dependency: dependency.trim(),
        required_action: requiredAction.trim(),
        responsible_id: responsible ? Number(responsible) : null,
        responsible_unit_id: unit ? Number(unit) : null,
        known_since: knownSince || undefined,
      }),
    onSuccess: async () => {
      onClose();
      await refreshWork(queryClient);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (description.trim()) {
      declare.mutate();
    }
  }

  return (
    <Panel title={t("declareTitle")} onSubmit={submit}>
      {declare.isError ? <Alert tone="error">{errorText(declare.error, tErrors)}</Alert> : null}
      <div className="space-y-1.5">
        <label htmlFor={descriptionId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("blockerDescription")}
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
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label={t("severityLabel")}
          value={severity}
          onChange={(event) => setSeverity(event.target.value as BlockerSeverity)}
        >
          {BLOCKER_SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {tWork(`severity.${value}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("originLabel")}
          value={origin}
          onChange={(event) => setOrigin(event.target.value as BlockerOrigin)}
        >
          {BLOCKER_ORIGINS.map((value) => (
            <option key={value} value={value}>
              {tWork(`origin.${value}`)}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t("knownSinceLabel")}
          type="date"
          valueDir="ltr"
          max={today()}
          value={knownSince}
          onChange={(event) => setKnownSince(event.target.value)}
        />
      </div>
      <TextField
        label={t("dependencyLabel")}
        value={dependency}
        maxLength={255}
        onChange={(event) => setDependency(event.target.value)}
      />
      <div className="space-y-1.5">
        <label htmlFor={actionId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("requiredActionLabel")}
        </label>
        <textarea
          id={actionId}
          rows={2}
          value={requiredAction}
          onChange={(event) => setRequiredAction(event.target.value)}
          className={textareaClass}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t("responsibleLabel")}
          value={responsible}
          onChange={(event) => setResponsible(event.target.value)}
        >
          <option value="">{t("nobodyChosen")}</option>
          {people.map((member) => (
            <option key={member.id} value={member.id}>
              {member.first_name} {member.last_name}
            </option>
          ))}
        </SelectField>
        <SelectField label={t("responsibleUnitLabel")} value={unit} onChange={(event) => setUnit(event.target.value)}>
          <option value="">{t("noUnitChosen")}</option>
          {(units.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
      </div>
      <PanelButtons
        confirm={t("declareConfirm")}
        pending={declare.isPending}
        disabled={!description.trim()}
        onClose={onClose}
      />
    </Panel>
  );
}

function BlockerItem({ task, blocker }: { task: TaskDetail; blocker: Blocker }) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [mode, setMode] = useState<"reject" | "resolve" | null>(null);
  const [text, setText] = useState("");
  // Each panel starts empty: a rejection note is not a resolution.
  function open(next: "reject" | "resolve") {
    setText("");
    setMode(next);
  }
  const day = (value: string) => format.dateTime(new Date(value), { dateStyle: "medium", numberingSystem: "latn" });
  const name = (member: { first_name: string; last_name: string } | null) =>
    member ? `${member.first_name} ${member.last_name}` : "";

  const decide = useMutation({
    mutationFn: ({ accept, note }: { accept: boolean; note?: string }) =>
      decideBlocker(task.id, blocker.id, accept, note),
    onSuccess: async () => {
      setMode(null);
      await refreshWork(queryClient);
    },
  });
  const resolve = useMutation({
    mutationFn: (resolution: string) => resolveBlocker(task.id, blocker.id, resolution),
    onSuccess: async () => {
      setMode(null);
      await refreshWork(queryClient);
    },
  });
  const error = decide.error ?? resolve.error;

  return (
    <li className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={blocker.severity} />
        <BlockerStatusBadge status={blocker.status} />
        <Badge tone="neutral">{tWork(`origin.${blocker.origin}`)}</Badge>
        {blocker.is_late ? <Badge tone="warning">{t("declaredLate")}</Badge> : null}
      </div>
      <p dir="auto" className="text-sm whitespace-pre-line text-ink">
        {blocker.description}
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {blocker.dependency ? <Detail label={t("dependencyLabel")}>{blocker.dependency}</Detail> : null}
        {blocker.required_action ? <Detail label={t("requiredActionLabel")}>{blocker.required_action}</Detail> : null}
        {blocker.responsible || blocker.responsible_unit ? (
          <Detail label={t("responsibleLabel")}>
            {[name(blocker.responsible), blocker.responsible_unit?.name].filter(Boolean).join(" · ")}
          </Detail>
        ) : null}
        <Detail label={t("knownSinceLabel")}>{day(blocker.known_since)}</Detail>
        <Detail label={t("reportedLabel")}>
          {blocker.reported_by
            ? t("byOn", { name: name(blocker.reported_by), date: day(blocker.reported_at) })
            : day(blocker.reported_at)}
        </Detail>
        {blocker.decided_at ? (
          <Detail label={blocker.status === "rejected" ? t("rejectedLabel") : t("validatedLabel")}>
            {t("byOn", { name: name(blocker.decided_by), date: day(blocker.decided_at) })}
            {blocker.decision_note ? <span className="block text-muted">{blocker.decision_note}</span> : null}
          </Detail>
        ) : null}
        {blocker.resolved_at ? (
          <Detail label={t("resolvedLabel")}>
            {day(blocker.resolved_at)}
            {blocker.resolution ? <span className="block text-muted">{blocker.resolution}</span> : null}
          </Detail>
        ) : null}
      </dl>
      {blocker.status === "validated" ? <p className="text-xs text-muted">{t("frozenHint")}</p> : null}
      {error ? <Alert tone="error">{errorText(error, tErrors)}</Alert> : null}
      {mode === null && (blocker.permissions.decide || blocker.permissions.resolve) ? (
        <div className="flex flex-wrap gap-2">
          {blocker.permissions.decide ? (
            <>
              <Button size="sm" onClick={() => decide.mutate({ accept: true })} loading={decide.isPending}>
                {t("acceptBlocker")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => open("reject")}>
                {t("rejectBlocker")}
              </Button>
            </>
          ) : null}
          {blocker.permissions.resolve ? (
            <Button size="sm" variant="secondary" onClick={() => open("resolve")}>
              {t("resolveBlocker")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {mode !== null ? (
        <Panel
          title={mode === "reject" ? t("rejectTitle") : t("resolveTitle")}
          onSubmit={(event) => {
            event.preventDefault();
            if (mode === "reject") {
              decide.mutate({ accept: false, note: text.trim() });
            } else {
              resolve.mutate(text.trim());
            }
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor={noteId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
              {mode === "reject" ? t("rejectLabel") : t("resolutionLabel")}
            </label>
            <textarea
              id={noteId}
              rows={2}
              required
              value={text}
              onChange={(event) => setText(event.target.value)}
              className={textareaClass}
            />
          </div>
          <PanelButtons
            confirm={mode === "reject" ? t("rejectConfirm") : t("resolveConfirm")}
            pending={mode === "reject" ? decide.isPending : resolve.isPending}
            disabled={!text.trim()}
            onClose={() => setMode(null)}
          />
        </Panel>
      ) : null}
    </li>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd dir="auto" className="text-ink">
        {children}
      </dd>
    </div>
  );
}
