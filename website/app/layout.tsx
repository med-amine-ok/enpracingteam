import type { Metadata, Viewport } from "next";
import {
  Big_Shoulders,
  Big_Shoulders_Stencil,
  Instrument_Sans,
  IBM_Plex_Mono,
} from "next/font/google";
import "./globals.css";

const display = Big_Shoulders({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  adjustFontFallback: false,
});
const stencil = Big_Shoulders_Stencil({
  variable: "--font-stencil",
  subsets: ["latin"],
  weight: ["700", "900"],
  adjustFontFallback: false,
});
const body = Instrument_Sans({ variable: "--font-body", subsets: ["latin"] });
const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://enp-racing-team.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "ENP Racing Team | From Algeria to Silverstone",
    template: "%s | ENP Racing Team",
  },
  description:
    "Official website of ENP Racing Team, the Formula Student team of the National Polytechnic School of Algiers (École Nationale Polytechnique). First Algerian team at Formula Student UK and winner of the Allan Staniforth Best Newcomer Award 2026.",
  applicationName: "ENP Racing Team",
  authors: [{ name: "ENP Racing Team", url: siteUrl }],
  generator: "Next.js",
  keywords: [
    "ENP Racing Team",
    "Formula Student",
    "Formula Student UK",
    "FSUK 2026",
    "Silverstone Circuit",
    "National Polytechnic School of Algiers",
    "École Nationale Polytechnique",
    "ENP Algiers",
    "Algeria Motorsport",
    "Student Formula Racing",
    "Car #19",
    "Allan Staniforth Award",
    "Algerian Engineering",
    "Formula SAE",
  ],
  creator: "ENP Racing Team",
  publisher: "École Nationale Polytechnique d'Alger",
  category: "Motorsport & Engineering",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "ENP Racing Team | From Algeria to Silverstone",
    description:
      "The first Formula Student single-seater from North Africa. Designed, built and raced by the students of the National Polytechnic School of Algiers. Best Newcomer Award, Formula Student UK 2026.",
    url: siteUrl,
    siteName: "ENP Racing Team",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/brand/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "ENP Racing Team | From Algeria to Silverstone",
      },
      {
        url: "/images/car-unveil.jpg",
        width: 2000,
        height: 1334,
        alt: "ENP Racing Team Formula Student Car",
      },
      {
        url: "/brand/logo-light-ink.png",
        width: 422,
        height: 358,
        alt: "ENP Racing Team Official Logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ENP Racing Team | From Algeria to Silverstone",
    description:
      "The first Formula Student single-seater from North Africa. Winner of the Allan Staniforth Best Newcomer Award, Formula Student UK 2026.",
    site: "@enp.rt",
    creator: "@enp.rt",
    images: [
      {
        url: "/brand/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "ENP Racing Team | From Algeria to Silverstone",
      },
    ],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
      { url: "/brand/r-mark.png", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    other: [
      {
        rel: "mask-icon",
        url: "/brand/r-mark.png",
        color: "#c21e2a",
      },
    ],
  },
  manifest: "/manifest.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#060b18" },
    { media: "(prefers-color-scheme: light)", color: "#060b18" },
  ],
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": ["SportsTeam", "Organization"],
      "@id": `${siteUrl}/#team`,
      name: "ENP Racing Team",
      alternateName: ["ENP Racing", "ENPRT"],
      url: siteUrl,
      logo: `${siteUrl}/brand/logo-light-ink.png`,
      image: `${siteUrl}/brand/og-image.jpg`,
      description:
        "The Formula Student team of the National Polytechnic School of Algiers. First Algerian team at Formula Student UK and winner of the Allan Staniforth Best Newcomer Award 2026.",
      email: "contact@enp-racing-team.dz",
      sport: "Motorsport / Formula Student",
      award:
        "Allan Staniforth Best Newcomer Award 2026 (Formula Student UK, Silverstone)",
      parentOrganization: {
        "@type": "EducationalOrganization",
        name: "National Polytechnic School of Algiers",
        alternateName: "École Nationale Polytechnique",
        url: "https://www.enp.edu.dz",
        address: {
          "@type": "PostalAddress",
          streetAddress: "10 Avenue Hassen Badi, BP 182, El Harrach",
          addressLocality: "Algiers",
          addressCountry: "DZ",
        },
      },
      sameAs: [
        "https://www.instagram.com/enp.rt/",
        "https://www.linkedin.com/company/enp-racing-team/",
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: "ENP Racing Team",
      description:
        "From Algeria to Silverstone | The first Formula Student single-seater from North Africa.",
      publisher: {
        "@id": `${siteUrl}/#team`,
      },
      inLanguage: "en-US",
    },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${stencil.variable} ${body.variable} ${mono.variable}`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
