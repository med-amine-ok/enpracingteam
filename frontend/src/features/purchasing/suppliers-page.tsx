"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Factory, Mail, MapPin, Pencil, Phone, Plus, Search, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { normalizeText } from "@/features/members/search";
import { useMembers } from "@/features/members/use-members";
import { errorText } from "@/lib/error-text";
import {
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
  createSupplier,
  updateSupplier,
  type Supplier,
  type SupplierStatus,
  type SupplierType,
  type SupplierWrite,
} from "./api";
import { SupplierStatusBadge, SupplierTypeBadge } from "./badges";
import { PurchasingTabs } from "./purchasing-tabs";
import { refreshPurchasing, usePurchaseSummary, useSuppliers } from "./queries";

const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

function supplierMatches(supplier: Supplier, words: string[]) {
  const text = normalizeText(
    [supplier.name, supplier.technical_capabilities, supplier.city, supplier.country].join(" "),
  );
  return words.every((word) => text.includes(word));
}

/** The club's suppliers and subcontractors: what they can do, where, how far the request went. */
export function SuppliersPage() {
  const t = useTranslations("Purchasing");
  const tShell = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const suppliers = useSuppliers();
  const summary = usePurchaseSummary();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<SupplierType | "">("");
  const [status, setStatus] = useState<SupplierStatus | "">("");
  const [adding, setAdding] = useState(false);
  const words = normalizeText(useDeferredValue(query)).split(/\s+/).filter(Boolean);
  const shown = suppliers.data?.filter(
    (supplier) =>
      supplierMatches(supplier, words) && (!type || supplier.type === type) && (!status || supplier.status === status),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("title")} description={t("suppliers.intro")}>
        {summary.data?.can_manage && !adding ? (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("suppliers.add")}
          </Button>
        ) : null}
      </PageHeader>
      <PurchasingTabs current="suppliers" />

      {adding ? (
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 className="mb-4 text-base font-semibold text-ink">{t("suppliers.addTitle")}</h2>
          <SupplierForm onDone={() => setAdding(false)} />
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <TextField
          label={t("suppliers.search")}
          type="search"
          icon={<Search />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("suppliers.searchPlaceholder")}
        />
        <SelectField
          label={t("suppliers.type")}
          value={type}
          onChange={(event) => setType(event.target.value as SupplierType | "")}
        >
          <option value="">{t("suppliers.allTypes")}</option>
          {SUPPLIER_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`supplierType.${value}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("suppliers.status")}
          value={status}
          onChange={(event) => setStatus(event.target.value as SupplierStatus | "")}
        >
          <option value="">{t("suppliers.allStatuses")}</option>
          {SUPPLIER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`supplierStatus.${value}`)}
            </option>
          ))}
        </SelectField>
      </div>

      {suppliers.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorText(suppliers.error, tErrors)}</Alert>
          <Button variant="secondary" onClick={() => suppliers.refetch()}>
            {t("retry")}
          </Button>
        </div>
      ) : !shown ? (
        <ul className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="h-40 animate-pulse rounded-xl border border-line bg-surface" />
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
          <Factory className="size-8 text-muted" aria-hidden="true" />
          <p className="font-medium text-ink">
            {suppliers.data?.length ? t("suppliers.noMatch") : t("suppliers.empty")}
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted" aria-live="polite">
            {t("suppliers.count", { count: shown.length, shown: String(shown.length) })}
          </p>
          <ul className="grid gap-4 sm:grid-cols-2">
            {shown.map((supplier) => (
              <SupplierCard key={supplier.id} supplier={supplier} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SupplierCard({ supplier }: { supplier: Supplier }) {
  const t = useTranslations("Purchasing");
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="rounded-xl border border-navy/30 bg-surface p-5 shadow-card sm:col-span-2">
        <h2 className="mb-4 text-base font-semibold text-ink">{t("suppliers.editTitle", { name: supplier.name })}</h2>
        <SupplierForm supplier={supplier} onDone={() => setEditing(false)} />
      </li>
    );
  }
  const place = [supplier.city, supplier.country].filter(Boolean).join(", ");
  const contact = [supplier.contact_name, supplier.contact_role].filter(Boolean).join(" — ");
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h2 dir="auto" className="text-base font-semibold text-ink rtl:text-right">
            {supplier.name}
          </h2>
          <div className="flex flex-wrap gap-2">
            <SupplierTypeBadge type={supplier.type} />
            <SupplierStatusBadge status={supplier.status} />
          </div>
        </div>
        {supplier.can_edit ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label={t("suppliers.edit", { name: supplier.name })}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {supplier.technical_capabilities ? (
        <p dir="auto" className="text-sm text-ink rtl:text-right">
          {supplier.technical_capabilities}
        </p>
      ) : null}
      <ul className="space-y-1.5 text-sm text-muted">
        {place || supplier.address ? (
          <li className="flex items-start gap-2">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <bdi>{[supplier.address, place].filter(Boolean).join(" — ")}</bdi>
          </li>
        ) : null}
        {contact ? (
          <li className="flex items-start gap-2">
            <UserRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <bdi>{contact}</bdi>
          </li>
        ) : null}
        {supplier.email ? (
          <li className="flex items-start gap-2">
            <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <a href={`mailto:${supplier.email}`} className="text-navy hover:underline" dir="ltr">
              {supplier.email}
            </a>
          </li>
        ) : null}
        {supplier.phone ? (
          <li className="flex items-start gap-2">
            <Phone className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <a href={`tel:${supplier.phone.replace(/\s+/g, "")}`} className="text-navy hover:underline" dir="ltr">
              {supplier.phone}
            </a>
          </li>
        ) : null}
      </ul>
      <p className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {supplier.contacted_by ? (
          <span>
            {t("suppliers.contactedBy")}{" "}
            <bdi className="text-ink">
              {supplier.contacted_by.first_name} {supplier.contacted_by.last_name}
            </bdi>
          </span>
        ) : null}
        {supplier.average_lead_time_days !== null && supplier.average_lead_time_days !== undefined ? (
          <span>
            {t("suppliers.leadTime", {
              count: supplier.average_lead_time_days,
              shown: String(supplier.average_lead_time_days),
            })}
          </span>
        ) : null}
      </p>
      {supplier.comments ? (
        <p dir="auto" className="rounded-lg bg-canvas px-3 py-2 text-xs text-muted rtl:text-right">
          {supplier.comments}
        </p>
      ) : null}
    </li>
  );
}

/** The form's fields, as typed (strings), before they become the API's values. */
type SupplierValues = {
  name: string;
  type: string;
  status: string;
  technical_capabilities: string;
  city: string;
  country: string;
  address: string;
  contact_name: string;
  contact_role: string;
  email: string;
  phone: string;
  average_lead_time_days: string;
  comments: string;
};

/** Add a supplier, or change one (Operations). */
function SupplierForm({ supplier, onDone }: { supplier?: Supplier; onDone: () => void }) {
  const t = useTranslations("Purchasing");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const members = useMembers();
  const [values, setValues] = useState<SupplierValues>({
    name: supplier?.name ?? "",
    type: supplier?.type ?? "",
    status: supplier?.status ?? "pas_encore_envoyee",
    technical_capabilities: supplier?.technical_capabilities ?? "",
    city: supplier?.city ?? "",
    country: supplier?.country ?? "",
    address: supplier?.address ?? "",
    contact_name: supplier?.contact_name ?? "",
    contact_role: supplier?.contact_role ?? "",
    email: supplier?.email ?? "",
    phone: supplier?.phone ?? "",
    average_lead_time_days: supplier?.average_lead_time_days?.toString() ?? "",
    comments: supplier?.comments ?? "",
  });
  const [contactedBy, setContactedBy] = useState<number | null>(supplier?.contacted_by?.id ?? null);
  const [problem, setProblem] = useState("");
  const capabilitiesId = useId();
  const commentsId = useId();
  const set = (field: keyof SupplierValues) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  const save = useMutation({
    mutationFn: (body: SupplierWrite) => (supplier ? updateSupplier(supplier.id, body) : createSupplier(body)),
    onSuccess: async () => {
      await refreshPurchasing(queryClient);
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.name.trim()) {
      setProblem(t("suppliers.nameMissing"));
      return;
    }
    setProblem("");
    const lead = values.average_lead_time_days.trim();
    save.mutate({
      ...values,
      name: values.name.trim(),
      type: (values.type || null) as SupplierType | null,
      status: values.status as SupplierStatus,
      average_lead_time_days: lead ? Number(lead) : null,
      contacted_by_id: contactedBy,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label={t("suppliers.name")}
          required
          value={values.name}
          onChange={(event) => set("name")(event.target.value)}
        />
        <SelectField
          label={t("suppliers.type")}
          value={values.type}
          onChange={(event) => set("type")(event.target.value)}
        >
          <option value="">{t("suppliers.noType")}</option>
          {SUPPLIER_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`supplierType.${value}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("suppliers.status")}
          value={values.status}
          onChange={(event) => set("status")(event.target.value)}
        >
          {SUPPLIER_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`supplierStatus.${value}`)}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t("suppliers.city")}
          value={values.city}
          onChange={(event) => set("city")(event.target.value)}
        />
        <TextField
          label={t("suppliers.country")}
          value={values.country}
          onChange={(event) => set("country")(event.target.value)}
        />
        <TextField
          label={t("suppliers.leadTimeLabel")}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={values.average_lead_time_days}
          onChange={(event) => set("average_lead_time_days")(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={capabilitiesId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("suppliers.capabilities")}
        </label>
        <textarea
          id={capabilitiesId}
          rows={2}
          dir="auto"
          value={values.technical_capabilities}
          onChange={(event) => set("technical_capabilities")(event.target.value)}
          className={textareaClass}
        />
      </div>
      <fieldset className="space-y-4 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">{t("suppliers.contacts")}</legend>
        <p className="text-xs text-muted">{t("suppliers.contactsPrivacy")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("suppliers.contactName")}
            value={values.contact_name}
            onChange={(event) => set("contact_name")(event.target.value)}
          />
          <TextField
            label={t("suppliers.contactRole")}
            value={values.contact_role}
            onChange={(event) => set("contact_role")(event.target.value)}
          />
          <TextField
            label={t("suppliers.email")}
            type="email"
            valueDir="ltr"
            value={values.email}
            onChange={(event) => set("email")(event.target.value)}
          />
          <TextField
            label={t("suppliers.phone")}
            type="tel"
            valueDir="ltr"
            value={values.phone}
            onChange={(event) => set("phone")(event.target.value)}
          />
          <TextField
            label={t("suppliers.address")}
            value={values.address}
            onChange={(event) => set("address")(event.target.value)}
          />
          <SelectField
            label={t("suppliers.contactedByLabel")}
            value={contactedBy ?? ""}
            onChange={(event) => setContactedBy(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">{t("suppliers.nobody")}</option>
            {members.data
              ?.filter((member) => member.status !== "alumni")
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.first_name} {member.last_name}
                </option>
              ))}
          </SelectField>
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <label htmlFor={commentsId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("suppliers.comments")}
        </label>
        <textarea
          id={commentsId}
          rows={2}
          dir="auto"
          value={values.comments}
          onChange={(event) => set("comments")(event.target.value)}
          className={textareaClass}
        />
      </div>
      {problem || save.isError ? <Alert tone="error">{problem || errorText(save.error, tErrors)}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending}>
          {supplier ? t("suppliers.save") : t("suppliers.create")}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}
