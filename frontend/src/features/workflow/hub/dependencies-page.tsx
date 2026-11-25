"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { useOrgUnits } from "@/features/members/use-members";
import { Link } from "@/i18n/navigation";
import {
  cancelDependency,
  decideDependencyProposal,
  fetchDependencies,
  fetchDependencyProposals,
  manualRelease,
  type DependencyLink,
  type DependencyProposal,
} from "../api";
import { DeliverableStatusBadge } from "../badges";
import { refreshWorkflow, useDependencies, workflowKeys } from "../queries";
import { WorkflowHeader } from "../workflow-header";
import { ActionPanel, Detail, Empty, TextArea, personName, useDates } from "./parts";

type LinkEnd = DependencyLink["prerequisite"];
type StateFilter = "all" | "waiting" | "released";
type DependencyQuery = NonNullable<Parameters<typeof fetchDependencies>[0]>;

const STATE_TONES = {
  waiting: "warning",
  released: "success",
  informational: "neutral",
  cancelled: "neutral",
} as const;

/** The department units, for the filters. */
export function useDepartments() {
  const units = useOrgUnits();
  return useMemo(
    () =>
      (units.data ?? [])
        .filter((unit) => unit.type === "fs_department" || unit.type === "club_department")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [units.data],
  );
}

/** The dependency links between Deliverables (front guide §9), and the proposals the viewer may decide. */
export function DependenciesPage() {
  const t = useTranslations("WorkHub");
  const departments = useDepartments();
  const [state, setState] = useState<StateFilter>("all");
  const [department, setDepartment] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const cancelledId = useId();
  // The list's filters (deliverable, work_order, department, state, all) are not in the generated schema.
  const filters = {
    ...(state !== "all" ? { state } : {}),
    ...(department ? { department: Number(department) } : {}),
    ...(cancelled ? { all: 1 } : {}),
  } as unknown as DependencyQuery;
  const links = useDependencies(filters);
  const names = useMemo(() => new Map(departments.map((unit) => [unit.id, unit.name])), [departments]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <WorkflowHeader current="dependencies" description={t("dependencies.intro")} />
      <ProposalsToDecide />
      <Card title={t("dependencies.links")}>
        <div className="mb-5 flex flex-wrap items-end gap-4">
          <Segmented
            label={t("dependencies.stateFilter")}
            value={state}
            onChange={setState}
            options={[
              { value: "all", label: t("all") },
              { value: "waiting", label: t("dependencies.waiting") },
              { value: "released", label: t("dependencies.released") },
            ]}
          />
          <div className="w-56">
            <SelectField
              label={t("department")}
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
            >
              <option value="">{t("allDepartments")}</option>
              {departments.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </SelectField>
          </div>
          <label htmlFor={cancelledId} className="flex h-11 items-center gap-2 text-sm text-ink">
            <input
              id={cancelledId}
              type="checkbox"
              checked={cancelled}
              onChange={(event) => setCancelled(event.target.checked)}
              className="size-4 accent-navy"
            />
            {t("dependencies.includeCancelled")}
          </label>
        </div>
        {links.isError ? (
          <LoadError error={links.error} />
        ) : !links.data ? (
          <LinesPlaceholder lines={4} />
        ) : links.data.length === 0 ? (
          <Empty>{t("dependencies.empty")}</Empty>
        ) : (
          <ul className="space-y-4">
            {links.data.map((link) => (
              <LinkCard key={link.id} link={link} departments={names} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** prerequisite → dependent, each linking to its Deliverable. */
function Ends({
  prerequisite,
  dependent,
  departments,
}: {
  prerequisite: LinkEnd;
  dependent: LinkEnd;
  departments: Map<number, string>;
}) {
  const t = useTranslations("WorkHub");
  return (
    <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
      <End end={prerequisite} label={t("dependencies.prerequisite")} departments={departments} />
      <ArrowRight className="mx-auto size-5 text-muted rtl:rotate-180" aria-hidden="true" />
      <End end={dependent} label={t("dependencies.dependent")} departments={departments} />
    </div>
  );
}

function End({ end, label, departments }: { end: LinkEnd; label: string; departments: Map<number, string> }) {
  const department = departments.get(end.work_order.department);
  return (
    <div className="min-w-0 space-y-1 rounded-lg border border-line bg-canvas p-3">
      <p className="text-2xs font-bold tracking-widest text-muted uppercase">{label}</p>
      <Link href={`/work/deliverables/${end.id}`} dir="auto" className="block font-semibold text-ink hover:text-racing">
        {[end.code, end.title].filter(Boolean).join(" · ")}
      </Link>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {end.status ? <DeliverableStatusBadge status={end.status} /> : null}
        {end.work_order.code ? <span dir="auto">{end.work_order.code}</span> : null}
        {department ? <span dir="auto">{department}</span> : null}
      </div>
    </div>
  );
}

function LinkCard({ link, departments }: { link: DependencyLink; departments: Map<number, string> }) {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const { moment } = useDates();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<null | "release" | "cancel">(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    setMode(null);
    setReason("");
    setConfirming(false);
  };
  const release = useMutation({
    mutationFn: () => manualRelease(link.id, reason.trim()),
    onSuccess: async () => {
      close();
      await refreshWorkflow(queryClient);
    },
  });
  const cancel = useMutation({
    mutationFn: () => cancelDependency(link.id, reason.trim()),
    onSuccess: async () => {
      close();
      await refreshWorkflow(queryClient);
    },
  });
  const condition = link.release_condition ?? "validated";
  const conditionText =
    condition === "milestone_completed" && link.release_milestone
      ? `${tWorkflow("releaseCondition.milestone_completed")} : ${link.release_milestone.title}`
      : tWorkflow(`releaseCondition.${condition}`);
  const open = (next: "release" | "cancel") => {
    release.reset();
    cancel.reset();
    setReason("");
    setConfirming(false);
    setMode(next);
  };

  return (
    <li className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="info">{tWorkflow(`dependencyType.${link.link_type}`)}</Badge>
        <Badge tone={STATE_TONES[link.state]}>{tWorkflow(`linkState.${link.state}`)}</Badge>
        <Badge tone={link.link_status === "active" ? "success" : "neutral"}>
          {t(`dependencies.linkStatus.${link.link_status}`)}
        </Badge>
        {link.manually_released ? <Badge tone="strong">{t("dependencies.manuallyReleased")}</Badge> : null}
      </div>
      <Ends prerequisite={link.prerequisite} dependent={link.dependent} departments={departments} />
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Detail label={t("dependencies.condition")}>{conditionText}</Detail>
        <Detail label={t("dependencies.created")}>
          {t("byOn", { name: personName(link.created_by) || tWorkflow("system"), date: moment(link.created_at) })}
        </Detail>
        {link.approved_by && link.approved_at ? (
          <Detail label={t("dependencies.approved")}>
            {t("byOn", { name: personName(link.approved_by), date: moment(link.approved_at) })}
          </Detail>
        ) : null}
        {link.released_at ? <Detail label={t("dependencies.releasedAt")}>{moment(link.released_at)}</Detail> : null}
        {link.manually_released && link.manual_release_at ? (
          <Detail label={t("dependencies.manualRelease")}>
            {t("byOn", { name: personName(link.manual_release_by), date: moment(link.manual_release_at) })}
            {link.manual_release_reason ? <span className="block text-muted">{link.manual_release_reason}</span> : null}
          </Detail>
        ) : null}
        {link.cancelled_at ? (
          <Detail label={t("dependencies.cancelledAt")}>
            {moment(link.cancelled_at)}
            {link.cancel_reason ? <span className="block text-muted">{link.cancel_reason}</span> : null}
          </Detail>
        ) : null}
        {link.reason ? <Detail label={t("reason")}>{link.reason}</Detail> : null}
      </dl>
      {mode === null && (link.rights.manual_release || link.rights.cancel) ? (
        <div className="flex flex-wrap gap-2">
          {link.rights.manual_release ? (
            <Button size="sm" onClick={() => open("release")}>
              {t("dependencies.release")}
            </Button>
          ) : null}
          {link.rights.cancel ? (
            <Button size="sm" variant="secondary" onClick={() => open("cancel")}>
              {t("dependencies.cancel")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {mode === "release" ? (
        <ActionPanel
          title={t("dependencies.releaseTitle")}
          confirm={confirming ? t("dependencies.releaseConfirm") : t("dependencies.releaseNext")}
          pending={release.isPending}
          disabled={!reason.trim()}
          error={release.error}
          onSubmit={() => (confirming ? release.mutate() : setConfirming(true))}
          onClose={close}
        >
          <p className="text-sm text-ink">{t("dependencies.unmet", { condition: conditionText })}</p>
          <TextArea label={t("reasonRequired")} value={reason} onChange={setReason} required disabled={confirming} />
          {confirming ? (
            <div role="alertdialog" aria-label={t("dependencies.confirmTitle")}>
              <Alert tone="warning">
                <p className="font-semibold">{t("dependencies.confirmTitle")}</p>
                <p>{t("dependencies.permanent")}</p>
              </Alert>
            </div>
          ) : null}
        </ActionPanel>
      ) : null}
      {mode === "cancel" ? (
        <ActionPanel
          title={t("dependencies.cancelTitle")}
          confirm={t("dependencies.cancelConfirm")}
          pending={cancel.isPending}
          disabled={!reason.trim()}
          error={cancel.error}
          onSubmit={() => cancel.mutate()}
          onClose={close}
        >
          <p className="text-sm text-muted">{t("dependencies.cancelHint")}</p>
          <TextArea label={t("reasonRequired")} value={reason} onChange={setReason} required />
        </ActionPanel>
      ) : null}
    </li>
  );
}

/** The pending dependency proposals a Head of an involved department decides (one involved Head suffices). */
function ProposalsToDecide() {
  const t = useTranslations("WorkHub");
  const departments = useDepartments();
  const names = useMemo(() => new Map(departments.map((unit) => [unit.id, unit.name])), [departments]);
  const proposals = useQuery({
    queryKey: [...workflowKeys.all, "dependency-proposals", "pending_review"],
    queryFn: () => fetchDependencyProposals("pending_review"),
  });
  const toDecide = (proposals.data ?? []).filter((proposal) => proposal.can_decide);
  if (proposals.isError) {
    return <LoadError error={proposals.error} />;
  }
  if (toDecide.length === 0) {
    return null;
  }
  return (
    <Card title={t("dependencies.proposals")} description={t("dependencies.proposalsIntro")}>
      <ul className="space-y-4">
        {toDecide.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} departments={names} />
        ))}
      </ul>
    </Card>
  );
}

function ProposalCard({ proposal, departments }: { proposal: DependencyProposal; departments: Map<number, string> }) {
  const t = useTranslations("WorkHub");
  const tWorkflow = useTranslations("Workflow");
  const { moment } = useDates();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<null | "approve" | "reject">(null);
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (approve: boolean) => decideDependencyProposal(proposal.id, approve, note.trim()),
    onSuccess: async () => {
      setMode(null);
      setNote("");
      await refreshWorkflow(queryClient);
    },
  });
  const open = (next: "approve" | "reject") => {
    decide.reset();
    setNote("");
    setMode(next);
  };
  return (
    <li className="space-y-3 rounded-lg border border-dashed border-line p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="warning">{tWorkflow("proposal")}</Badge>
        {proposal.proposed_link_type ? (
          <Badge tone="info">{tWorkflow(`dependencyType.${proposal.proposed_link_type}`)}</Badge>
        ) : null}
        {proposal.proposed_release_condition ? (
          <Badge tone="neutral">{tWorkflow(`releaseCondition.${proposal.proposed_release_condition}`)}</Badge>
        ) : null}
      </div>
      <Ends
        prerequisite={proposal.proposed_prerequisite}
        dependent={proposal.proposed_dependent}
        departments={departments}
      />
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Detail label={t("dependencies.proposedBy")}>
          {t("byOn", { name: personName(proposal.proposed_by), date: moment(proposal.created_at) })}
        </Detail>
        {proposal.justification ? <Detail label={t("reason")}>{proposal.justification}</Detail> : null}
      </dl>
      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => open("approve")}>
            {t("approve")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => open("reject")}>
            {t("reject")}
          </Button>
        </div>
      ) : (
        <ActionPanel
          title={mode === "approve" ? t("dependencies.approveTitle") : t("dependencies.rejectTitle")}
          confirm={mode === "approve" ? t("approve") : t("reject")}
          pending={decide.isPending}
          disabled={mode === "reject" && !note.trim()}
          error={decide.error}
          onSubmit={() => decide.mutate(mode === "approve")}
          onClose={() => setMode(null)}
        >
          {mode === "approve" ? (
            <p className="flex items-start gap-2 text-sm text-muted">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t("dependencies.approveHint")}
            </p>
          ) : null}
          <TextArea
            label={mode === "reject" ? t("noteRequired") : t("noteOptional")}
            value={note}
            onChange={setNote}
            required={mode === "reject"}
          />
        </ActionPanel>
      )}
    </li>
  );
}
