"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

type OtpInputProps = {
  /** Number of digits (OTP_LENGTH in backend/config/settings.py). */
  length?: number;
  /** Name of the whole field, read by screen readers. */
  label: string;
  /** Name of one box, e.g. "Digit 2 of 6". */
  digitLabel: (position: number, total: number) => string;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  onChange?: (code: string) => void;
  /** Called when every box holds a digit. */
  onComplete?: (code: string) => void;
};

/**
 * A code typed in one box per digit. Accepts typing, pasting the whole code anywhere, and the code
 * suggested by the phone (autocomplete="one-time-code"). Digits go left to right in every language.
 * To empty it, give it a new `key`.
 */
export function OtpInput({
  length = 6,
  label,
  digitLabel,
  disabled,
  invalid,
  autoFocus,
  onChange,
  onComplete,
}: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(() => Array<string>(length).fill(""));
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  function update(next: string[], focusIndex?: number) {
    setDigits(next);
    const code = next.join("");
    onChange?.(code);
    if (focusIndex !== undefined) {
      inputs.current[Math.min(focusIndex, length - 1)]?.focus();
    }
    if (next.every((digit) => digit !== "")) {
      onComplete?.(code);
    }
  }

  /** Writes the digits of `text` from box `from` onwards (anything else is ignored). */
  function fill(from: number, text: string) {
    const typed = text
      .replace(/\D/g, "")
      .slice(0, length - from)
      .split("");
    if (typed.length === 0) {
      return;
    }
    const next = [...digits];
    typed.forEach((digit, offset) => {
      next[from + offset] = digit;
    });
    update(next, from + typed.length);
  }

  function handleChange(index: number, value: string) {
    if (value === "") {
      const next = [...digits];
      next[index] = "";
      update(next);
      return;
    }
    // The box already held a digit: keep only what was just typed.
    fill(index, digits[index] ? value.replace(digits[index], "") : value);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = "";
      update(next, index - 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      inputs.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < length - 1) {
      event.preventDefault();
      inputs.current[index + 1]?.focus();
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text");
    // A whole code fills the boxes from the first one, wherever it is pasted.
    fill(text.replace(/\D/g, "").length >= length ? 0 : index, text);
  }

  return (
    <div role="group" aria-label={label} dir="ltr" className="flex gap-2">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            inputs.current[index] = element;
          }}
          value={digit}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={digitLabel(index + 1, length)}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          onFocus={(event) => event.target.select()}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          className={cn(
            "h-12 w-full min-w-0 flex-1 rounded-lg border border-line bg-surface text-center text-xl font-semibold text-ink tabular-nums shadow-xs transition",
            "focus:border-navy focus:ring-3 focus:ring-navy/10 focus:outline-none",
            "disabled:opacity-60 aria-invalid:border-racing",
          )}
        />
      ))}
    </div>
  );
}
