import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/lg", "/v", "/api/"],
      },
    ],
    sitemap: "https://thisiscarlos.org/sitemap.xml",
    host: "https://thisiscarlos.org",
  };
}
