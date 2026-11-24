"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useMembers } from "@/features/members/use-members";
import { errorText } from "@/lib/error-text";
import {
  changeSponsor,
  createSponsor,
  deleteSponsor,
  SPONSOR_STAGES,
  type Sponsorship,
  type SponsorshipStatus,
  type SponsorshipWrite,
} from "./api";
import { PanelButtons, PanelFrame } from "./expense-row";
import { FinanceTabs, textareaClass, useDay, useMoney } from "./finance-parts";
import { refreshFinance, useFinanceSummary, useSponsors, useSponsorSummary } from "./queries";

const STAGE_TONES: Record<SponsorshipStatus, BadgeTone> = {
  prospect: "neutral",
  contacted: "info",
  negotiating: "warning",
  confirmed: "success",
  declined: "danger",
};

/** The sponsors, stage by stage, with the total confirmed this budget year. */
export function SponsorsPage() {
  const t = useTranslations("Finance");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const money = useMoney();
  const summary = useFinanceSummary();
  const canSee = summary.data?.can_see_sponsors ?? false;
  const manage = summary.data?.can_manage_sponsors ?? false;
  const sponsors = useSponsors(canSee);
  const totals = useSponsorSummary(undefined, canSee);
  const [adding, setAdding] = useState(false);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("sponsorsTitle")} description={t("sponsorsIntro")}>
        {manage ? (
          <Button onClick={() => setAdding(true)} disabled={adding}>
            <Plus className="size-4" aria-hidden="true" />
            {t("newSponsor")}
          </Button>
        ) : null}
      </PageHeader>
      <FinanceTabs current="sponsors" summary={summary.data} />

      {summary.isError ? (
        <Alert tone="error">{errorText(summary.error, tErrors)}</Alert>
      ) : summary.data && !canSee ? (
        <Alert tone="info">{t("sponsorsNoAccess")}</Alert>
      ) : (
        <>
          {totals.data ? (
            <p className="text-sm text-muted">
              {t.rich("sponsorsTotal", {
                year: totals.data.fiscal_year,
                total: money(totals.data.confirmed_total),
                strong: (chunks) => <strong className="font-semibold text-ink tabular-nums">{chunks}</strong>,
              })}
              {manage ? null : <> {t("contactsHidden")}</>}
            </p>
          ) : null}
          {adding ? (
            <Card>
              <SponsorForm onClose={() => setAdding(false)} />
            </Card>
          ) : null}
          {sponsors.isError ? (
            <Alert tone="error">{errorText(sponsors.error, tErrors)}</Alert>
          ) : !sponsors.data ? (
            <div className="grid gap-3 md:grid-cols-5" aria-hidden="true">
              {SPONSOR_STAGES.map((stage) => (
                <div key={stage} className="h-40 animate-pulse rounded-xl border border-line bg-surface" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {SPONSOR_STAGES.map((stage) => {
                const inStage = sponsors.data.filter((sponsor) => sponsor.status === stage);
                return (
                  <section key={stage} aria-labelledby={`stage-${stage}`} className="space-y-3">
                    <h2 id={`stage-${stage}`} className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <Badge tone={STAGE_TONES[stage]}>{t(`stage.${stage}`)}</Badge>
                      <span className="text-muted tabular-nums">{inStage.length}</span>
                    </h2>
                    {inStage.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
                        {t("noSponsor")}
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {inStage.map((sponsor) => (
                          <SponsorCard key={sponsor.id} sponsor={sponsor} manage={manage} />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SponsorCard({ sponsor, manage }: { sponsor: Sponsorship; manage: boolean }) {
  const t = useTranslations("Finance");
  const money = useMoney();
  const day = useDay();
  const [panel, setPanel] = useState<"edit" | "delete" | null>(null);
  const who = sponsor.managed_by ? `${sponsor.managed_by.first_name} ${sponsor.managed_by.last_name}` : null;
  return (
    <li className="space-y-2 rounded-xl border border-line bg-surface p-4 text-sm shadow-card">
      <p className="font-medium text-ink">
        <bdi>{sponsor.sponsor_name}</bdi>
      </p>
      {sponsor.amount ? <p className="font-semibold text-ink tabular-nums">{money(sponsor.amount)}</p> : null}
      {sponsor.in_kind_description ? (
        <p className="text-muted">{t("inKind", { what: sponsor.in_kind_description })}</p>
      ) : null}
      {sponsor.confirmed_at ? (
        <p className="text-xs text-success">{t("confirmedOn", { date: day(sponsor.confirmed_at) })}</p>
      ) : null}
      {who ? (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <UserRound className="size-3.5" aria-hidden="true" />
          {t("followedBy", { who })}
        </p>
      ) : null}
      {sponsor.contact_name || sponsor.contact_email ? (
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <Mail className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {sponsor.contact_name ? <bdi>{sponsor.contact_name}</bdi> : null}
            {sponsor.contact_name && sponsor.contact_email ? " · " : null}
            {sponsor.contact_email ? <bdi dir="ltr">{sponsor.contact_email}</bdi> : null}
          </span>
        </p>
      ) : null}
      {sponsor.notes ? (
        <p className="text-xs whitespace-pre-line text-muted">
          <bdi>{sponsor.notes}</bdi>
        </p>
      ) : null}
      {manage && panel === null ? (
        <div className="flex flex-wrap gap-1 pt-1">
          <Button variant="ghost" size="sm" onClick={() => setPanel("edit")}>
            <Pencil className="size-4" aria-hidden="true" />
            {t("actions.edit")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPanel("delete")}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t("actions.delete")}
          </Button>
        </div>
      ) : null}
      {panel === "edit" ? <SponsorForm sponsor={sponsor} onClose={() => setPanel(null)} /> : null}
      {panel === "delete" ? <DeleteSponsor sponsor={sponsor} onClose={() => setPanel(null)} /> : null}
    </li>
  );
}

/** A new sponsor, or the changes of one: its stage, what it gives, its contact, who follows it. */
function SponsorForm({ sponsor, onClose }: { sponsor?: Sponsorship; onClose: () => void }) {
  const t = useTranslations("Finance");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const members = useMembers();
  const [name, setName] = useState(sponsor?.sponsor_name ?? "");
  const [stage, setStage] = useState<SponsorshipStatus>(sponsor?.status ?? "prospect");
  const [amount, setAmount] = useState(sponsor?.amount ? String(Number(sponsor.amount)) : "");
  const [inKind, setInKind] = useState(sponsor?.in_kind_description ?? "");
  const [contactName, setContactName] = useState(sponsor?.contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(sponsor?.contact_email ?? "");
  const [followedBy, setFollowedBy] = useState(sponsor?.managed_by ? String(sponsor.managed_by.id) : "");
  const [notes, setNotes] = useState(sponsor?.notes ?? "");
  const notesId = useId();
  const valid = name.trim() !== "" && (amount === "" || Number(amount) >= 0);
  const save = useMutation({
    mutationFn: () => {
      const body: SponsorshipWrite = {
        sponsor_name: name.trim(),
        status: stage,
        amount: amount === "" ? null : amount,
        in_kind_description: inKind.trim(),
        contact_name: contactName.trim(),
        contact_email: contactEmail.trim(),
        notes: notes.trim(),
        ...(followedBy ? { managed_by_id: Number(followedBy) } : {}),
      };
      return sponsor ? changeSponsor(sponsor.id, body) : createSponsor(body);
    },
    onSuccess: async () => {
      onClose();
      await refreshFinance(queryClient);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) {
      save.mutate();
    }
  }

  return (
    <PanelFrame title={sponsor ? t("sponsorForm.editTitle") : t("sponsorForm.newTitle")} onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("sponsorForm.name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
        <SelectField
          label={t("sponsorForm.stage")}
          value={stage}
          onChange={(event) => setStage(event.target.value as SponsorshipStatus)}
        >
          {SPONSOR_STAGES.map((value) => (
            <option key={value} value={value}>
              {t(`stage.${value}`)}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t("sponsorForm.amount")}
          type="number"
          min={0}
          step="1"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <TextField label={t("sponsorForm.inKind")} value={inKind} onChange={(event) => setInKind(event.target.value)} />
        <TextField
          label={t("sponsorForm.contactName")}
          value={contactName}
          onChange={(event) => setContactName(event.target.value)}
        />
        <TextField
          label={t("sponsorForm.contactEmail")}
          type="email"
          valueDir="ltr"
          value={contactEmail}
          onChange={(event) => setContactEmail(event.target.value)}
        />
        <SelectField
          label={t("sponsorForm.followedBy")}
          value={followedBy}
          onChange={(event) => setFollowedBy(event.target.value)}
        >
          <option value="">{sponsor ? t("sponsorForm.nobody") : t("sponsorForm.me")}</option>
          {members.data
            ?.filter((member) => member.status !== "alumni")
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.first_name} {member.last_name}
              </option>
            ))}
        </SelectField>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={notesId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("form.notes")}
        </label>
        <textarea
          id={notesId}
          rows={2}
          dir="auto"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className={textareaClass}
        />
      </div>
      {stage === "confirmed" && !sponsor?.confirmed_at ? (
        <p className="text-xs text-muted">{t("sponsorForm.dated")}</p>
      ) : null}
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      <PanelButtons
        confirm={sponsor ? t("edit.confirm") : t("sponsorForm.create")}
        pending={save.isPending}
        disabled={!valid}
        onClose={onClose}
      />
    </PanelFrame>
  );
}

function DeleteSponsor({ sponsor, onClose }: { sponsor: Sponsorship; onClose: () => void }) {
  const t = useTranslations("Finance");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteSponsor(sponsor.id),
    onSuccess: async () => {
      onClose();
      await refreshFinance(queryClient);
    },
  });
  return (
    <PanelFrame
      title={t("deleteSponsor.title")}
      onSubmit={(event) => {
        event.preventDefault();
        remove.mutate();
      }}
    >
      <p className="text-sm text-muted">{t("deleteSponsor.text")}</p>
      {remove.isError ? <Alert tone="error">{errorText(remove.error, tErrors)}</Alert> : null}
      <PanelButtons confirm={t("delete.confirm")} pending={remove.isPending} onClose={onClose} />
    </PanelFrame>
  );
}
