"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ALWAYS_EMAILED, EMAIL_TOPICS, updateMutedEmailTopics, type EmailTopic, type Me } from "@/features/auth/api";
import { meQueryKey } from "@/features/auth/use-me";
import { errorText } from "@/lib/error-text";

/** Which e-mails of the ERP the member receives, by subject (decision D-023): the notifications stay in the
 * ERP; the warnings and exclusions are always e-mailed. */
export function EmailPreference({ member }: { member: Me }) {
  const t = useTranslations("Profile");
  const tErrors = useTranslations("Errors");
  const queryClient = useQueryClient();
  const [muted, setMuted] = useState<EmailTopic[]>(member.muted_email_topics);
  const save = useMutation({
    mutationFn: (topics: EmailTopic[]) => updateMutedEmailTopics(topics),
    onSuccess: (_, topics) =>
      queryClient.setQueryData<Me | null>(meQueryKey, (me) => (me ? { ...me, muted_email_topics: topics } : me)),
  });

  function toggle(topic: EmailTopic) {
    save.reset();
    setMuted((current) => (current.includes(topic) ? current.filter((other) => other !== topic) : [...current, topic]));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(EMAIL_TOPICS.filter((topic) => muted.includes(topic)));
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <fieldset className="space-y-2.5">
        <legend className="sr-only">{t("emailsTitle")}</legend>
        {EMAIL_TOPICS.map((topic) => {
          const always = ALWAYS_EMAILED.includes(topic);
          return (
            <label key={topic} className="flex items-start gap-3 text-sm text-ink">
              <input
                type="checkbox"
                checked={always || !muted.includes(topic)}
                disabled={always}
                onChange={() => toggle(topic)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-navy disabled:cursor-not-allowed"
              />
              <span>
                {t(`emailTopics.${topic}`)}
                {always ? <span className="block text-xs text-muted">{t("emailsAlways")}</span> : null}
              </span>
            </label>
          );
        })}
      </fieldset>
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">{t("emailsSaved")}</Alert> : null}
      <Button type="submit" size="sm" loading={save.isPending}>
        {t("emailsSave")}
      </Button>
    </form>
  );
}
