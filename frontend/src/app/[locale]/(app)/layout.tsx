import { AppShell } from "@/components/app-shell/app-shell";

/** Pages for logged-in members. The login page is outside this group. */
export default function MemberAreaLayout({ children }: LayoutProps<"/[locale]">) {
  return <AppShell>{children}</AppShell>;
}
