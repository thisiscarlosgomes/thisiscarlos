import { SiteHeader } from "@/app/components/site-header";
import { BeijingTime } from "@/app/components/beijing-time";

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Person",
      name: "Carlos Gomes",
      url: "https://thisiscarlos.org",
      sameAs: ["https://twitter.com/carlosecgomes"],
    },
    {
      "@type": "WebSite",
      name: "Carlos",
      url: "https://thisiscarlos.org",
      inLanguage: "en",
    },
  ],
};

export default function Home() {

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 pb-20 pt-10 sm:px-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <SiteHeader showCallButton={false} />

      <section className="space-y-6 text-base leading-6 text-zinc-700">
        <p>
          i&apos;m{" "}
          <a
            href="https://twitter.com/carlosecgomes"
            className="font-medium text-zinc-950 underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            Carlos
          </a>
          . i build at the intersection of crypto x ai / prev. founder at
          forefront ($2m pre-seed) / 火币网
        </p>

        <p>
          <strong className="font-semibold text-zinc-950">co-creations:</strong> Seedclub, Mintfund, SquiggleDAO +++
        </p>

        <p>
          <strong className="font-semibold text-zinc-950">angels:</strong> Backdrop, Refraction, Songcamp, Yup,
          Afropolitan, Syndicate, Cabin, Zypsy, and Chuva.
        </p>

        <p>
          <strong className="font-semibold text-zinc-950">current focus:</strong> AI & crypto: learning, building, experimenting, and enjoying the frontier.
        </p>

        <p>
          <strong className="font-semibold text-zinc-950">languages:</strong> English, Chinese, Portuguese, Creole 🇨🇻, (bits: Spanish, Italian)
        </p>

      </section>

      <BeijingTime />
    </main>
  );
}
