"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { updateRaceNumber, type Me } from "@/features/auth/api";
import { meQueryKey } from "@/features/auth/use-me";
import { errorText } from "@/lib/error-text";

/** The member's number on their driver card (1 to 99), chosen by them; two members of the team never share one. */
export function RaceNumberPreference({ member }: { member: Me }) {
  const t = useTranslations("Profile");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [value, setValue] = useState(member.race_number ? String(member.race_number) : "");
  const [outOfRange, setOutOfRange] = useState(false);
  const save = useMutation({
    mutationFn: (number: number | null) => updateRaceNumber(number),
    onSuccess: (_, number) => {
      setValue(number ? String(number) : "");
      queryClient.setQueryData<Me | null>(meQueryKey, (me) => (me ? { ...me, race_number: number } : me));
    },
  });

  function choose(event: FormEvent) {
    event.preventDefault();
    const number = Number(value);
    const valid = Number.isInteger(number) && number >= 1 && number <= 99;
    setOutOfRange(!valid);
    if (valid) {
      save.mutate(number);
    }
  }

  return (
    <form className="space-y-4" onSubmit={choose} noValidate>
      <div className="flex items-end gap-4">
        <span
          className="grid h-11 w-16 shrink-0 place-items-center rounded-md bg-navy font-display text-3xl leading-none font-extrabold text-white"
          aria-hidden="true"
        >
          {member.race_number ?? "—"}
        </span>
        <div className="flex-1">
          <TextField
            label={t("raceNumber")}
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={value}
            aria-invalid={outOfRange || undefined}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
      </div>
      {outOfRange ? <Alert tone="error">{t("raceRange")}</Alert> : null}
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">{t("raceSaved")}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={save.isPending}>
          {t("raceSave")}
        </Button>
        {member.race_number ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            {t("raceClear")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
