import { describe, expect, it, vi } from "vitest";
import { saveBlob, toCsv } from "./csv";

describe("toCsv", () => {
  it("writes semicolons for the French Excel, with the UTF-8 mark and quotes where needed", () => {
    const text = toCsv([
      ["Référence", "Titre"],
      ["EV27-001", 'Le "pack"; v2'],
      [7, null],
    ]);
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text.slice(1).split("\r\n")).toEqual(["Référence;Titre", 'EV27-001;"Le ""pack""; v2"', "7;"]);
  });

  it("keeps a cell starting like a formula as text, so that Excel never runs it", () => {
    expect(toCsv([["=1+1", "+33 6", "-2", "@SUM(A1)"]]).slice(1)).toBe("'=1+1;'+33 6;'-2;'@SUM(A1)");
  });
});

describe("saveBlob", () => {
  it("releases the file only after the browser has handled the click", () => {
    vi.useFakeTimers();
    try {
      // jsdom has no object URLs: stand-ins.
      URL.createObjectURL = vi.fn(() => "blob:report");
      URL.revokeObjectURL = vi.fn();
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      saveBlob(new Blob(["x"]), "rapport.pdf");
      expect(click).toHaveBeenCalled();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report");
    } finally {
      vi.useRealTimers();
    }
  });
});
