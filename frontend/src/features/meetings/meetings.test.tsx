import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { fetchMembers, fetchOrgUnits } from "@/features/members/api";
import { fetchProjects } from "@/features/work/api";
import { attendance, me, meeting, meetingDetail, member, project, unit } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  actionToTask,
  addAction,
  addDecision,
  askExcuse,
  checkIn,
  confirmAttendance,
  createMeeting,
  decideExcuse,
  fetchExcuses,
  fetchMeeting,
  fetchMeetingRights,
  fetchMeetings,
  saveMinutes,
  type MeetingDetail,
} from "./api";
import { ExcusesPage } from "./excuses-page";
import { MeetingForm } from "./meeting-form";
import { MeetingView } from "./meeting-view";
import { MeetingsPage } from "./meetings-page";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useParams: () => ({ id: "5" }),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchMeetingRights: vi.fn(),
  fetchMeetings: vi.fn(),
  fetchMeeting: vi.fn(),
  createMeeting: vi.fn(),
  checkIn: vi.fn(),
  askExcuse: vi.fn(),
  confirmAttendance: vi.fn(),
  saveMinutes: vi.fn(),
  addDecision: vi.fn(),
  addAction: vi.fn(),
  actionToTask: vi.fn(),
  fetchExcuses: vi.fn(),
  decideExcuse: vi.fn(),
}));
vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("@/features/members/api", () => ({ fetchMembers: vi.fn(), fetchOrgUnits: vi.fn() }));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  fetchProjects: vi.fn(),
}));

const RAYAN = { id: 2, first_name: "Rayan", last_name: "Demo" };
const KARIM = { id: 3, first_name: "Karim", last_name: "Demo" };
const NO_RIGHTS = { schedule: false, decide_excuses: false, pending_excuses: 0 };
const PAST = { starts_at: "2026-10-01T17:00:00Z", ends_at: "2026-10-01T18:00:00Z" };

function show(detail: MeetingDetail) {
  vi.mocked(fetchMeeting).mockResolvedValue(detail);
  return renderWithProviders(<MeetingView />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMe).mockResolvedValue(me());
  vi.mocked(fetchMeetingRights).mockResolvedValue(NO_RIGHTS);
  vi.mocked(fetchMembers).mockResolvedValue([member(2, "Rayan", "Demo"), member(3, "Karim", "Demo")]);
  vi.mocked(fetchOrgUnits).mockResolvedValue([unit(3, "Electronics")]);
  vi.mocked(fetchProjects).mockResolvedValue([project(1, "[DEMO] EV 2027")]);
});

describe("MeetingsPage", () => {
  it("lists the sessions with their type, weight and the viewer's attendance", async () => {
    vi.mocked(fetchMeetings).mockResolvedValue([
      meeting(5, "Point électronique", {
        is_mandatory: true,
        my_attendance: { id: 9, status: "present", checked_in_at: null, excuse_status: "none", excuse_reason: "" },
      }),
      meeting(6, "Assemblée générale", { kind: "general", org_unit: null, is_critical: true }),
    ]);
    renderWithProviders(<MeetingsPage />);
    const row = (await screen.findByText("Point électronique")).closest("a")!;
    expect(row).toHaveAttribute("href", "/fr/meetings/5");
    expect(within(row).getByText("Réunion de département")).toBeInTheDocument();
    expect(within(row).getByText("Obligatoire")).toBeInTheDocument();
    expect(within(row).getByText("Présent")).toBeInTheDocument();
    const general = screen.getByText("Assemblée générale").closest("a")!;
    expect(within(general).getByText("Toute l'équipe")).toBeInTheDocument();
    expect(within(general).getByText("Critique ×2")).toBeInTheDocument();
    expect(fetchMeetings).toHaveBeenCalledWith("upcoming");
    expect(screen.queryByRole("link", { name: "Programmer une séance" })).not.toBeInTheDocument();
  });

  it("offers the bureau to schedule, and the Team Manager the excuses to decide", async () => {
    vi.mocked(fetchMeetings).mockResolvedValue([]);
    vi.mocked(fetchMeetingRights).mockResolvedValue({ schedule: true, decide_excuses: true, pending_excuses: 2 });
    renderWithProviders(<MeetingsPage />);
    expect(await screen.findByRole("link", { name: "Programmer une séance" })).toHaveAttribute(
      "href",
      "/fr/meetings/new",
    );
    expect(screen.getByRole("link", { name: /Excuses à traiter/ })).toHaveTextContent("2");
    expect(screen.getByText("Aucune séance à venir.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Passées" }));
    expect(fetchMeetings).toHaveBeenCalledWith("past");
  });
});

describe("MeetingView", () => {
  const mine = { id: 9, status: "pending", checked_in_at: null, excuse_status: "none", excuse_reason: "" } as const;

  it("lets an invitee check in, and ask for an excuse with its reason", async () => {
    const detail = meetingDetail(5, "Point électronique", {
      is_mandatory: true,
      my_attendance: mine,
      attendances: [attendance(9, RAYAN)],
      permissions: { edit: false, run: false, check_in: true, ask_excuse: true },
    });
    vi.mocked(checkIn).mockResolvedValue(detail);
    vi.mocked(askExcuse).mockResolvedValue(detail);
    const user = userEvent.setup();
    show(detail);
    await user.click(await screen.findByRole("button", { name: "Je suis là" }));
    await waitFor(() => expect(checkIn).toHaveBeenCalledWith(5));

    await user.click(screen.getByRole("button", { name: "Demander une excuse" }));
    await user.selectOptions(screen.getByLabelText("Motif"), "illness");
    await user.type(screen.getByLabelText("Précision (facultatif)"), "Grippe");
    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    await waitFor(() => expect(askExcuse).toHaveBeenCalledWith(5, "illness", "Grippe"));
  });

  it("lets who runs it confirm the list: whoever did not check in is proposed absent", async () => {
    const detail = meetingDetail(5, "Point électronique", {
      ...PAST,
      attendances: [
        attendance(9, RAYAN, { status: "late", checked_in_at: "2026-10-01T17:12:00Z" }),
        attendance(10, KARIM),
      ],
      permissions: { edit: true, run: true, check_in: false, ask_excuse: false },
    });
    vi.mocked(confirmAttendance).mockResolvedValue(detail);
    const user = userEvent.setup();
    show(detail);
    expect(await screen.findByRole("combobox", { name: "Présence de Karim Demo" })).toHaveValue("absent");
    expect(screen.getByRole("combobox", { name: "Présence de Rayan Demo" })).toHaveValue("late");
    await user.selectOptions(screen.getByRole("combobox", { name: "Présence de Karim Demo" }), "present");
    await user.click(screen.getByRole("button", { name: "Confirmer les présences" }));
    await waitFor(() =>
      expect(confirmAttendance).toHaveBeenCalledWith(5, [
        { member_id: 2, status: "late" },
        { member_id: 3, status: "present" },
      ]),
    );
  });

  it("lets who runs it write and publish the minutes, decisions and actions, and make an action a task", async () => {
    const detail = meetingDetail(5, "Point électronique", {
      ...PAST,
      actions: [
        {
          id: 70,
          description: "Demander deux devis",
          responsible: RAYAN,
          due_date: "2026-11-30",
          is_done: false,
          done_at: null,
          task: null,
          created_at: "2026-10-01T18:00:00Z",
        },
      ],
      permissions: { edit: true, run: true, check_in: false, ask_excuse: false },
    });
    vi.mocked(saveMinutes).mockResolvedValue(detail);
    vi.mocked(addDecision).mockResolvedValue({ id: 1, text: "x", created_by: null, created_at: "" });
    vi.mocked(addAction).mockResolvedValue(detail.actions[0]);
    vi.mocked(actionToTask).mockResolvedValue(detail.actions[0]);
    const user = userEvent.setup();
    show(detail);

    await user.type(await screen.findByLabelText("Compte rendu"), "Fournisseur A retenu.");
    await user.click(screen.getByRole("button", { name: "Publier aux invités" }));
    await waitFor(() => expect(saveMinutes).toHaveBeenCalledWith(5, "Fournisseur A retenu.", true));

    await user.type(screen.getByLabelText("Nouvelle décision"), "Commander le BMS");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    await waitFor(() => expect(addDecision).toHaveBeenCalledWith(5, "Commander le BMS"));

    await user.type(screen.getByLabelText("Nouvelle action"), "Relancer le fournisseur");
    await user.selectOptions(screen.getByLabelText("Responsable"), "3");
    await user.click(screen.getByRole("button", { name: "Ajouter l'action" }));
    await waitFor(() =>
      expect(addAction).toHaveBeenCalledWith(5, {
        description: "Relancer le fournisseur",
        responsible_id: 3,
        due_date: null,
      }),
    );

    await user.click(screen.getByRole("button", { name: "En faire une tâche" }));
    await user.selectOptions(await screen.findByLabelText("Projet"), "1");
    await user.click(screen.getByRole("button", { name: "Créer la tâche" }));
    await waitFor(() => expect(actionToTask).toHaveBeenCalledWith(5, 70, 1));
  });

  it("says a cancelled session is cancelled, and why", async () => {
    show(meetingDetail(5, "Point électronique", { status: "cancelled", cancel_reason: "Semaine d'examens" }));
    expect(await screen.findByText("Séance annulée : Semaine d'examens")).toBeInTheDocument();
  });
});

describe("MeetingForm", () => {
  it("schedules a mandatory session for the whole team", async () => {
    vi.mocked(createMeeting).mockResolvedValue(meetingDetail(8, "Assemblée générale"));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<MeetingForm onSaved={onSaved} />);
    await user.type(screen.getByLabelText("Titre"), "Assemblée générale");
    await user.selectOptions(screen.getByLabelText("Type"), "general");
    await user.type(screen.getByLabelText("Début"), "2026-11-02T18:00");
    await user.type(screen.getByLabelText("Fin"), "2026-11-02T19:30");
    await user.click(screen.getByRole("checkbox", { name: /Séance obligatoire/ }));
    await user.click(screen.getByRole("button", { name: "Programmer la séance" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Assemblée générale",
        kind: "general",
        org_unit_id: null,
        is_mandatory: true,
        is_critical: false,
        starts_at: new Date("2026-11-02T18:00").toISOString(),
        ends_at: new Date("2026-11-02T19:30").toISOString(),
      }),
    );
  });
});

describe("ExcusesPage", () => {
  const row = {
    id: 40,
    meeting: {
      id: 5,
      title: "Point électronique",
      starts_at: "2026-10-23T17:00:00Z",
      is_mandatory: true,
      is_critical: false,
    },
    member: RAYAN,
    status: "pending" as const,
    excuse_reason: "exam" as const,
    excuse_note: "Examen d'analyse",
    excuse_requested_at: "2026-10-20T09:00:00Z",
  };

  it("lets the Team Manager accept an excuse, or refuse it saying why", async () => {
    vi.mocked(fetchMeetingRights).mockResolvedValue({ schedule: true, decide_excuses: true, pending_excuses: 1 });
    vi.mocked(fetchExcuses).mockResolvedValue([row]);
    vi.mocked(decideExcuse).mockResolvedValue(row);
    const user = userEvent.setup();
    renderWithProviders(<ExcusesPage />);
    expect(await screen.findByText("Examen d'analyse")).toBeInTheDocument();
    expect(screen.getByText("Examen")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refuser" }));
    const refuse = screen.getByRole("button", { name: "Refuser l'excuse" });
    expect(refuse).toBeDisabled();
    await user.type(screen.getByLabelText("Pourquoi elle est refusée"), "Pas de justificatif");
    await user.click(refuse);
    await waitFor(() => expect(decideExcuse).toHaveBeenCalledWith(40, false, "Pas de justificatif"));

    await user.click(await screen.findByRole("button", { name: "Accepter" }));
    await waitFor(() => expect(decideExcuse).toHaveBeenCalledWith(40, true, ""));
  });

  it("is the Team Manager's", async () => {
    renderWithProviders(<ExcusesPage />);
    expect(await screen.findByText("Le Team Manager traite les excuses.")).toBeInTheDocument();
    expect(fetchExcuses).not.toHaveBeenCalled();
  });
});
