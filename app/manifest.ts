import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MovieTime",
    short_name: "MovieTime",
    description: "Whose turn, what movie, what did we think.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0a0f",
    theme_color: "#0b0a0f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
