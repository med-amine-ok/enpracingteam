"use client";

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, ListChecks, MessageSquare, Play } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useId, useState, type DragEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { TASK_STATUSES, startTask, type Task, type TaskStatus } from "./api";
import { BlockedBadge, PointsBadge, PriorityBadge } from "./badges";
import { ProgressBar } from "./lifecycle-steps";
import { refreshWork } from "./queries";

const COLUMN_DOTS: Record<TaskStatus, string> = {
  planned: "bg-muted",
  in_progress: "bg-navy",
  submitted: "bg-warning",
  needs_revision: "bg-racing",
  validated: "bg-success",
};

/** A task counted in the ranking starts once a leader has set its points, start date and due date. */
export function waitsForEstimate(task: Pick<Task, "scored" | "points" | "start_date" | "due_date">) {
  return task.scored && (!task.points || !task.start_date || !task.due_date);
}

/**
 * Starts a task (planned → in progress): the board shows it at once, then the API confirms (or the
 * task goes back, with the API's message). The other steps need a form: they are on the task's page.
 */
export function useStartTask(listKey: QueryKey) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: Task) => startTask(task.id),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<Task[]>(listKey);
      queryClient.setQueryData<Task[]>(listKey, (tasks) =>
        tasks?.map((item) => (item.id === task.id ? { ...item, status: "in_progress" } : item)),
      );
      return { previous };
    },
    onError: (_error, _task, context) => {
      if (context?.previous) {
        queryClient.setQueryData(listKey, context.previous);
      }
    },
    onSettled: () => refreshWork(queryClient),
  });
}

type TaskBoardProps = {
  tasks: Task[];
  onStart: (task: Task) => void;
  /** Show the project of each task (boards that mix projects, such as "my tasks"). */
  showProject?: boolean;
};

/**
 * Kanban: one column per step. A planned card is started with its button, or dragged to "in progress";
 * submitting and validating are done on the task's page (what was delivered, its quality mark).
 */
export function TaskBoard({ tasks, onStart, showProject = false }: TaskBoardProps) {
  const t = useTranslations("Work");
  const [dragged, setDragged] = useState<Task | null>(null);
  const [over, setOver] = useState<TaskStatus | null>(null);

  function drop(status: TaskStatus) {
    if (dragged && status === "in_progress" && dragged.status === "planned") {
      onStart(dragged);
    }
    setDragged(null);
    setOver(null);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {TASK_STATUSES.map((status) => {
        const column = tasks.filter((task) => task.status === status);
        // Only "in progress" takes a card: a planned one, being started.
        const takesDrop = status === "in_progress" && dragged !== null;
        return (
          <section
            key={status}
            aria-label={t(`taskStatus.${status}`)}
            onDragOver={(event: DragEvent) => {
              if (takesDrop) {
                event.preventDefault();
                setOver(status);
              }
            }}
            onDragLeave={() => setOver((current) => (current === status ? null : current))}
            onDrop={(event: DragEvent) => {
              event.preventDefault();
              drop(status);
            }}
            className={cn(
              "flex min-h-40 flex-col gap-3 rounded-xl border border-line bg-canvas/70 p-3 transition-colors",
              over === status && "border-navy/40 bg-info-soft",
            )}
          >
            <header className="flex items-center gap-2 px-1">
              <span className={cn("size-2 rounded-full", COLUMN_DOTS[status])} aria-hidden="true" />
              <h3 className="text-sm font-semibold text-ink">{t(`taskStatus.${status}`)}</h3>
              <span className="ms-auto rounded-full bg-surface px-2 text-xs font-medium text-muted">
                {column.length}
              </span>
            </header>
            {column.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                showProject={showProject}
                onStart={onStart}
                onDragStart={() => setDragged(task)}
                onDragEnd={() => {
                  setDragged(null);
                  setOver(null);
                }}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

type TaskCardProps = {
  task: Task;
  showProject: boolean;
  onStart: (task: Task) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

function TaskCard({ task, showProject, onStart, onDragStart, onDragEnd }: TaskCardProps) {
  const t = useTranslations("Work");
  const titleId = useId();
  const canStart = task.permissions.start && !waitsForEstimate(task);
  return (
    <article
      draggable={canStart}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(task.id));
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "space-y-2.5 rounded-lg border border-line bg-surface p-3 shadow-xs",
        canStart && "cursor-grab active:cursor-grabbing",
        task.is_blocked && "border-racing/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-2xs font-bold tracking-wider text-racing" dir="ltr">
            {task.reference}
          </p>
          <h4 id={titleId} dir="auto" className="text-sm leading-snug font-medium text-ink rtl:text-right">
            <Link href={`/tasks/${task.id}`} className="hover:underline">
              {task.title}
            </Link>
          </h4>
        </div>
        <PriorityBadge priority={task.priority} />
      </div>
      {task.status === "in_progress" || task.status === "needs_revision" ? (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ProgressBar done={task.progress} total={100} label={t("progressOf", { title: task.title })} />
          </div>
          <span className="font-display text-xs font-bold text-navy tabular-nums">{task.progress} %</span>
        </div>
      ) : null}
      {task.is_blocked || task.points ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {task.is_blocked ? <BlockedBadge /> : null}
          <PointsBadge points={task.points} />
        </div>
      ) : null}
      {showProject || task.subsystem ? (
        <p className="truncate text-xs text-muted">
          {[showProject ? task.project.name : null, task.subsystem?.name].filter(Boolean).map((name, index) => (
            <Fragment key={index}>
              {index > 0 ? " · " : null}
              <bdi>{name}</bdi>
            </Fragment>
          ))}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <DueDate date={task.due_date} overdue={task.is_overdue} />
        {task.subtasks_total > 0 ? (
          <span className="inline-flex items-center gap-1" title={t("subtasksTitle")}>
            <ListChecks className="size-3.5" aria-hidden="true" />
            {t("subtasks", { done: String(task.subtasks_done), total: String(task.subtasks_total) })}
          </span>
        ) : null}
        {task.comments_count > 0 ? (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3.5" aria-hidden="true" />
            {t("comments", { count: task.comments_count, shown: String(task.comments_count) })}
          </span>
        ) : null}
        {task.status === "validated" && task.quality_mark !== null ? (
          <span>{t("qualityMark", { mark: String(task.quality_mark) })}</span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <AssigneeAvatars task={task} />
        <NextStep task={task} titleId={titleId} canStart={canStart} onStart={onStart} />
      </div>
    </article>
  );
}

type NextStepProps = { task: Task; titleId: string; canStart: boolean; onStart: (task: Task) => void };

/** What the viewer does next with the card: start it here, or submit / validate it on its page. */
function NextStep({ task, titleId, canStart, onStart }: NextStepProps) {
  const t = useTranslations("Work");
  const linkClass =
    "inline-flex h-7 items-center rounded-md border border-line px-2 text-xs font-medium text-ink hover:bg-canvas";
  if (canStart) {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onStart(task)}
        aria-label={t("startTask", { title: task.title })}
      >
        <Play className="size-3.5" aria-hidden="true" />
        {t("start")}
      </Button>
    );
  }
  if (task.permissions.start) {
    return <span className="text-end text-xs text-muted">{t("waitsForEstimate")}</span>;
  }
  if (task.permissions.submit) {
    return (
      <Link href={`/tasks/${task.id}`} className={linkClass} aria-describedby={titleId}>
        {t("submit")}
      </Link>
    );
  }
  if (task.permissions.validate) {
    return (
      <Link href={`/tasks/${task.id}`} className={linkClass} aria-describedby={titleId}>
        {t("validate")}
      </Link>
    );
  }
  return null;
}

/** A due date; overdue ones in red, with a warning sign. */
export function DueDate({ date, overdue }: { date: string | null | undefined; overdue: boolean }) {
  const t = useTranslations("Work");
  const format = useFormatter();
  if (!date) {
    return null;
  }
  const text = format.dateTime(new Date(date), { day: "numeric", month: "short", numberingSystem: "latn" });
  return (
    <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-racing-strong")}>
      {overdue ? (
        <AlertTriangle className="size-3.5" aria-hidden="true" />
      ) : (
        <CalendarDays className="size-3.5" aria-hidden="true" />
      )}
      {overdue ? t("overdueOn", { date: text }) : text}
    </span>
  );
}

/** Up to 3 avatars of the assignees (the main one first), then "+n". */
export function AssigneeAvatars({ task }: { task: Pick<Task, "assignees"> }) {
  const t = useTranslations("Work");
  if (task.assignees.length === 0) {
    return <span className="text-xs text-muted">{t("unassigned")}</span>;
  }
  const names = task.assignees.map(({ member }) => `${member.first_name} ${member.last_name}`).join(", ");
  return (
    <span className="flex -space-x-1.5 rtl:space-x-reverse" title={names}>
      <span className="sr-only">{names}</span>
      {task.assignees.slice(0, 3).map(({ member }) => (
        <Avatar
          key={member.id}
          firstName={member.first_name}
          lastName={member.last_name}
          seed={member.id}
          size="sm"
          className="size-6 text-2xs ring-2 ring-surface"
        />
      ))}
      {task.assignees.length > 3 ? (
        <span className="grid size-6 place-items-center rounded-full bg-canvas text-2xs font-medium text-muted ring-2 ring-surface">
          +{task.assignees.length - 3}
        </span>
      ) : null}
    </span>
  );
}
