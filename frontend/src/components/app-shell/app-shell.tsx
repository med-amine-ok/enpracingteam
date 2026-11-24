"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Bot,
  Boxes,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FolderKanban,
  Gauge,
  HandHeart,
  House,
  ListChecks,
  LoaderCircle,
  LogOut,
  Menu,
  Network,
  ShieldAlert,
  ShoppingCart,
  Trophy,
  UserRound,
  Users,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { logout, type Me } from "@/features/auth/api";
import { meQueryKey, useMe } from "@/features/auth/use-me";
import { NotificationBell } from "@/features/notifications/notification-bell";
import { ReferenceSearch } from "@/features/tasks/reference-search";
import { useReportingRights } from "@/features/team/queries";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { pageWithoutLocale } from "@/i18n/routing";
import { errorText } from "@/lib/error-text";
import { initials } from "@/lib/initials";
import { SECTION_LIVERIES, livery } from "@/lib/livery";
import { cn } from "@/lib/utils";

type NavKey =
  | "home"
  | "profile"
  | "directory"
  | "orgChart"
  | "projects"
  | "tasks"
  | "purchasing"
  | "stock"
  | "finance"
  | "meetings"
  | "documents"
  | "workshop"
  | "ranking"
  | "discipline"
  | "engagement"
  | "assistant"
  | "team"
  | "notifications";

type NavItem = { key: NavKey; icon: LucideIcon; href: string; needs?: "dashboard" };

/**
 * The menu, in the groups of the team's Figma (decision D-022). `needs`: shown only to who may see it (the Team
 * Manager's dashboard: the bureau and the leaders).
 */
const NAVIGATION: { group: "main" | "team" | "execution" | "logistics"; items: NavItem[] }[] = [
  {
    group: "main",
    items: [
      { key: "home", icon: House, href: "/" },
      { key: "profile", icon: UserRound, href: "/profile" },
      { key: "notifications", icon: Bell, href: "/notifications" },
    ],
  },
  {
    group: "team",
    items: [
      { key: "directory", icon: Users, href: "/directory" },
      { key: "orgChart", icon: Network, href: "/org-chart" },
      { key: "team", icon: Gauge, href: "/team", needs: "dashboard" },
      { key: "ranking", icon: Trophy, href: "/ranking" },
      { key: "engagement", icon: HandHeart, href: "/engagement" },
      { key: "discipline", icon: ShieldAlert, href: "/discipline" },
    ],
  },
  {
    group: "execution",
    items: [
      { key: "projects", icon: FolderKanban, href: "/projects" },
      { key: "tasks", icon: ListChecks, href: "/tasks" },
      { key: "meetings", icon: CalendarDays, href: "/meetings" },
      { key: "documents", icon: FileText, href: "/documents" },
      { key: "assistant", icon: Bot, href: "/assistant" },
    ],
  },
  {
    group: "logistics",
    items: [
      { key: "workshop", icon: Wrench, href: "/workshop" },
      { key: "purchasing", icon: ShoppingCart, href: "/purchasing" },
      { key: "stock", icon: Boxes, href: "/stock" },
      { key: "finance", icon: Wallet, href: "/finance" },
    ],
  },
];

const ALL_ITEMS = NAVIGATION.flatMap(({ items }) => items);

/**
 * Frame of the pages of logged-in members: side navigation, top bar, and the session check.
 * The frame and the page are always drawn (Next.js prerenders them, so navigation is instant);
 * what depends on the member shows a placeholder until the API has answered, in the browser.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("Shell");
  const tErrors = useTranslations("Errors");
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  // The side menu reduced to its icons (large screens), as the Figma's.
  const [collapsed, setCollapsed] = useState(false);

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Nothing of this member's (data, rights) is kept for whoever logs in next on this browser.
      queryClient.clear();
      queryClient.setQueryData(meQueryKey, null);
      router.replace("/login");
    },
  });

  // No valid session (expired, or logged out on another device): back to the login page, which
  // then reopens this page with its parameters.
  useEffect(() => {
    if (me.data === null && !signOut.isSuccess) {
      const page = pageWithoutLocale(window.location);
      router.replace(page === "/" ? "/login" : { pathname: "/login", query: { next: page } });
    }
  }, [me.data, signOut.isSuccess, router]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  const member = me.data ?? null;
  const sidebar = (reduced: boolean) => (
    <Sidebar
      member={member}
      collapsed={reduced}
      onToggle={() => setCollapsed((value) => !value)}
      onNavigate={() => setMenuOpen(false)}
      onLogout={() => signOut.mutate()}
      loggingOut={signOut.isPending || signOut.isSuccess}
      logoutError={signOut.isError ? errorText(signOut.error, tErrors) : null}
    />
  );

  return (
    <div
      className={cn(
        // On paper (a printed report), only the page: no menu, no top bar, the whole width.
        "min-h-dvh lg:grid print:block",
        collapsed ? "lg:grid-cols-[4.5rem_minmax(0,1fr)]" : "lg:grid-cols-[15rem_minmax(0,1fr)]",
      )}
    >
      <div className="print-hidden sticky top-0 hidden h-dvh lg:block">{sidebar(collapsed)}</div>
      {menuOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={t("closeMenu")}
            className="absolute inset-0 bg-navy/50 backdrop-blur-[2px]"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 start-0 w-72 max-w-[85vw] shadow-2xl">{sidebar(false)}</div>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col">
        <header className="print-hidden sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur-md sm:px-8">
          <button
            type="button"
            className="-ms-1.5 grid size-9 place-items-center rounded-lg text-ink hover:bg-canvas lg:hidden"
            aria-label={menuOpen ? t("closeMenu") : t("openMenu")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
          <p className="flex min-w-0 items-center gap-2 truncate text-sm">
            <span className="hidden text-muted sm:inline">ENP Racing</span>
            <span className="hidden text-line sm:inline" aria-hidden="true">
              /
            </span>
            <Suspense
              fallback={
                <span className="inline-block h-3 w-20 animate-pulse rounded bg-line align-middle" aria-hidden="true" />
              }
            >
              <CurrentSectionName />
            </Suspense>
          </p>
          <div className="ms-auto flex items-center gap-3 sm:gap-4">
            {member ? <ReferenceSearch /> : null}
            <Suspense fallback={null}>
              <SectionCar />
            </Suspense>
            <LanguageSwitcher />
            <NotificationBell enabled={member !== null} />
            {member ? (
              <span
                className="grid size-8 place-items-center rounded-full bg-racing text-xs font-bold text-white"
                title={`${member.first_name} ${member.last_name}`}
                aria-hidden="true"
              >
                {initials(member.first_name, member.last_name)}
              </span>
            ) : (
              <span className="size-8 animate-pulse rounded-full bg-line" aria-hidden="true" />
            )}
          </div>
          <Suspense fallback={null}>
            <SectionLine />
          </Suspense>
        </header>
        <main className="racing-canvas flex-1 px-4 py-6 sm:px-8 lg:py-10 print:p-0">
          {me.isError ? (
            <div className="mx-auto max-w-md space-y-4">
              <Alert tone="error">{errorText(me.error, tErrors)}</Alert>
              <Button variant="secondary" onClick={() => me.refetch()}>
                {t("retry")}
              </Button>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * The section of the page shown, from its address ("home" when none matches). Next.js only knows
 * the address of pages such as /projects/12 when they are requested: the components that read it
 * are wrapped in <Suspense>, so the rest of the frame is still prerendered and shows at once.
 */
function useCurrentSection(): NavKey {
  const pathname = usePathname();
  // Pages reached from a section without being in the menu: a member's sheet belongs to the directory.
  const page = pathname.startsWith("/members/") ? "/directory" : pathname;
  return ALL_ITEMS.find(({ href }) => href !== "/" && (page === href || page.startsWith(href + "/")))?.key ?? "home";
}

function CurrentSectionName() {
  const t = useTranslations("Shell");
  const section = useCurrentSection();
  return <span className="truncate font-display font-bold tracking-wide text-navy uppercase">{t(section)}</span>;
}

/** The car of the section's livery, as in the Figma's top bar (wide screens). */
function SectionCar() {
  const section = useCurrentSection();
  const colours = livery(SECTION_LIVERIES[section] ?? "projet");
  if (!colours.car) {
    return null;
  }
  return (
    <span className="hidden items-center gap-2 xl:flex" aria-hidden="true">
      <span className="text-2xs font-semibold tracking-widest text-muted uppercase">{colours.team}</span>
      <Image src={colours.car} alt="" width={1018} height={224} className="h-8 w-28 object-contain object-right" />
    </span>
  );
}

/** A line in the section's livery under the top bar. */
function SectionLine() {
  const section = useCurrentSection();
  const colours = livery(SECTION_LIVERIES[section] ?? "projet");
  return (
    <span
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 rtl:-scale-x-100"
      style={{ background: "linear-gradient(90deg, " + colours.color + ", transparent 72%)" }}
      aria-hidden="true"
    />
  );
}

type SidebarProps = {
  /** null while the API has not answered yet. */
  member: Me | null;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  onLogout: () => void;
  loggingOut: boolean;
  logoutError: string | null;
};

function Sidebar({ member, collapsed, onToggle, onNavigate, onLogout, loggingOut, logoutError }: SidebarProps) {
  const t = useTranslations("Shell");
  const role = member ? currentRole(member) : null;
  return (
    <nav
      aria-label={t("navigation")}
      className="sidebar-scroll relative flex h-full flex-col overflow-hidden bg-navy text-white/70"
    >
      <span className="h-0.5 w-full shrink-0 bg-racing" aria-hidden="true" />
      <div
        className={cn(
          "flex shrink-0 items-center border-b border-white/10 py-4",
          collapsed ? "flex-col gap-3 px-2" : "justify-between gap-2 px-4",
        )}
      >
        <Link
          href="/"
          onClick={onNavigate}
          className="min-w-0 rounded-md"
          aria-label={collapsed ? t("home") : undefined}
        >
          {collapsed ? <LogoMark className="w-9" /> : <Logo tone="light" />}
        </Link>
        <button
          type="button"
          onClick={onToggle}
          className="hidden size-8 shrink-0 place-items-center rounded-md text-white/40 hover:bg-white/5 hover:text-white/80 lg:grid"
          aria-label={collapsed ? t("expandMenu") : t("collapseMenu")}
          title={collapsed ? t("expandMenu") : t("collapseMenu")}
        >
          {collapsed ? (
            <ChevronsRight className="size-4 rtl:rotate-180" aria-hidden="true" />
          ) : (
            <ChevronsLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
          )}
        </button>
      </div>
      <Suspense fallback={<NavigationLinks current={null} collapsed={collapsed} onNavigate={onNavigate} />}>
        <CurrentNavigationLinks collapsed={collapsed} onNavigate={onNavigate} />
      </Suspense>
      <RacingStripes />
      <div className={cn("relative shrink-0 space-y-2 border-t border-white/10 py-3", collapsed ? "px-2" : "px-4")}>
        {member ? (
          <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full bg-racing text-xs font-bold text-white"
              title={collapsed ? member.first_name + " " + member.last_name : undefined}
            >
              {initials(member.first_name, member.last_name)}
            </span>
            {collapsed ? null : (
              <span className="min-w-0 leading-tight">
                <span className="block truncate font-display text-sm font-semibold tracking-wide text-white uppercase">
                  {member.first_name} {member.last_name}
                </span>
                <span className="mt-0.5 block truncate text-2xs text-white/45">
                  {role ? <bdi>{role}</bdi> : <bdi dir="ltr">{member.email}</bdi>}
                </span>
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="size-8 shrink-0 animate-pulse rounded-full bg-white/10" />
            {collapsed ? null : <span className="h-3 w-32 animate-pulse rounded bg-white/10" />}
          </div>
        )}
        {logoutError ? (
          <p role="alert" className="text-xs text-white">
            {logoutError}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut || !member}
          aria-label={collapsed ? t("logout") : undefined}
          title={collapsed ? t("logout") : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-md py-2 text-sm transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60",
            collapsed ? "justify-center px-0" : "px-2",
          )}
        >
          {loggingOut ? (
            <LoaderCircle className="size-[18px] animate-spin" aria-hidden="true" />
          ) : (
            <LogOut className="size-[18px] rtl:rotate-180" aria-hidden="true" />
          )}
          {collapsed ? null : t("logout")}
        </button>
      </div>
    </nav>
  );
}

/** The role of the member's main current membership, shown under their name. */
function currentRole(member: Me) {
  const current = member.memberships.filter((membership) => membership.end_date === null);
  return (current.find((membership) => membership.is_primary) ?? current[0])?.role.name ?? null;
}

const STRIPES = ["stripe-wide", "stripe-mid", "stripe-small", "stripe-accent"];

/** The speed stripes of the Figma, faint, at the bottom of the menu: decoration only. */
function RacingStripes() {
  return (
    <span
      className="pointer-events-none absolute start-0 bottom-16 h-28 w-full opacity-[0.08] rtl:-scale-x-100"
      aria-hidden="true"
    >
      {STRIPES.map((name) => (
        <Image key={name} src={"/racing/" + name + ".svg"} alt="" fill className="object-contain object-left" />
      ))}
    </span>
  );
}

function CurrentNavigationLinks({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
  const current = useCurrentSection();
  return <NavigationLinks current={current} collapsed={collapsed} onNavigate={onNavigate} />;
}

/** `current`: null while the address is not known yet (see useCurrentSection). */
function NavigationLinks({
  current,
  collapsed,
  onNavigate,
}: {
  current: NavKey | null;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const t = useTranslations("Shell");
  // Only once the member is known: logged out (or just after logging out), the request would only get a 401
  // and try to renew a session that no longer exists.
  const me = useMe();
  const rights = useReportingRights(Boolean(me.data));
  return (
    // The list scrolls when the window is short: the account and "log out" stay in view below it.
    <div className="relative z-10 min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-3">
      {NAVIGATION.map(({ group, items }) => {
        const shown = items.filter(({ needs }) => !needs || rights.data?.[needs]);
        return (
          <div key={group} className="mb-1">
            {group !== "main" && !collapsed ? (
              <p className="px-5 pt-3 pb-1.5 text-2xs font-bold tracking-[0.18em] text-white/25 uppercase">
                {t(`groups.${group}`)}
              </p>
            ) : null}
            <ul>
              {shown.map(({ key, icon: Icon, href }) => {
                const active = key === current;
                return (
                  <li key={key}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      aria-label={collapsed ? t(key) : undefined}
                      title={collapsed ? t(key) : undefined}
                      className={cn(
                        "relative flex items-center gap-3 py-2.5 transition-colors",
                        collapsed ? "justify-center px-0" : "px-5",
                        active ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white/90",
                      )}
                    >
                      {active ? (
                        <span
                          className="absolute start-0 top-1/2 h-7 w-0.5 -translate-y-1/2 bg-racing"
                          aria-hidden="true"
                        />
                      ) : null}
                      <Icon
                        className={cn("size-[18px] shrink-0", active ? "text-white" : "text-white/45")}
                        aria-hidden="true"
                      />
                      {collapsed ? null : (
                        <span className="flex-1 truncate font-display text-sm font-semibold tracking-wider uppercase">
                          {t(key)}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
