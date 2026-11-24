"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { PART_CATEGORIES, type Part, type PartCategory } from "@/features/purchasing/api";
import { KnownPart } from "@/features/purchasing/purchase-form";
import { useRouter } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import { createStockLine, type StockLineCreate } from "./api";
import { refreshStock } from "./queries";

/** A new stock line (managers): a part, its place, its threshold and how many are already there. */
export function NewStockLine() {
  const t = useTranslations("Stock");
  const tShell = useTranslations("Shell");
  const tPurchasing = useTranslations("Purchasing");
  const tErrors = useTranslations("Errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"known" | "new">("known");
  const [part, setPart] = useState<Part | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<PartCategory>("other");
  const [reference, setReference] = useState("");
  const [location, setLocation] = useState("");
  const [threshold, setThreshold] = useState("0");
  const [quantity, setQuantity] = useState("0");
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState("");
  const notesId = useId();

  const save = useMutation({
    mutationFn: (body: StockLineCreate) => createStockLine(body),
    onSuccess: async (line) => {
      await refreshStock(queryClient);
      router.push(`/stock/${line.id}`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const counts = [Number(threshold), Number(quantity)];
    if (mode === "known" ? !part : !name.trim()) {
      setProblem(tPurchasing("form.partMissing"));
      return;
    }
    if (counts.some((value) => !Number.isInteger(value) || value < 0)) {
      setProblem(t("form.numbersInvalid"));
      return;
    }
    setProblem("");
    save.mutate({
      ...(mode === "known"
        ? { part_id: part!.id }
        : { new_part: { name: name.trim(), category, reference: reference.trim() } }),
      location: location.trim(),
      min_threshold: counts[0],
      initial_quantity: counts[1],
      notes: notes.trim(),
    });
  }

  const message = problem || (save.isError ? errorText(save.error, tErrors) : "");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/stock">{t("title")}</BackLink>
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("form.title")} description={t("form.intro")} />
      <form
        onSubmit={submit}
        className="space-y-6 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6"
        noValidate
      >
        <Segmented
          label={tPurchasing("form.partMode")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "known", label: tPurchasing("form.knownPart") },
            { value: "new", label: tPurchasing("form.newPart") },
          ]}
        />
        {mode === "known" ? (
          <KnownPart part={part} onChange={setPart} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label={tPurchasing("form.partName")}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <SelectField
              label={tPurchasing("form.category")}
              value={category}
              onChange={(event) => setCategory(event.target.value as PartCategory)}
            >
              {PART_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {tPurchasing(`category.${value}`)}
                </option>
              ))}
            </SelectField>
            <TextField
              label={tPurchasing("form.reference")}
              valueDir="ltr"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label={t("form.location")}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder={t("form.locationExample")}
          />
          <TextField
            label={t("form.threshold")}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
          <TextField
            label={t("form.quantity")}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
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
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink shadow-xs focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none"
          />
        </div>
        {message ? <Alert tone="error">{message}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={save.isPending}>
            {t("form.create")}
          </Button>
          <Button variant="secondary" onClick={() => router.push("/stock")}>
            {tPurchasing("form.cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}
