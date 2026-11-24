"use client";

import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { errorText } from "@/lib/error-text";
import { LoanCard, ReservationRow } from "./loan-card";
import { useLoans, useMyReservations, useWorkshopRights } from "./queries";
import { WorkshopTabs } from "./workshop-parts";

/** The viewer's coming slots and loans. */
export function MyWorkshop() {
  const t = useTranslations("Workshop");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const reservations = useMyReservations("upcoming");
  const loans = useLoans({ mine: true });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("mineTitle")} description={t("mineIntro")} />
      <WorkshopTabs current="mine" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("upcomingTitle")}>
          {reservations.isError ? (
            <Alert tone="error">{errorText(reservations.error, tErrors)}</Alert>
          ) : !reservations.data ? (
            <LinesPlaceholder lines={3} />
          ) : reservations.data.length === 0 ? (
            <p className="text-sm text-muted">{t("noUpcoming")}</p>
          ) : (
            <ul className="space-y-3">
              {reservations.data.map((reservation) => (
                <ReservationRow key={reservation.id} reservation={reservation} showEquipment mine />
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("myLoansTitle")}>
          {loans.isError ? (
            <Alert tone="error">{errorText(loans.error, tErrors)}</Alert>
          ) : !loans.data ? (
            <LinesPlaceholder lines={3} />
          ) : loans.data.length === 0 ? (
            <p className="text-sm text-muted">{t("noLoans")}</p>
          ) : (
            <ul className="space-y-3">
              {loans.data.map((loan) => (
                <LoanCard key={loan.id} loan={loan} showEquipment />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** The managers' desk: the requests to decide, then what is out (the late ones first). */
export function LoansToHandle() {
  const t = useTranslations("Workshop");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const rights = useWorkshopRights();
  const manage = rights.data?.manage ?? false;
  const requested = useLoans({ status: "requested" }, manage);
  const out = useLoans({ status: "out" }, manage);
  const outSorted = out.data ? [...out.data].sort((a, b) => Number(b.overdue) - Number(a.overdue)) : undefined;

  const list = (query: { isError: boolean; error: unknown }, rows: typeof outSorted, empty: string) =>
    query.isError ? (
      <Alert tone="error">{errorText(query.error, tErrors)}</Alert>
    ) : !rows ? (
      <LinesPlaceholder lines={3} />
    ) : rows.length === 0 ? (
      <p className="text-sm text-muted">{empty}</p>
    ) : (
      <ul className="space-y-3">
        {rows.map((loan) => (
          <LoanCard key={loan.id} loan={loan} showEquipment />
        ))}
      </ul>
    );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("loansTab")} description={t("loansIntro")} />
      <WorkshopTabs current="loans" />
      {rights.data && !manage ? (
        <Alert tone="info">{t("managersOnly")}</Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={t("requestedTitle")}>{list(requested, requested.data, t("noRequested"))}</Card>
          <Card title={t("outTitle")}>{list(out, outSorted, t("noOut"))}</Card>
        </div>
      )}
    </div>
  );
}
