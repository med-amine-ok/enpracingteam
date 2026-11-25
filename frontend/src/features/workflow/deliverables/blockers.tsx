"use client";

import { OctagonAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { BlockerStatusBadge, ImpactBadge, SeverityBadge } from "../badges";
import {
  BLOCKER_IMPACTS,
  BLOCKER_ORIGINS,
  BLOCKER_SEVERITIES,
  reportBlocker,
  type Blocker,
  type BlockerImpact,
  type BlockerOrigin,
  type BlockerSeverity,
  type DeliverableDetail,
} from "../api";
import { endName } from "./dependencies";
import { ConfirmDialog, TextArea, memberName, useDates, useWorkMutation } from "./shared";

/** The actual obstacles on this Deliverable (guide §10): they never change its workflow status. */
export function Blockers({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const [reporting, setReporting] = useState(false);
  const blockers = [...deliverable.blockers].sort((a, b) => b.reported_at.localeCompare(a.reported_at));
  return (
    <Card
      title={t("blockersTitle")}
      action={
        deliverable.rights.report_blocker ? (
          <Button variant="secondary" size="sm" onClick={() => setReporting(true)}>
            <OctagonAlert className="size-4" aria-hidden="true" />
            {t("blockerReport")}
          </Button>
        ) : null
      }
    >
      {blockers.length === 0 ? <p className="text-sm text-muted">{t("blockersNone")}</p> : null}
      <ul className="space-y-3">
        {blockers.map((blocker) => (
          <BlockerItem key={blocker.id} deliverable={deliverable} blocker={blocker} />
        ))}
      </ul>
      {reporting ? <ReportBlocker deliverable={deliverable} onClose={() => setReporting(false)} /> : null}
    </Card>
  );
}

function BlockerItem({ deliverable, blocker }: { deliverable: DeliverableDetail; blocker: Blocker }) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const { moment } = useDates();
  const milestone = deliverable.milestones.find((item) => item.id === blocker.milestone);
  const link = deliverable.dependencies.prerequisites.find((item) => item.id === blocker.dependency_link);
  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={blocker.severity} />
        {blocker.status ? <BlockerStatusBadge status={blocker.status} /> : null}
        {blocker.impact ? <ImpactBadge impact={blocker.impact} /> : null}
        {blocker.origin ? <Badge tone="neutral">{tWorkflow(`origin.${blocker.origin}`)}</Badge> : null}
      </div>
      <p dir="auto" className="text-sm whitespace-pre-line text-ink">
        {blocker.description}
      </p>
      {blocker.required_action ? (
        <p dir="auto" className="text-xs text-muted">
          {t("pair", { label: t("requiredAction"), value: blocker.required_action })}
        </p>
      ) : null}
      {milestone ? (
        <p className="text-xs text-muted">{t("pair", { label: t("contextMilestone"), value: milestone.title })}</p>
      ) : null}
      {link ? (
        <p className="text-xs text-muted">
          {t("pair", { label: t("relatedDependency"), value: endName(link.prerequisite) })}
        </p>
      ) : null}
      <p className="text-xs text-muted">
        {t("reportedBy", { name: memberName(blocker.reported_by) || t("someone"), date: moment(blocker.reported_at) })}
        {blocker.responsible_unit ? ` · ${blocker.responsible_unit.name}` : ""}
      </p>
      {blocker.resolution_note ? (
        <p dir="auto" className="text-xs text-ink italic">
          {blocker.resolution_note}
        </p>
      ) : null}
    </li>
  );
}

function ReportBlocker({ deliverable, onClose }: { deliverable: DeliverableDetail; onClose: () => void }) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const [origin, setOrigin] = useState<BlockerOrigin>("technical");
  const [severity, setSeverity] = useState<BlockerSeverity>("medium");
  const [impact, setImpact] = useState<BlockerImpact>("partial");
  const [description, setDescription] = useState("");
  const [requiredAction, setRequiredAction] = useState("");
  const [milestone, setMilestone] = useState("");
  const [link, setLink] = useState("");
  const report = useWorkMutation(
    () =>
      reportBlocker({
        deliverable: deliverable.id,
        origin,
        severity,
        impact,
        description: description.trim(),
        required_action: requiredAction.trim(),
        milestone: milestone ? Number(milestone) : null,
        dependency_link: link ? Number(link) : null,
      }),
    onClose,
  );
  const milestones = deliverable.milestones.filter((item) => !item.is_cancelled);
  const links = deliverable.dependencies.prerequisites.filter((item) => item.state !== "cancelled");
  return (
    <ConfirmDialog
      title={t("blockerReportTitle")}
      confirm={t("blockerReport")}
      pending={report.isPending}
      error={report.error}
      disabled={!description.trim()}
      onConfirm={() => report.mutate()}
      onClose={onClose}
    >
      <p className="text-xs text-muted">{t("blockerReportHint")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label={t("origin")}
          value={origin}
          onChange={(event) => setOrigin(event.target.value as BlockerOrigin)}
        >
          {BLOCKER_ORIGINS.map((value) => (
            <option key={value} value={value}>
              {tWorkflow(`origin.${value}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("severity")}
          value={severity}
          onChange={(event) => setSeverity(event.target.value as BlockerSeverity)}
        >
          {BLOCKER_SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {tWorkflow(`severity.${value}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("impact")}
          value={impact}
          onChange={(event) => setImpact(event.target.value as BlockerImpact)}
        >
          {BLOCKER_IMPACTS.map((value) => (
            <option key={value} value={value}>
              {tWorkflow(`impact.${value}`)}
            </option>
          ))}
        </SelectField>
      </div>
      <TextArea label={t("blockerDescription")} value={description} onChange={setDescription} required />
      <TextArea label={t("requiredAction")} value={requiredAction} onChange={setRequiredAction} rows={2} />
      {milestones.length > 0 ? (
        <SelectField
          label={t("contextMilestoneOptional")}
          value={milestone}
          onChange={(event) => setMilestone(event.target.value)}
        >
          <option value="">{t("none")}</option>
          {milestones.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </SelectField>
      ) : null}
      {links.length > 0 ? (
        <SelectField
          label={t("relatedDependencyOptional")}
          value={link}
          onChange={(event) => setLink(event.target.value)}
        >
          <option value="">{t("none")}</option>
          {links.map((item) => (
            <option key={item.id} value={item.id}>
              {endName(item.prerequisite)}
            </option>
          ))}
        </SelectField>
      ) : null}
    </ConfirmDialog>
  );
}
