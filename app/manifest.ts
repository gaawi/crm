import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vela",
    short_name: "Vela",
    description: "Contacts, campaigns, email history and follow-ups across Gmail accounts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fafafa",
    theme_color: "#fafafa",
    // Generated from the Vela mark by scripts/generate-brand-icons.mjs.
    icons: [
      { src: "/icons/vela-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/vela-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/vela-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
