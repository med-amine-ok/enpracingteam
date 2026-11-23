import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ENP Racing Team | From Algeria to Silverstone",
    short_name: "ENP Racing",
    description:
      "Official website of ENP Racing Team, the Formula Student team of the National Polytechnic School of Algiers. First Algerian team at Formula Student UK.",
    start_url: "/",
    display: "standalone",
    background_color: "#060b18",
    theme_color: "#060b18",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
