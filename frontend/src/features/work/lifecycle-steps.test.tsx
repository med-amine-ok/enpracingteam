import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { lifecycleStep, stepState } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { LifecycleSteps, ProgressBar } from "./lifecycle-steps";

const study = lifecycleStep(1, "Étude & recherche");
const cad = lifecycleStep(2, "Conception CAD");
const validation = lifecycleStep(3, "Validation par le chef", { requires_validation: true });
const build = lifecycleStep(4, "Fabrication / achat");

/** A subsystem whose study is done; the validation is for unit leaders (canValidate). */
function steps({ canValidate = false } = {}) {
  return [
    stepState(study, { is_complete: true, completed_at: "2026-09-17T10:00:00Z" }),
    stepState(cad),
    stepState(validation, { can_tick: canValidate }),
    stepState(build, { waiting_for: 3 }),
  ];
}

describe("LifecycleSteps", () => {
  it("shows how far the subsystem is, step by step", () => {
    renderWithProviders(<LifecycleSteps steps={steps()} onToggle={vi.fn()} />);
    expect(screen.getByText("1/4 étapes terminées")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1. Étude & recherche: Terminée" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Terminée · 17 sept.")).toBeInTheDocument();
    expect(screen.getByText("Attend l'étape 3")).toBeInTheDocument();
  });

  it("lets the member tick the steps they may change", async () => {
    const onToggle = vi.fn();
    renderWithProviders(<LifecycleSteps steps={steps()} onToggle={onToggle} />);
    const step = screen.getByRole("button", { name: "2. Conception CAD: À faire" });
    expect(step).toHaveAttribute("aria-pressed", "false");
    await userEvent.setup().click(step);
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ step: cad, is_complete: false }));
  });

  it("keeps the validation for unit leaders, and locks the steps that wait for it", () => {
    renderWithProviders(<LifecycleSteps steps={steps()} onToggle={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Validation par le chef/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fabrication/ })).not.toBeInTheDocument();
    // Still shown, with its number for screen readers.
    expect(screen.getByText("Validation par le chef")).toHaveTextContent("3. Validation par le chef");
  });

  it("lets a unit leader sign the validation, then names who signed it", () => {
    const { rerender } = renderWithProviders(
      <LifecycleSteps steps={steps({ canValidate: true })} onToggle={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "3. Validation par le chef: À faire" })).toBeEnabled();

    const signed = steps({ canValidate: true });
    signed[2] = stepState(validation, {
      is_complete: true,
      completed_at: "2026-10-07T10:00:00Z",
      validated_by: { id: 5, first_name: "Sara", last_name: "Demo" },
    });
    rerender(<LifecycleSteps steps={signed} onToggle={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "3. Validation par le chef: Validée par Sara Demo" }),
    ).toBeInTheDocument();
  });

  it("changes nothing when shown read only", () => {
    renderWithProviders(<LifecycleSteps steps={steps({ canValidate: true })} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ProgressBar", () => {
  it("gives the share done to screen readers", () => {
    const { rerender } = renderWithProviders(<ProgressBar done={3} total={10} label="Avancement des tâches" />);
    expect(screen.getByRole("progressbar", { name: "Avancement des tâches" })).toHaveAttribute("aria-valuenow", "30");
    rerender(<ProgressBar done={0} total={0} label="Avancement des tâches" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
