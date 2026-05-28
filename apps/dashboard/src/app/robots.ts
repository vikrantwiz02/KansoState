import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard/", "/meetings/"],
      },
    ],
    sitemap: "https://kansostate.vikrantkumar.site/sitemap.xml",
  };
}
