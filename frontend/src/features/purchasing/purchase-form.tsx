"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useId, useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { LoadError } from "@/components/ui/load-error";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useOrgUnits } from "@/features/members/use-members";
import { useProjects, useSubsystems } from "@/features/work/queries";
import { errorText } from "@/lib/error-text";
import {
  PART_CATEGORIES,
  PURCHASE_PRIORITIES,
  createPurchase,
  updatePurchase,
  type Part,
  type PartCategory,
  type PurchasePriority,
  type PurchaseRequestDetail,
  type PurchaseWrite,
} from "./api";
import { refreshPurchasing, useParts, useSuppliers } from "./queries";

type NewPart = {
  name: string;
  category: PartCategory;
  reference: string;
  material: string;
  process: string;
  description: string;
};

const EMPTY_PART: NewPart = { name: "", category: "other", reference: "", material: "", process: "", description: "" };

const textareaClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none";

type PurchaseFormProps = {
  /** The request to change (it awaits its leader); none: a new request. */
  purchase?: PurchaseRequestDetail;
  /** A known part to start with (a stock line's "ask for a purchase"). */
  initialPart?: Part;
  onSaved: (purchase: PurchaseRequestDetail) => void;
  onCancel: () => void;
};

/** Ask for a part, or change the request while it awaits its leader. */
export function PurchaseForm({ purchase, initialPart, onSaved, onCancel }: PurchaseFormProps) {
  const t = useTranslations("Purchasing");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const projects = useProjects();
  const units = useOrgUnits();
  const suppliers = useSuppliers();

  const [project, setProject] = useState<number | null>(purchase?.project?.id ?? null);
  const [subsystem, setSubsystem] = useState<number | null>(purchase?.subsystem?.id ?? null);
  const [unit, setUnit] = useState<number | null>(purchase?.subsystem ? null : (purchase?.org_unit?.id ?? null));
  const subsystems = useSubsystems(project);
  const [partMode, setPartMode] = useState<"new" | "known">(purchase || initialPart ? "known" : "new");
  const [knownPart, setKnownPart] = useState<Part | null>(purchase?.part ?? initialPart ?? null);
  const [newPart, setNewPart] = useState<NewPart>(EMPTY_PART);
  const [quantity, setQuantity] = useState(String(purchase?.quantity ?? 1));
  const [priority, setPriority] = useState<PurchasePriority>(purchase?.priority || "medium");
  const [neededBy, setNeededBy] = useState(purchase?.requested_date ?? "");
  const [supplier, setSupplier] = useState<number | null>(purchase?.suggested_supplier?.id ?? null);
  const [notes, setNotes] = useState(purchase?.notes ?? "");
  const [problem, setProblem] = useState("");
  const notesId = useId();

  const projectUnit = projects.data?.find((item) => item.id === project)?.org_unit.id ?? null;

  const save = useMutation({
    mutationFn: (body: PurchaseWrite) => (purchase ? updatePurchase(purchase.id, body) : createPurchase(body)),
    onSuccess: async (saved) => {
      await refreshPurchasing(queryClient);
      onSaved(saved);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const count = Number(quantity);
    const forUnit = subsystem ? null : project ? projectUnit : unit;
    if (!subsystem && !forUnit) {
      setProblem(t("form.targetMissing"));
      return;
    }
    if (partMode === "known" ? !knownPart : !newPart.name.trim()) {
      setProblem(t("form.partMissing"));
      return;
    }
    if (!Number.isInteger(count) || count < 1) {
      setProblem(t("form.quantityInvalid"));
      return;
    }
    setProblem("");
    save.mutate({
      ...(partMode === "known" ? { part_id: knownPart!.id } : { new_part: { ...newPart, name: newPart.name.trim() } }),
      quantity: count,
      priority,
      requested_date: neededBy || null,
      notes,
      suggested_supplier_id: supplier,
      subsystem_id: subsystem,
      ...(subsystem ? {} : { org_unit_id: forUnit }),
    });
  }

  const message = problem || (save.isError ? errorText(save.error, tErrors) : "");

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <Fieldset legend={t("form.forWhat")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("form.project")}
            value={project ?? ""}
            onChange={(event) => {
              setProject(event.target.value ? Number(event.target.value) : null);
              setSubsystem(null);
            }}
          >
            <option value="">{t("form.noProject")}</option>
            {projects.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
          {project ? (
            <SelectField
              label={t("form.subsystem")}
              value={subsystem ?? ""}
              onChange={(event) => setSubsystem(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">{t("form.wholeProject")}</option>
              {subsystems.data?.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </SelectField>
          ) : (
            <SelectField
              label={t("form.unit")}
              value={unit ?? ""}
              onChange={(event) => setUnit(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">{t("form.chooseUnit")}</option>
              {units.data
                ?.filter((item) => item.is_active)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </SelectField>
          )}
        </div>
        <p className="text-xs text-muted">{t("form.approvalHint")}</p>
      </Fieldset>

      <Fieldset legend={t("form.whichPart")}>
        <Segmented
          label={t("form.partMode")}
          value={partMode}
          onChange={setPartMode}
          options={[
            { value: "new", label: t("form.newPart") },
            { value: "known", label: t("form.knownPart") },
          ]}
        />
        {partMode === "known" ? (
          <KnownPart part={knownPart} onChange={setKnownPart} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t("form.partName")}
              required
              value={newPart.name}
              onChange={(event) => setNewPart({ ...newPart, name: event.target.value })}
            />
            <SelectField
              label={t("form.category")}
              value={newPart.category}
              onChange={(event) => setNewPart({ ...newPart, category: event.target.value as PartCategory })}
            >
              {PART_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(`category.${category}`)}
                </option>
              ))}
            </SelectField>
            <TextField
              label={t("form.reference")}
              value={newPart.reference}
              onChange={(event) => setNewPart({ ...newPart, reference: event.target.value })}
              valueDir="ltr"
            />
            <TextField
              label={t("form.material")}
              value={newPart.material}
              onChange={(event) => setNewPart({ ...newPart, material: event.target.value })}
            />
            <TextField
              label={t("form.process")}
              value={newPart.process}
              onChange={(event) => setNewPart({ ...newPart, process: event.target.value })}
              placeholder={t("form.processExample")}
            />
            <TextField
              label={t("form.description")}
              value={newPart.description}
              onChange={(event) => setNewPart({ ...newPart, description: event.target.value })}
            />
          </div>
        )}
      </Fieldset>

      <Fieldset legend={t("form.howMany")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label={t("form.quantity")}
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            required
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
          <TextField
            label={t("form.neededBy")}
            type="date"
            value={neededBy}
            onChange={(event) => setNeededBy(event.target.value)}
          />
          <SelectField
            label={t("form.suggestedSupplier")}
            value={supplier ?? ""}
            onChange={(event) => setSupplier(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">{t("form.noSupplier")}</option>
            {suppliers.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink">{t("form.priority")}</span>
          <Segmented
            label={t("form.priority")}
            value={priority}
            onChange={setPriority}
            options={PURCHASE_PRIORITIES.map((value) => ({
              value,
              label: t(`priorityOption.${value}`),
            }))}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={notesId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
            {t("form.notes")}
          </label>
          <textarea
            id={notesId}
            rows={3}
            dir="auto"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className={textareaClass}
          />
        </div>
      </Fieldset>

      {message ? <Alert tone="error">{message}</Alert> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={save.isPending}>
          {purchase ? t("form.save") : t("form.send")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("form.cancel")}
        </Button>
      </div>
    </form>
  );
}

function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6">
      <legend className="px-1 text-base font-semibold text-ink">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** A part already known (bought before, or in stock): searched by name or reference. */
export function KnownPart({ part, onChange }: { part: Part | null; onChange: (part: Part | null) => void }) {
  const t = useTranslations("Purchasing");
  const [search, setSearch] = useState("");
  const parts = useParts(useDeferredValue(search));
  if (part) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-4 py-3">
        <div className="min-w-0 text-sm">
          <p className="font-medium text-ink">
            <bdi>{part.name}</bdi>
          </p>
          <p className="text-xs text-muted">
            {[t(`category.${part.category}`), part.reference].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          {t("form.otherPart")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <TextField
        label={t("form.searchPart")}
        type="search"
        icon={<Search />}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("form.searchPartPlaceholder")}
      />
      {parts.error ? (
        <LoadError error={parts.error} />
      ) : parts.data ? (
        parts.data.length === 0 ? (
          <p className="text-sm text-muted">{t("form.noPartFound")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {parts.data.slice(0, 8).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onChange(item)}
                  className="flex w-full flex-col items-start px-4 py-2.5 text-start text-sm hover:bg-canvas"
                >
                  <bdi className="font-medium text-ink">{item.name}</bdi>
                  <span className="text-xs text-muted">
                    {[t(`category.${item.category}`), item.reference].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
