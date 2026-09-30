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

      <section className="space-y-6 text-sm leading-6 text-zinc-700">
        <div className="space-y-2">
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
            . i build at the intersection of ai x crypto.
          </p>

          <p>
            currently building{" "}
            <a
              href="https://terminal.co"
              className="font-medium text-zinc-950 underline underline-offset-4"
              target="_blank"
              rel="noopener noreferrer"
            >
              terminal ai
            </a>{" "}
            - financial intelligence that can act.
          </p>

           <p>
            <strong className="font-semibold text-zinc-950">also exploring:</strong> ambitious teams building at the frontier of ai, fintech & crypto.
          </p>


          <p>
            previously founded{" "}
            <a
              href="https://x.com/forefront__"
              className="font-medium text-zinc-950 underline underline-offset-4"
              target="_blank"
              rel="noopener noreferrer"
            >
              @forefront
            </a>{" "}
            ($2.1m) /{" "}
            <span className="text-zinc-950">@huobiglobal</span>
          </p>
        </div>

        <div className="space-y-2">

          <p>
            <strong className="font-semibold text-zinc-950">co-creations:</strong> Seedclub, MintFund, SquiggleDAO +++
          </p>

          {/* <p>
            <strong className="font-semibold text-zinc-950">angels:</strong> Backdrop, Refraction, Songcamp, Yup,
            Afropolitan, Syndicate, Cabin, Zypsy, Chuva.
          </p> */}

          <p>
            <strong className="font-semibold text-zinc-950">elsewhere:</strong> Maioazul.com · maio.cv · visitmaio.com · Kode.social +++
          </p>

         
          <p>
            <strong className="font-semibold text-zinc-950">languages:</strong> English, Chinese, Portuguese · bits of Spanish & Italian
          </p>

        </div>
      </section>

      <BeijingTime />
    </main>
  );
}
