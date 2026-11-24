import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  if (typeof document === "undefined") {
    return; // tests that run without a browser (// @vitest-environment node)
  }
  cleanup();
  // Each test starts without cookies (the CSRF cookie changes what the API client sends).
  document.cookie.split(";").forEach((cookie) => {
    document.cookie = `${cookie.split("=")[0].trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
});
