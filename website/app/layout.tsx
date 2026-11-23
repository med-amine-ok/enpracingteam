import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Big_Shoulders_Stencil, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Big_Shoulders({ variable: "--font-display", subsets: ["latin"], weight: ["600", "700", "800", "900"], adjustFontFallback: false });
const stencil = Big_Shoulders_Stencil({ variable: "--font-stencil", subsets: ["latin"], weight: ["700", "900"], adjustFontFallback: false });
const body = Instrument_Sans({ variable: "--font-body", subsets: ["latin"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://enp-racing-team.vercel.app"),
  title: "ENP Racing Team — From Algeria to Silverstone",
  description:
    "ENP Racing Team, the Formula Student team of the National Polytechnic School of Algiers. First Algerian team at Formula Student UK and winner of the Allan Staniforth Best Newcomer Award 2026.",
  openGraph: {
    title: "ENP Racing Team — From Algeria to Silverstone",
    description: "The first Formula Student single-seater from North Africa. Best Newcomer Award, Formula Student UK 2026.",
    images: ["/images/car-unveil.jpg"],
    type: "website",
  },
  icons: { icon: "/brand/logo-badge.jpg" },
};

export const viewport: Viewport = {
  themeColor: "#07070a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${stencil.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
