"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { SelectField } from "@/components/ui/select-field";
import { updateLanguage, type LanguageChoice, type Me } from "@/features/auth/api";
import { meQueryKey } from "@/features/auth/use-me";
import { usePathname, useRouter } from "@/i18n/navigation";
import { errorText } from "@/lib/error-text";

/**
 * The language saved in the member's profile: used by the API (messages, e-mails) and applied after
 * login on every device. Empty: follow the browser.
 */
export function LanguagePreference({ current }: { current: LanguageChoice }) {
  const t = useTranslations("Profile");
  const tErrors = useTranslations("Errors");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: (language: LanguageChoice) => updateLanguage(language),
    onSuccess: (_, language) => {
      queryClient.setQueryData<Me | null>(meQueryKey, (me) => (me ? { ...me, language } : me));
      if (language && language !== locale) {
        router.replace(pathname, { locale: language });
      }
    },
  });

  return (
    <div className="space-y-4">
      <SelectField
        label={t("languageLabel")}
        value={current}
        disabled={save.isPending}
        onChange={(event) => save.mutate(event.target.value as LanguageChoice)}
      >
        <option value="">{t("languageBrowser")}</option>
        <option value="fr" lang="fr">
          Français
        </option>
        <option value="en" lang="en">
          English
        </option>
        <option value="ar" lang="ar">
          العربية
        </option>
      </SelectField>
      {save.isError ? <Alert tone="error">{errorText(save.error, tErrors)}</Alert> : null}
      {save.isSuccess ? <Alert tone="success">{t("languageSaved")}</Alert> : null}
    </div>
  );
}
