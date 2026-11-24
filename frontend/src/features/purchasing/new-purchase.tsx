"use client";

import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { BackLink } from "@/components/ui/back-link";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useRouter } from "@/i18n/navigation";
import { PurchaseForm } from "./purchase-form";
import { usePart } from "./queries";

/** Ask for a part: the request then awaits the approvals (its leader, then the head of Operations).
 * `?part=` starts with a known part (a stock line's "ask for a purchase"). */
export function NewPurchase() {
  const t = useTranslations("Purchasing");
  const tShell = useTranslations("Shell");
  const router = useRouter();
  const partId = Number(useSearchParams().get("part")) || 0;
  const part = usePart(partId);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/purchasing">{t("title")}</BackLink>
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("form.newTitle")} description={t("form.newIntro")} />
      {partId > 0 && part.isPending ? (
        <Card>
          <LinesPlaceholder lines={3} />
        </Card>
      ) : (
        <PurchaseForm
          initialPart={part.data}
          onSaved={(saved) => router.push(`/purchasing/requests/${saved.id}`)}
          onCancel={() => router.push("/purchasing")}
        />
      )}
    </div>
  );
}
