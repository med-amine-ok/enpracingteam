"use client";

import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { errorText } from "@/lib/error-text";
import type { JournalFilters, StockMovementType } from "./api";
import { useJournal } from "./queries";
import { MovementItem, StockTabs } from "./stock-parts";

/** The stock journal: the latest movements of every line, by kind, or the viewer's own. */
export function JournalPage() {
  const t = useTranslations("Stock");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const [kind, setKind] = useState<StockMovementType | "all">("all");
  const [mine, setMine] = useState<"all" | "mine">("all");
  const filters: JournalFilters = {
    ...(kind !== "all" ? { type: kind } : {}),
    ...(mine === "mine" ? { mine: true } : {}),
  };
  const journal = useJournal(filters);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("title")} description={t("journal.intro")} />
      <StockTabs current="journal" />
      <div className="flex flex-wrap gap-3">
        <Segmented
          label={t("journal.kindLabel")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: t("journal.all") },
            { value: "out", label: t("journal.out") },
            { value: "in", label: t("journal.in") },
            { value: "adjustment", label: t("journal.adjustment") },
          ]}
        />
        <Segmented
          label={t("journal.whoLabel")}
          value={mine}
          onChange={setMine}
          options={[
            { value: "all", label: t("journal.everyone") },
            { value: "mine", label: t("journal.mine") },
          ]}
        />
      </div>
      {journal.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(journal.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => journal.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !journal.data ? (
        <div className="h-48 animate-pulse rounded-xl border border-line bg-surface" aria-hidden="true" />
      ) : journal.data.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
          <History className="size-8 text-muted" aria-hidden="true" />
          <p className="font-medium text-ink">{t("journal.empty")}</p>
        </div>
      ) : (
        <Card>
          <p className="mb-2 text-xs text-muted">{t("journal.latest")}</p>
          <ol className="divide-y divide-line">
            {journal.data.map((movement) => (
              <MovementItem key={movement.id} movement={movement} showPart />
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

/** On a task's page: the parts taken out of the stock for it (nothing shown when there are none). */
export function TaskStock({ taskId }: { taskId: number }) {
  const t = useTranslations("Stock");
  const journal = useJournal({ task: taskId, type: "out" });
  if (!journal.data || journal.data.length === 0) {
    return null;
  }
  return (
    <Card title={t("taskCard.title")} description={t("taskCard.intro")}>
      <ol className="divide-y divide-line">
        {journal.data.map((movement) => (
          <MovementItem key={movement.id} movement={movement} showPart showTask={false} />
        ))}
      </ol>
    </Card>
  );
}
