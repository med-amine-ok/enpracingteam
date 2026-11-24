import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { renderWithProviders } from "@/test/render";
import { fetchMe, requestCode, verifyCode, type Me } from "./api";
import { LoginForm } from "./login-form";

const router = { replace: vi.fn() };
let search = "";

vi.mock("./api", () => ({ requestCode: vi.fn(), verifyCode: vi.fn(), fetchMe: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search) }));

const EMAIL = "lina.demo@example.invalid";
const member = (language: Me["language"] = "") => ({ first_name: "Lina", language }) as Me;

async function askForCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Adresse e-mail"), `  ${EMAIL} `);
  await user.click(screen.getByRole("button", { name: "Recevoir un code" }));
}

async function typeCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(screen.getByLabelText("Chiffre 1 sur 6"));
  await user.keyboard(code);
}

describe("LoginForm", () => {
  beforeEach(() => {
    search = "";
    router.replace.mockReset();
    vi.mocked(requestCode).mockResolvedValue("If this email is registered, a code has been sent.");
    vi.mocked(verifyCode).mockResolvedValue(undefined);
    vi.mocked(fetchMe).mockResolvedValue(member());
  });

  it("asks for a code for the trimmed address, then shows the code step", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);
    await askForCode(user);
    expect(requestCode).toHaveBeenCalledWith(EMAIL);
    expect(await screen.findByRole("heading", { name: "Vérifiez votre boîte mail" })).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    // The API allows a new code after 45 s only.
    expect(screen.getByRole("button", { name: "Renvoyer dans 45 secondes" })).toBeDisabled();
  });

  it("shows the API's own message when it refuses", async () => {
    vi.mocked(requestCode).mockRejectedValue(new ApiError(429, "Veuillez patienter avant de redemander un code."));
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);
    await askForCode(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Veuillez patienter avant de redemander un code.");
    expect(screen.getByLabelText("Adresse e-mail")).toBeInTheDocument();
  });

  it("explains when the server cannot be reached", async () => {
    vi.mocked(requestCode).mockRejectedValue(new ApiError(0, ""));
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);
    await askForCode(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de joindre le serveur.");
  });

  it("empties the boxes after a wrong code", async () => {
    vi.mocked(verifyCode).mockRejectedValue(new ApiError(400, "Code invalide ou expiré."));
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);
    await askForCode(user);
    await screen.findByLabelText("Chiffre 1 sur 6");
    await typeCode(user, "000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("Code invalide ou expiré.");
    expect(verifyCode).toHaveBeenCalledWith(EMAIL, "000000");
    expect((screen.getByLabelText("Chiffre 1 sur 6") as HTMLInputElement).value).toBe("");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("logs in with the right code and opens the home page", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);
    await askForCode(user);
    await screen.findByLabelText("Chiffre 1 sur 6");
    await typeCode(user, "111524");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/", { locale: "fr" }));
    expect(verifyCode).toHaveBeenCalledWith(EMAIL, "111524");
  });

  it("forgets what was cached for a previous member before opening the pages", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<LoginForm />);
    queryClient.setQueryData(["tasks"], ["tâche d'un autre membre"]);
    await askForCode(user);
    await screen.findByLabelText("Chiffre 1 sur 6");
    await typeCode(user, "111524");
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(queryClient.getQueryData(["tasks"])).toBeUndefined();
  });

  it("switches to the language saved in the member's profile", async () => {
    vi.mocked(fetchMe).mockResolvedValue(member("ar"));
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);
    await askForCode(user);
    await screen.findByLabelText("Chiffre 1 sur 6");
    await typeCode(user, "111524");
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/", { locale: "ar" }));
  });

  it("goes back to the page asked before login, never to another site", async () => {
    for (const [next, expected] of [
      ["/tasks", "/tasks"],
      ["//evil.example", "/"],
    ]) {
      search = `next=${encodeURIComponent(next)}`;
      router.replace.mockReset();
      const user = userEvent.setup();
      const { unmount } = renderWithProviders(<LoginForm />);
      await askForCode(user);
      await screen.findByLabelText("Chiffre 1 sur 6");
      await typeCode(user, "111524");
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith(expected, { locale: "fr" }));
      unmount();
    }
  });

  it("works in Arabic, with Arabic plurals", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />, { locale: "ar" });
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("البريد الإلكتروني"), EMAIL);
    await user.click(screen.getByRole("button", { name: "إرسال رمز الدخول" }));
    expect(await screen.findByRole("button", { name: "إعادة الإرسال بعد 45 ثانية" })).toBeDisabled();
  });
});
