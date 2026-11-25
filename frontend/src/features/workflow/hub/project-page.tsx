"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { BackLink } from "@/components/ui/back-link";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { SelectField } from "@/components/ui/select-field";
import { Link } from "@/i18n/navigation";
import type { ProjectOverview } from "../api";
import { ProgressMeter, WorkOrderStatusBadge } from "../badges";
import { refreshWorkflow, useProjectOverview, useSeasons } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { useDepartments } from "./dependencies-page";
import { setupProject } from "./hub-api";
import { ActionPanel, Empty, labelClass } from "./parts";
import { DepartmentRows } from "./reports-page";

/** A project seen through the work hierarchy: its departments' progress and its Work Orders (spec §6.3). */
export function ProjectPage() {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const params = useParams<{ id: string }>();
  const id = Number(params.id) || 0;
  const project = useProjectOverview(id);
  const data = project.data;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <BackLink href="/work/reports">{tWorkflow("tabs.reports")}</BackLink>
      <WorkflowHeader current="reports" title={data?.name ?? tWorkflow("entity.project")} />
      {project.isError ? (
        <LoadError error={project.error} />
      ) : !data ? (
        <LinesPlaceholder lines={6} />
      ) : (
        <>
          <Card
            title={t("project.departments")}
            description={t("project.departmentsIntro")}
            action={<ProgressMeter value={data.progress} label={tWorkflow("progress")} className="w-48" />}
          >
            <DepartmentRows rows={data.departments} />
          </Card>
          <Card title={tWorkflow("tabs.workOrders")}>
            {data.work_orders.length === 0 ? (
              <Empty>{t("reports.noWorkOrders")}</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {data.work_orders.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0 space-y-0.5">
                      <Link
                        href={`/work/orders/${order.id}`}
                        dir="auto"
                        className="font-medium text-ink hover:text-racing"
                      >
                        {[order.code, order.title].filter(Boolean).join(" · ")}
                      </Link>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span dir="auto">{order.department.name}</span>
                        {order.status ? <WorkOrderStatusBadge status={order.status} /> : null}
                      </p>
                    </div>
                    <ProgressMeter value={order.progress} label={tWorkflow("progress")} className="w-44" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {data.can_manage ? <SetupForm project={data} /> : null}
        </>
      )}
    </div>
  );
}

/** The club admins and the project's manager set its season and participating departments. */
function SetupForm({ project }: { project: ProjectOverview }) {
  const t = useTranslations("WorkHub");
  const queryClient = useQueryClient();
  const seasons = useSeasons();
  const departments = useDepartments();
  const [season, setSeason] = useState(project.season ? String(project.season) : "");
  const [chosen, setChosen] = useState<number[]>(project.departments.map((unit) => unit.id));
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => setupProject(project.id, { season: season ? Number(season) : null, departments: chosen }),
    onSuccess: async () => {
      setSaved(true);
      await refreshWorkflow(queryClient);
    },
  });
  const toggle = (unit: number) => {
    setSaved(false);
    setChosen((current) => (current.includes(unit) ? current.filter((value) => value !== unit) : [...current, unit]));
  };
  return (
    <Card title={t("project.setup")} description={t("project.setupIntro")}>
      <ActionPanel
        title={t("project.setup")}
        confirm={t("save")}
        pending={save.isPending}
        error={save.error}
        onSubmit={() => save.mutate()}
        onClose={() => {
          setSeason(project.season ? String(project.season) : "");
          setChosen(project.departments.map((unit) => unit.id));
          setSaved(false);
        }}
      >
        <div className="max-w-xs">
          <SelectField
            label={t("reports.season")}
            value={season}
            onChange={(event) => {
              setSaved(false);
              setSeason(event.target.value);
            }}
          >
            <option value="">{t("project.noSeason")}</option>
            {(seasons.data ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </SelectField>
        </div>
        <fieldset className="space-y-2">
          <legend className={labelClass}>{t("project.participating")}</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map((unit) => (
              <label key={unit.id} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={chosen.includes(unit.id)}
                  onChange={() => toggle(unit.id)}
                  className="size-4 accent-navy"
                />
                {unit.name}
              </label>
            ))}
          </div>
        </fieldset>
        {saved ? <p className="text-sm text-success">{t("project.saved")}</p> : null}
      </ActionPanel>
    </Card>
  );
}
