"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, MapPin, Pencil, ShieldCheck, ShieldOff, Wrench } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useId, useMemo, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMe } from "@/features/auth/use-me";
import { fromLocalInput } from "@/features/meetings/meeting-parts";
import { useMembers } from "@/features/members/use-members";
import { clubToday } from "@/lib/dates";
import { errorText } from "@/lib/error-text";
import {
  SETTABLE_STATUSES,
  certify,
  recordMaintenance,
  requestLoan,
  reserve,
  revokeCertification,
  type EquipmentDetail,
  type SettableStatus,
} from "./api";
import { EquipmentForm } from "./equipment-form";
import { LoanCard, ReservationRow } from "./loan-card";
import { refreshWorkshop, useEquipment, workshopKeys } from "./queries";
import { EquipmentStatusBadge, personName, textareaClass, useDay } from "./workshop-parts";

/** An item of the workshop: book it, borrow it; its managers change it, certify the members, record its care. */
export function EquipmentView() {
  const t = useTranslations("Workshop");
  const tErrors = useTranslations("Errors");
  const { id } = useParams<{ id: string }>();
  const equipment = useEquipment(Number(id));
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  if (equipment.isError) {
    return (
      <div className="mx-auto max-w-5xl">
        <Alert tone="error">{errorText(equipment.error, tErrors)}</Alert>
      </div>
    );
  }
  if (!equipment.data) {
    return (
      <div className="mx-auto max-w-5xl" aria-hidden="true">
        <Card>
          <LinesPlaceholder lines={5} />
        </Card>
      </div>
    );
  }
  const data = equipment.data;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <BackLink href="/workshop">{t("title")}</BackLink>
      {editing ? (
        <Card title={t("editTitle")}>
          <EquipmentForm
            equipment={data}
            onSaved={(saved) => {
              queryClient.setQueryData(workshopKeys.detail(data.id), saved);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </Card>
      ) : (
        <EquipmentHeader equipment={data} onEdit={() => setEditing(true)} />
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <ReserveCard equipment={data} />
          <SlotsCard equipment={data} />
        </div>
        <div className="space-y-6">
          {data.loanable ? <BorrowCard equipment={data} /> : null}
          {data.loans.length > 0 ? (
            <Card title={t("loansTitle")}>
              <ul className="space-y-3">
                {data.loans.map((loan) => (
                  <LoanCard key={loan.id} loan={loan} />
                ))}
              </ul>
            </Card>
          ) : null}
          {data.requires_certification || data.certifications.length > 0 || data.permissions.certify ? (
            <CertificationsCard equipment={data} />
          ) : null}
        </div>
      </div>
      <MaintenanceCard equipment={data} />
    </div>
  );
}

function EquipmentHeader({ equipment, onEdit }: { equipment: EquipmentDetail; onEdit: () => void }) {
  const t = useTranslations("Workshop");
  const day = useDay();
  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <span className="flex flex-wrap items-center gap-1.5">
            <EquipmentStatusBadge status={equipment.status} />
            <Badge tone="neutral">{t(`category.${equipment.category}`)}</Badge>
            {equipment.requires_certification ? (
              <Badge tone={equipment.certified ? "success" : "warning"}>
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                {equipment.certified ? t("certified") : t("certificationRequired")}
              </Badge>
            ) : null}
            {!equipment.loanable ? <Badge tone="neutral">{t("staysInWorkshop")}</Badge> : null}
          </span>
          <h1 dir="auto" className="text-2xl font-semibold tracking-tight text-ink rtl:text-right">
            {equipment.name}
          </h1>
          {equipment.location ? (
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <MapPin className="size-4" aria-hidden="true" />
              <bdi>{equipment.location}</bdi>
            </p>
          ) : null}
        </div>
        {equipment.permissions.manage ? (
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" />
            {t("edit")}
          </Button>
        ) : null}
      </div>
      {equipment.description ? (
        <p dir="auto" className="text-sm whitespace-pre-line text-ink">
          {equipment.description}
        </p>
      ) : null}
      {equipment.lent_to && equipment.lent_until ? (
        <Alert tone="info">
          {t("lentTo", { name: personName(equipment.lent_to), date: day(equipment.lent_until) })}
        </Alert>
      ) : null}
      {equipment.last_maintenance_at ? (
        <p className="text-xs text-muted">{t("lastMaintenance", { date: day(equipment.last_maintenance_at) })}</p>
      ) : null}
    </section>
  );
}

function ReserveCard({ equipment }: { equipment: EquipmentDetail }) {
  const t = useTranslations("Workshop");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [purpose, setPurpose] = useState("");
  const book = useMutation({
    mutationFn: () => reserve(equipment.id, fromLocalInput(from), fromLocalInput(to), purpose.trim()),
    onSuccess: async () => {
      setFrom("");
      setTo("");
      setPurpose("");
      await refreshWorkshop(queryClient);
    },
  });
  const unusable = equipment.status === "maintenance" || equipment.status === "out_of_service";

  return (
    <Card title={t("reserveTitle")} description={t("reserveIntro")}>
      {!equipment.permissions.reserve ? (
        <Alert tone="info">{unusable ? t("unavailable") : t("needsCertification")}</Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (from && to) {
              book.mutate();
            }
          }}
        >
          {book.isError ? <Alert tone="error">{errorText(book.error, tErrors)}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t("fromLabel")}
              type="datetime-local"
              required
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <TextField
              label={t("toLabel")}
              type="datetime-local"
              required
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <TextField
            label={t("purposeLabel")}
            maxLength={255}
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
          <Button type="submit" loading={book.isPending} disabled={!from || !to}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            {t("reserve")}
          </Button>
        </form>
      )}
    </Card>
  );
}

function SlotsCard({ equipment }: { equipment: EquipmentDetail }) {
  const t = useTranslations("Workshop");
  const me = useMe();
  return (
    <Card title={t("slotsTitle")}>
      {equipment.reservations.length === 0 ? (
        <p className="text-sm text-muted">{t("noSlots")}</p>
      ) : (
        <ul className="space-y-3">
          {equipment.reservations.map((reservation) => (
            <ReservationRow
              key={reservation.id}
              reservation={reservation}
              mine={reservation.reserved_by.id === me.data?.id}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function BorrowCard({ equipment }: { equipment: EquipmentDetail }) {
  const t = useTranslations("Workshop");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [due, setDue] = useState("");
  const ask = useMutation({
    mutationFn: () => requestLoan(equipment.id, reason.trim(), due),
    onSuccess: async () => {
      setReason("");
      setDue("");
      await refreshWorkshop(queryClient);
    },
  });
  const usable =
    equipment.status !== "maintenance" &&
    equipment.status !== "out_of_service" &&
    (!equipment.requires_certification || equipment.certified);

  return (
    <Card title={t("borrowTitle")} description={t("borrowIntro")}>
      {!equipment.permissions.borrow ? (
        <Alert tone="info">
          {!usable
            ? equipment.status === "maintenance" || equipment.status === "out_of_service"
              ? t("unavailable")
              : t("needsCertification")
            : t("alreadyAsked")}
        </Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (reason.trim() && due) {
              ask.mutate();
            }
          }}
        >
          {ask.isError ? <Alert tone="error">{errorText(ask.error, tErrors)}</Alert> : null}
          <div className="space-y-1.5">
            <label htmlFor={reasonId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
              {t("reasonLabel")}
            </label>
            <textarea
              id={reasonId}
              rows={2}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={textareaClass}
            />
          </div>
          <TextField
            label={t("dueLabel")}
            type="date"
            required
            min={clubToday(new Date())}
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
          <Button type="submit" loading={ask.isPending} disabled={!reason.trim() || !due}>
            {t("askLoan")}
          </Button>
        </form>
      )}
    </Card>
  );
}

function CertificationsCard({ equipment }: { equipment: EquipmentDetail }) {
  const t = useTranslations("Workshop");
  const tErrors = useTranslations("Errors");
  const day = useDay();
  const queryClient = useQueryClient();
  const members = useMembers();
  const [member, setMember] = useState("");
  const [note, setNote] = useState("");
  const certified = useMemo(
    () => new Set(equipment.certifications.map((row) => row.member.id)),
    [equipment.certifications],
  );
  const people = useMemo(
    () =>
      (members.data ?? [])
        .filter((person) => person.status !== "alumni" && !certified.has(person.id))
        .sort((a, b) => personName(a).localeCompare(personName(b))),
    [members.data, certified],
  );
  const onDone = async () => {
    setMember("");
    setNote("");
    await refreshWorkshop(queryClient);
  };
  const grant = useMutation({
    mutationFn: () => certify(equipment.id, Number(member), note.trim()),
    onSuccess: onDone,
  });
  const revoke = useMutation({
    mutationFn: (certification: number) => revokeCertification(equipment.id, certification),
    onSuccess: onDone,
  });
  const error = grant.error ?? revoke.error;

  return (
    <Card title={t("certificationsTitle")}>
      <div className="space-y-4">
        {error ? <Alert tone="error">{errorText(error, tErrors)}</Alert> : null}
        {equipment.certifications.length === 0 ? (
          <p className="text-sm text-muted">{t("noCertifications")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {equipment.certifications.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{personName(row.member)}</span>
                  <span className="block text-xs text-muted">
                    {t("certifiedBy", {
                      name: row.granted_by ? personName(row.granted_by) : "—",
                      date: day(row.granted_at),
                    })}
                    {row.note ? ` · ${row.note}` : ""}
                  </span>
                </span>
                {equipment.permissions.certify ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("revokeOf", { name: personName(row.member) })}
                    onClick={() => revoke.mutate(row.id)}
                    loading={revoke.isPending && revoke.variables === row.id}
                  >
                    <ShieldOff className="size-4" aria-hidden="true" />
                    {t("revoke")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {equipment.permissions.certify ? (
          <form
            className="space-y-3 rounded-lg border border-line bg-canvas p-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (member) {
                grant.mutate();
              }
            }}
          >
            <SelectField label={t("certifyMember")} value={member} onChange={(event) => setMember(event.target.value)}>
              <option value="">{t("chooseMember")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {personName(person)}
                </option>
              ))}
            </SelectField>
            <TextField label={t("certifyNote")} value={note} onChange={(event) => setNote(event.target.value)} />
            <Button type="submit" size="sm" disabled={!member} loading={grant.isPending}>
              <ShieldCheck className="size-4" aria-hidden="true" />
              {t("certify")}
            </Button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}

function MaintenanceCard({ equipment }: { equipment: EquipmentDetail }) {
  const t = useTranslations("Workshop");
  const tErrors = useTranslations("Errors");
  const format = useFormatter();
  const day = useDay();
  const queryClient = useQueryClient();
  const workId = useId();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [work, setWork] = useState("");
  const [cost, setCost] = useState("");
  const [status, setStatus] = useState<SettableStatus | "">("");
  const save = useMutation({
    mutationFn: () =>
      recordMaintenance(equipment.id, {
        ...(date ? { performed_at: fromLocalInput(`${date}T12:00`) } : {}),
        description: work.trim(),
        cost: cost ? cost : null,
        ...(status ? { status } : {}),
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(workshopKeys.detail(equipment.id), saved);
      setOpen(false);
      setDate("");
      setWork("");
      setCost("");
      setStatus("");
      await refreshWorkshop(queryClient);
    },
  });

  return (
    <Card
      title={t("maintenanceTitle")}
      action={
        equipment.permissions.manage && !open ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Wrench className="size-4" aria-hidden="true" />
            {t("recordMaintenance")}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        {open ? (
          <form
            className="space-y-3 rounded-lg border border-line bg-canvas p-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (work.trim()) {
                save.mutate();
              }
            }}
          >
            {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                label={t("maintenanceDate")}
                type="date"
                max={clubToday(new Date())}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
              <TextField
                label={t("maintenanceCost")}
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
              />
              {equipment.status !== "borrowed" ? (
                <SelectField
                  label={t("statusAfter")}
                  value={status}
                  onChange={(event) => setStatus(event.target.value as SettableStatus | "")}
                >
                  <option value="">{t("keepStatus")}</option>
                  {SETTABLE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {t(`status.${value}`)}
                    </option>
                  ))}
                </SelectField>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <label htmlFor={workId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
                {t("maintenanceWork")}
              </label>
              <textarea
                id={workId}
                rows={2}
                required
                value={work}
                onChange={(event) => setWork(event.target.value)}
                className={textareaClass}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={!work.trim()} loading={save.isPending}>
                {t("saveMaintenance")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        ) : null}
        {equipment.maintenance.length === 0 ? (
          <p className="text-sm text-muted">{t("noMaintenance")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {equipment.maintenance.map((row) => (
              <li key={row.id} className="space-y-1 py-2">
                <p dir="auto" className="text-sm whitespace-pre-line text-ink">
                  {row.description}
                </p>
                <p className="text-xs text-muted">
                  {t("maintenanceBy", { name: personName(row.performed_by), date: day(row.performed_at) })}
                  {row.cost != null
                    ? ` · ${t("cost", {
                        amount: format.number(Number(row.cost), { maximumFractionDigits: 2, numberingSystem: "latn" }),
                      })}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
