"use client";

import { Filter, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, type AuditFilters } from "./api";
import { AuditTimeline, useAuditLabels } from "./audit-timeline";
import { useAudit } from "./queries";
import { PanelPlaceholder, QueryFailure, ScoringGate, ScoringHeader } from "./scoring-parts";

/** The ranking audit log (guide §14.6): who did what, when, to which entity, before/after, and why. */
export function ScoringAuditPage() {
  return (
    <ScoringGate>
      <ScoringAudit />
    </ScoringGate>
  );
}

const EMPTY: Required<Omit<AuditFilters, "actor">> = { action: "", entity_type: "", entity_id: "", search: "" };

function ScoringAudit() {
  const t = useTranslations("Scoring");
  const labels = useAuditLabels();
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState<AuditFilters>({});
  const audit = useAudit(filters);
  const set = (key: keyof typeof EMPTY) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));

  if (audit.isError) {
    return <QueryFailure error={audit.error} />;
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ScoringHeader current="audit" title={t("audit.title")} description={t("audit.intro")} />
      <form
        className="flex flex-wrap items-end gap-3"
        aria-label={t("audit.filters")}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setFilters(Object.fromEntries(Object.entries(draft).filter(([, value]) => value.trim())));
        }}
      >
        <div className="w-52">
          <SelectField
            label={t("audit.actionLabel")}
            value={draft.action}
            onChange={(event) => set("action")(event.target.value)}
          >
            <option value="">{t("audit.all")}</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {labels.action(action)}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-52">
          <SelectField
            label={t("audit.entityLabel")}
            value={draft.entity_type}
            onChange={(event) => set("entity_type")(event.target.value)}
          >
            <option value="">{t("audit.all")}</option>
            {AUDIT_ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {labels.entity(type)}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="w-32">
          <TextField
            label={t("audit.entityId")}
            type="number"
            min={1}
            valueDir="ltr"
            value={draft.entity_id}
            onChange={(event) => set("entity_id")(event.target.value)}
          />
        </div>
        <div className="w-60">
          <TextField
            label={t("audit.search")}
            type="search"
            icon={<Search />}
            value={draft.search}
            onChange={(event) => set("search")(event.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary">
          <Filter className="size-4" aria-hidden="true" />
          {t("audit.apply")}
        </Button>
      </form>
      {!audit.data ? (
        <PanelPlaceholder />
      ) : (
        <Card title={t("audit.timeline", { count: audit.data.length })}>
          <AuditTimeline entries={audit.data} />
        </Card>
      )}
    </div>
  );
}
