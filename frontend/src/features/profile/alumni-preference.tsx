"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { updateAlumniProfile, type AlumniProfile, type Me } from "@/features/auth/api";
import { meQueryKey } from "@/features/auth/use-me";
import { errorText } from "@/lib/error-text";

/** What an alumni tells the team about their life after it: shown on their sheet and in the directory. */
export function AlumniPreference({ member }: { member: Me }) {
  const t = useTranslations("Profile");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const saved = member.alumni_profile;
  const [year, setYear] = useState(saved?.graduation_year ? String(saved.graduation_year) : "");
  const [position, setPosition] = useState(saved?.current_position ?? "");
  const [company, setCompany] = useState(saved?.current_company ?? "");
  const [linkedin, setLinkedin] = useState(saved?.linkedin_url ?? "");
  const [mentor, setMentor] = useState(saved?.willing_to_mentor ?? false);
  const save = useMutation({
    mutationFn: (body: AlumniProfile) => updateAlumniProfile(body),
    onSuccess: (profile) => {
      queryClient.setQueryData<Me | null>(meQueryKey, (me) => (me ? { ...me, alumni_profile: profile } : me));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const body: AlumniProfile = {
      graduation_year: year ? Number(year) : null,
      current_position: position.trim(),
      current_company: company.trim(),
      linkedin_url: linkedin.trim(),
      willing_to_mentor: mentor,
    };
    save.mutate(body);
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("alumniYear")}
          type="number"
          inputMode="numeric"
          value={year}
          onChange={(event) => setYear(event.target.value)}
        />
        <TextField label={t("alumniCompany")} value={company} onChange={(event) => setCompany(event.target.value)} />
        <TextField label={t("alumniPosition")} value={position} onChange={(event) => setPosition(event.target.value)} />
        <TextField
          label={t("alumniLinkedin")}
          type="url"
          valueDir="ltr"
          placeholder="https://www.linkedin.com/in/…"
          value={linkedin}
          onChange={(event) => setLinkedin(event.target.value)}
        />
      </div>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-1"
          checked={mentor}
          onChange={(event) => setMentor(event.target.checked)}
        />
        <span>
          {t("alumniMentor")} <span className="block text-xs text-muted">{t("alumniMentorHint")}</span>
        </span>
      </label>
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">{t("alumniSaved")}</Alert> : null}
      <Button type="submit" size="sm" loading={save.isPending}>
        {t("alumniSave")}
      </Button>
    </form>
  );
}
