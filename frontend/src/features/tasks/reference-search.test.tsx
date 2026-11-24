import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findTask } from "@/features/work/api";
import { task } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ReferenceSearch } from "./reference-search";

const router = { push: vi.fn() };

vi.mock("@/i18n/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/i18n/navigation")>()),
  useRouter: () => router,
}));
vi.mock("@/features/work/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/work/api")>()),
  findTask: vi.fn(),
}));

describe("ReferenceSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the task a reference names", async () => {
    vi.mocked(findTask).mockResolvedValue(task(7, "Câbler le BMS"));
    const user = userEvent.setup();
    renderWithProviders(<ReferenceSearch />);
    await user.type(screen.getByRole("searchbox", { name: "Chercher une tâche par sa référence" }), "ev27-007{Enter}");
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/tasks/7"));
    expect(findTask).toHaveBeenCalledWith("ev27-007");
  });

  it("says when no task has the reference", async () => {
    vi.mocked(findTask).mockResolvedValue(null);
    const user = userEvent.setup();
    renderWithProviders(<ReferenceSearch />);
    const box = screen.getByRole("searchbox", { name: "Chercher une tâche par sa référence" });
    await user.type(box, "ev27-099{Enter}");
    expect(await screen.findByText("Aucune tâche n'a la référence EV27-099.")).toBeInTheDocument();
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(router.push).not.toHaveBeenCalled();
  });
});
