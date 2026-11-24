import type { LucideIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** The bar under a title: one line, which scrolls sideways when it is wider than the screen (a phone). The grey
 * line is drawn inside it, under the tabs, so that it never grows by a pixel and shows a scroll bar of its own. */
export const tabBarClassName =
  "flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-line)] [scrollbar-width:thin]";

/** A tab of that bar: the current one underlined in red. */
export function tabClassName(current: boolean) {
  return cn(
    "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors",
    current ? "border-racing text-ink" : "border-transparent text-muted hover:text-ink",
  );
}

export type PageTab = { key: string; href: string; icon: LucideIcon; label: string };

/** The pages of a module, under its title. */
export function PageTabs({ label, tabs, current }: { label: string; tabs: readonly PageTab[]; current: string }) {
  return (
    <nav aria-label={label} className={tabBarClassName}>
      {tabs.map(({ key, href, icon: Icon, label: name }) => (
        <Link
          key={key}
          href={href}
          aria-current={key === current ? "page" : undefined}
          className={tabClassName(key === current)}
        >
          <Icon className="size-4" aria-hidden="true" />
          {name}
        </Link>
      ))}
    </nav>
  );
}
