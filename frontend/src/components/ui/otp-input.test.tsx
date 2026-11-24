import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OtpInput } from "./otp-input";

function setup() {
  const onComplete = vi.fn();
  const onChange = vi.fn();
  render(
    <OtpInput
      label="Code"
      digitLabel={(position, total) => `Digit ${position} of ${total}`}
      onChange={onChange}
      onComplete={onComplete}
    />,
  );
  const boxes = screen.getAllByRole("textbox") as HTMLInputElement[];
  return { boxes, onChange, onComplete, user: userEvent.setup() };
}

describe("OtpInput", () => {
  it("has one named box per digit, written left to right in every language", () => {
    const { boxes } = setup();
    expect(boxes).toHaveLength(6);
    expect(screen.getByLabelText("Digit 1 of 6")).toBe(boxes[0]);
    expect(screen.getByRole("group", { name: "Code" })).toHaveAttribute("dir", "ltr");
    expect(boxes[0]).toHaveAttribute("autocomplete", "one-time-code");
  });

  it("moves to the next box while typing and reports the full code", async () => {
    const { boxes, onComplete, user } = setup();
    await user.click(boxes[0]);
    await user.keyboard("482913");
    expect(boxes.map((box) => box.value).join("")).toBe("482913");
    expect(onComplete).toHaveBeenCalledWith("482913");
  });

  it("ignores letters and spaces", async () => {
    const { boxes, onComplete, user } = setup();
    await user.click(boxes[0]);
    await user.keyboard("a1 b");
    expect(boxes.map((box) => box.value)).toEqual(["1", "", "", "", "", ""]);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("fills every box when a whole code is pasted, wherever", async () => {
    const { boxes, onComplete, user } = setup();
    await user.click(boxes[3]);
    await user.paste("Code : 123 456");
    expect(boxes.map((box) => box.value).join("")).toBe("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("goes back one box with Backspace on an empty box", async () => {
    const { boxes, onChange, user } = setup();
    await user.click(boxes[0]);
    await user.keyboard("12");
    expect(boxes[2]).toHaveFocus();
    await user.keyboard("{Backspace}");
    expect(boxes[1]).toHaveFocus();
    expect(boxes[1].value).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("1");
  });
});
