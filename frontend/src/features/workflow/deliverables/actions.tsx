"use client";

import { Ban, CheckCheck, Pencil, Play, RotateCcw, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useMembers } from "@/features/members/use-members";
import { ProposalBadge } from "../badges";
import {
  approveDeliverable,
  deliverableAction,
  updateDeliverable,
  type DeliverableChange,
  type DeliverableDetail,
} from "../api";
import {
  ConfirmDialog,
  MutationError,
  Panel,
  PanelButtons,
  TextArea,
  decimal,
  memberName,
  useWorkMutation,
} from "./shared";

/** Work Order statuses in which an official change no longer needs a reason. */
const PLANNING = new Set(["draft", "planning"]);

/** The workflow actions the backend allows this viewer (rights), each confirmed when consequential. */
export function DeliverableActions({ deliverable, onEdit }: { deliverable: DeliverableDetail; onEdit: () => void }) {
  const t = useTranslations("Deliverables");
  const { rights } = deliverable;
  const [mode, setMode] = useState<"cancel" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const close = () => setMode(null);
  const markReady = useWorkMutation(() => deliverableAction(deliverable.id, "mark-ready"));
  const start = useWorkMutation(() => deliverableAction(deliverable.id, "start"));
  const cancel = useWorkMutation(() => deliverableAction(deliverable.id, "cancel", reason.trim()), close);
  const reopen = useWorkMutation(() => deliverableAction(deliverable.id, "reopen", reason.trim()), close);
  const any = rights.mark_ready || rights.start || rights.cancel || rights.reopen || rights.edit;
  if (!any) {
    return null;
  }
  function open(next: "cancel" | "reopen") {
    setReason("");
    cancel.reset();
    reopen.reset();
    setMode(next);
  }
  const resume = deliverable.status === "revision_requested";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {rights.start ? (
          <Button size="sm" loading={start.isPending} onClick={() => start.mutate()}>
            <Play className="size-4" aria-hidden="true" />
            {t(resume ? "resume" : "start")}
          </Button>
        ) : null}
        {rights.mark_ready ? (
          <Button size="sm" loading={markReady.isPending} onClick={() => markReady.mutate()}>
            <CheckCheck className="size-4" aria-hidden="true" />
            {t("markReady")}
          </Button>
        ) : null}
        {rights.edit ? (
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
            {t("editDetails")}
          </Button>
        ) : null}
        {rights.reopen ? (
          <Button variant="secondary" size="sm" onClick={() => open("reopen")}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("reopen")}
          </Button>
        ) : null}
        {rights.cancel ? (
          <Button variant="ghost" size="sm" onClick={() => open("cancel")}>
            <Ban className="size-4" aria-hidden="true" />
            {t("cancelDeliverable")}
          </Button>
        ) : null}
      </div>
      <MutationError error={start.error ?? markReady.error} />
      {mode === "cancel" ? (
        <ConfirmDialog
          title={t("cancelTitle")}
          confirm={t("cancelDeliverable")}
          pending={cancel.isPending}
          error={cancel.error}
          disabled={!reason.trim()}
          onConfirm={() => cancel.mutate()}
          onClose={close}
        >
          <p>{t("cancelHint")}</p>
          <TextArea label={t("reason")} value={reason} onChange={setReason} required rows={2} />
        </ConfirmDialog>
      ) : null}
      {mode === "reopen" ? (
        <ConfirmDialog
          title={t("reopenTitle")}
          confirm={t("reopen")}
          pending={reopen.isPending}
          error={reopen.error}
          disabled={!reason.trim()}
          onConfirm={() => reopen.mutate()}
          onClose={close}
        >
          <p>{t("reopenHint")}</p>
          <TextArea label={t("reason")} value={reason} onChange={setReason} required rows={2} />
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

/** The official details a Head edits (a reason once the Work Order runs); a proposer edits their own proposal. */
export function EditDetails({ deliverable, onClose }: { deliverable: DeliverableDetail; onClose: () => void }) {
  const t = useTranslations("Deliverables");
  const [title, setTitle] = useState(deliverable.title);
  const [description, setDescription] = useState(deliverable.description ?? "");
  const [criteria, setCriteria] = useState(deliverable.acceptance_criteria ?? "");
  const [startDate, setStartDate] = useState(deliverable.start_date ?? "");
  const [deadline, setDeadline] = useState(deliverable.original_deadline ?? "");
  const [weight, setWeight] = useState(deliverable.weight != null ? decimal(deliverable.weight) : "");
  const [reason, setReason] = useState("");
  const official = !deliverable.proposal_status || deliverable.proposal_status === "approved";
  const needsReason = official && !PLANNING.has(deliverable.work_order.status ?? "draft");
  const valid = !!title.trim() && (!needsReason || !!reason.trim());
  const save = useWorkMutation(() => {
    const body: DeliverableChange = {
      submit: true,
      title: title.trim(),
      description: description.trim(),
      acceptance_criteria: criteria.trim(),
      start_date: startDate || null,
      original_deadline: deadline || null,
      reason: reason.trim(),
    };
    if (deliverable.weight != null && weight.trim() && decimal(weight) !== decimal(deliverable.weight)) {
      body.weight = weight.trim();
    }
    return updateDeliverable(deliverable.id, body);
  }, onClose);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && !save.isPending) {
      save.mutate();
    }
  }
  return (
    <Panel title={t("editTitle")} description={needsReason ? t("editReasonHint") : undefined} onSubmit={submit}>
      <MutationError error={save.error} />
      <TextField label={t("title")} required value={title} onChange={(event) => setTitle(event.target.value)} />
      <TextArea label={t("description")} value={description} onChange={setDescription} rows={3} />
      <TextArea label={t("acceptanceCriteria")} value={criteria} onChange={setCriteria} rows={3} />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label={t("startDate")}
          type="date"
          valueDir="ltr"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <TextField
          label={t("originalDeadline")}
          type="date"
          valueDir="ltr"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
        />
        {deliverable.weight != null ? (
          <TextField
            label={t("weight")}
            type="number"
            inputMode="decimal"
            valueDir="ltr"
            min={0}
            max={100}
            step="0.01"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
        ) : null}
      </div>
      {needsReason || official ? (
        <TextArea
          label={needsReason ? t("reason") : t("reasonOptional")}
          value={reason}
          onChange={setReason}
          rows={2}
        />
      ) : null}
      <PanelButtons confirm={t("save")} pending={save.isPending} disabled={!valid} onClose={onClose} />
    </Panel>
  );
}

/** A proposal is never shown as official work (guide §11.2): its state, and the Head's decision. */
export function ProposalBanner({ deliverable }: { deliverable: DeliverableDetail }) {
  const t = useTranslations("Deliverables");
  const status = deliverable.proposal_status;
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const close = () => setMode(null);
  const submitProposal = useWorkMutation(() => deliverableAction(deliverable.id, "submit-proposal"));
  const reject = useWorkMutation(() => deliverableAction(deliverable.id, "reject", note.trim()), close);
  if (!status || status === "approved") {
    return null;
  }
  const { rights } = deliverable;
  return (
    <Alert tone={status === "rejected" ? "error" : "warning"}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ProposalBadge status={status} />
          {deliverable.proposed_by ? (
            <span>{t("proposedBy", { name: memberName(deliverable.proposed_by) })}</span>
          ) : null}
        </div>
        <p>{t(`proposalText.${status}`)}</p>
        {deliverable.proposal_note ? (
          <p dir="auto" className="italic">
            {deliverable.proposal_note}
          </p>
        ) : null}
        <MutationError error={submitProposal.error} />
        <div className="flex flex-wrap gap-2">
          {rights.submit_proposal ? (
            <Button size="sm" loading={submitProposal.isPending} onClick={() => submitProposal.mutate()}>
              <Send className="size-4" aria-hidden="true" />
              {t("submitProposal")}
            </Button>
          ) : null}
          {rights.decide ? (
            <>
              <Button size="sm" onClick={() => setMode("approve")}>
                {t("approveProposal")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setNote("");
                  reject.reset();
                  setMode("reject");
                }}
              >
                {t("rejectProposal")}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {mode === "reject" ? (
        <ConfirmDialog
          title={t("rejectProposalTitle")}
          confirm={t("rejectProposal")}
          pending={reject.isPending}
          error={reject.error}
          disabled={!note.trim()}
          onConfirm={() => reject.mutate()}
          onClose={close}
        >
          <TextArea label={t("decisionNote")} value={note} onChange={setNote} required rows={2} />
        </ConfirmDialog>
      ) : null}
      {mode === "approve" ? <ApproveDialog deliverable={deliverable} onClose={close} /> : null}
    </Alert>
  );
}

/** Approving sets the official weight, dates, criteria and members (spec §4.2). */
function ApproveDialog({ deliverable, onClose }: { deliverable: DeliverableDetail; onClose: () => void }) {
  const t = useTranslations("Deliverables");
  const members = useMembers();
  const [criteria, setCriteria] = useState(deliverable.acceptance_criteria ?? "");
  const [startDate, setStartDate] = useState(deliverable.start_date ?? "");
  const [deadline, setDeadline] = useState(deliverable.original_deadline ?? "");
  const [weight, setWeight] = useState(deliverable.weight != null ? decimal(deliverable.weight) : "");
  const [chosen, setChosen] = useState<number[]>(deliverable.assignees.map((member) => member.id));
  const [note, setNote] = useState("");
  const people = useMemo(
    () =>
      (members.data ?? [])
        .filter((item) => item.status !== "alumni")
        .sort((a, b) => memberName(a).localeCompare(memberName(b))),
    [members.data],
  );
  const approve = useWorkMutation(() => {
    const body: DeliverableChange = {
      submit: true,
      acceptance_criteria: criteria.trim(),
      start_date: startDate || null,
      original_deadline: deadline || null,
      member_ids: chosen,
      note: note.trim(),
    };
    if (weight.trim()) {
      body.weight = weight.trim();
    }
    return approveDeliverable(deliverable.id, body);
  }, onClose);
  const valid = !!criteria.trim() && !!deadline;
  return (
    <ConfirmDialog
      title={t("approveProposalTitle")}
      confirm={t("approveProposal")}
      pending={approve.isPending}
      error={approve.error}
      disabled={!valid}
      onConfirm={() => approve.mutate()}
      onClose={onClose}
    >
      <p className="text-xs text-muted">{t("approveProposalHint")}</p>
      <TextArea label={t("acceptanceCriteria")} value={criteria} onChange={setCriteria} rows={3} required />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label={t("startDate")}
          type="date"
          valueDir="ltr"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <TextField
          label={t("originalDeadline")}
          type="date"
          valueDir="ltr"
          required
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
        />
        <TextField
          label={t("weight")}
          type="number"
          inputMode="decimal"
          valueDir="ltr"
          min={0}
          max={100}
          step="0.01"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
        />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold tracking-widest text-muted uppercase">{t("members")}</legend>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-line p-2">
          {people.map((person) => (
            <label key={person.id} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="size-4 accent-racing"
                checked={chosen.includes(person.id)}
                onChange={(event) =>
                  setChosen((current) =>
                    event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id),
                  )
                }
              />
              {memberName(person)}
            </label>
          ))}
        </div>
      </fieldset>
      <TextArea label={t("decisionNote")} value={note} onChange={setNote} rows={2} />
    </ConfirmDialog>
  );
}
