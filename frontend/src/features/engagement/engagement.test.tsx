import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchMeetings } from "@/features/meetings/api";
import { fetchMemberAdding, fetchMembers } from "@/features/members/api";
import { clubToday } from "@/lib/dates";
import { me, meeting, member } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  changeGoal,
  createGoal,
  createTraining,
  createVolunteering,
  fetchCharterIssues,
  fetchEngagementRights,
  fetchFollowedMembers,
  fetchGoals,
  fetchMemberSheet,
  fetchMissingVolunteering,
  fetchTrainings,
  fetchVolunteering,
  planTraining,
  refuseVolunteering,
  validateVolunteering,
  type Goal,
  type MemberSheet,
  type Training,
  type Volunteering,
} from "./api";
import { MemberSheetView } from "./member-sheet";
import { ObjectivesPage } from "./objectives-page";
import { EngagementTeamPage } from "./team-page";
import { TrainingsPage } from "./trainings-page";
import { VolunteeringPage } from "./volunteering-page";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "2" }),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchEngagementRights: vi.fn(),
  fetchFollowedMembers: vi.fn(),
  fetchMemberSheet: vi.fn(),
  fetchCharterIssues: vi.fn(),
  fetchGoals: vi.fn(),
  createGoal: vi.fn(),
  changeGoal: vi.fn(),
  fetchTrainings: vi.fn(),
  createTraining: vi.fn(),
  planTraining: vi.fn(),
  fetchVolunteering: vi.fn(),
  createVolunteering: vi.fn(),
  validateVolunteering: vi.fn(),
  refuseVolunteering: vi.fn(),
  fetchMissingVolunteering: vi.fn(),
}));
vi.mock("@/features/auth/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/auth/api")>()),
  fetchMe: vi.fn(),
}));
vi.mock("@/features/members/api", () => ({
  fetchMembers: vi.fn(),
  fetchOrgUnits: vi.fn(),
  fetchMemberAdding: vi.fn(),
}));
vi.mock("@/features/meetings/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/meetings/api")>()),
  fetchMeetings: vi.fn(),
}));

const LINA = { id: 1, first_name: "Lina", last_name: "Demo" };
const RAYAN = { id: 2, first_name: "Rayan", last_name: "Demo" };
const NOUR = { id: 3, first_name: "Nour", last_name: "Demo" };
const MEMBER = { leads: false, sees_all: false };
const HEAD = { leads: true, sees_all: false };
const TODAY = clubToday(new Date());

function activity(id: number, overrides: Partial<Volunteering> = {}): Volunteering {
  return {
    id,
    title: "Rangement de l'atelier",
    kind: "workshop",
    description: "",
    date: TODAY,
    organiser: RAYAN,
    participants: [RAYAN, NOUR],
    status: "proposed",
    decided_by: null,
    decided_at: null,
    decision_note: "",
    created_at: "2026-10-20T10:00:00Z",
    permissions: { decide: false, withdraw: false },
    ...overrides,
  };
}

function training(id: number, overrides: Partial<Training> = {}): Training {
  return {
    id,
    member: LINA,
    topic: "Soudure TIG",
    reason: "Pour le châssis",
    status: "wished",
    session: null,
    followed_on: null,
    note: "",
    updated_by: null,
    created_at: "2026-10-19T10:00:00Z",
    permissions: { manage: false, withdraw: true },
    ...overrides,
  };
}

function goal(id: number, overrides: Partial<Goal> = {}): Goal {
  return {
    id,
    member: LINA,
    season: 2026,
    title: "Livrer le faisceau basse tension",
    description: "",
    measure: "Faisceau validé au banc",
    due_date: "2027-01-31",
    progress: 40,
    member_note: "",
    status: "in_progress",
    set_by: RAYAN,
    assessment_note: "",
    assessed_by: null,
    assessed_at: null,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    permissions: { progress: true, assess: false },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMe).mockResolvedValue(me()); // Lina, id 1
  vi.mocked(fetchEngagementRights).mockResolvedValue(MEMBER);
  vi.mocked(fetchFollowedMembers).mockResolvedValue([]);
  vi.mocked(fetchVolunteering).mockResolvedValue([]);
  vi.mocked(fetchMissingVolunteering).mockResolvedValue([]);
  vi.mocked(fetchTrainings).mockResolvedValue([]);
  vi.mocked(fetchGoals).mockResolvedValue([]);
  vi.mocked(fetchMembers).mockResolvedValue([member(1, "Lina", "Demo"), member(2, "Rayan", "Demo")]);
  vi.mocked(fetchMemberAdding).mockResolvedValue(adding(false));
});

/** What the viewer may do with the members: `manage` for the Board and the Team Manager (decision D-025). */
function adding(manage: boolean) {
  return { can_add: manage, can_manage: manage, unit_ids: [], roles: [], positions: [], projects: [] };
}

describe("VolunteeringPage", () => {
  it("tells a member their month is not covered, and records an activity with its participants", async () => {
    vi.mocked(createVolunteering).mockResolvedValue(activity(9, { organiser: LINA }));
    const user = userEvent.setup();
    renderWithProviders(<VolunteeringPage />);
    expect(await screen.findByText(/Aucun bénévolat validé pour vous en/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mon équipe" })).not.toBeInTheDocument();
    expect(fetchMissingVolunteering).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Noter un bénévolat" }));
    await user.type(screen.getByLabelText("Tâche de bénévolat"), "Inventaire des outils");
    await user.selectOptions(screen.getByLabelText("Type"), "equipment");
    await user.type(screen.getByLabelText("Chercher un membre"), "ray");
    await user.click(await screen.findByRole("checkbox", { name: "Rayan Demo" }));
    await user.click(screen.getByRole("button", { name: "Envoyer pour validation" }));
    await waitFor(() =>
      expect(createVolunteering).toHaveBeenCalledWith({
        title: "Inventaire des outils",
        kind: "equipment",
        date: TODAY,
        description: "",
        participant_ids: [2],
      }),
    );
  });

  it("shows a validated month", async () => {
    vi.mocked(fetchVolunteering).mockResolvedValue([activity(4, { status: "validated", participants: [RAYAN, LINA] })]);
    renderWithProviders(<VolunteeringPage />);
    expect(await screen.findByText(/est validé\.$/)).toBeInTheDocument();
  });

  it("lets a head validate an activity, refuse another saying why, and see who is missing", async () => {
    vi.mocked(fetchEngagementRights).mockResolvedValue(HEAD);
    vi.mocked(fetchVolunteering).mockResolvedValue([
      activity(4, { permissions: { decide: true, withdraw: false } }),
      activity(5, { title: "Préparer le stand", kind: "event", permissions: { decide: true, withdraw: false } }),
    ]);
    vi.mocked(fetchMissingVolunteering).mockResolvedValue([
      { id: 3, first_name: "Nour", last_name: "Demo", goals: 0, volunteered: false },
    ]);
    vi.mocked(validateVolunteering).mockResolvedValue(activity(4, { status: "validated" }));
    vi.mocked(refuseVolunteering).mockResolvedValue(activity(5, { status: "refused" }));
    const user = userEvent.setup();
    renderWithProviders(<VolunteeringPage />);

    expect(await screen.findByRole("link", { name: "Nour Demo" })).toHaveAttribute("href", "/fr/members/3");
    const first = screen.getByText("Rangement de l'atelier").closest("li")!;
    expect(within(first).getByText("Avec : Nour Demo")).toBeInTheDocument();
    await user.click(within(first).getByRole("button", { name: "Valider" }));
    await waitFor(() => expect(validateVolunteering).toHaveBeenCalledWith(4));

    const second = screen.getByText("Préparer le stand").closest("li")!;
    await user.click(within(second).getByRole("button", { name: "Refuser" }));
    const confirm = within(second).getByRole("button", { name: "Refuser l'activité" });
    expect(confirm).toBeDisabled(); // a reason first
    await user.type(within(second).getByLabelText("Pourquoi la refuser"), "Ce n'était pas une mission collective");
    await user.click(confirm);
    await waitFor(() => expect(refuseVolunteering).toHaveBeenCalledWith(5, "Ce n'était pas une mission collective"));
  });
});

describe("TrainingsPage", () => {
  it("lets a member wish a training", async () => {
    vi.mocked(createTraining).mockResolvedValue(training(7));
    const user = userEvent.setup();
    renderWithProviders(<TrainingsPage />);
    expect(await screen.findByText("Aucune formation pour l'instant.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Noter une formation suivie" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Souhaiter une formation" }));
    await user.type(screen.getByLabelText("Sujet"), "Soudure TIG");
    await user.type(screen.getByLabelText("Pourquoi (facultatif)"), "Pour le châssis");
    await user.click(screen.getByRole("button", { name: "Envoyer mon souhait" }));
    await waitFor(() =>
      expect(createTraining).toHaveBeenCalledWith({
        topic: "Soudure TIG",
        reason: "Pour le châssis",
        status: "wished",
      }),
    );
  });

  it("lets a head plan a member's wish through a training session", async () => {
    vi.mocked(fetchEngagementRights).mockResolvedValue(HEAD);
    vi.mocked(fetchTrainings).mockResolvedValue([
      training(7, { member: RAYAN, permissions: { manage: true, withdraw: false } }),
    ]);
    vi.mocked(fetchMeetings).mockResolvedValue([
      meeting(12, "Atelier soudure", { kind: "training" }),
      meeting(13, "Réunion du département"),
    ]);
    vi.mocked(planTraining).mockResolvedValue(training(7, { status: "planned" }));
    const user = userEvent.setup();
    renderWithProviders(<TrainingsPage />);
    const row = (await screen.findByText("Soudure TIG")).closest("li")!;
    expect(within(row).getByRole("link", { name: "Rayan Demo" })).toHaveAttribute("href", "/fr/members/2");
    await user.click(within(row).getByRole("button", { name: "Prévoir" }));
    const select = within(row).getByLabelText("Séance de formation");
    await within(row).findByRole("option", { name: /^Atelier soudure/ });
    expect(within(row).queryByRole("option", { name: /Réunion du département/ })).not.toBeInTheDocument();
    await user.selectOptions(select, "12");
    await user.click(within(row).getByRole("button", { name: "Prévoir la formation" }));
    await waitFor(() => expect(planTraining).toHaveBeenCalledWith(7, { session_id: 12, note: "" }));
  });
});

describe("ObjectivesPage", () => {
  it("lets a member move their goal forward", async () => {
    vi.mocked(fetchGoals).mockResolvedValue([goal(3)]);
    vi.mocked(changeGoal).mockResolvedValue(goal(3, { progress: 60 }));
    const user = userEvent.setup();
    renderWithProviders(<ObjectivesPage />);
    expect(await screen.findByRole("progressbar", { name: /Livrer le faisceau/ })).toHaveAttribute(
      "aria-valuenow",
      "40",
    );
    expect(screen.queryByRole("button", { name: "Fixer un objectif" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mettre à jour" }));
    expect(screen.queryByLabelText("État")).not.toBeInTheDocument(); // the head assesses
    const progress = screen.getByLabelText("Progression (%)");
    await user.clear(progress);
    await user.type(progress, "60");
    await user.type(screen.getByLabelText("Votre note"), "Connecteurs reçus");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(changeGoal).toHaveBeenCalledWith(3, { progress: 60, member_note: "Connecteurs reçus" }));
  });

  it("lets a head set a goal of a member they follow", async () => {
    vi.mocked(fetchEngagementRights).mockResolvedValue(HEAD);
    vi.mocked(fetchFollowedMembers).mockResolvedValue([{ ...RAYAN, goals: 0, volunteered: true }]);
    vi.mocked(createGoal).mockResolvedValue(goal(4, { member: RAYAN }));
    const user = userEvent.setup();
    renderWithProviders(<ObjectivesPage />);
    await user.click(await screen.findByRole("button", { name: "Fixer un objectif" }));
    await screen.findByRole("option", { name: "Rayan Demo" });
    await user.selectOptions(screen.getByLabelText("Membre"), "2");
    await user.type(screen.getByLabelText("Objectif"), "Simuler l'aileron arrière");
    await user.type(screen.getByLabelText("Comment il se mesure"), "Rapport CFD relu");
    await user.click(screen.getByRole("button", { name: "Fixer l'objectif" }));
    await waitFor(() =>
      expect(createGoal).toHaveBeenCalledWith({
        member_id: 2,
        title: "Simuler l'aileron arrière",
        description: "",
        measure: "Rapport CFD relu",
        due_date: null,
      }),
    );
  });
});

describe("EngagementTeamPage", () => {
  it("shows the Bureau the memberships breaking the charter and the members' sheets", async () => {
    vi.mocked(fetchEngagementRights).mockResolvedValue({ leads: true, sees_all: true });
    vi.mocked(fetchFollowedMembers).mockResolvedValue([{ ...RAYAN, goals: 2, volunteered: false }]);
    vi.mocked(fetchCharterIssues).mockResolvedValue([
      {
        membership_id: 8,
        member: NOUR,
        unit: { id: 4, code: null, name: "Aerodynamics", type: "fs_department" },
        role: "Engineer",
        problems: ["Art. 13 : un étudiant de classes préparatoires n'appartient qu'au Département Médias."],
      },
    ]);
    renderWithProviders(<EngagementTeamPage />);
    expect(await screen.findByText(/^Art\. 13 :/)).toBeInTheDocument();
    const rayan = screen.getByRole("link", { name: "Ouvrir la fiche de Rayan Demo" });
    expect(rayan).toHaveAttribute("href", "/fr/members/2");
    expect(within(rayan).getByText("2 objectifs en cours")).toBeInTheDocument();
    expect(within(rayan).getByText("Sans bénévolat ce mois-ci")).toBeInTheDocument();
  });
});

describe("MemberSheetView", () => {
  it("shows a member's season on one page", async () => {
    vi.mocked(fetchEngagementRights).mockResolvedValue(HEAD);
    const sheet: MemberSheet = {
      member: { ...member(2, "Rayan", "Demo"), study_level: "year_4", study_field: "Génie mécanique", race_number: 7 },
      season: 2026,
      health: { status: "at_risk", last_activity: "2026-10-01T10:00:00Z", idle_days: 21 },
      objectives: [goal(3, { member: RAYAN, permissions: { progress: false, assess: true } })],
      tasks: {
        open: 3,
        overdue: 1,
        validated_recently: 2,
        current: [{ id: 40, title: "Usiner les moyeux", status: "in_progress", due_date: "2026-10-10", overdue: true }],
      },
      presence: {
        month: 75,
        season: 82.5,
        recent: [{ id: 12, title: "Réunion du département", starts_at: "2026-10-15T17:00:00Z", status: "absent" }],
      },
      contributions: { season_points: 6, scores: [{ month: "2026-09", final: 14.5, category: "B", rank: 4 }] },
      warnings: [{ id: 7, level: 1, ground: "commitments", issued_at: "2026-10-12T10:00:00Z", status: "active" }],
      trainings: [training(5, { member: RAYAN, status: "followed", followed_on: "2026-10-05" })],
      volunteering: {
        activities: [
          { id: 4, title: "Rangement de l'atelier", kind: "workshop", date: "2026-09-20", status: "validated" },
        ],
        months_covered: ["2026-09"],
      },
    };
    vi.mocked(fetchMemberSheet).mockResolvedValue(sheet);
    renderWithProviders(<MemberSheetView />);
    expect(await screen.findByRole("heading", { level: 1, name: "Rayan Demo" })).toBeInTheDocument();
    expect(fetchMemberSheet).toHaveBeenCalledWith(2);
    expect(screen.getByText("À risque")).toBeInTheDocument();
    expect(screen.getByText(/^4e année/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Évaluer" })).toBeInTheDocument(); // the head assesses from here
    expect(screen.getByRole("link", { name: "Usiner les moyeux" })).toHaveAttribute("href", "/fr/tasks/40");
    expect(screen.getByText("83 %")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Avertissement n° 1" })).toHaveAttribute(
      "href",
      "/fr/discipline/warnings/7",
    );
    expect(screen.getByText("Mois validés : septembre 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mon équipe" })).toHaveAttribute("href", "/fr/engagement/team");
    expect(screen.getByText(/· N° 7$/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Profil d'ancien membre" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Modifier" })).not.toBeInTheDocument(); // a head does not edit
  });

  it("lets the Board and the Team Manager edit the member (decision D-025)", async () => {
    vi.mocked(fetchMemberAdding).mockResolvedValue(adding(true));
    vi.mocked(fetchMemberSheet).mockResolvedValue({
      member: member(2, "Rayan", "Demo", { projects: [{ id: 7, name: "EV 2027", category: "ev", manages: true }] }),
      season: 2026,
      health: { status: null, last_activity: null, idle_days: null },
      objectives: [],
      tasks: { open: 0, overdue: 0, validated_recently: 0, current: [] },
      presence: { month: null, season: null, recent: [] },
      contributions: { season_points: 0, scores: [] },
      warnings: [],
      trainings: [],
      volunteering: { activities: [], months_covered: [] },
    });
    renderWithProviders(<MemberSheetView />);
    expect(await screen.findByRole("link", { name: "Modifier" })).toHaveAttribute("href", "/fr/members/2/edit");
    // The projects they work on or manage (decision D-025).
    expect(screen.getByRole("link", { name: "EV 2027" })).toHaveAttribute("href", "/fr/projects/7");
    expect(screen.getByText(/\(chef de projet\)/)).toBeInTheDocument();
  });

  it("shows an alumni's profile on their sheet", async () => {
    vi.mocked(fetchEngagementRights).mockResolvedValue(HEAD);
    vi.mocked(fetchMemberSheet).mockResolvedValue({
      member: member(2, "Rayan", "Demo", {
        status: "alumni",
        alumni_profile: {
          graduation_year: 2023,
          current_position: "Ingénieur essais",
          current_company: "Atelier Demo",
          linkedin_url: "https://www.linkedin.com/in/rayan-demo",
          willing_to_mentor: false,
        },
      }),
      season: 2026,
      health: { status: null, last_activity: null, idle_days: null },
      objectives: [],
      tasks: { open: 0, overdue: 0, validated_recently: 0, current: [] },
      presence: { month: null, season: null, recent: [] },
      contributions: { season_points: 0, scores: [] },
      warnings: [],
      trainings: [],
      volunteering: { activities: [], months_covered: [] },
    });
    renderWithProviders(<MemberSheetView />);
    const card = await screen.findByRole("region", { name: "Profil d'ancien membre" });
    expect(within(card).getByText("Atelier Demo")).toBeInTheDocument();
    expect(within(card).getByText("2023")).toBeInTheDocument();
    expect(within(card).getByText("Pas pour le moment")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Voir le profil LinkedIn" })).toHaveAttribute(
      "href",
      "https://www.linkedin.com/in/rayan-demo",
    );
  });
});
