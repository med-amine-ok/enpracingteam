import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe, logout } from "@/features/auth/api";
import { fetchReportingRights } from "@/features/team/api";
import { me } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { AppShell } from "./app-shell";

const router = { replace: vi.fn() };
const address = { page: "/" };

vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn(), logout: vi.fn() }));
vi.mock("@/features/notifications/api", () => ({
  fetchUnreadCount: vi.fn().mockResolvedValue(2),
  fetchNotifications: vi.fn().mockResolvedValue([]),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));
vi.mock("@/features/team/api", () => ({ fetchReportingRights: vi.fn() }));
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
  usePathname: () => address.page,
}));

function renderShell() {
  return renderWithProviders(
    <AppShell>
      <p>Contenu de la page</p>
    </AppShell>,
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    router.replace.mockReset();
    vi.mocked(fetchMe).mockReset().mockResolvedValue(me());
    vi.mocked(fetchReportingRights).mockReset().mockResolvedValue({ dashboard: false, reports: false });
    address.page = "/";
  });

  it("shows the dashboard in the menu only to who may see it", async () => {
    renderShell();
    expect(await screen.findByRole("link", { name: "Réunions" })).toHaveAttribute("href", "/fr/meetings");
    expect(screen.queryByRole("link", { name: "Tableau de bord" })).not.toBeInTheDocument();
  });

  it("leads the Team Manager, the bureau and the leaders to the dashboard", async () => {
    vi.mocked(fetchReportingRights).mockResolvedValue({ dashboard: true, reports: true });
    address.page = "/team/reports";
    renderShell();
    const link = await screen.findByRole("link", { name: "Tableau de bord" });
    expect(link).toHaveAttribute("href", "/fr/team");
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("marks the section of the page in the menu and the top bar", async () => {
    address.page = "/projects/12";
    renderShell();
    expect(await screen.findByRole("link", { name: "Projets" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Accueil" })).not.toHaveAttribute("aria-current");
    expect(within(screen.getByRole("banner")).getByText("Projets")).toBeInTheDocument();
  });

  it("counts a member's sheet in the directory", async () => {
    address.page = "/members/4";
    renderShell();
    expect(await screen.findByRole("link", { name: "Annuaire" })).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("banner")).getByText("Annuaire")).toBeInTheDocument();
  });

  it("leaves the menu and the top bar off a printed page (the tasks' report)", async () => {
    renderShell();
    const menu = await screen.findByRole("link", { name: "Réunions" });
    expect(menu.closest(".print-hidden")).not.toBeNull();
    expect(screen.getByRole("banner")).toHaveClass("print-hidden");
    expect(screen.getByRole("main").closest(".print-hidden")).toBeNull();
  });

  it("shows the notification bell once the member is known", async () => {
    renderShell();
    expect(await screen.findByRole("button", { name: "Notifications : 2 non lues" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute("href", "/fr/notifications");
  });

  it("leads to the purchases, and marks them as the current section", async () => {
    address.page = "/purchasing/requests/7";
    renderShell();
    const link = await screen.findByRole("link", { name: "Achats" });
    expect(link).toHaveAttribute("href", "/fr/purchasing");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Stock" })).toHaveAttribute("href", "/fr/stock");
  });

  it("sends members without a session to the login page, then back to the page with its parameters", async () => {
    vi.mocked(fetchMe).mockResolvedValue(null);
    window.history.replaceState(null, "", "/fr/tasks/new?project=3");
    renderShell();
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({ pathname: "/login", query: { next: "/tasks/new?project=3" } }),
    );
  });

  it("sends them to the login page alone from the home page", async () => {
    vi.mocked(fetchMe).mockResolvedValue(null);
    window.history.replaceState(null, "", "/fr");
    renderShell();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
  });

  it("forgets the member's cached data on logout, so the next member never sees it", async () => {
    vi.mocked(logout).mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { queryClient } = renderShell();
    queryClient.setQueryData(["tasks"], ["tâche de Lina"]);
    await user.click(await screen.findByRole("button", { name: "Se déconnecter" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login"));
    expect(queryClient.getQueryData(["tasks"])).toBeUndefined();
  });
});
