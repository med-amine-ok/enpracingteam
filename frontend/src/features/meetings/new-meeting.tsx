"use client";

import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { BackLink } from "@/components/ui/back-link";
import { Card, LinesPlaceholder } from "@/components/ui/card";
import { LoadError } from "@/components/ui/load-error";
import { PageHeader } from "@/components/ui/page-header";
import { useRouter } from "@/i18n/navigation";
import { MeetingForm } from "./meeting-form";
import { useMeetingRights } from "./queries";

/** Schedule a session (the bureau and the admins), then open it. */
export function NewMeeting() {
  const t = useTranslations("Meetings");
  const tShell = useTranslations("Shell");
  const router = useRouter();
  const rights = useMeetingRights();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/meetings">{t("title")}</BackLink>
      <PageHeader eyebrow={tShell("groups.execution")} title={t("newTitle")} description={t("newIntro")} />
      <Card>
        {rights.error ? (
          <LoadError error={rights.error} />
        ) : !rights.data ? (
          <LinesPlaceholder lines={4} />
        ) : rights.data.schedule ? (
          <MeetingForm onSaved={(meeting) => router.replace(`/meetings/${meeting.id}`)} />
        ) : (
          <Alert tone="info">{t("bureauOnly")}</Alert>
        )}
      </Card>
    </div>
  );
}
