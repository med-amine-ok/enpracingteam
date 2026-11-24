"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { STUDY_LEVELS, type StudyLevel } from "@/features/auth/api";
import {
  addMember,
  scopeOfUnit,
  type MemberAdd,
  type MemberAdding,
  type OrgUnit,
  type Position,
  type ProjectChoice,
} from "@/features/members/api";
import { membersQueryKey, useMemberAdding, useOrgUnits } from "@/features/members/use-members";
import type { ProjectCategory } from "@/features/work/api";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";

type Added = { id: number; name: string; email: string };

/** Add a member from the web app (decision D-024): who they are and their first unit and role, with a position
 * in the club and their projects (decision D-025). They then sign in with a code e-mailed to their address. Club
 * admins add to any unit, department heads to theirs. */
export function AddMember() {
  const t = useTranslations("Directory");
  const tShell = useTranslations("Shell");
  const adding = useMemberAdding();
  const units = useOrgUnits();
  const error = adding.error ?? units.error;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/directory">{tShell("directory")}</BackLink>
      <PageHeader eyebrow={t("eyebrow")} title={t("addTitle")} description={t("addIntro")} />
      {error ? (
        <LoadError error={error} />
      ) : !adding.data || !units.data ? (
        <Card>
          <LinesPlaceholder lines={6} />
        </Card>
      ) : !adding.data.can_add ? (
        <Alert tone="info">{t("addNotAllowed")}</Alert>
      ) : (
        <AddMemberForm
          adding={adding.data}
          units={units.data.filter((unit) => adding.data.unit_ids.includes(unit.id))}
        />
      )}
    </div>
  );
}

function AddMemberForm({ adding, units }: { adding: MemberAdding; units: OrgUnit[] }) {
  const t = useTranslations("Directory");
  const tMember = useTranslations("Member");
  const tEngagement = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [unitId, setUnitId] = useState(units.length === 1 ? String(units[0].id) : "");
  const [roleId, setRoleId] = useState("");
  const [level, setLevel] = useState<"main" | "junior" | "">("main");
  const [study, setStudy] = useState<StudyLevel | "">("");
  const [phone, setPhone] = useState("");
  const [positionId, setPositionId] = useState("");
  const [projectIds, setProjectIds] = useState<number[]>([]);
  const [added, setAdded] = useState<Added | null>(null);

  const unit = units.find((item) => String(item.id) === unitId);
  const roles = unit ? adding.roles.filter((item) => item.scope === scopeOfUnit(unit.type)) : [];
  const role = roles.find((item) => String(item.id) === roleId);
  const sorted = [...units].sort((a, b) => a.name.localeCompare(b.name));

  const save = useMutation({
    mutationFn: (body: MemberAdd) => addMember(body),
    onSuccess: async (member) => {
      setAdded({ id: member.id, name: `${member.first_name} ${member.last_name}`, email: member.email });
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setStudy("");
      setPositionId("");
      setProjectIds([]);
      await queryClient.invalidateQueries({ queryKey: membersQueryKey });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setAdded(null);
    save.mutate({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      org_unit_id: Number(unitId),
      role_id: Number(roleId),
      member_level: role?.is_leadership ? null : level || null,
      study_level: study,
      phone: phone.trim(),
      position_id: positionId ? Number(positionId) : null,
      project_ids: projectIds,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6" aria-labelledby="add-member-title">
      {added ? (
        <Alert tone="success">
          {t.rich("added", {
            name: added.name,
            email: added.email,
            who: (chunks) => <bdi className="font-semibold">{chunks}</bdi>,
          })}{" "}
          <Link href={`/members/${added.id}`} className="font-semibold underline">
            {t("addedSheet")}
          </Link>
        </Alert>
      ) : null}
      <Card title={t("addWho")}>
        <h2 id="add-member-title" className="sr-only">
          {t("addTitle")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("firstName")}
            required
            autoComplete="off"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />
          <TextField
            label={t("lastName")}
            required
            autoComplete="off"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
          <div className="sm:col-span-2">
            <TextField
              label={t("emailAddress")}
              type="email"
              required
              valueDir="ltr"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <p className="mt-1.5 text-xs text-muted">{t("emailHint")}</p>
          </div>
          <TextField
            label={t("phoneOptional")}
            type="tel"
            valueDir="ltr"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <SelectField
            label={t("studyOptional")}
            value={study}
            onChange={(event) => setStudy(event.target.value as StudyLevel | "")}
          >
            <option value="">{t("studyUnknown")}</option>
            {STUDY_LEVELS.map((value) => (
              <option key={value} value={value}>
                {tEngagement(`studyLevel.${value}`)}
              </option>
            ))}
          </SelectField>
        </div>
      </Card>
      <Card title={t("addWhere")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("unitLabel")}
            required
            value={unitId}
            onChange={(event) => {
              setUnitId(event.target.value);
              setRoleId("");
            }}
          >
            <option value="">{t("chooseUnit")}</option>
            {sorted.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t("columnRole")}
            required
            disabled={!unit}
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
          >
            <option value="">{unit ? t("chooseRole") : t("chooseUnitFirst")}</option>
            {roles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
          {role && !role.is_leadership ? (
            <SelectField
              label={t("levelLabel")}
              value={level}
              onChange={(event) => setLevel(event.target.value as "main" | "junior")}
            >
              <option value="main">{tMember("levels.main")}</option>
              <option value="junior">{tMember("levels.junior")}</option>
            </SelectField>
          ) : null}
        </div>
      </Card>
      {adding.positions.length || adding.projects.length ? (
        <Card title={t("addClub")}>
          <div className="space-y-5">
            {adding.positions.length ? (
              <PositionField positions={adding.positions} value={positionId} onChange={setPositionId} />
            ) : null}
            {adding.projects.length ? (
              <ProjectsField projects={adding.projects} value={projectIds} onChange={setProjectIds} />
            ) : null}
          </div>
        </Card>
      ) : null}
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      <Button type="submit" loading={save.isPending}>
        <UserPlus className="size-4" aria-hidden="true" />
        {t("addConfirm")}
      </Button>
    </form>
  );
}

/** A position in the club (decision D-025): a role in the Board or the Executive Bureau, given by the Board and the
 * Team Manager. */
export function PositionField({
  positions,
  value,
  onChange,
  label,
}: {
  positions: Position[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const t = useTranslations("Directory");
  return (
    <SelectField
      label={label ?? t("positionOptional")}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t("positionNone")}</option>
      {positions.map((position) => (
        <option key={position.id} value={position.id}>
          {t("positionIn", { role: position.name, unit: position.unit.name })}
        </option>
      ))}
    </SelectField>
  );
}

/** The projects under way or planned a member is in, as boxes to tick. */
export function ProjectsField({
  projects,
  value,
  onChange,
}: {
  projects: ProjectChoice[];
  value: number[];
  onChange: (value: number[]) => void;
}) {
  const t = useTranslations("Directory");
  const tWork = useTranslations("Work");
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-xs font-semibold tracking-widest text-muted uppercase">
        {t("projectsLabel")}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {projects.map((project) => (
          <label
            key={project.id}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm text-ink has-[:checked]:border-racing"
          >
            <input
              type="checkbox"
              checked={value.includes(project.id)}
              onChange={(event) =>
                onChange(event.target.checked ? [...value, project.id] : value.filter((id) => id !== project.id))
              }
            />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="shrink-0 text-xs text-muted">
              {tWork(`category.${project.category as ProjectCategory}`)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
