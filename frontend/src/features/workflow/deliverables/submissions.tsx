"use client";

import { ExternalLink, Flag, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { DeliverableStatusBadge } from "../badges";
import {
  EVIDENCE_TYPES,
  REVISION_SEVERITIES,
  reviewSubmission,
  submitDeliverable,
  type DeliverableDetail,
  type EvidenceType,
  type ReviewBody,
  type RevisionSeverity,
  type Submission,
} from "../api";
import {
  CheckField,
  ConfirmDialog,
  Detail,
  MutationError,
  Panel,
  TextArea,
  memberName,
  safeUrl,
  useDates,
  useWorkMutation,
} from "./shared";

/** Submission history (guide §11.4–11.5): each round with its evidence and its single review. */
export function Submissions({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const { moment } = useDates();
  const rounds = [...deliverable.submissions].sort((a, b) => b.submission_number - a.submission_number);
  const waiting = deliverable.status === "submitted" && !deliverable.rights.review;
  return (
    <Card title={t("submissionsTitle")}>
      <div className="space-y-4">
        {deliverable.first_complete_submission_at ? (
          <p className="text-sm text-ink">
            <Flag className="me-1.5 inline size-4 text-racing" aria-hidden="true" />
            {t("firstCompleteAt", { date: moment(deliverable.first_complete_submission_at) })}
          </p>
        ) : null}
        {waiting ? <Alert tone="info">{t("awaitingReview")}</Alert> : null}
        {rounds.length === 0 ? <p className="text-sm text-muted">{t("submissionsNone")}</p> : null}
        {rounds.length > 0 ? (
          <ol className="space-y-4">
            {rounds.map((submission) => (
              <SubmissionItem key={submission.id} submission={submission} />
            ))}
          </ol>
        ) : null}
      </div>
    </Card>
  );
}

function SubmissionItem({ submission }: { submission: Submission }) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const { moment } = useDates();
  const review = submission.review;
  return (
    <li className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">
          {t("submissionNumber", { number: submission.submission_number })}
        </span>
        <Badge tone={submission.is_complete ? "info" : "neutral"}>
          {t(submission.is_complete ? "submissionComplete" : "submissionPartial")}
        </Badge>
        {submission.is_first_complete ? (
          <Badge tone="strong">
            <Flag className="size-3" aria-hidden="true" />
            {t("firstComplete")}
          </Badge>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        {t("byOn", {
          name: memberName(submission.submitted_by) || t("someone"),
          date: moment(submission.submitted_at),
        })}
      </p>
      {submission.submission_note ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {submission.submission_note}
        </p>
      ) : null}
      {submission.evidence.length > 0 ? (
        <ul className="space-y-1">
          {submission.evidence.map((item, index) => {
            const href = safeUrl(item.url);
            return (
              <li key={`${item.url}-${index}`} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="neutral">{tWorkflow(`evidenceType.${item.link_type}`)}</Badge>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-navy underline-offset-2 hover:underline"
                  >
                    <bdi dir="auto">{item.label || item.url}</bdi>
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                ) : (
                  <bdi dir="auto" className="text-ink">
                    {item.label || item.url}
                  </bdi>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted">{t("noEvidence")}</p>
      )}
      {review ? (
        <div className="space-y-2 rounded-md bg-canvas p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tracking-widest text-muted uppercase">{t("review")}</span>
            {review.decision === "validated" || review.decision === "revision_requested" ? (
              <DeliverableStatusBadge status={review.decision} />
            ) : (
              <Badge>{review.decision}</Badge>
            )}
            {review.severity ? <Badge tone="warning">{tWorkflow(`revisionSeverity.${review.severity}`)}</Badge> : null}
          </div>
          <p className="text-xs text-muted">
            {t("byOn", { name: memberName(review.reviewer) || t("someone"), date: moment(review.reviewed_at) })}
          </p>
          <dl className="grid gap-2">
            {review.issues_summary ? (
              <Detail label={t("issues")}>
                <span dir="auto" className="whitespace-pre-line">
                  {review.issues_summary}
                </span>
              </Detail>
            ) : null}
            {review.decision === "revision_requested" && review.is_attributable !== null ? (
              <Detail label={t("attribution")}>
                {t(review.is_attributable ? "attributable" : "notAttributable")}
                {!review.is_attributable && review.attribution_reason ? (
                  <span dir="auto" className="block text-muted">
                    {review.attribution_reason}
                  </span>
                ) : null}
              </Detail>
            ) : null}
            {review.review_note ? (
              <Detail label={t("reviewNote")}>
                <span dir="auto" className="whitespace-pre-line">
                  {review.review_note}
                </span>
              </Detail>
            ) : null}
          </dl>
        </div>
      ) : (
        <p className="text-xs text-muted">{t("notReviewed")}</p>
      )}
    </li>
  );
}

type EvidenceRow = { url: string; label: string; link_type: EvidenceType };
const emptyRow = (): EvidenceRow => ({ url: "", label: "", link_type: "drive" });

/** The assigned members send their work with its evidence (guide §11.4). */
export function SubmitForm({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const [rows, setRows] = useState<EvidenceRow[]>([emptyRow()]);
  const [note, setNote] = useState("");
  const [complete, setComplete] = useState(false);
  const [sent, setSent] = useState(false);
  const evidence = rows
    .filter((row) => row.url.trim())
    .map((row) => ({ url: row.url.trim(), label: row.label.trim() || row.url.trim(), link_type: row.link_type }));
  const submit = useWorkMutation(
    () => submitDeliverable(deliverable.id, { submission_note: note.trim(), evidence, declares_complete: complete }),
    () => {
      setRows([emptyRow()]);
      setNote("");
      setComplete(false);
      setSent(true);
    },
  );
  const update = (index: number, change: Partial<EvidenceRow>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));

  function send(event: FormEvent) {
    event.preventDefault();
    if (!submit.isPending) {
      submit.mutate();
    }
  }

  return (
    <Card title={t("submitTitle")} description={t("submitIntro")}>
      {deliverable.acceptance_criteria ? (
        <div className="mb-4 space-y-1 rounded-md bg-canvas p-3">
          <p className="text-xs font-semibold tracking-widest text-muted uppercase">{t("acceptanceCriteria")}</p>
          <p dir="auto" className="text-sm whitespace-pre-line text-ink">
            {deliverable.acceptance_criteria}
          </p>
        </div>
      ) : null}
      <Panel title={t("submitEvidence")} onSubmit={send}>
        <ul className="space-y-3">
          {rows.map((row, index) => (
            <li key={index} className="grid gap-2 sm:grid-cols-[2fr_1.5fr_1fr_auto] sm:items-end">
              <TextField
                label={t("evidenceUrl")}
                type="url"
                valueDir="ltr"
                value={row.url}
                placeholder="https://"
                onChange={(event) => update(index, { url: event.target.value })}
              />
              <TextField
                label={t("evidenceLabel")}
                value={row.label}
                onChange={(event) => update(index, { label: event.target.value })}
              />
              <SelectField
                label={t("evidenceType")}
                value={row.link_type}
                onChange={(event) => update(index, { link_type: event.target.value as EvidenceType })}
              >
                {EVIDENCE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {tWorkflow(`evidenceType.${value}`)}
                  </option>
                ))}
              </SelectField>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("evidenceRemove")}
                disabled={rows.length === 1}
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="secondary" size="sm" onClick={() => setRows((current) => [...current, emptyRow()])}>
          <Plus className="size-4" aria-hidden="true" />
          {t("evidenceAdd")}
        </Button>
        <TextArea label={t("submissionNote")} value={note} onChange={setNote} rows={3} />
        <CheckField label={t("declaresComplete")} checked={complete} onChange={setComplete} />
        {evidence.length === 0 || !complete ? <Alert tone="warning">{t("submitNotComplete")}</Alert> : null}
        <MutationError error={submit.error} />
        {sent && !submit.isPending ? <Alert tone="success">{t("submitted")}</Alert> : null}
        <Button type="submit" size="sm" loading={submit.isPending}>
          {t("submitConfirm")}
        </Button>
      </Panel>
    </Card>
  );
}

type Decision = "validated" | "revision_requested";

/**
 * The Head's review of the latest unreviewed submission (guide §11.5): validate, or request a revision with one
 * severity and one attribution decision for the whole round. The optional final quality mark is given only by a
 * club admin (`rights.enter_quality`): a Head who is not one validates without it.
 */
export function ReviewPanel({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const tWorkflow = useTranslations("Workflow");
  const pending = [...deliverable.submissions]
    .filter((submission) => !submission.review)
    .sort((a, b) => b.submission_number - a.submission_number)[0];
  const [decision, setDecision] = useState<Decision>("validated");
  const [quality, setQuality] = useState("");
  const [severity, setSeverity] = useState<RevisionSeverity | "">("");
  const [issues, setIssues] = useState("");
  const [attributable, setAttributable] = useState(true);
  const [attributionReason, setAttributionReason] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const review = useWorkMutation(
    (body: ReviewBody) => reviewSubmission(pending?.id ?? 0, body),
    () => setConfirming(false),
  );
  if (!pending) {
    return null;
  }
  const marks = deliverable.rights.enter_quality;
  const qualityNumber = !marks || quality.trim() === "" ? null : Number(quality);
  const qualityValid =
    qualityNumber === null || (Number.isFinite(qualityNumber) && qualityNumber >= 0 && qualityNumber <= 5);
  const valid =
    decision === "validated"
      ? qualityValid
      : !!severity && !!issues.trim() && (attributable || !!attributionReason.trim());

  function body(): ReviewBody {
    if (decision === "validated") {
      return {
        decision,
        review_note: note.trim(),
        issues_summary: "",
        is_attributable: true,
        attribution_reason: "",
        // Sent only by whoever may give it (the backend refuses it from anybody else).
        ...(marks ? { raw_quality: qualityNumber === null ? null : qualityNumber.toFixed(1) } : {}),
      };
    }
    return {
      decision,
      review_note: note.trim(),
      severity: severity || undefined,
      issues_summary: issues.trim(),
      is_attributable: attributable,
      attribution_reason: attributable ? "" : attributionReason.trim(),
    };
  }

  function open(event: FormEvent) {
    event.preventDefault();
    if (valid) {
      review.reset();
      setConfirming(true);
    }
  }

  return (
    <Card title={t("reviewTitle")} description={t("reviewIntro", { number: pending.submission_number })}>
      <Panel title={t("reviewDecision")} description={t("reviewerRule")} onSubmit={open}>
        <Segmented
          label={t("reviewDecision")}
          value={decision}
          onChange={setDecision}
          options={[
            { value: "validated", label: t("decisionValidate") },
            { value: "revision_requested", label: t("decisionRevision") },
          ]}
        />
        {decision === "validated" ? (
          marks ? (
            <div className="space-y-1">
              <TextField
                label={t("qualityMark")}
                type="number"
                inputMode="decimal"
                valueDir="ltr"
                min={0}
                max={5}
                step={0.1}
                value={quality}
                aria-invalid={!qualityValid || undefined}
                onChange={(event) => setQuality(event.target.value)}
              />
              <p className="text-xs text-muted">{t("qualityMarkHint")}</p>
            </div>
          ) : null
        ) : (
          <>
            <SelectField
              label={t("revisionSeverity")}
              required
              value={severity}
              onChange={(event) => setSeverity(event.target.value as RevisionSeverity | "")}
            >
              <option value="">{t("choose")}</option>
              {REVISION_SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {tWorkflow(`revisionSeverity.${value}`)}
                </option>
              ))}
            </SelectField>
            <p className="text-xs text-muted">{t("revisionSeverityHint")}</p>
            <TextArea label={t("issues")} value={issues} onChange={setIssues} required hint={t("issuesHint")} />
            <CheckField
              label={t("attributableLabel")}
              checked={attributable}
              onChange={setAttributable}
              hint={t("attributableHint")}
            />
            {!attributable ? (
              <TextArea
                label={t("attributionReason")}
                value={attributionReason}
                onChange={setAttributionReason}
                required
                rows={2}
              />
            ) : null}
          </>
        )}
        <TextArea label={t("reviewNote")} value={note} onChange={setNote} rows={2} />
        <Button type="submit" size="sm" disabled={!valid}>
          {t(decision === "validated" ? "decisionValidate" : "decisionRevision")}
        </Button>
      </Panel>
      {confirming ? (
        <ConfirmDialog
          title={t(decision === "validated" ? "confirmValidateTitle" : "confirmRevisionTitle")}
          confirm={t(decision === "validated" ? "decisionValidate" : "decisionRevision")}
          pending={review.isPending}
          error={review.error}
          onConfirm={() => review.mutate(body())}
          onClose={() => setConfirming(false)}
        >
          <p>{t(decision === "validated" ? "confirmValidateText" : "confirmRevisionText")}</p>
        </ConfirmDialog>
      ) : null}
      <MutationError error={confirming ? null : review.error} />
    </Card>
  );
}
