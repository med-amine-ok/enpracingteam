"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import type { TaskDetail } from "@/features/work/api";
import { useProjects, useTask } from "@/features/work/queries";
import { useRouter } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { TaskForm } from "./task-form";

/** A new task, in the project given by ?project= or chosen here; a new subtask with ?parent=. */
export function NewTask() {
  const params = useSearchParams();
  const parentId = Number(params.get("parent")) || null;
  if (parentId) {
    return <NewSubtask parentId={parentId} />;
  }
  return <NewProjectTask projectId={Number(params.get("project")) || null} />;
}

function NewProjectTask({ projectId }: { projectId: number | null }) {
  const t = useTranslations("Tasks");
  const [chosen, setChosen] = useState<number | null>(null);
  const project = projectId ?? chosen;
  // Only the projects where the viewer may create tasks.
  const projects = useProjects({ mine: true });
  const allowed = (projects.data ?? []).filter((item) => item.permissions.create_task);

  return (
    <NewTaskPage
      back={project ? <BackLink href={`/projects/${project}`}>{t("backToProject")}</BackLink> : null}
      title={t("newTitle")}
      description={t("newIntro")}
    >
      {project ? (
        <NewTaskForm projectId={project} />
      ) : projects.error ? (
        <LoadError error={projects.error} />
      ) : projects.data ? (
        <SelectField
          label={t("projectLabel")}
          value=""
          onChange={(event) => setChosen(Number(event.target.value) || null)}
        >
          <option value="">{t("chooseProject")}</option>
          {allowed.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <LinesPlaceholder lines={2} />
      )}
    </NewTaskPage>
  );
}

/** A subtask belongs to its parent's project, and starts in the parent's subsystem and step. */
function NewSubtask({ parentId }: { parentId: number }) {
  const t = useTranslations("Tasks");
  const tErrors = useTranslations("Errors");
  const parent = useTask(parentId);

  return (
    <NewTaskPage
      back={
        parent.data ? (
          <BackLink href={`/tasks/${parent.data.id}`}>{parent.data.title}</BackLink>
        ) : parent.isPending ? (
          <span className="block h-5 w-48 animate-pulse rounded bg-line" aria-hidden="true" />
        ) : null
      }
      title={t("newSubtaskTitle")}
      description={parent.data ? t("newSubtaskIntro", { title: parent.data.title }) : t("newIntro")}
    >
      {parent.data ? (
        <NewTaskForm projectId={parent.data.project.id} parent={parent.data} />
      ) : parent.isError ? (
        <Alert tone="error">{errorText(parent.error, tErrors)}</Alert>
      ) : (
        <LinesPlaceholder lines={4} />
      )}
    </NewTaskPage>
  );
}

/** Then the new task's page; "Cancel" goes back where the member came from. */
function NewTaskForm({ projectId, parent }: { projectId: number; parent?: TaskDetail }) {
  const router = useRouter();
  return (
    <TaskForm
      projectId={projectId}
      parent={parent}
      onSaved={(task) => router.replace(`/tasks/${task.id}`)}
      onCancel={() => router.back()}
    />
  );
}

type NewTaskPageProps = { back: ReactNode; title: string; description: string; children: ReactNode };

function NewTaskPage({ back, title, description, children }: NewTaskPageProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {back}
      <PageHeader title={title} description={description} />
      <Card>{children}</Card>
    </div>
  );
}
