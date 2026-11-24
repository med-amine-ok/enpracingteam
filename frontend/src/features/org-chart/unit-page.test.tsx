import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMembers, fetchOrgUnits } from "@/features/members/api";
import { fetchProjects } from "@/features/work/api";
import { member, membership, project, role, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { UnitPage } from "./unit-page";

let id = "2";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id }),
}));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn() }));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchProjects: vi.fn(),
}));

const root = unit(1, "ENP Racing Team", { code: "enp-racing-team", type: "root" });
const media = unit(2, "Media", {
  code: "dept-media",
  parent: 1,
  description: "Photos, vidéos et articles de l'équipe.",
});
const photo = unit(3, "Photo", { code: "media-photo", parent: 2, type: "club_pole" });
const head = role(1, "Chef du département", { is_leadership: true });
const reporter = role(2, "Photographe");

beforeEach(() => {
  id = "2";
  vi.mocked(fetchOrgUnits).mockResolvedValue([root, media, photo]);
  vi.mocked(fetchMembers).mockResolvedValue([
    member(1, "Adam", "Demo", { memberships: [membership(media, head, { member_level: "main" })] }),
    member(2, "Ines", "Demo", { memberships: [membership(photo, reporter, { member_level: "main" })] }),
    member(3, "Nour", "Demo", { memberships: [membership(media, reporter, { member_level: "junior" })] }),
  ]);
  vi.mocked(fetchProjects).mockResolvedValue([
    project(9, "Affiches du salon", { org_unit: { id: 3, code: "media-photo", name: "Photo", type: "club_pole" } }),
    project(10, "[DEMO] EV 2027"),
  ]);
});

describe("UnitPage", () => {
  it("shows a department in its livery: what it does, its head, its members, projects and units", async () => {
    renderWithProviders(<UnitPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Media" })).toBeInTheDocument();
    expect(screen.getByText("Département du club · Mercedes")).toBeInTheDocument();
    expect(screen.getByText("Photos, vidéos et articles de l'équipe.")).toBeInTheDocument();
    const heads = screen.getByRole("heading", { level: 2, name: "Chefs" }).closest("section")!;
    expect(within(heads).getByText("Adam Demo")).toBeInTheDocument();
    expect(within(heads).getByText("Chef du département")).toBeInTheDocument();
    const main = screen.getByRole("region", { name: "Principaux" });
    expect(within(main).getByText("Ines Demo")).toBeInTheDocument();
    expect(within(main).getByText("Photo")).toBeInTheDocument(); // the unit below, named
    expect(within(screen.getByRole("region", { name: "Juniors" })).getByText("Nour Demo")).toBeInTheDocument();
    const projects = await screen.findByRole("link", { name: /Affiches du salon/ });
    expect(projects).toHaveAttribute("href", "/fr/projects/9");
    expect(screen.queryByRole("link", { name: /EV 2027/ })).not.toBeInTheDocument(); // another unit's
    expect(screen.getByRole("link", { name: /^Photo/ })).toHaveAttribute("href", "/fr/org-chart/3");
  });

  it("says when the unit does not exist", async () => {
    id = "99";
    renderWithProviders(<UnitPage />);
    expect(await screen.findByText("Cette unité n'existe pas ou n'est plus active.")).toBeInTheDocument();
  });
});
