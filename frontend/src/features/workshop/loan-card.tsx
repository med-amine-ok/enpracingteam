"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, PackageCheck, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { Link } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import {
  approveLoan,
  cancelLoan,
  cancelReservation,
  refuseLoan,
  returnLoan,
  type Loan,
  type Reservation,
  type ReturnCondition,
} from "./api";
import { refreshWorkshop } from "./queries";
import { LoanStatusBadge, personName, textareaClass, useDay, useSlot } from "./workshop-parts";

/**
 * A loan: who, until when, why; and what the viewer may do with it: hand it out or refuse it (a manager),
 * record its return (a manager), withdraw the request (its borrower).
 */
export function LoanCard({ loan, showEquipment = false }: { loan: Loan; showEquipment?: boolean }) {
  const t = useTranslations("Workshop");
  const tErrors = useTranslations("Errors");
  const day = useDay();
  const queryClient = useQueryClient();
  const noteId = useId();
  const [form, setForm] = useState<"refuse" | "return" | null>(null);
  const [note, setNote] = useState("");
  const [condition, setCondition] = useState<ReturnCondition>("good");
  const change = useMutation({
    mutationFn: (action: "approve" | "refuse" | "return" | "cancel") => {
      if (action === "approve") {
        return approveLoan(loan.id);
      }
      if (action === "refuse") {
        return refuseLoan(loan.id, note.trim());
      }
      if (action === "return") {
        return returnLoan(loan.id, condition, note.trim());
      }
      return cancelLoan(loan.id);
    },
    onSuccess: async () => {
      setForm(null);
      setNote("");
      await refreshWorkshop(queryClient);
    },
  });
  const { permissions } = loan;

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        {showEquipment ? (
          <Link href={`/workshop/${loan.equipment.id}`} className="font-medium text-navy hover:underline">
            <bdi>{loan.equipment.name}</bdi>
          </Link>
        ) : null}
        <LoanStatusBadge status={loan.status} />
        {loan.overdue ? <Badge tone="danger">{t("overdue")}</Badge> : null}
      </div>
      <p className="text-sm text-ink">{t("loanLine", { name: personName(loan.borrower), date: day(loan.due_date) })}</p>
      <p dir="auto" className="text-sm whitespace-pre-line text-muted">
        {loan.reason}
      </p>
      {loan.decision_note ? <Alert tone="warning">{t("decisionNote", { note: loan.decision_note })}</Alert> : null}
      {loan.returned_at ? (
        <p className="text-xs text-muted">
          {t("returnedOn", { date: day(loan.returned_at) })}
          {loan.return_condition ? ` · ${t(`condition.${loan.return_condition}`)}` : ""}
          {loan.return_note ? ` · ${loan.return_note}` : ""}
        </p>
      ) : null}
      {change.isError ? <Alert tone="error">{errorText(change.error, tErrors)}</Alert> : null}
      {form === null ? (
        <div className="flex flex-wrap gap-2">
          {permissions.decide ? (
            <>
              <Button size="sm" onClick={() => change.mutate("approve")} loading={change.isPending}>
                <Check className="size-4" aria-hidden="true" />
                {t("approve")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setForm("refuse")}>
                <X className="size-4" aria-hidden="true" />
                {t("refuse")}
              </Button>
            </>
          ) : null}
          {permissions.receive ? (
            <Button size="sm" variant="secondary" onClick={() => setForm("return")}>
              <PackageCheck className="size-4" aria-hidden="true" />
              {t("receive")}
            </Button>
          ) : null}
          {permissions.cancel ? (
            <Button size="sm" variant="ghost" onClick={() => change.mutate("cancel")} loading={change.isPending}>
              <Undo2 className="size-4" aria-hidden="true" />
              {t("withdraw")}
            </Button>
          ) : null}
        </div>
      ) : (
        <form
          className="space-y-3 rounded-lg border border-line bg-canvas p-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            change.mutate(form);
          }}
        >
          {form === "return" ? (
            <SelectField
              label={t("conditionLabel")}
              value={condition}
              onChange={(event) => setCondition(event.target.value as ReturnCondition)}
            >
              <option value="good">{t("condition.good")}</option>
              <option value="damaged">{t("condition.damaged")}</option>
            </SelectField>
          ) : null}
          <div className="space-y-1.5">
            <label htmlFor={noteId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
              {form === "refuse" ? t("refuseReason") : t("returnNoteLabel")}
            </label>
            <textarea
              id={noteId}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={textareaClass}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={form === "refuse" && !note.trim()} loading={change.isPending}>
              {form === "refuse" ? t("refuseConfirm") : t("receiveConfirm")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

/** A booked slot; its author or a manager cancels it (a manager says why: the member is told). */
export function ReservationRow({
  reservation,
  showEquipment = false,
  mine = false,
}: {
  reservation: Reservation;
  showEquipment?: boolean;
  /** The viewer's own slot: cancelled at once, without a reason. */
  mine?: boolean;
}) {
  const t = useTranslations("Workshop");
  const tErrors = useTranslations("Errors");
  const slot = useSlot();
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const when = slot(reservation.reserved_from, reservation.reserved_to);
  const cancel = useMutation({
    mutationFn: () => cancelReservation(reservation.id, reason.trim()),
    onSuccess: async () => {
      setAsking(false);
      await refreshWorkshop(queryClient);
    },
  });

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          {showEquipment ? (
            <Link href={`/workshop/${reservation.equipment.id}`} className="font-medium text-navy hover:underline">
              <bdi>{reservation.equipment.name}</bdi>
            </Link>
          ) : null}
          <p className="text-sm font-medium text-ink">{when}</p>
          <p className="text-xs text-muted">
            {t("bookedBy", { name: personName(reservation.reserved_by) })}
            {reservation.purpose ? (
              <>
                {" · "}
                <bdi>{reservation.purpose}</bdi>
              </>
            ) : null}
          </p>
        </div>
        {reservation.permissions.cancel && !asking ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("cancelSlotOf", { slot: when })}
            loading={cancel.isPending}
            onClick={() => (mine ? cancel.mutate() : setAsking(true))}
          >
            <X className="size-4" aria-hidden="true" />
            {t("cancelSlot")}
          </Button>
        ) : null}
      </div>
      {cancel.isError ? <Alert tone="error">{errorText(cancel.error, tErrors)}</Alert> : null}
      {asking ? (
        <form
          className="space-y-3 rounded-lg border border-line bg-canvas p-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            cancel.mutate();
          }}
        >
          <label htmlFor={reasonId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t("cancelReason")}
          </label>
          <textarea
            id={reasonId}
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={textareaClass}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={cancel.isPending}>
              {t("confirmCancel")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
