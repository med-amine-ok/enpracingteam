import { useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { meQueryKey } from "@/features/auth/use-me";
import type { AppLocale } from "@/i18n/routing";
import { ApiError } from "@/lib/api/errors";
import { me } from "@/test/fixtures";
import { createQueryClient, Providers, shouldRetry } from "./providers";

/** The app's frame, as in src/app/[locale]/layout.tsx: the language, then the data cache. */
function app(locale: AppLocale, children: ReactNode) {
  return (
    <NextIntlClientProvider locale={locale} timeZone="Africa/Algiers">
      <Providers>{children}</Providers>
    </NextIntlClientProvider>
  );
}

describe("Providers", () => {
  it("fetches the data shown again when the language changes", async () => {
    // Some answers depend on the language, such as the names of the standard lifecycle steps.
    const fetchSteps = vi.fn(async () => "steps");
    function Steps() {
      const { data } = useQuery({ queryKey: ["lifecycle-steps"], queryFn: fetchSteps, staleTime: 60 * 60_000 });
      return <p>{data}</p>;
    }

    const { rerender } = render(app("fr", <Steps />));
    expect(await screen.findByText("steps")).toBeInTheDocument();
    rerender(app("fr", <Steps />));
    expect(fetchSteps).toHaveBeenCalledTimes(1); // same language: kept

    rerender(app("en", <Steps />));
    await waitFor(() => expect(fetchSteps).toHaveBeenCalledTimes(2));
  });
});

describe("createQueryClient", () => {
  it("tries a failed fetch once more, unless the API refused it", () => {
    expect(shouldRetry(0, new ApiError(0, ""))).toBe(true);
    expect(shouldRetry(0, new ApiError(503, ""))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, ""))).toBe(false);
    expect(shouldRetry(0, new ApiError(404, ""))).toBe(false);
    expect(shouldRetry(0, new ApiError(429, ""))).toBe(false);
  });

  it("forgets the member when a fetch or an action ends with 401 (session ended)", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(meQueryKey, me());
    await queryClient
      .fetchQuery({ queryKey: ["tasks"], queryFn: () => Promise.reject(new ApiError(403, "")) })
      .catch(() => {});
    expect(queryClient.getQueryData(meQueryKey)).not.toBeNull();
    await queryClient
      .fetchQuery({ queryKey: ["tasks"], queryFn: () => Promise.reject(new ApiError(401, "")) })
      .catch(() => {});
    expect(queryClient.getQueryData(meQueryKey)).toBeNull();

    queryClient.setQueryData(meQueryKey, me());
    const save = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => Promise.reject(new ApiError(401, "")),
    });
    await save.execute(undefined).catch(() => {});
    expect(queryClient.getQueryData(meQueryKey)).toBeNull();
  });
});
