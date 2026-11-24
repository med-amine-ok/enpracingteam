"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { normalizeText } from "@/features/members/search";
import { useMembers } from "@/features/members/use-members";
import {
  TASK_POINTS,
  TASK_PRIORITIES,
  createTask,
  stepsFor,
  updateTask,
  type TaskDetail,
  type TaskPoints,
  type TaskPriority,
} from "@/features/work/api";
import { refreshWork, useLifecycleSteps, useProject, useSubsystems } from "@/features/work/queries";
import { errorText } from "@/lib/error-text";
import { textareaClass } from "./task-steps";

type TaskFormProps = {
  projectId: number;
  /** The parent task, for a new subtask: it starts in the same subsystem and step. */
  parent?: TaskDetail;
  /** The task to change; a new task when absent. */
  task?: TaskDetail;
  onSaved: (task: TaskDetail) => void;
  onCancel?: () => void;
};

/**
 * Create or change a task: what, which subsystem and step, what it must deliver, who. Its points and
 * dates are set by a leader (unit leader or project manager), before the work starts (decision D-012).
 */
export function TaskForm({ projectId, parent, task, onSaved, onCancel }: TaskFormProps) {
  const t = useTranslations("Tasks");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const project = useProject(projectId);
  const subsystems = useSubsystems(projectId);
  const steps = useLifecycleSteps();
  // Only the steps of the project's car (IC or EV); a step already chosen stays offered.
  const offered = steps.data?.filter(
    (item) => stepsFor(project.data?.category, [item]).length > 0 || item.id === task?.lifecycle_step?.id,
  );
  const descriptionId = useId();
  const deliverableId = useId();
  const criteriaId = useId();

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [priority, setPriority] = useState<TaskPriority | "">(task?.priority ?? "");
  const [points, setPoints] = useState(task?.points ? String(task.points) : "");
  const [startDate, setStartDate] = useState(task?.start_date ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [deliverable, setDeliverable] = useState(task?.deliverable ?? "");
  const [criteria, setCriteria] = useState(task?.success_criteria ?? "");
  const place = task ?? parent;
  const [subsystem, setSubsystem] = useState(place?.subsystem ? String(place.subsystem.id) : "");
  const [step, setStep] = useState(place?.lifecycle_step ? String(place.lifecycle_step.id) : "");
  const [assignees, setAssignees] = useState<number[]>(task?.assignees.map(({ member }) => member.id) ?? []);
  const [primary, setPrimary] = useState<number | null>(
    task?.assignees.find((row) => row.is_primary)?.member.id ?? null,
  );
  const chosen = subsystems.data?.find((item) => String(item.id) === subsystem);
  // A leader of the task, before work starts: of its subsystem if it has one, else of the project.
  const canEstimate = task
    ? task.permissions.estimate
    : chosen
      ? chosen.permissions.estimate_tasks
      : !!project.data?.permissions.estimate_tasks;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        description,
        priority: priority || null,
        deliverable,
        success_criteria: criteria,
        ...(canEstimate
          ? {
              points: points ? (Number(points) as TaskPoints) : null,
              start_date: startDate || null,
              due_date: dueDate || null,
            }
          : {}),
        subsystem_id: subsystem ? Number(subsystem) : null,
        // Sent when changed only: the API refuses a step that no longer applies to the project, even
        // one the task already has, and any other change of the task would fail with it.
        ...(!task || step !== String(task.lifecycle_step?.id ?? "")
          ? { lifecycle_step_id: step ? Number(step) : null }
          : {}),
        assignee_ids: assignees,
        primary_assignee_id: primary !== null && assignees.includes(primary) ? primary : null,
      };
      return task
        ? updateTask(task.id, body)
        : createTask({ ...body, project_id: projectId, parent_id: parent?.id ?? null });
    },
    onSuccess: async (saved) => {
      await refreshWork(queryClient);
      onSaved(saved);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      <TextField
        label={t("titleLabel")}
        name="title"
        required
        maxLength={255}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="space-y-1.5">
        <label htmlFor={descriptionId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("descriptionLabel")}
        </label>
        <textarea
          id={descriptionId}
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={deliverableId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("deliverableLabel")}
        </label>
        <textarea
          id={deliverableId}
          rows={2}
          value={deliverable}
          onChange={(event) => setDeliverable(event.target.value)}
          className={textareaClass}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={criteriaId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("successCriteriaLabel")}
        </label>
        <textarea
          id={criteriaId}
          rows={2}
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
          className={textareaClass}
        />
      </div>
      <fieldset className="space-y-3 rounded-xl border border-line p-4">
        <legend className="px-1 text-2xs font-semibold tracking-widest text-muted uppercase">
          {t("estimateLegend")}
        </legend>
        {canEstimate ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField label={t("pointsLabel")} value={points} onChange={(event) => setPoints(event.target.value)}>
              <option value="">{t("noPoints")}</option>
              {TASK_POINTS.map((value) => (
                <option key={value} value={value}>
                  {value} · {tWork(`pointsLevel.${value}`)}
                </option>
              ))}
            </SelectField>
            <TextField
              label={t("startDateLabel")}
              type="date"
              valueDir="ltr"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
            <TextField
              label={t("dueDateLabel")}
              type="date"
              valueDir="ltr"
              min={startDate || undefined}
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
        ) : (
          <p className="text-sm text-muted">
            {task && task.status !== "planned" ? t("estimateLocked") : t("estimateByLeader")}
          </p>
        )}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t("priorityLabel")}
          value={priority}
          onChange={(event) => setPriority(event.target.value as TaskPriority | "")}
        >
          <option value="">{tWork("priority.none")}</option>
          {TASK_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {tWork(`priority.${value}`)}
            </option>
          ))}
        </SelectField>
        {subsystems.data && subsystems.data.length > 0 ? (
          <SelectField
            label={t("subsystemLabel")}
            value={subsystem}
            onChange={(event) => {
              setSubsystem(event.target.value);
              // The step is chosen within a subsystem: without one, its (hidden) step goes too.
              if (!event.target.value) {
                setStep("");
              }
            }}
          >
            <option value="">{t("noSubsystem")}</option>
            {subsystems.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        {subsystem && offered && project.data ? (
          <SelectField label={t("stepLabel")} value={step} onChange={(event) => setStep(event.target.value)}>
            <option value="">{t("noStep")}</option>
            {offered.map((item) => (
              <option key={item.id} value={item.id}>
                {item.step_order}. {item.name}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>
      <AssigneesPicker
        selected={assignees}
        primary={primary}
        onChange={(ids, main) => {
          setAssignees(ids);
          setPrimary(main);
        }}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={save.isPending}>
          {task ? t("save") : t("create")}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={save.isPending}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

type AssigneesPickerProps = {
  selected: number[];
  primary: number | null;
  onChange: (selected: number[], primary: number | null) => void;
};

/** Who works on the task: search the members, tick them, choose the main one. */
function AssigneesPicker({ selected, primary, onChange }: AssigneesPickerProps) {
  const t = useTranslations("Tasks");
  const members = useMembers();
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map((members.data ?? []).map((member) => [member.id, member])), [members.data]);
  const matches = useMemo(() => {
    const words = normalizeText(query).split(/\s+/).filter(Boolean);
    return (members.data ?? [])
      .filter((member) => member.status !== "alumni")
      .filter((member) => {
        const text = normalizeText(`${member.first_name} ${member.last_name}`);
        return words.every((word) => text.includes(word));
      })
      .slice(0, 8);
  }, [members.data, query]);
  const main = primary !== null && selected.includes(primary) ? primary : (selected[0] ?? null);

  function toggle(id: number) {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    onChange(next, next.includes(main ?? -1) ? main : (next[0] ?? null));
  }

  return (
    <fieldset className="space-y-3 rounded-xl border border-line p-4">
      <legend className="px-1 text-2xs font-semibold tracking-widest text-muted uppercase">
        {t("assigneesLabel")}
      </legend>
      {selected.length > 0 ? (
        <ul className="space-y-2">
          {selected.map((id) => {
            const member = byId.get(id);
            const name = member ? `${member.first_name} ${member.last_name}` : `#${id}`;
            return (
              <li key={id} className="flex flex-wrap items-center gap-3 rounded-lg bg-canvas px-3 py-2 text-sm">
                {member ? (
                  <Avatar firstName={member.first_name} lastName={member.last_name} seed={member.id} size="sm" />
                ) : null}
                <span className="flex-1 font-medium text-ink">{name}</span>
                <label className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <input
                    type="radio"
                    name="primary-assignee"
                    checked={main === id}
                    onChange={() => onChange(selected, id)}
                    aria-label={t("mainAssigneeOf", { name })}
                  />
                  {t("mainAssignee")}
                </label>
                <Button variant="ghost" size="sm" onClick={() => toggle(id)} aria-label={t("unassign", { name })}>
                  {t("remove")}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t("nobodyAssigned")}</p>
      )}
      <TextField
        label={t("findMember")}
        type="search"
        icon={<Search />}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() ? (
        <ul className="divide-y divide-line rounded-lg border border-line" aria-label={t("searchResults")}>
          {matches.length === 0 ? <li className="px-3 py-2 text-sm text-muted">{t("noMatch")}</li> : null}
          {matches.map((member) => {
            const name = `${member.first_name} ${member.last_name}`;
            const isSelected = selected.includes(member.id);
            return (
              <li key={member.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Avatar firstName={member.first_name} lastName={member.last_name} seed={member.id} size="sm" />
                <span className="flex-1 text-ink">{name}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => toggle(member.id)}
                  aria-label={isSelected ? t("unassign", { name }) : t("assignMember", { name })}
                >
                  {isSelected ? t("assigned") : t("assign")}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </fieldset>
  );
}
