"use client";

import { CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { ReliefStatusBadge } from "../badges";
import { claimRelief, decideRelief, type DeliverableDetail, type ReliefInterval } from "../api";
import { endName } from "./dependencies";
import {
  CheckField,
  ConfirmDialog,
  Detail,
  MutationError,
  Panel,
  PanelButtons,
  TextArea,
  memberName,
  today,
  useDates,
  useWorkMutation,
} from "./shared";

/**
 * Deadline relief (guide §10.3): the assigned members claim a period their work was genuinely prevented, the
 * Head verifies it (whole calendar days, all or nothing) or rejects it. Only the backend's effective deadline
 * is shown: nothing is computed here.
 */
export function Relief({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const [claiming, setClaiming] = useState(false);
  const claims = deliverable.relief;
  if (claims.length === 0 && !deliverable.rights.claim_relief) {
    return null;
  }
  return (
    <Card
      title={t("reliefTitle")}
      description={t("reliefIntro")}
      action={
        deliverable.rights.claim_relief && !claiming ? (
          <Button variant="secondary" size="sm" onClick={() => setClaiming(true)}>
            <CalendarClock className="size-4" aria-hidden="true" />
            {t("reliefClaim")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        {claiming ? <ClaimForm deliverable={deliverable} onClose={() => setClaiming(false)} /> : null}
        {claims.length === 0 && !claiming ? <p className="text-sm text-muted">{t("reliefNone")}</p> : null}
        <ul className="space-y-3">
          {claims.map((claim) => (
            <ClaimItem key={claim.id} deliverable={deliverable} claim={claim} />
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** What was blocking: a `blocks` prerequisite of this Deliverable or one of its blockers. */
function useSources(deliverable: DeliverableDetail) {
  const links = deliverable.dependencies.prerequisites.filter(
    (link) => link.link_type === "blocks" && link.state !== "cancelled",
  );
  return {
    links,
    blockers: deliverable.blockers,
    linkName: (id: number | null | undefined) => {
      const link = deliverable.dependencies.prerequisites.find((item) => item.id === id);
      return link ? endName(link.prerequisite) : null;
    },
    blockerName: (id: number | null | undefined) => deliverable.blockers.find((item) => item.id === id)?.description,
  };
}

function ClaimForm({ deliverable, onClose }: { deliverable: DeliverableDetail; onClose: () => void }) {
  const t = useTranslations("Deliverables");
  const sources = useSources(deliverable);
  const [source, setSource] = useState("");
  const [neededAt, setNeededAt] = useState("");
  const [preventedFrom, setPreventedFrom] = useState("");
  const [releasedOn, setReleasedOn] = useState("");
  const [impact, setImpact] = useState("");
  const [teamReady, setTeamReady] = useState(false);
  const [directlyPrevented, setDirectlyPrevented] = useState(false);
  const [kind, id] = source.split(":");
  const orderOk = !releasedOn || !preventedFrom || releasedOn >= preventedFrom;
  const valid = !!source && !!neededAt && !!preventedFrom && !!impact.trim() && orderOk;
  const claim = useWorkMutation(
    () =>
      claimRelief(deliverable.id, {
        dependency_link: kind === "link" ? Number(id) : null,
        blocker: kind === "blocker" ? Number(id) : null,
        needed_at: neededAt,
        waiting_started_at: preventedFrom,
        released_at: releasedOn || null,
        impact_description: impact.trim(),
        team_ready: teamReady,
        directly_prevented: directlyPrevented,
      }),
    onClose,
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && !claim.isPending) {
      claim.mutate();
    }
  }
  return (
    <Panel title={t("reliefClaimTitle")} description={t("reliefClaimHint")} onSubmit={submit}>
      <MutationError error={claim.error} />
      <SelectField label={t("reliefSource")} value={source} onChange={(event) => setSource(event.target.value)}>
        <option value="">{t("choose")}</option>
        {sources.links.length > 0 ? (
          <optgroup label={t("reliefSourceLinks")}>
            {sources.links.map((link) => (
              <option key={link.id} value={`link:${link.id}`}>
                {endName(link.prerequisite)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {sources.blockers.length > 0 ? (
          <optgroup label={t("reliefSourceBlockers")}>
            {sources.blockers.map((blocker) => (
              <option key={blocker.id} value={`blocker:${blocker.id}`}>
                {blocker.description.slice(0, 80)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </SelectField>
      {sources.links.length === 0 && sources.blockers.length === 0 ? (
        <p className="text-xs text-muted">{t("reliefNoSource")}</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label={t("neededOn")}
          type="date"
          valueDir="ltr"
          value={neededAt}
          onChange={(event) => setNeededAt(event.target.value)}
        />
        <TextField
          label={t("preventedFrom")}
          type="date"
          valueDir="ltr"
          value={preventedFrom}
          onChange={(event) => setPreventedFrom(event.target.value)}
        />
        <TextField
          label={t("releasedOn")}
          type="date"
          valueDir="ltr"
          max={today()}
          value={releasedOn}
          aria-invalid={!orderOk || undefined}
          onChange={(event) => setReleasedOn(event.target.value)}
        />
      </div>
      {!orderOk ? <p className="text-xs text-racing">{t("releasedBeforePrevented")}</p> : null}
      <TextArea label={t("impactDescription")} value={impact} onChange={setImpact} required />
      <CheckField label={t("teamReady")} checked={teamReady} onChange={setTeamReady} />
      <CheckField label={t("directlyPrevented")} checked={directlyPrevented} onChange={setDirectlyPrevented} />
      <PanelButtons confirm={t("reliefClaim")} pending={claim.isPending} disabled={!valid} onClose={onClose} />
    </Panel>
  );
}

function ClaimItem({ deliverable, claim }: { deliverable: DeliverableDetail; claim: ReliefInterval }) {
  const t = useTranslations("Deliverables");
  const { day, moment } = useDates();
  const sources = useSources(deliverable);
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [start, setStart] = useState(claim.waiting_started_at);
  const [end, setEnd] = useState(claim.released_at ?? "");
  const [note, setNote] = useState("");
  const close = () => setMode(null);
  const decide = useWorkMutation(
    (approve: boolean) =>
      decideRelief(
        claim.id,
        approve
          ? { approve, approved_start: start, approved_end: end, note: note.trim() }
          : { approve, note: note.trim() },
      ),
    close,
  );
  const source = claim.dependency_link
    ? sources.linkName(claim.dependency_link)
    : claim.blocker
      ? sources.blockerName(claim.blocker)
      : null;
  const canDecide = deliverable.rights.decide_relief && claim.status === "claimed";
  const periodOk = !!start && !!end && end >= start;
  function open(next: "approve" | "reject") {
    setStart(claim.waiting_started_at);
    setEnd(claim.released_at ?? "");
    setNote("");
    decide.reset();
    setMode(next);
  }
  return (
    <li className="space-y-3 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ReliefStatusBadge status={claim.status} />
        {source ? (
          <bdi dir="auto" className="min-w-0 truncate text-sm text-ink">
            {source}
          </bdi>
        ) : null}
      </div>
      <dl className="grid gap-2 sm:grid-cols-3">
        <Detail label={t("neededOn")}>{day(claim.needed_at)}</Detail>
        <Detail label={t("preventedFrom")}>{day(claim.waiting_started_at)}</Detail>
        <Detail label={t("releasedOn")}>{claim.released_at ? day(claim.released_at) : t("notYet")}</Detail>
      </dl>
      <p dir="auto" className="text-sm whitespace-pre-line text-ink">
        {claim.impact_description}
      </p>
      <ul className="space-y-0.5 text-xs text-muted">
        <li>{t(claim.team_ready ? "teamReadyYes" : "teamReadyNo")}</li>
        <li>{t(claim.directly_prevented ? "directlyPreventedYes" : "directlyPreventedNo")}</li>
        <li>
          {t("claimedBy", { name: memberName(claim.claimed_by) || t("someone"), date: moment(claim.claimed_at) })}
        </li>
      </ul>
      {claim.status !== "claimed" ? (
        <div className="space-y-1 rounded-md bg-canvas p-2 text-xs text-ink">
          {claim.status === "approved" && claim.approved_start && claim.approved_end ? (
            <p>
              {t("approvedPeriod", {
                start: day(claim.approved_start),
                end: day(claim.approved_end),
                days: claim.approved_days,
              })}
            </p>
          ) : null}
          <p className="text-muted">
            {t("decidedBy", { name: memberName(claim.decided_by) || t("someone"), date: moment(claim.decided_at) })}
          </p>
          {claim.decision_note ? (
            <p dir="auto" className="italic">
              {claim.decision_note}
            </p>
          ) : null}
        </div>
      ) : null}
      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => open("approve")}>
            {t("reliefApprove")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => open("reject")}>
            {t("reliefReject")}
          </Button>
        </div>
      ) : null}
      {mode === "approve" ? (
        <ConfirmDialog
          title={t("reliefApproveTitle")}
          confirm={t("reliefApprove")}
          pending={decide.isPending}
          error={decide.error}
          disabled={!periodOk}
          onConfirm={() => decide.mutate(true)}
          onClose={close}
        >
          <Alert tone="info">{t("reliefApproveHint")}</Alert>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t("verifiedStart")}
              type="date"
              valueDir="ltr"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
            <TextField
              label={t("verifiedEnd")}
              type="date"
              valueDir="ltr"
              value={end}
              aria-invalid={(!!end && !periodOk) || undefined}
              onChange={(event) => setEnd(event.target.value)}
            />
          </div>
          <TextArea label={t("decisionNote")} value={note} onChange={setNote} rows={2} />
        </ConfirmDialog>
      ) : null}
      {mode === "reject" ? (
        <ConfirmDialog
          title={t("reliefRejectTitle")}
          confirm={t("reliefReject")}
          pending={decide.isPending}
          error={decide.error}
          disabled={!note.trim()}
          onConfirm={() => decide.mutate(false)}
          onClose={close}
        >
          <TextArea label={t("decisionNote")} value={note} onChange={setNote} rows={2} required />
        </ConfirmDialog>
      ) : null}
    </li>
  );
}
