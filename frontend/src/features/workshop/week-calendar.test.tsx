import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fetchEquipmentList, fetchWeekReservations, fetchWorkshopRights, type Reservation } from "./api";
import { WeekCalendar } from "./week-calendar";

const router = { replace: vi.fn() };
let search = "week=2026-10-21";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  fetchWeekReservations: vi.fn(),
  fetchEquipmentList: vi.fn(),
  fetchWorkshopRights: vi.fn(),
  fetchLoans: vi.fn().mockResolvedValue([]),
}));

const ENGINEER = { id: 3, first_name: "Engineer", last_name: "Demo" };

function slot(id: number, from: string, to: string, equipment = { id: 7, name: "Tour" }): Reservation {
  return {
    id,
    equipment,
    reserved_by: ENGINEER,
    reserved_from: from,
    reserved_to: to,
    purpose: "Moyeux",
    status: "confirmed",
    cancelled_by: null,
    cancelled_at: null,
    permissions: { cancel: false },
  } as Reservation;
}

beforeEach(() => {
  vi.clearAllMocks();
  search = "week=2026-10-21";
  vi.mocked(fetchWorkshopRights).mockResolvedValue({ manage: false, certify: false } as never);
  vi.mocked(fetchEquipmentList).mockResolvedValue([
    { id: 7, name: "Tour" },
    { id: 8, name: "Perceuse" },
  ] as never);
  vi.mocked(fetchWeekReservations).mockResolvedValue([
    // Tuesday 20 October, 10:00 to 12:00 in Algiers (UTC+1).
    slot(1, "2026-10-20T09:00:00Z", "2026-10-20T11:00:00Z"),
    // Friday night to Saturday morning: on both days.
    slot(2, "2026-10-23T20:00:00Z", "2026-10-24T08:00:00Z", { id: 8, name: "Perceuse" }),
  ]);
});

describe("WeekCalendar", () => {
  it("shows the week of the asked day, Monday first, with each slot on its day", async () => {
    renderWithProviders(<WeekCalendar />);
    const tuesday = await screen.findByRole("list", { name: "mardi 20 octobre" });
    expect(fetchWeekReservations).toHaveBeenCalledWith("2026-10-19", undefined); // its Monday
    expect(screen.getByRole("heading", { name: "Du 19 octobre au 25 octobre 2026" })).toBeInTheDocument();
    expect(within(tuesday).getByRole("link", { name: "Tour" })).toHaveAttribute("href", "/fr/workshop/7");
    expect(within(tuesday).getByText("10:00–12:00")).toBeInTheDocument();
    expect(within(tuesday).getByText("Engineer Demo")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "vendredi 23 octobre" })).getByText("Perceuse")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "samedi 24 octobre" })).getByText("Perceuse")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "lundi 19 octobre" })).queryByRole("listitem")).toBeNull();
  });

  it("leaves out the slots all before 07:00 or after 23:00 of a day, instead of drawing them at 07:00", async () => {
    vi.mocked(fetchWeekReservations).mockResolvedValue([
      // Wednesday 21 October, 02:00 to 05:00 in Algiers; Thursday 22, 23:15 to 23:45.
      slot(3, "2026-10-21T01:00:00Z", "2026-10-21T04:00:00Z"),
      slot(4, "2026-10-22T22:15:00Z", "2026-10-22T22:45:00Z"),
    ]);
    renderWithProviders(<WeekCalendar />);
    await screen.findByRole("list", { name: "mardi 20 octobre" });
    expect(fetchWeekReservations).toHaveBeenCalled();
    expect(within(screen.getByRole("list", { name: "mercredi 21 octobre" })).queryByRole("listitem")).toBeNull();
    expect(within(screen.getByRole("list", { name: "jeudi 22 octobre" })).queryByRole("listitem")).toBeNull();
  });

  it("moves from week to week and keeps to one equipment", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WeekCalendar />);
    await screen.findByRole("list", { name: "mardi 20 octobre" });
    expect(screen.getByRole("link", { name: /Semaine suivante/ })).toHaveAttribute(
      "href",
      "/fr/workshop/calendar?week=2026-10-26",
    );
    expect(screen.getByRole("link", { name: /Semaine précédente/ })).toHaveAttribute(
      "href",
      "/fr/workshop/calendar?week=2026-10-12",
    );
    await screen.findByRole("option", { name: "Perceuse" });
    await user.selectOptions(screen.getByLabelText("Équipement"), "8");
    expect(router.replace).toHaveBeenCalledWith("/workshop/calendar?week=2026-10-19&equipment=8");
  });

  it("asks only one equipment's slots when the address names it", async () => {
    search = "week=2026-10-19&equipment=8";
    renderWithProviders(<WeekCalendar />);
    await screen.findByRole("list", { name: "mardi 20 octobre" });
    expect(fetchWeekReservations).toHaveBeenCalledWith("2026-10-19", 8);
  });
});
