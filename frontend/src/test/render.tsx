import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

const MESSAGES = { fr, en, ar };

/**
 * Renders a component as in the app: translations of `locale` and a fresh data cache. `rerender`
 * keeps them (they wrap whatever is rendered).
 */
export function renderWithProviders(ui: ReactElement, { locale = "fr" }: { locale?: keyof typeof MESSAGES } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="Africa/Algiers">
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  }
  return { ...render(ui, { wrapper: Providers }), queryClient };
}
