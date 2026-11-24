"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { clubToday } from "@/lib/dates";

export type Arrival = { day: string; location: string; quantity?: number };

type ReceiveFormProps = {
  title: string;
  hint: string;
  /** The parts of one order: how many were asked and have arrived so far (a grouped order has none). */
  parts?: { quantity: number; received: number };
  pending: boolean;
  error: ReactNode;
  onSubmit: (arrival: Arrival) => void;
  onClose: () => void;
};

/** Parts arrived: the day, where they are stored and, for one order, how many (all those still to come
 * by default; fewer when only part of them arrived, decision D-023). */
export function ReceiveForm({ title, hint, parts, pending, error, onSubmit, onClose }: ReceiveFormProps) {
  const t = useTranslations("Purchasing");
  const today = clubToday(new Date());
  const rest = parts ? parts.quantity - parts.received : 0;
  const [day, setDay] = useState(today);
  const [location, setLocation] = useState("");
  const [quantity, setQuantity] = useState(String(rest));
  const count = Math.min(Math.max(Math.trunc(Number(quantity) || 0), 1), rest);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ day: day || today, location: location.trim(), ...(parts ? { quantity: count } : {}) });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-line bg-canvas p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="text-sm text-muted">{hint}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {parts ? (
          <TextField
            label={t("panels.receiveQuantity", { count: rest })}
            type="number"
            min={1}
            max={rest}
            step={1}
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        ) : null}
        <TextField
          label={t("panels.deliveredOn")}
          type="date"
          max={today}
          value={day}
          onChange={(event) => setDay(event.target.value)}
        />
        <TextField
          label={t("panels.location")}
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          placeholder={t("panels.locationExample")}
        />
      </div>
      {error}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={pending} autoFocus>
          {t("panels.receiveConfirm")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t("panels.back")}
        </Button>
      </div>
    </form>
  );
}
