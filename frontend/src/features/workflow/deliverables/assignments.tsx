"use client";

import { UserMinus, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { useMembers } from "@/features/members/use-members";
import {
  assignMember,
  setAssignmentRole,
  unassign,
  type Assignment,
  type AssignmentRole,
  type DeliverableDetail,
} from "../api";
import { ConfirmDialog, MutationError, Panel, PanelButtons, TextArea, memberName, useWorkMutation } from "./shared";

const ROLES: AssignmentRole[] = ["member", "lead"];

/** The assigned members (equal credit, no individual share); the Head assigns, changes roles and unassigns. */
export function Assignments({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const [adding, setAdding] = useState(false);
  const active = deliverable.assignments.filter((assignment) => assignment.is_active !== false);
  const canAssign = deliverable.rights.assign;
  return (
    <Card
      title={t("assignmentsTitle")}
      action={
        canAssign && !adding ? (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" aria-hidden="true" />
            {t("assign")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-3">
        {adding ? <AssignForm deliverable={deliverable} onClose={() => setAdding(false)} /> : null}
        {active.length === 0 ? <p className="text-sm text-muted">{t("assignmentsNone")}</p> : null}
        <ul className="space-y-2">
          {active.map((assignment) => (
            <AssignmentRow key={assignment.id} assignment={assignment} canAssign={canAssign} />
          ))}
        </ul>
      </div>
    </Card>
  );
}

function AssignForm({ deliverable, onClose }: { deliverable: DeliverableDetail; onClose: () => void }) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const members = useMembers();
  const [member, setMember] = useState("");
  const [role, setRole] = useState<AssignmentRole>("member");
  const taken = new Set(deliverable.assignments.filter((a) => a.is_active !== false).map((a) => a.member.id));
  const people = useMemo(
    () =>
      (members.data ?? [])
        .filter((item) => item.status !== "alumni")
        .sort((a, b) => memberName(a).localeCompare(memberName(b))),
    [members.data],
  );
  const assign = useWorkMutation(() => assignMember(deliverable.id, Number(member), role), onClose);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (member && !assign.isPending) {
      assign.mutate();
    }
  }
  return (
    <Panel title={t("assignTitle")} onSubmit={submit}>
      <MutationError error={assign.error} />
      <SelectField label={t("member")} value={member} onChange={(event) => setMember(event.target.value)}>
        <option value="">{t("choose")}</option>
        {people
          .filter((item) => !taken.has(item.id))
          .map((item) => (
            <option key={item.id} value={item.id}>
              {memberName(item)}
            </option>
          ))}
      </SelectField>
      <SelectField label={t("role")} value={role} onChange={(event) => setRole(event.target.value as AssignmentRole)}>
        {ROLES.map((value) => (
          <option key={value} value={value}>
            {tWorkflow(`assignmentRole.${value}`)}
          </option>
        ))}
      </SelectField>
      <PanelButtons confirm={t("assign")} pending={assign.isPending} disabled={!member} onClose={onClose} />
    </Panel>
  );
}

function AssignmentRow({ assignment, canAssign }: { assignment: Assignment; canAssign: boolean }) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  const role = assignment.role ?? "member";
  const changeRole = useWorkMutation((next: AssignmentRole) => setAssignmentRole(assignment.id, next));
  const remove = useWorkMutation(
    () => unassign(assignment.id, reason.trim()),
    () => setRemoving(false),
  );
  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Avatar
          firstName={assignment.member.first_name}
          lastName={assignment.member.last_name}
          seed={assignment.member.id}
          size="sm"
        />
        <span className="min-w-0 flex-1 text-sm text-ink">{memberName(assignment.member)}</span>
        {canAssign ? (
          <select
            aria-label={t("roleOf", { name: memberName(assignment.member) })}
            value={role}
            disabled={changeRole.isPending}
            onChange={(event) => changeRole.mutate(event.target.value as AssignmentRole)}
            className="h-9 rounded-md border border-line bg-surface px-2 text-xs text-ink"
          >
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {tWorkflow(`assignmentRole.${value}`)}
              </option>
            ))}
          </select>
        ) : (
          <Badge tone={role === "lead" ? "info" : "neutral"}>{tWorkflow(`assignmentRole.${role}`)}</Badge>
        )}
        {canAssign ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("unassignOf", { name: memberName(assignment.member) })}
            onClick={() => {
              setReason("");
              remove.reset();
              setRemoving(true);
            }}
          >
            <UserMinus className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <MutationError error={changeRole.error} />
      {removing ? (
        <ConfirmDialog
          title={t("unassignTitle", { name: memberName(assignment.member) })}
          confirm={t("unassign")}
          pending={remove.isPending}
          error={remove.error}
          disabled={!reason.trim()}
          onConfirm={() => remove.mutate()}
          onClose={() => setRemoving(false)}
        >
          <p>{t("unassignHint")}</p>
          <TextArea label={t("reason")} value={reason} onChange={setReason} required rows={2} />
        </ConfirmDialog>
      ) : null}
    </li>
  );
}
