"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import type { Member, OrgUnit } from "@/features/members/api";
import { useMembers, useOrgUnits } from "@/features/members/use-members";
import {
  PROJECT_CATEGORIES,
  createProject,
  type ProjectCategory,
  type ProjectCreate,
  type ProjectStatus,
} from "@/features/work/api";
import { useProjectCreating } from "@/features/work/queries";
import { useRouter } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";

const STARTING_STATUSES: ProjectStatus[] = ["planned", "active"];
// Codes of the units that run each kind of project (seed_org_units): the cars are the FS team's, the
// complementary competition the MATE ROV team's (decision D-025).
const UNIT_OF_CATEGORY: Partial<Record<ProjectCategory, string>> = {
  ic: "fs-team",
  ev: "fs-team",
  complementary_competition: "mate-rov",
};

const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

/** The members who may be named project manager: anyone still in the team. The Board names them (charter art. 2
 * and 6); one without a role that allows it gets the Project Manager role on saving (decision D-025). */
function possibleManagers(members: Member[]) {
  return members
    .filter((member) => member.status !== "alumni")
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`));
}

/** A new project, with its manager (decision D-025: the Board and the Team Manager; charter art. 2 and 6, the Board
 * names the project managers). */
export function NewProject() {
  const t = useTranslations("Projects");
  const tShell = useTranslations("Shell");
  const creating = useProjectCreating();
  const members = useMembers();
  const units = useOrgUnits();
  const error = creating.error ?? members.error ?? units.error;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/projects">{tShell("projects")}</BackLink>
      <PageHeader eyebrow={t("eyebrow")} title={t("newTitle")} description={t("newIntro")} />
      {error ? (
        <LoadError error={error} />
      ) : !creating.data || !members.data || !units.data ? (
        <Card>
          <LinesPlaceholder lines={6} />
        </Card>
      ) : !creating.data.can_create ? (
        <Alert tone="info">{t("newNotAllowed")}</Alert>
      ) : (
        <NewProjectForm managers={possibleManagers(members.data)} units={units.data.filter((unit) => unit.is_active)} />
      )}
    </div>
  );
}

function NewProjectForm({ managers, units }: { managers: Member[]; units: OrgUnit[] }) {
  const t = useTranslations("Projects");
  const tWork = useTranslations("Work");
  const tErrors = useTranslations("Errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const descriptionId = useId();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProjectCategory | "">("");
  const [unitId, setUnitId] = useState("");
  const [managerId, setManagerId] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planned");
  const [key, setKey] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [description, setDescription] = useState("");
  const sorted = [...units].sort((a, b) => a.name.localeCompare(b.name));

  const save = useMutation({
    mutationFn: (body: ProjectCreate) => createProject(body),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push(`/projects/${project.id}`);
    },
  });

  function chooseCategory(value: ProjectCategory | "") {
    setCategory(value);
    const code = value ? UNIT_OF_CATEGORY[value] : undefined;
    const unit = code ? units.find((item) => item.code === code) : undefined;
    if (unit) setUnitId(String(unit.id));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!category) return;
    save.mutate({
      name: name.trim(),
      category,
      org_unit_id: Number(unitId),
      project_manager_id: managerId ? Number(managerId) : null,
      status,
      key: key.trim(),
      start_date: start || null,
      end_date: end || null,
      description: description.trim(),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6" aria-label={t("newTitle")}>
      <Card title={t("newWhat")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField
              label={t("newName")}
              required
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <SelectField
            label={t("newCategory")}
            required
            value={category}
            onChange={(event) => chooseCategory(event.target.value as ProjectCategory | "")}
          >
            <option value="">{t("newChooseCategory")}</option>
            {PROJECT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {tWork(`category.${value}`)}
              </option>
            ))}
          </SelectField>
          <SelectField label={t("newUnit")} required value={unitId} onChange={(event) => setUnitId(event.target.value)}>
            <option value="">{t("newChooseUnit")}</option>
            {sorted.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </SelectField>
          <div className="sm:col-span-2">
            <SelectField
              label={t("newManager")}
              value={managerId}
              onChange={(event) => setManagerId(event.target.value)}
            >
              <option value="">{t("newNoManager")}</option>
              {managers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.first_name} {member.last_name}
                </option>
              ))}
            </SelectField>
            <p className="mt-1.5 text-xs text-muted">{t("newManagerHint")}</p>
          </div>
        </div>
      </Card>
      <Card title={t("newWhen")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("statusLabel")}
            value={status}
            onChange={(event) => setStatus(event.target.value as ProjectStatus)}
          >
            {STARTING_STATUSES.map((value) => (
              <option key={value} value={value}>
                {tWork(`projectStatus.${value}`)}
              </option>
            ))}
          </SelectField>
          <div>
            <TextField
              label={t("keyLabel")}
              valueDir="ltr"
              autoComplete="off"
              maxLength={10}
              value={key}
              onChange={(event) => setKey(event.target.value.toUpperCase())}
            />
            <p className="mt-1.5 text-xs text-muted">{t("keyHint", { example: `${key.trim() || "EV27"}-001` })}</p>
          </div>
          <TextField
            label={t("newStart")}
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
          <TextField label={t("newEnd")} type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor={descriptionId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
              {t("newDescription")}
            </label>
            <textarea
              id={descriptionId}
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={textareaClass}
            />
          </div>
        </div>
      </Card>
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      <Button type="submit" loading={save.isPending}>
        <FolderPlus className="size-4" aria-hidden="true" />
        {t("newConfirm")}
      </Button>
    </form>
  );
}
