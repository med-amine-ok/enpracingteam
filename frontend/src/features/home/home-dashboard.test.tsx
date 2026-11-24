import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchMeetings } from "@/features/meetings/api";
import { fetchTasks } from "@/features/work/api";
import { ApiError } from "@/lib/api/errors";
import { me, meeting, task } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { HomeDashboard } from "./home-dashboard";

vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchTasks: vi.fn(),
}));
vi.mock("@/features/meetings/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/meetings/api")>()),
  fetchMeetings: vi.fn(),
}));

describe("HomeDashboard", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockResolvedValue(me());
    vi.mocked(fetchTasks)
      .mockReset()
      .mockResolvedValue([task(1, "Boîtier et fixations", { is_overdue: true })]);
    vi.mocked(fetchMeetings)
      .mockReset()
      .mockResolvedValue([
        meeting(4, "Séance annulée", { status: "cancelled" }),
        meeting(5, "Point électronique", { is_mandatory: true }),
      ]);
  });

  it("shows the next session, mandatory or not, never a cancelled one", async () => {
    renderWithProviders(<HomeDashboard />);
    const next = (await screen.findByText("Point électronique")).closest("a")!;
    expect(next).toHaveAttribute("href", "/fr/meetings/5");
    expect(next).toHaveTextContent("Obligatoire");
    expect(screen.queryByText("Séance annulée")).not.toBeInTheDocument();
    expect(fetchMeetings).toHaveBeenCalledWith("upcoming");
  });

  it("greets the member and sums up their tasks", async () => {
    renderWithProviders(<HomeDashboard />);
    expect(await screen.findByRole("heading", { name: `Bonjour ${me().first_name}` })).toBeInTheDocument();
    expect(await screen.findByText("1 tâche en retard")).toBeInTheDocument();
    expect(fetchTasks).toHaveBeenCalledWith({ assignee: "me" });
  });

  it("says why a card could not be filled, instead of loading for ever", async () => {
    vi.mocked(fetchTasks).mockRejectedValue(new ApiError(0, ""));
    vi.mocked(fetchMeetings).mockRejectedValue(new ApiError(500, "Erreur du serveur."));
    renderWithProviders(<HomeDashboard />);
    const myTasks = screen.getByRole("heading", { name: "Mes tâches" }).closest("section")!;
    expect(await within(myTasks).findByRole("alert")).toHaveTextContent("Impossible de joindre le serveur.");
    const next = screen.getByRole("heading", { name: "Prochaine séance" }).closest("section")!;
    expect(await within(next).findByRole("alert")).toHaveTextContent("Erreur du serveur.");
  });

  it("has a shortcut to every module built, purchasing, stock and finance included", () => {
    renderWithProviders(<HomeDashboard />);
    const shortcuts = within(screen.getByRole("region", { name: "Accès rapide" }));
    for (const [title, href] of [
      ["Mon profil", "/fr/profile"],
      ["Annuaire", "/fr/directory"],
      ["Organigramme", "/fr/org-chart"],
      ["Projets", "/fr/projects"],
      ["Mes tâches", "/fr/tasks"],
      ["Réunions", "/fr/meetings"],
      ["Documents", "/fr/documents"],
      ["Atelier", "/fr/workshop"],
      ["Classement", "/fr/ranking"],
      ["Avertissements", "/fr/discipline"],
      ["Engagement", "/fr/engagement"],
      ["Assistant", "/fr/assistant"],
      ["Achats", "/fr/purchasing"],
      ["Stock", "/fr/stock"],
      ["Finance", "/fr/finance"],
      ["Notifications", "/fr/notifications"],
    ]) {
      expect(shortcuts.getByRole("link", { name: new RegExp(`^${title}`) })).toHaveAttribute("href", href);
    }
  });

  it("announces no module to come any more: all are built (22/10/2026)", () => {
    renderWithProviders(<HomeDashboard />);
    expect(screen.queryByText("Bientôt dans l'ERP")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Assistant/ })).toHaveAttribute("href", "/fr/assistant");
  });

  it("speaks Arabic too", () => {
    renderWithProviders(<HomeDashboard />, { locale: "ar" });
    const shortcuts = within(screen.getByRole("region", { name: "وصول سريع" }));
    expect(shortcuts.getByRole("link", { name: /^المخزون/ })).toHaveAttribute("href", "/ar/stock");
    expect(shortcuts.getByRole("link", { name: /^المالية/ })).toHaveAttribute("href", "/ar/finance");
    expect(shortcuts.getByRole("link", { name: /^الاجتماعات/ })).toHaveAttribute("href", "/ar/meetings");
  });
});
