"use client";

import { Check, Lock, ShieldCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { StepState } from "./api";

type LifecycleStepsProps = {
  steps: StepState[];
  /** Tick (or untick) a step; not given when nothing can be changed. */
  onToggle?: (step: StepState) => void;
  busy?: boolean;
};

/**
 * The engineering lifecycle of a subsystem, step by step. A step the viewer may change is a button;
 * the validation step shows who signed it; a step waiting for that validation is locked.
 */
export function LifecycleSteps({ steps, onToggle, busy = false }: LifecycleStepsProps) {
  const t = useTranslations("Work");
  const format = useFormatter();
  const done = steps.filter((state) => state.is_complete).length;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted">
        {t("stepsDone", { done: String(done), total: String(steps.length) })}
      </p>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7 lg:gap-1">
        {steps.map((state) => {
          const { step } = state;
          const locked = !state.is_complete && state.waiting_for !== null;
          const clickable = !!onToggle && state.can_tick && !locked;
          const label = `${step.step_order}. ${step.name}`;
          const description = state.is_complete
            ? state.validated_by
              ? t("validatedBy", {
                  name: `${state.validated_by.first_name} ${state.validated_by.last_name}`,
                })
              : t("stepDone")
            : locked
              ? t("waitsFor", { step: String(state.waiting_for) })
              : t("stepToDo");
          const content = (
            <>
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                  state.is_complete
                    ? "border-success bg-success text-white"
                    : step.requires_validation
                      ? "border-navy/40 bg-info-soft text-navy"
                      : "border-line bg-surface text-muted",
                )}
                aria-hidden="true"
              >
                {state.is_complete ? (
                  <Check className="size-4" />
                ) : locked ? (
                  <Lock className="size-3.5" />
                ) : step.requires_validation ? (
                  <ShieldCheck className="size-4" />
                ) : (
                  step.step_order
                )}
              </span>
              <span className="min-w-0 text-start">
                {/* Step names are data, shown as saved in the ERP. The number is read out here: the
                    circle shows it only to the eye. */}
                <span className="block text-xs leading-tight font-medium text-ink">
                  <span className="sr-only">{`${step.step_order}. `}</span>
                  {step.name}
                </span>
                <span className="block text-2xs leading-tight text-muted">
                  {description}
                  {state.is_complete && state.completed_at
                    ? ` · ${format.dateTime(new Date(state.completed_at), { day: "numeric", month: "short", numberingSystem: "latn" })}`
                    : null}
                </span>
              </span>
            </>
          );
          const boxClass = cn(
            "flex w-full items-center gap-2 rounded-lg border p-2 lg:flex-col lg:items-start",
            state.is_complete ? "border-success/30 bg-success-soft/50" : "border-line bg-surface",
            locked && "opacity-70",
          );
          return (
            <li key={step.id}>
              {clickable ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={state.is_complete}
                  aria-label={`${label}: ${description}`}
                  title={state.is_complete ? t("untick") : t("tick")}
                  onClick={() => onToggle?.(state)}
                  className={cn(boxClass, "transition-colors hover:border-navy/40 disabled:opacity-60")}
                >
                  {content}
                </button>
              ) : (
                <div className={boxClass}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A thin bar: how much of something is done. */
export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 overflow-hidden rounded-full bg-line"
    >
      {/* The Figma's colours: red under half, amber under three quarters, green above. */}
      <div
        className={cn(
          "h-full rounded-full transition-all",
          percent < 50 ? "bg-racing" : percent < 75 ? "bg-amber-500" : "bg-emerald-500",
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
