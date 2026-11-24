"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { STUDY_LEVELS, updateStudies, type Me, type StudyLevel } from "@/features/auth/api";
import { meQueryKey } from "@/features/auth/use-me";
import { errorText } from "@/lib/error-text";

/** The member's year and field of study: the Bureau checks with it the charter's art. 13. */
export function StudyPreference({ member }: { member: Me }) {
  const t = useTranslations("Profile");
  const tEngagement = useTranslations("Engagement");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<StudyLevel | "">(member.study_level ?? "");
  const [field, setField] = useState(member.study_field ?? "");
  const save = useMutation({
    mutationFn: () => updateStudies({ study_level: level, study_field: field.trim() }),
    onSuccess: () => {
      queryClient.setQueryData<Me | null>(meQueryKey, (me) =>
        me ? { ...me, study_level: level, study_field: field.trim() } : me,
      );
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <SelectField
        label={t("studyLevel")}
        value={level}
        onChange={(event) => setLevel(event.target.value as StudyLevel | "")}
      >
        <option value="">{t("studyNotSaid")}</option>
        {STUDY_LEVELS.map((value) => (
          <option key={value} value={value}>
            {tEngagement(`studyLevel.${value}`)}
          </option>
        ))}
      </SelectField>
      <TextField label={t("studyField")} value={field} onChange={(event) => setField(event.target.value)} />
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">{t("studySaved")}</Alert> : null}
      <Button type="submit" size="sm" loading={save.isPending}>
        {t("studySave")}
      </Button>
    </form>
  );
}
