import { describe, expect, it } from "vitest";
import { clubDateTime, clubToday, fromClubDateTime } from "./dates";
import { initials } from "./initials";
import { safeWebUrl, telHref } from "./links";

describe("initials", () => {
  it("takes the first letter of each name", () => {
    expect(initials("lina", "Demo")).toBe("LD");
    expect(initials(" Ines ", "")).toBe("I");
    expect(initials("أمين", "علي")).toBe("أع");
  });
});

describe("clubToday", () => {
  it("is the date in Algiers, not in UTC", () => {
    // 23:30 UTC on 17 October = 00:30 on 18 October in Algiers (UTC+1).
    expect(clubToday(new Date("2026-10-17T23:30:00Z"))).toBe("2026-10-18");
    expect(clubToday(new Date("2026-10-17T12:00:00Z"))).toBe("2026-10-17");
  });
});

describe("date-time fields in the club's time zone", () => {
  it("show and read the time of Algiers (UTC+1), whatever the device's time zone", () => {
    expect(clubDateTime(new Date("2026-10-21T17:00:00Z"))).toBe("2026-10-21T18:00");
    expect(clubDateTime(new Date("2026-10-17T23:30:00Z"))).toBe("2026-10-18T00:30");
    expect(fromClubDateTime("2026-10-21T18:00").toISOString()).toBe("2026-10-21T17:00:00.000Z");
    expect(fromClubDateTime("2026-01-01T00:30").toISOString()).toBe("2025-12-31T23:30:00.000Z");
    // Summer too: Algeria keeps UTC+1 all year.
    expect(fromClubDateTime("2026-07-14T09:15").toISOString()).toBe("2026-07-14T08:15:00.000Z");
  });
});

describe("links typed by people", () => {
  it("only open web addresses", () => {
    expect(safeWebUrl("https://www.facebook.com/someone")).toBe("https://www.facebook.com/someone");
    expect(safeWebUrl(" http://example.org ")).toBe("http://example.org/");
    expect(safeWebUrl("javascript:alert(1)")).toBeNull();
    expect(safeWebUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeWebUrl("facebook.com/someone")).toBeNull();
    expect(safeWebUrl(null)).toBeNull();
  });

  it("call the digits of a phone number", () => {
    expect(telHref("0555 12 34 56")).toBe("tel:0555123456");
    expect(telHref("+213 555-12-34-56")).toBe("tel:+213555123456");
    expect(telHref("—")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});
