import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateLanguage } from "@/features/auth/api";
import { meQueryKey } from "@/features/auth/use-me";
import { me } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { LanguageSwitcher } from "./language-switcher";

const router = { replace: vi.fn() };

vi.mock("@/features/auth/api", () => ({ updateLanguage: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));

describe("LanguageSwitcher", () => {
  beforeEach(() => {
    router.replace.mockReset();
    vi.mocked(updateLanguage).mockReset().mockResolvedValue(undefined);
    window.history.replaceState(null, "", "/fr/tasks/new?project=3");
  });

  it("reopens the same page, with its parameters, in the chosen language", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LanguageSwitcher />);
    await user.click(screen.getByRole("button", { name: "العربية" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/tasks/new?project=3", { locale: "ar" }));
    expect(updateLanguage).not.toHaveBeenCalled(); // nobody is logged in
  });

  it("also saves the choice in the profile of a logged-in member", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<LanguageSwitcher />);
    queryClient.setQueryData(meQueryKey, me({ language: "fr" }));
    await user.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/tasks/new?project=3", { locale: "en" }));
    expect(updateLanguage).toHaveBeenCalledWith("en");
    expect(queryClient.getQueryData(meQueryKey)).toMatchObject({ language: "en" });
  });

  it("does nothing for the language already shown", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LanguageSwitcher />);
    expect(screen.getByRole("button", { name: "Français" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Français" }));
    expect(router.replace).not.toHaveBeenCalled();
  });
});
