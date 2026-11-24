"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Mail, SquareTerminal } from "lucide-react";
import { hasLocale, useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/ui/otp-input";
import { TextField } from "@/components/ui/text-field";
import { useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { safeNextPath } from "@/lib/auth/session-hint";
import { errorText } from "@/lib/error-text";
import { fetchMe, requestCode, verifyCode } from "./api";
import { meQueryKey } from "./use-me";

/** Wait before asking for another code (OTP_RESEND_COOLDOWN_SECONDS in backend/config/settings.py). */
export const RESEND_COOLDOWN_SECONDS = 45;
/** OTP_LENGTH in backend/config/settings.py. */
const CODE_LENGTH = 6;

/** Login without a password: the member's e-mail address, then the code the API sends there. */
export function LoginForm() {
  const [email, setEmail] = useState("");
  // When the last code was sent (null: still on the e-mail step).
  const [sentAt, setSentAt] = useState<number | null>(null);

  if (sentAt === null) {
    return (
      <EmailStep
        initialEmail={email}
        onSent={(address) => {
          setEmail(address);
          setSentAt(Date.now());
        }}
      />
    );
  }
  return (
    <CodeStep
      email={email}
      sentAt={sentAt}
      onResent={() => setSentAt(Date.now())}
      onChangeEmail={() => setSentAt(null)}
    />
  );
}

function EmailStep({ initialEmail, onSent }: { initialEmail: string; onSent: (email: string) => void }) {
  const t = useTranslations("Login");
  const tErrors = useTranslations("Errors");
  const [value, setValue] = useState(initialEmail);
  const send = useMutation({
    mutationFn: (email: string) => requestCode(email),
    onSuccess: (_, email) => onSent(email),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send.mutate(value.trim());
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">{t("portal")}</p>
        <h1 className="font-display text-3xl font-extrabold tracking-wide text-navy uppercase">{t("title")}</h1>
        <p className="text-sm leading-relaxed text-muted">{t("subtitle")}</p>
      </header>
      {send.isError ? <Alert tone="error">{errorText(send.error, tErrors)}</Alert> : null}
      <TextField
        label={t("emailLabel")}
        type="email"
        name="email"
        autoComplete="email"
        required
        autoFocus
        valueDir="ltr"
        icon={<Mail />}
        placeholder={t("emailPlaceholder")}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-invalid={send.isError || undefined}
      />
      <Button type="submit" className="w-full" loading={send.isPending}>
        {t("sendCode")}
        <ArrowRight className="size-4 rtl:rotate-180" aria-hidden="true" />
      </Button>
    </form>
  );
}

type CodeStepProps = {
  email: string;
  sentAt: number;
  onResent: () => void;
  onChangeEmail: () => void;
};

function CodeStep({ email, sentAt, onResent, onChangeEmail }: CodeStepProps) {
  const t = useTranslations("Login");
  const tErrors = useTranslations("Errors");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  // A new key empties the boxes after a wrong code.
  const [attempt, setAttempt] = useState(0);
  const secondsLeft = useSecondsLeft(sentAt, RESEND_COOLDOWN_SECONDS);

  const verify = useMutation({
    mutationFn: (value: string) => verifyCode(email, value),
    onSuccess: async () => {
      // Nothing cached for a previous member on this browser (data, rights) is shown to this one.
      queryClient.clear();
      const me = await queryClient.fetchQuery({ queryKey: meQueryKey, queryFn: fetchMe });
      // The language saved in the member's profile wins, as in the API: the same on every device.
      const language = me?.language && hasLocale(routing.locales, me.language) ? me.language : locale;
      router.replace(safeNextPath(searchParams.get("next")), { locale: language });
    },
    onError: () => {
      setCode("");
      setAttempt((count) => count + 1);
    },
  });
  const resend = useMutation({ mutationFn: () => requestCode(email), onSuccess: onResent });
  const busy = verify.isPending || verify.isSuccess;

  function submitCode(value: string) {
    if (value.length === CODE_LENGTH && !busy) {
      verify.mutate(value);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitCode(code);
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">{t("portal")}</p>
        <h1 className="font-display text-3xl font-extrabold tracking-wide text-navy uppercase">{t("codeTitle")}</h1>
        <p className="text-sm leading-relaxed text-muted">
          {t.rich("codeSent", {
            email,
            address: (chunks) => <bdi className="font-medium text-ink">{chunks}</bdi>,
          })}
        </p>
      </header>
      {verify.isError ? <Alert tone="error">{errorText(verify.error, tErrors)}</Alert> : null}
      {resend.isError ? <Alert tone="error">{errorText(resend.error, tErrors)}</Alert> : null}
      {resend.isSuccess && !verify.isError ? <Alert tone="success">{t("resent")}</Alert> : null}
      <OtpInput
        key={attempt}
        length={CODE_LENGTH}
        label={t("codeLabel")}
        digitLabel={(position, total) => t("digitLabel", { position, total })}
        autoFocus
        disabled={busy}
        invalid={verify.isError}
        onChange={setCode}
        onComplete={submitCode}
      />
      <Button type="submit" className="w-full" loading={busy} disabled={code.length !== CODE_LENGTH}>
        {t("submit")}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <Button variant="ghost" size="sm" className="-ms-3" onClick={onChangeEmail} disabled={busy}>
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          {t("changeEmail")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="-me-3"
          onClick={() => resend.mutate()}
          disabled={secondsLeft > 0 || busy}
          loading={resend.isPending}
        >
          {/* `seconds` as text: Latin digits (as written in Algeria), also on Arabic pages. */}
          {secondsLeft > 0 ? t("resendIn", { count: secondsLeft, seconds: String(secondsLeft) }) : t("resend")}
        </Button>
      </div>
      {process.env.NODE_ENV === "development" ? (
        <p className="flex gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-muted">
          <SquareTerminal className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {t("devHint")}
        </p>
      ) : null}
    </form>
  );
}

/** Seconds left of a `seconds`-long wait that started at `start` (ms), updated every second. */
function useSecondsLeft(start: number, seconds: number) {
  const [now, setNow] = useState(start);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [start]);
  const left = Math.ceil((start + seconds * 1000 - now) / 1000);
  return Math.min(seconds, Math.max(0, left));
}
