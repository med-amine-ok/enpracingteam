import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe } from "@/features/auth/api";
import { me, notification } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { fetchNotifications, fetchUnreadCount, markAllRead, markRead, type Notification } from "./api";
import { NotificationBell } from "./notification-bell";
import { NotificationItem, notificationHref } from "./notification-item";
import { NotificationsPage } from "./notifications-page";

vi.mock("@/features/auth/api", () => ({ fetchMe: vi.fn() }));
vi.mock("./api", () => ({
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));
// A plain link: the test has no Next.js router to navigate with.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, onClick, ...props }: ComponentProps<"a"> & { href: string }) => (
    <a
      href={`/fr${href}`}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    />
  ),
}));

const ABOUT_PACK = { task: "Modéliser le pack", project: "[DEMO] EV 2027" };

function textOf(item: Notification, locale: "fr" | "ar" = "fr") {
  const { container } = renderWithProviders(<NotificationItem notification={item} />, { locale });
  return container;
}

describe("NotificationItem", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockResolvedValue(me()); // Lina, id 1
    vi.mocked(markRead)
      .mockReset()
      .mockResolvedValue(notification(1, "task_done", { is_read: true }));
  });

  it.each<[Notification["kind"], Record<string, unknown>, string]>([
    ["task_assigned", ABOUT_PACK, "Rayan Demo vous a assigné « Modéliser le pack »."],
    [
      "task_commented",
      { ...ABOUT_PACK, excerpt: "Les cellules arrivent lundi." },
      "Rayan Demo a commenté « Modéliser le pack » : « Les cellules arrivent lundi. »",
    ],
    ["task_blocked", ABOUT_PACK, "Rayan Demo a marqué « Modéliser le pack » comme bloquée."],
    ["task_done", ABOUT_PACK, "Rayan Demo a terminé « Modéliser le pack »."],
    ["task_submitted", ABOUT_PACK, "Rayan Demo a soumis « Modéliser le pack » : elle attend votre validation."],
    ["task_validated", { ...ABOUT_PACK, quality_mark: 4 }, "Rayan Demo a validé « Modéliser le pack » : qualité 4/5."],
    [
      "task_revision",
      { ...ABOUT_PACK, excerpt: "Ajouter les fixations" },
      "Rayan Demo a renvoyé « Modéliser le pack » à reprendre : « Ajouter les fixations »",
    ],
    [
      "blocker_declared",
      { ...ABOUT_PACK, severity: "high", excerpt: "Pas de sertisseuse" },
      "Rayan Demo a déclaré un blocage (Haute) sur « Modéliser le pack » : « Pas de sertisseuse »",
    ],
    [
      "blocker_updated",
      { ...ABOUT_PACK, status: "validated" },
      "Rayan Demo a validé le blocage de « Modéliser le pack » : l'échéance est gelée.",
    ],
    [
      "blocker_updated",
      { ...ABOUT_PACK, status: "rejected" },
      "Rayan Demo a rejeté le blocage de « Modéliser le pack ».",
    ],
    [
      "blocker_updated",
      { ...ABOUT_PACK, status: "resolved" },
      "Rayan Demo a résolu le blocage de « Modéliser le pack ».",
    ],
    [
      "validation_requested",
      { subsystem: "HV Battery & BMS", project: "[DEMO] EV 2027", project_id: 1 },
      "« HV Battery & BMS » attend votre validation.",
    ],
    [
      "validation_signed",
      { subsystem: "HV Battery & BMS", project: "[DEMO] EV 2027", project_id: 1 },
      "Rayan Demo a signé la validation de « HV Battery & BMS » : la suite peut commencer.",
    ],
    ["task_due_soon", { ...ABOUT_PACK, due_date: "2026-10-22" }, "« Modéliser le pack » est à rendre le 22 octobre."],
    [
      "task_overdue",
      { ...ABOUT_PACK, due_date: "2026-10-22" },
      "« Modéliser le pack » devait être terminée le 22 octobre.",
    ],
  ])("says what happened: %s", (kind, data, sentence) => {
    const container = textOf(notification(1, kind, { data }));
    expect(container).toHaveTextContent(sentence);
    expect(container).toHaveTextContent("[DEMO] EV 2027 · il y a 1 heure");
  });

  const CELLS = { part: "Cellules Li-ion 21700", quantity: 120, requester: "Rayan Demo" };

  it.each<[Notification["kind"], Record<string, unknown>, string]>([
    [
      "purchase_approval_requested",
      { level: "leader" },
      "Demande d'achat à valider : 120 × « Cellules Li-ion 21700 », demandée par Rayan Demo.",
    ],
    [
      "purchase_approval_requested",
      { level: "operations" },
      "À valider par les Opérations : 120 × « Cellules Li-ion 21700 », demandée par Rayan Demo et validée par son chef.",
    ],
    ["purchase_to_order", {}, "À commander : 120 × « Cellules Li-ion 21700 », demandée par Rayan Demo, est validée."],
    [
      "purchase_updated",
      { action: "approved", status: "a_valider_operations" },
      "Rayan Demo a validé votre demande « Cellules Li-ion 21700 » : elle attend maintenant les Opérations.",
    ],
    [
      "purchase_updated",
      { action: "approved", status: "a_commander" },
      "Rayan Demo a validé votre demande « Cellules Li-ion 21700 » : elle va être commandée.",
    ],
    [
      "purchase_updated",
      { action: "refused", reason: "Il en reste à l'atelier." },
      "Rayan Demo a refusé votre demande « Cellules Li-ion 21700 » : « Il en reste à l'atelier. »",
    ],
    [
      "purchase_updated",
      { action: "ordered", supplier: "[DEMO] Atelier Laser Alger" },
      "Rayan Demo a commandé « Cellules Li-ion 21700 » chez [DEMO] Atelier Laser Alger.",
    ],
    [
      "purchase_updated",
      { action: "received" },
      "« Cellules Li-ion 21700 » : livraison réceptionnée par Rayan Demo, la pièce est en stock.",
    ],
    [
      "purchase_updated",
      { action: "cancelled", reason: "Plus utile" },
      "Rayan Demo a annulé la demande « Cellules Li-ion 21700 » : « Plus utile »",
    ],
  ])("says what happened to a purchase: %s %o", (kind, data, sentence) => {
    const container = textOf(
      notification(1, kind, { data: { ...CELLS, ...data }, target: { type: "purchase_request", id: 7 } }),
    );
    expect(container).toHaveTextContent(sentence);
    expect(container).toHaveTextContent("il y a 1 heure");
  });

  it("leads to the purchase request", () => {
    const item = notification(1, "purchase_to_order", { data: CELLS, target: { type: "purchase_request", id: 7 } });
    expect(notificationHref(item)).toBe("/purchasing/requests/7");
  });

  it("says that a stock line is low, and leads to it", () => {
    const low = notification(1, "stock_low", {
      actor: null,
      data: { part: "Gaine thermorétractable", location: "Armoire E1", quantity: 2, threshold: 2 },
      target: { type: "stock_item", id: 4 },
    });
    expect(textOf(low)).toHaveTextContent(
      "Stock bas : « Gaine thermorétractable » (Armoire E1) : il en reste 2, seuil 2.",
    );
    expect(notificationHref(low)).toBe("/stock/4");
    const unplaced = notification(2, "stock_low", {
      data: { part: "Vis M8", location: "", quantity: 0, threshold: 5 },
    });
    expect(textOf(unplaced)).toHaveTextContent("« Vis M8 » (emplacement non précisé) : il en reste 0, seuil 5.");
  });

  it("says that a budget is exceeded, with its amounts, and leads to it", () => {
    const over = notification(1, "budget_exceeded", {
      actor: null,
      data: { unit: "Électronique", fiscal_year: "2026-2027", allocated: "200000.00", spent: "201000.00" },
      target: { type: "budget", id: 3 },
    });
    expect(textOf(over)).toHaveTextContent(
      "Budget dépassé : Électronique (2026-2027) : 201 000 DA dépensés pour 200 000 DA alloués.",
    );
    expect(notificationHref(over)).toBe("/finance/budgets/3");
  });

  it("tells about the workshop's loans, slots and certifications, and leads to the equipment", () => {
    const target = { type: "equipment", id: 5 };
    const caliper = { equipment: "Pied à coulisse", due_date: "2026-10-25", loan: 3 };
    const asked = notification(1, "loan_requested", {
      data: { ...caliper, excerpt: "Mesurer les porte-moyeux" },
      target,
    });
    expect(textOf(asked)).toHaveTextContent(
      "Rayan Demo demande à emprunter « Pied à coulisse » jusqu'au 25 octobre : « Mesurer les porte-moyeux »",
    );
    expect(notificationHref(asked)).toBe("/workshop/5");
    expect(textOf(notification(2, "loan_decided", { data: { ...caliper, approved: true }, target }))).toHaveTextContent(
      "Rayan Demo a validé votre prêt de « Pied à coulisse » : à rendre le 25 octobre.",
    );
    const slot = { equipment: "Tour", reserved_from: "2026-10-23T08:00:00Z", reserved_to: "2026-10-23T10:00:00Z" };
    expect(
      textOf(notification(3, "reservation_cancelled", { actor: null, data: { ...slot, unavailable: true }, target })),
    ).toHaveTextContent(
      /^Votre créneau du .+ sur « Tour » est annulé : l'équipement est en maintenance ou hors service\./,
    );
    expect(textOf(notification(4, "certification_granted", { data: { equipment: "Tour" }, target }))).toHaveTextContent(
      "Rayan Demo vous a donné l'habilitation pour « Tour ».",
    );
  });

  it("tells about contribution points and the published ranking, and leads to them", () => {
    const points = { points: 2, member: "Yacine Demo", excerpt: "Aide sur la CFD", date: "2026-10-05" };
    const proposed = notification(1, "contribution_proposed", {
      data: points,
      target: { type: "contribution", id: 4 },
    });
    expect(textOf(proposed)).toHaveTextContent(
      "Rayan Demo propose 2 points de contribution pour Yacine Demo : « Aide sur la CFD »",
    );
    expect(notificationHref(proposed)).toBe("/ranking/contributions");
    const refused = notification(2, "contribution_decided", {
      data: { ...points, points: 1, approved: false, note: "Sa propre tâche" },
      target: { type: "contribution", id: 4 },
    });
    expect(textOf(refused)).toHaveTextContent("Rayan Demo a refusé les points de contribution pour Yacine Demo");
    const published = notification(3, "ranking_published", {
      data: { month: "2026-09" },
      target: { type: "ranking", id: 1 },
    });
    expect(textOf(published)).toHaveTextContent("Le classement de septembre 2026 est publié : votre note vous attend.");
    expect(notificationHref(published)).toBe("/ranking");
    expect(
      notificationHref(
        notification(4, "ranking_to_publish", { data: { month: "2026-09" }, target: { type: "ranking", id: 0 } }),
      ),
    ).toBe("/ranking/team");
  });

  it("tells about breaches, warnings and exclusions, and leads to them", () => {
    const issued = notification(1, "warning_issued", {
      data: { member: "Yacine Demo", ground: "commitments", number: 1 },
      target: { type: "warning", id: 7 },
    });
    expect(textOf(issued)).toHaveTextContent(
      "Avertissement n° 1 pour Yacine Demo, donné par Rayan Demo (Engagements non respectés).",
    );
    expect(notificationHref(issued)).toBe("/discipline/warnings/7");
    const reported = notification(2, "warning_reported", {
      data: { member: "Yacine Demo", ground: "communication" },
      target: { type: "discipline_report", id: 3 },
    });
    expect(textOf(reported)).toHaveTextContent("Rayan Demo signale un manquement de Yacine Demo");
    expect(notificationHref(reported)).toBe("/discipline");
    const pending = notification(3, "exclusion_pending", {
      data: { member: "Yacine Demo", ground: "theft", cause: "immediate" },
      target: { type: "exclusion", id: 2 },
    });
    expect(textOf(pending)).toHaveTextContent("Une exclusion de Yacine Demo attend la confirmation du Bureau.");
  });

  it("tells about goals, trainings and volunteering, and leads to them", () => {
    const goal = notification(1, "objective_set", {
      data: { objective: "Livrer le faisceau", due_date: "2027-01-31" },
      target: { type: "objective", id: 3 },
    });
    expect(textOf(goal)).toHaveTextContent(
      "Rayan Demo vous a fixé un objectif pour le 31 janvier : « Livrer le faisceau ».",
    );
    expect(notificationHref(goal)).toBe("/engagement/objectives");
    const planned = notification(2, "training_planned", {
      data: { training: "Soudure TIG" },
      target: { type: "training", id: 7 },
    });
    expect(textOf(planned)).toHaveTextContent("Rayan Demo a prévu votre formation « Soudure TIG ».");
    expect(notificationHref(planned)).toBe("/engagement/trainings");
    const refused = notification(3, "volunteering_decided", {
      data: { volunteering: "Rangement", date: "2026-10-20", approved: false, note: "Pas collectif" },
      target: { type: "volunteering", id: 4 },
    });
    expect(textOf(refused)).toHaveTextContent("Rayan Demo a refusé le bénévolat « Rangement » : « Pas collectif »");
    expect(notificationHref(refused)).toBe("/engagement");
    const validated = notification(4, "volunteering_decided", {
      data: { volunteering: "Rangement", date: "2026-10-20", approved: true },
      target: { type: "volunteering", id: 4 },
    });
    expect(textOf(validated)).toHaveTextContent("Rayan Demo a validé le bénévolat « Rangement » du 20 octobre.");
    const reminder = notification(5, "volunteering_reminder", {
      data: { month: "2026-10" },
      target: { type: "volunteering", id: 0 },
    });
    expect(textOf(reminder)).toHaveTextContent("Aucun bénévolat validé pour vous en octobre 2026");
  });

  it("tells the main assignee that they are", async () => {
    const container = textOf(notification(1, "task_assigned", { data: { ...ABOUT_PACK, primary_id: 1 } }));
    await waitFor(() => expect(container).toHaveTextContent("vous en êtes la personne principale"));
  });

  it("shows a message written by hand as it is, and someone unknown as such", () => {
    expect(textOf(notification(1, "message", { message: "Réunion à 18 h.", target: null }))).toHaveTextContent(
      "Réunion à 18 h.",
    );
    expect(textOf(notification(2, "task_done", { actor: null }))).toHaveTextContent("Quelqu'un a terminé");
  });

  it("speaks Arabic, keeping French names in order", () => {
    const container = textOf(notification(1, "task_commented", { data: { ...ABOUT_PACK, excerpt: "OK" } }), "ar");
    expect(container).toHaveTextContent("تعليق من Rayan Demo على «Modéliser le pack»: «OK»");
    expect(container.querySelectorAll("bdi").length).toBeGreaterThanOrEqual(2);
  });

  it("leads to its task or subsystem, and opening it marks it read", async () => {
    expect(notificationHref(notification(1, "task_done"))).toBe("/tasks/7");
    expect(
      notificationHref(
        notification(2, "validation_requested", { target: { type: "subsystem", id: 3 }, data: { project_id: 1 } }),
      ),
    ).toBe("/projects/1?tab=subsystems");
    expect(notificationHref(notification(3, "message", { target: null }))).toBeNull();

    renderWithProviders(<NotificationItem notification={notification(9, "task_done")} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/fr/tasks/7");
    expect(link).toHaveTextContent("Non lue");
    await userEvent.setup().click(link);
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(9));
  });
});

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockResolvedValue(me());
    vi.mocked(fetchUnreadCount).mockReset().mockResolvedValue(3);
    vi.mocked(fetchNotifications)
      .mockReset()
      .mockResolvedValue([
        notification(3, "task_commented", { data: { ...ABOUT_PACK, excerpt: "OK" } }),
        notification(2, "task_blocked"),
        notification(1, "task_done", { is_read: true }),
      ]);
    vi.mocked(markRead)
      .mockReset()
      .mockResolvedValue(notification(3, "task_commented", { is_read: true }));
    vi.mocked(markAllRead).mockReset().mockResolvedValue(3);
  });

  it("says how many are unread", async () => {
    renderWithProviders(<NotificationBell enabled />);
    expect(await screen.findByRole("button", { name: "Notifications : 3 non lues" })).toHaveTextContent("3");
    expect(fetchNotifications).not.toHaveBeenCalled(); // the list waits for the panel
  });

  it("shows 9+ beyond nine, and asks nothing before the member is known", async () => {
    vi.mocked(fetchUnreadCount).mockResolvedValue(12);
    const { rerender } = renderWithProviders(<NotificationBell enabled={false} />);
    expect(screen.getByRole("button", { name: "Notifications" })).not.toHaveTextContent(/\d/);
    expect(fetchUnreadCount).not.toHaveBeenCalled();
    rerender(<NotificationBell enabled />);
    expect(await screen.findByRole("button", { name: "Notifications : 12 non lues" })).toHaveTextContent("9+");
  });

  it("opens the newest in a panel; opening one marks it read and closes the panel", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell enabled />);
    const bell = await screen.findByRole("button", { name: "Notifications : 3 non lues" });
    await user.click(bell);
    expect(bell).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("region", { name: "Notifications" });
    const items = await within(panel).findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(panel).getByRole("link", { name: "Voir toutes les notifications" })).toHaveAttribute(
      "href",
      "/fr/notifications",
    );

    await user.click(within(items[0]).getByRole("link"));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(3));
    expect(screen.queryByRole("region", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("marks them all read, and closes with Escape", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationBell enabled />);
    const bell = await screen.findByRole("button", { name: "Notifications : 3 non lues" });
    await user.click(bell);
    await user.click(await screen.findByRole("button", { name: "Tout marquer comme lu" }));
    await waitFor(() => expect(markAllRead).toHaveBeenCalled());

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Notifications" })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });
});

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.mocked(fetchMe).mockResolvedValue(me());
    vi.mocked(fetchUnreadCount).mockReset().mockResolvedValue(1);
    vi.mocked(fetchNotifications)
      .mockReset()
      .mockImplementation(async (unread) =>
        unread
          ? [notification(2, "task_blocked")]
          : [notification(2, "task_blocked"), notification(1, "task_done", { is_read: true })],
      );
    vi.mocked(markAllRead).mockReset().mockResolvedValue(1);
  });

  it("lists them all, or only the unread ones", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsPage />);
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Non lues" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(fetchNotifications).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole("button", { name: "Tout marquer comme lu" }));
    await waitFor(() => expect(markAllRead).toHaveBeenCalled());
  });

  it("says when there is nothing", async () => {
    vi.mocked(fetchUnreadCount).mockResolvedValue(0);
    vi.mocked(fetchNotifications).mockResolvedValue([]);
    renderWithProviders(<NotificationsPage />);
    expect(await screen.findByText("Aucune notification pour le moment.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tout marquer comme lu" })).not.toBeInTheDocument();
  });
});
