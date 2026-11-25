"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMembers } from "@/features/members/use-members";
import { useRouter } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import {
  PRIORITIES,
  createWorkOrder,
  updateWorkOrder,
  type Priority,
  type WorkOrderChange,
  type WorkOrderDetail,
} from "../api";
import { refreshWorkflow, useSeasons, useWorkMe, useWorkProjects } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { TextArea, isLocked, memberName, useDepartments } from "./shared";

type Details = {
  project: string;
  title: string;
  description: string;
  objectives: string;
  justification: string;
  effort: string;
  priority: Priority | "";
  coordinator: string;
};

function detailsOf(order?: WorkOrderDetail): Details {
  return {
    project: order?.project?.id ? String(order.project.id) : "",
    title: order?.title ?? "",
    description: order?.description ?? "",
    objectives: order?.objectives ?? "",
    justification: order?.justification ?? "",
    effort: order?.estimated_effort_units ?? "",
    priority: (order?.priority || "") as Priority | "",
    coordinator: order?.coordinator?.id ? String(order.coordinator.id) : "",
  };
}

function bodyOf(details: Details) {
  return {
    project: details.project ? Number(details.project) : null,
    title: details.title.trim(),
    description: details.description,
    objectives: details.objectives,
    justification: details.justification,
    estimated_effort_units: details.effort.trim() || null,
    priority: details.priority,
    coordinator: details.coordinator ? Number(details.coordinator) : null,
  };
}

/** The fields a Work Order shares between its creation and its edition. */
function DetailFields({
  details,
  onChange,
  season,
}: {
  details: Details;
  onChange: (details: Details) => void;
  season: number | null;
}) {
  const t = useTranslations("WorkOrders");
  const tFlow = useTranslations("Workflow");
  const projects = useWorkProjects(season ?? undefined);
  const members = useMembers();
  const set = (patch: Partial<Details>) => onChange({ ...details, ...patch });
  return (
    <>
      <SelectField
        label={t("projectOptional")}
        value={details.project}
        onChange={(e) => set({ project: e.target.value })}
      >
        <option value="">{t("noProject")}</option>
        {(projects.data ?? []).map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </SelectField>
      <TextField
        label={t("titleColumn")}
        required
        maxLength={255}
        value={details.title}
        onChange={(event) => set({ title: event.target.value })}
      />
      <TextArea
        label={t("description")}
        value={details.description}
        onChange={(value) => set({ description: value })}
      />
      <TextArea
        label={t("objectives")}
        hint={t("objectivesHint")}
        value={details.objectives}
        onChange={(value) => set({ objectives: value })}
      />
      <TextArea
        label={t("justification")}
        value={details.justification}
        onChange={(value) => set({ justification: value })}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label={t("effort")}
          type="number"
          min={0}
          step="0.5"
          inputMode="decimal"
          valueDir="ltr"
          value={details.effort}
          onChange={(event) => set({ effort: event.target.value })}
        />
        <SelectField
          label={t("priority")}
          value={details.priority}
          onChange={(event) => set({ priority: event.target.value as Priority | "" })}
        >
          <option value="">{t("noPriority")}</option>
          {PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {tFlow(`priority.${value}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("coordinatorOptional")}
          value={details.coordinator}
          onChange={(event) => set({ coordinator: event.target.value })}
        >
          <option value="">{t("noCoordinator")}</option>
          {(members.data ?? [])
            .filter((member) => member.status === "active" || String(member.id) === details.coordinator)
            .sort((a, b) => memberName(a).localeCompare(memberName(b)))
            .map((member) => (
              <option key={member.id} value={member.id}>
                {memberName(member)}
              </option>
            ))}
        </SelectField>
      </div>
      <p className="text-xs text-muted">{t("coordinatorHint")}</p>
    </>
  );
}

/** A new Work Order: official when the viewer heads its department, a proposal to the Head otherwise (§3.1). */
export function NewWorkOrder() {
  const t = useTranslations("WorkOrders");
  const tErrors = useTranslations("Errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useWorkMe();
  const seasons = useSeasons();
  const { departments } = useDepartments();
  const [seasonChoice, setSeasonChoice] = useState<string | null>(null);
  const [department, setDepartment] = useState("");
  const [details, setDetails] = useState<Details>(detailsOf());
  const season = seasonChoice ?? (me.data?.current_season ? String(me.data.current_season.id) : "");
  const heads =
    !!department && (!!me.data?.is_club_admin || !!me.data?.headed_department_ids?.includes(Number(department)));

  const save = useMutation({
    mutationFn: (submit: boolean) =>
      createWorkOrder({ ...bodyOf(details), season: Number(season), department: Number(department), submit }, !heads),
    onSuccess: async (created) => {
      await refreshWorkflow(queryClient);
      router.replace(`/work/orders/${created.id}`);
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(true);
  }

  if (!me.data && !me.isError) {
    return <LinesPlaceholder lines={4} />;
  }

  return (
    <div className="space-y-6">
      <BackLink href="/work/orders">{t("backToList")}</BackLink>
      <WorkflowHeader current="workOrders" title={t("newTitle")} description={t("newIntro")} />
      <Card className="mx-auto max-w-3xl">
        <form onSubmit={submit} className="space-y-5">
          {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label={t("season")} required value={season} onChange={(e) => setSeasonChoice(e.target.value)}>
              <option value="" disabled>
                {t("chooseSeason")}
              </option>
              {(seasons.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </SelectField>
            <SelectField
              label={t("department")}
              required
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
            >
              <option value="" disabled>
                {t("chooseDepartment")}
              </option>
              {departments.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </SelectField>
          </div>
          {department ? (
            <Alert tone={heads ? "success" : "info"}>{heads ? t("createsOfficial") : t("createsProposal")}</Alert>
          ) : null}
          <DetailFields details={details} onChange={setDetails} season={season ? Number(season) : null} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => router.back()} disabled={save.isPending}>
              {t("cancel")}
            </Button>
            {department && !heads ? (
              <Button
                variant="secondary"
                disabled={!details.title.trim() || !season || save.isPending}
                loading={save.isPending && save.variables === false}
                onClick={() => save.mutate(false)}
              >
                {t("saveDraft")}
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={!department || !season || save.isPending}
              loading={save.isPending && save.variables !== false}
            >
              {department && !heads ? t("submitProposal") : t("create")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

/** Editing the details: the Head (also before deciding on a proposal), the author while it is not decided. */
export function EditWorkOrder({ order, onDone }: { order: WorkOrderDetail; onDone: () => void }) {
  const t = useTranslations("WorkOrders");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [details, setDetails] = useState<Details>(detailsOf(order));
  const [reason, setReason] = useState("");
  const locked = isLocked(order.status);
  const save = useMutation({
    mutationFn: () => {
      const body: WorkOrderChange = { ...bodyOf(details), ...(reason.trim() ? { reason: reason.trim() } : {}) };
      return updateWorkOrder(order.id, body);
    },
    onSuccess: async () => {
      await refreshWorkflow(queryClient);
      onDone();
    },
  });
  return (
    <Card title={t("editTitle")}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
        <DetailFields details={details} onChange={setDetails} season={order.season} />
        {locked ? <TextArea label={t("reason")} rows={2} value={reason} onChange={setReason} /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onDone} disabled={save.isPending}>
            {t("cancel")}
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!details.title.trim()}>
            {t("save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
