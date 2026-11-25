"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/error-text";
import { refreshWorkflow } from "../queries";
import { Modal, TextArea } from "./shared";

/**
 * The two formal outcomes of a proposal (guide §15.6): Approve or Reject, with a note (required to reject, and
 * confirmed). Editing before deciding is done apart: it is not a third outcome.
 */
export function ProposalDecision({
  decide,
  onApprove,
}: {
  decide: (approve: boolean, note: string) => Promise<unknown>;
  /** Approving needs more than a note (a Deliverable's official details): opens that instead. */
  onApprove?: () => void;
}) {
  const t = useTranslations("WorkOrders");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [noteMissing, setNoteMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const decision = useMutation({
    mutationFn: (approve: boolean) => decide(approve, note.trim()),
    onSuccess: async () => {
      setConfirming(false);
      setNote("");
      await refreshWorkflow(queryClient);
    },
  });

  function reject() {
    if (!note.trim()) {
      setNoteMissing(true);
      return;
    }
    setConfirming(true);
  }

  return (
    <div className="space-y-3">
      {decision.isError && !confirming ? <Alert tone="error">{errorText(decision.error, tErrors)}</Alert> : null}
      <TextArea
        label={t("decisionNote")}
        hint={t("decisionNoteHint")}
        rows={2}
        value={note}
        onChange={(value) => {
          setNote(value);
          setNoteMissing(false);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => (onApprove ? onApprove() : decision.mutate(true))}
          loading={decision.isPending && decision.variables === true}
          disabled={decision.isPending}
        >
          <Check className="size-4" aria-hidden="true" />
          {t("approve")}
        </Button>
        <Button size="sm" variant="secondary" onClick={reject} disabled={decision.isPending}>
          <X className="size-4" aria-hidden="true" />
          {t("reject")}
        </Button>
      </div>
      {noteMissing && !note.trim() ? (
        <p role="alert" className="text-xs text-racing-strong">
          {t("rejectNeedsNote")}
        </p>
      ) : null}
      {confirming ? (
        <Modal title={t("rejectConfirmTitle")} onClose={() => setConfirming(false)}>
          <p className="text-sm text-ink">{t("rejectConfirmText")}</p>
          <blockquote dir="auto" className="rounded-md bg-canvas px-3 py-2 text-sm whitespace-pre-line text-ink">
            {note}
          </blockquote>
          {decision.isError ? <Alert tone="error">{errorText(decision.error, tErrors)}</Alert> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={decision.isPending}>
              {t("cancel")}
            </Button>
            <Button onClick={() => decision.mutate(false)} loading={decision.isPending}>
              {t("rejectConfirm")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
