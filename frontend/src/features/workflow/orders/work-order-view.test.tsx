import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setWeights, workOrderAction } from "@/features/workflow/api";
import { renderWithProviders } from "@/test/render";
import { workOrderDetail } from "./test-fixtures";
import { checkWeights, WeightEditor } from "./work-order-deliverables";
import { ProposalBanner } from "./work-order-view";

vi.mock("@/features/workflow/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/workflow/api")>()),
  workOrderAction: vi.fn(),
  setWeights: vi.fn(),
}));

const pending = (rights: NonNullable<Parameters<typeof workOrderDetail>[2]>["rights"]) =>
  workOrderDetail(5, "Aéro arrière", {
    proposal_status: "pending_review",
    proposed_by: { id: 2, first_name: "Sami", last_name: "Demo" },
    rights,
  });

describe("ProposalBanner", () => {
  beforeEach(() => {
    vi.mocked(workOrderAction).mockReset().mockResolvedValue(workOrderDetail(5, "Aéro arrière"));
  });

  it("offers Approve and Reject only to whoever may decide", () => {
    const { unmount } = renderWithProviders(<ProposalBanner order={pending({ decide: false })} />);
    expect(screen.getByText(/attend la décision du chef de département/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approuver" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rejeter" })).not.toBeInTheDocument();
    unmount();

    renderWithProviders(<ProposalBanner order={pending({ decide: true, edit: true })} />);
    expect(screen.getByRole("button", { name: "Approuver" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rejeter" })).toBeInTheDocument();
  });

  it("needs a note to reject, then a confirmation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProposalBanner order={pending({ decide: true })} />);
    await user.click(screen.getByRole("button", { name: "Rejeter" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Expliquez le rejet dans la note.");
    expect(workOrderAction).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Note de décision"), "Hors périmètre de la saison");
    await user.click(screen.getByRole("button", { name: "Rejeter" }));
    const dialog = screen.getByRole("dialog", { name: "Rejeter la proposition ?" });
    await user.click(within(dialog).getByRole("button", { name: "Rejeter" }));
    expect(workOrderAction).toHaveBeenCalledWith(5, "reject", "Hors périmètre de la saison");
  });

  it("lets the author submit a draft, and shows nothing once approved", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(
      <ProposalBanner
        order={workOrderDetail(5, "Aéro", { proposal_status: "draft", rights: { submit_proposal: true } })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Soumettre la proposition" }));
    expect(workOrderAction).toHaveBeenCalledWith(5, "submit-proposal");
    unmount();
    const { container } = renderWithProviders(
      <ProposalBanner order={workOrderDetail(5, "Aéro", { proposal_status: "approved" })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("WeightEditor", () => {
  const planning = (status: "planning" | "active") =>
    workOrderDetail(7, "Batterie HV", {
      status,
      budget_tier: 4,
      rights: { plan: true },
      plan_problems: ["The Deliverable weights total 70 %, not 100 %."],
      credit_plan: [
        { id: 11, code: "D-1", title: "Modèle CAO", weight: "40.000", allocated_points: "1.6000" },
        { id: 12, code: "D-2", title: "Essais", weight: "30.000", allocated_points: "1.2000" },
      ],
    });

  beforeEach(() => {
    vi.mocked(setWeights).mockReset().mockResolvedValue(workOrderDetail(7, "Batterie HV"));
  });

  it("checks the weights: valid, over 100 % or not 100 % once active", () => {
    expect(checkWeights(["40", "60"], true)).toMatchObject({ total: 100, blocking: false });
    expect(checkWeights(["40", "30"], false)).toMatchObject({ total: 70, notHundred: true, blocking: false });
    expect(checkWeights(["40", "30"], true).blocking).toBe(true);
    expect(checkWeights(["70", "30.5"], false)).toMatchObject({ over: true, blocking: true });
    expect(checkWeights(["12.3456"], false)).toMatchObject({ invalid: true, blocking: true });
    expect(checkWeights(["33.333", "33.333", "33.334"], true)).toMatchObject({ total: 100, blocking: false });
  });

  it("totals live, computes the points, shows the backend's problems and saves", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WeightEditor order={planning("planning")} />);
    expect(screen.getByText("The Deliverable weights total 70 %, not 100 %.")).toBeInTheDocument();
    expect(screen.getByTestId("weights-total")).toHaveTextContent("70 %");
    expect(screen.getByText(/devra atteindre 100 %/)).toBeInTheDocument();

    const second = screen.getByLabelText("Poids de « Essais »");
    await user.clear(second);
    await user.type(second, "70");
    expect(screen.getByTestId("weights-total")).toHaveTextContent("110 %");
    expect(screen.getByRole("alert")).toHaveTextContent("plus de 100 %");
    expect(screen.getByRole("button", { name: "Enregistrer les poids" })).toBeDisabled();

    await user.clear(second);
    await user.type(second, "60");
    expect(screen.getByTestId("weights-total")).toHaveTextContent("100 %");
    // 4 points × 60 % = 2.40
    expect(screen.getByText("2,40")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enregistrer les poids" }));
    expect(setWeights).toHaveBeenCalledWith(7, { "11": "40.000", "12": "60.000" }, "");
  });

  it("asks for a reason once the Work Order is active", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WeightEditor order={planning("active")} />);
    const second = screen.getByLabelText("Poids de « Essais »");
    await user.clear(second);
    await user.type(second, "60");
    const save = screen.getByRole("button", { name: "Enregistrer les poids" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Raison"), "Essais élargis");
    await user.click(save);
    expect(setWeights).toHaveBeenCalledWith(7, { "11": "40.000", "12": "60.000" }, "Essais élargis");
  });
});
