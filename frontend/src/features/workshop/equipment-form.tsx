"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { useRouter } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";
import {
  CATEGORIES,
  SETTABLE_STATUSES,
  createEquipment,
  updateEquipment,
  type EquipmentCategory,
  type EquipmentDetail,
  type SettableStatus,
} from "./api";
import { refreshWorkshop } from "./queries";
import { textareaClass } from "./workshop-parts";

type EquipmentFormProps = {
  /** The item to change; a new one when absent. */
  equipment?: EquipmentDetail;
  onSaved: (equipment: EquipmentDetail) => void;
  onCancel?: () => void;
};

/** Add or change an item (the equipment managers). Its status is set here, except "borrowed" (the loans). */
export function EquipmentForm({ equipment, onSaved, onCancel }: EquipmentFormProps) {
  const t = useTranslations("Workshop");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const descriptionId = useId();
  const [name, setName] = useState(equipment?.name ?? "");
  const [category, setCategory] = useState<EquipmentCategory>(equipment?.category ?? "machine");
  const [location, setLocation] = useState(equipment?.location ?? "");
  const [description, setDescription] = useState(equipment?.description ?? "");
  const [certification, setCertification] = useState(equipment?.requires_certification ?? false);
  const [loanable, setLoanable] = useState(equipment?.loanable ?? true);
  const [purchased, setPurchased] = useState(equipment?.purchased_at ?? "");
  const lent = equipment?.status === "borrowed";
  const [status, setStatus] = useState<SettableStatus>(
    equipment && equipment.status !== "borrowed" ? equipment.status : "available",
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        category,
        location,
        description,
        requires_certification: certification,
        loanable,
        purchased_at: purchased || null,
        ...(equipment && !lent ? { status } : {}),
      };
      return equipment ? updateEquipment(equipment.id, body) : createEquipment(body);
    },
    onSuccess: async (saved) => {
      await refreshWorkshop(queryClient);
      onSaved(saved);
    },
  });

  return (
    <form
      className="space-y-5"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (name.trim()) {
          save.mutate();
        }
      }}
    >
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      <TextField
        label={t("nameLabel")}
        required
        maxLength={255}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t("categoryLabel")}
          value={category}
          onChange={(event) => setCategory(event.target.value as EquipmentCategory)}
        >
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(`category.${value}`)}
            </option>
          ))}
        </SelectField>
        <TextField label={t("locationLabel")} value={location} onChange={(event) => setLocation(event.target.value)} />
        <TextField
          label={t("purchasedLabel")}
          type="date"
          value={purchased}
          onChange={(event) => setPurchased(event.target.value)}
        />
        {equipment && !lent ? (
          <SelectField
            label={t("statusLabel")}
            value={status}
            onChange={(event) => setStatus(event.target.value as SettableStatus)}
          >
            {SETTABLE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={descriptionId} className="block text-xs font-semibold tracking-widest text-muted uppercase">
          {t("descriptionLabel")}
        </label>
        <textarea
          id={descriptionId}
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={textareaClass}
        />
      </div>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-1"
          checked={certification}
          onChange={(event) => setCertification(event.target.checked)}
        />
        <span>
          {t("requiresCertificationLabel")}
          <span className="block text-xs text-muted">{t("requiresCertificationHint")}</span>
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={loanable} onChange={(event) => setLoanable(event.target.checked)} />
        {t("loanableLabel")}
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending} disabled={!name.trim()}>
          {equipment ? t("save") : t("create")}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function NewEquipment() {
  const t = useTranslations("Workshop");
  const tShell = useTranslations("Shell");
  const router = useRouter();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/workshop">{t("title")}</BackLink>
      <PageHeader eyebrow={tShell("groups.logistics")} title={t("newTitle")} description={t("newIntro")} />
      <Card>
        <EquipmentForm onSaved={(saved) => router.replace(`/workshop/${saved.id}`)} />
      </Card>
    </div>
  );
}
