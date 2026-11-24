"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, UserMinus } from "lucide-react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { STUDY_LEVELS, type StudyLevel } from "@/features/auth/api";
import { engagementKeys } from "@/features/engagement/queries";
import {
  addMembership,
  changeMember,
  endMembership,
  scopeOfUnit,
  type MemberAdding,
  type MemberManage,
  type MemberStatus,
  type MembershipAdd,
  type OrgUnit,
} from "@/features/members/api";
import {
  memberManageQueryKey,
  membersQueryKey,
  useMemberAdding,
  useMemberManage,
  useOrgUnits,
} from "@/features/members/use-members";
import { errorText } from "@/lib/error-text";
import { PositionField, ProjectsField } from "./add-member";

const STATUSES: MemberStatus[] = ["active", "on_leave", "alumni"];

/** The Board and the Team Manager edit a member (decision D-025): who they are, their status and projects, their
 * memberships and positions in the club. */
export function EditMember() {
  const t = useTranslations("Directory");
  const { id } = useParams<{ id: string }>();
  const memberId = Number(id);
  const manage = useMemberManage(memberId);
  const adding = useMemberAdding();
  const units = useOrgUnits();
  const error = manage.error ?? adding.error ?? units.error;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href={`/members/${memberId}`}>{t("editBack")}</BackLink>
      {error ? (
        <LoadError error={error} />
      ) : !manage.data || !adding.data || !units.data ? (
        <Card>
          <LinesPlaceholder lines={8} />
        </Card>
      ) : (
        <>
          <PageHeader
            eyebrow={t("eyebrow")}
            title={t("editTitle", { name: `${manage.data.first_name} ${manage.data.last_name}` })}
            description={t("editIntro")}
          />
          <IdentityForm member={manage.data} adding={adding.data} />
          <MembershipsCard member={manage.data} adding={adding.data} units={units.data} />
        </>
      )}
    </div>
  );
}

/** After a change: the edited member as the API answered, and the lists that show them. */
function useRefresh(memberId: number) {
  const queryClient = useQueryClient();
  return async (member: MemberManage) => {
    queryClient.setQueryData(memberManageQueryKey(memberId), member);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: membersQueryKey }),
      queryClient.invalidateQueries({ queryKey: engagementKeys.sheet(memberId) }),
    ]);
  };
}

function IdentityForm({ member, adding }: { member: MemberManage; adding: MemberAdding }) {
  const t = useTranslations("Directory");
  const tMember = useTranslations("Member");
  const tEngagement = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const refresh = useRefresh(member.id);
  const [firstName, setFirstName] = useState(member.first_name);
  const [lastName, setLastName] = useState(member.last_name);
  const [email, setEmail] = useState(member.email);
  const [phone, setPhone] = useState(member.phone ?? "");
  const [study, setStudy] = useState<StudyLevel | "">((member.study_level as StudyLevel | "" | undefined) ?? "");
  const [status, setStatus] = useState<MemberStatus>(member.status ?? "active");
  const [projectIds, setProjectIds] = useState<number[]>(member.projects);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      changeMember(member.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        study_level: study,
        status,
        project_ids: projectIds,
      }),
    onSuccess: async (changed) => {
      setSaved(true);
      await refresh(changed);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    save.mutate();
  }

  return (
    <form onSubmit={submit} aria-label={t("editWho")}>
      <Card title={t("editWho")}>
        <div className="space-y-5">
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
            <SelectField
              label={t("statusLabel")}
              value={status}
              onChange={(event) => setStatus(event.target.value as MemberStatus)}
            >
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {tMember(`statuses.${value}`)}
                </option>
              ))}
            </SelectField>
          </div>
          {adding.projects.length ? (
            <ProjectsField projects={adding.projects} value={projectIds} onChange={setProjectIds} />
          ) : null}
          {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
          {saved ? <Alert tone="success">{t("editSaved")}</Alert> : null}
          <Button type="submit" loading={save.isPending}>
            <Save className="size-4" aria-hidden="true" />
            {t("editSave")}
          </Button>
        </div>
      </Card>
    </form>
  );
}

function MembershipsCard({ member, adding, units }: { member: MemberManage; adding: MemberAdding; units: OrgUnit[] }) {
  const t = useTranslations("Directory");
  const tMember = useTranslations("Member");
  const tErrors = useTranslations("Errors");
  const refresh = useRefresh(member.id);
  const [ending, setEnding] = useState<number | null>(null);

  const end = useMutation({
    mutationFn: (membership: number) => endMembership(member.id, membership),
    onSuccess: async (changed) => {
      setEnding(null);
      await refresh(changed);
    },
  });

  return (
    <Card title={t("editMemberships")}>
      <div className="space-y-6">
        {member.memberships.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line" aria-label={t("editMemberships")}>
            {member.memberships.map((membership) => {
              const label = `${membership.role.name} · ${membership.org_unit.name}`;
              return (
                <li key={membership.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{membership.role.name}</p>
                    <p className="text-xs text-muted">
                      {membership.org_unit.name}
                      {membership.member_level ? ` · ${tMember(`levels.${membership.member_level}`)}` : ""}
                    </p>
                  </div>
                  {membership.is_primary ? <Badge tone="neutral">{t("editPrimary")}</Badge> : null}
                  {ending === membership.id ? (
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={end.isPending}
                        onClick={() => end.mutate(membership.id)}
                      >
                        {t("editEndConfirm")}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEnding(null)}>
                        {t("editCancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={t("editEndOf", { what: label })}
                      onClick={() => setEnding(membership.id)}
                    >
                      <UserMinus className="size-4" aria-hidden="true" />
                      {t("editEnd")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">{t("editNoMembership")}</p>
        )}
        {end.isError ? <Alert tone="error">{errorText(end.error, tErrors)}</Alert> : null}
        <AddMembershipForm member={member} adding={adding} units={units} />
        {adding.positions.length ? <GivePositionForm member={member} adding={adding} /> : null}
      </div>
    </Card>
  );
}

function AddMembershipForm({
  member,
  adding,
  units,
}: {
  member: MemberManage;
  adding: MemberAdding;
  units: OrgUnit[];
}) {
  const t = useTranslations("Directory");
  const tMember = useTranslations("Member");
  const tErrors = useTranslations("Errors");
  const refresh = useRefresh(member.id);
  const [unitId, setUnitId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [level, setLevel] = useState<"main" | "junior">("main");
  const allowed = units
    .filter((unit) => adding.unit_ids.includes(unit.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const unit = allowed.find((item) => String(item.id) === unitId);
  const roles = unit ? adding.roles.filter((item) => item.scope === scopeOfUnit(unit.type)) : [];
  const role = roles.find((item) => String(item.id) === roleId);

  const add = useMutation({
    mutationFn: (body: MembershipAdd) => addMembership(member.id, body),
    onSuccess: async (changed) => {
      setUnitId("");
      setRoleId("");
      await refresh(changed);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate({
      org_unit_id: Number(unitId),
      role_id: Number(roleId),
      member_level: role?.is_leadership ? null : level,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg bg-canvas p-4" aria-label={t("editAddMembership")}>
      <p className="text-sm font-semibold text-ink">{t("editAddMembership")}</p>
      <div className="grid gap-4 sm:grid-cols-3">
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
          {allowed.map((item) => (
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
      {add.isError ? <Alert tone="error">{errorText(add.error, tErrors)}</Alert> : null}
      <Button type="submit" variant="secondary" loading={add.isPending}>
        <Plus className="size-4" aria-hidden="true" />
        {t("editAddMembershipConfirm")}
      </Button>
    </form>
  );
}

function GivePositionForm({ member, adding }: { member: MemberManage; adding: MemberAdding }) {
  const t = useTranslations("Directory");
  const tErrors = useTranslations("Errors");
  const refresh = useRefresh(member.id);
  const [positionId, setPositionId] = useState("");

  const give = useMutation({
    mutationFn: () => addMembership(member.id, { position_id: Number(positionId) }),
    onSuccess: async (changed) => {
      setPositionId("");
      await refresh(changed);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    give.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg bg-canvas p-4" aria-label={t("editGivePosition")}>
      <p className="text-sm font-semibold text-ink">{t("editGivePosition")}</p>
      <PositionField
        positions={adding.positions}
        value={positionId}
        onChange={setPositionId}
        label={t("positionLabel")}
      />
      {give.isError ? <Alert tone="error">{errorText(give.error, tErrors)}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={!positionId} loading={give.isPending}>
        <Plus className="size-4" aria-hidden="true" />
        {t("editGivePositionConfirm")}
      </Button>
    </form>
  );
}
