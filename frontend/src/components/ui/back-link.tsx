import { ArrowLeft } from "lucide-react";
import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";

type BackLinkProps = Pick<ComponentProps<typeof Link>, "href" | "children">;

/**
 * "← The page above this one" (the arrow turns round in Arabic). Long names are cut with "…";
 * <bdi> keeps a French name in order on an Arabic page.
 */
export function BackLink({ href, children }: BackLinkProps) {
  return (
    <Link href={href} className="inline-flex max-w-full items-center gap-1.5 text-sm text-muted hover:text-ink">
      <ArrowLeft className="size-4 shrink-0 rtl:rotate-180" aria-hidden="true" />
      <bdi className="min-w-0 truncate">{children}</bdi>
    </Link>
  );
}
