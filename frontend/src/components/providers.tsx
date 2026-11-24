"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { meQueryKey } from "@/features/auth/use-me";
import { ApiError } from "@/lib/api/errors";

/** Tries a failed fetch once more, unless the API refused it (4xx): the same answer would come back. */
export function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 1;
}

/**
 * The data cache of the app. A 401 that reaches it means the session could not be renewed (ended,
 * or logged out on another device): the member becomes unknown, and the app shell opens the login page.
 */
export function createQueryClient() {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: endSessionOn401 }),
    mutationCache: new MutationCache({ onError: endSessionOn401 }),
    defaultOptions: { queries: { retry: shouldRetry, refetchOnWindowFocus: false } },
  });
  function endSessionOn401(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      queryClient.setQueryData(meQueryKey, null);
    }
  }
  return queryClient;
}

/** Shared data cache of the pages (TanStack Query): each API answer is fetched once and reused. */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <RefetchOnLanguageChange />
      {children}
    </QueryClientProvider>
  );
}

/**
 * Some answers are written in the language of the page (names of the standard lifecycle steps,
 * messages): after a language change, what is shown is fetched again, the rest when next shown.
 */
function RefetchOnLanguageChange() {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const previous = useRef(locale);
  useEffect(() => {
    if (previous.current !== locale) {
      previous.current = locale;
      void queryClient.invalidateQueries();
    }
  }, [locale, queryClient]);
  return null;
}
