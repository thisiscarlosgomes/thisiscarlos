import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/api/blog/media/"],
        disallow: ["/lg", "/v", "/admin", "/api/"],
      },
    ],
    sitemap: "https://carlos.cv/sitemap.xml",
    host: "https://carlos.cv",
  };
}
