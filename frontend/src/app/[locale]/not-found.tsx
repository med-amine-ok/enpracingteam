import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { LogoMark } from "@/components/brand/logo";
import { Link } from "@/i18n/navigation";
import { buttonClassName } from "@/components/ui/button";

export default function NotFound() {
  const t = useTranslations("NotFound");
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-sm space-y-5 text-center">
        <LogoMark className="mx-auto size-12" />
        <p className="text-sm font-semibold text-racing">404</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("title")}</h1>
        <p className="text-sm text-muted">{t("description")}</p>
        <Link href="/" className={buttonClassName("secondary", "md")}>
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          {t("back")}
        </Link>
      </div>
    </main>
  );
}
