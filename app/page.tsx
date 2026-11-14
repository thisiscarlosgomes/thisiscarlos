import Link from "next/link";
import { getRecentPublishedPosts } from "@/lib/blog/posts";
import { SiteHeader } from "@/app/components/site-header";
import { BeijingTime } from "@/app/components/beijing-time";

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Person",
      name: "Carlos Gomes",
      url: "https://carlos.cv",
      sameAs: ["https://twitter.com/carlosecgomes"],
    },
    {
      "@type": "WebSite",
      name: "Carlos",
      url: "https://carlos.cv",
      inLanguage: "en",
    },
  ],
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const posts = await getRecentPublishedPosts();

  return (
    <main style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }} className="site-page mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 pb-20 pt-10 sm:px-10">
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
            <strong className="font-semibold text-zinc-950">looking for new positions:</strong> ambitious teams building at the frontier of ai, fintech & crypto.
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
            <strong className="font-semibold text-zinc-950">latest:</strong>{" "}
            <a
              href="https://heycast.xyz"
              className="font-medium text-zinc-950 underline underline-offset-4"
              target="_blank"
              rel="noopener noreferrer"
            >
              heycast.xyz
            </a>
            {" "}·{" "}
            <a
              href="https://naundi.com"
              className="font-medium text-zinc-950 underline underline-offset-4"
              target="_blank"
              rel="noopener noreferrer"
            >
              naundi.com
            </a>
          </p>

          <p>
            <strong className="font-semibold text-zinc-950">co-creations:</strong> Seedclub, MintFund, SquiggleDAO +++
          </p>

          {/* <p>
            <strong className="font-semibold text-zinc-950">angels:</strong> Backdrop, Refraction, Songcamp, Yup,
            Afropolitan, Syndicate, Cabin, Zypsy, Chuva.
          </p> */}

          <p>
            <strong className="font-semibold text-zinc-950">elsewhere:</strong>{" "}
            <a
              href="https://maio.cv"
              className="font-medium text-zinc-950 underline underline-offset-4"
              target="_blank"
              rel="noopener noreferrer"
            >
              maio.cv
            </a>
            {" "}·{" "}
            <a
              href="https://kode.social"
              className="font-medium text-zinc-950 underline underline-offset-4"
              target="_blank"
              rel="noopener noreferrer"
            >
              Kode.social
            </a>
            {" "}+++
          </p>

         
          <p>
            <strong className="font-semibold text-zinc-950">languages:</strong> English, Chinese, Portuguese · bits of Spanish & Italian
          </p>

        </div>
      </section>

      <section aria-labelledby="thoughts-heading" className="mt-10 text-sm leading-6">
        <h2 id="thoughts-heading" className="font-semibold text-zinc-950">thoughts</h2>
        {posts.length ? (
          <ul className="mt-1 space-y-1">
            {posts.map((post) => (
              <li key={String(post._id)}>
                <Link href={`/blog/${post.slug}`} className="inline-flex min-h-11 items-center py-1 text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950 hover:decoration-zinc-950">
                  {post.title.toLowerCase()}
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-zinc-500">more soon.</p>}
      </section>

      <BeijingTime />
    </main>
  );
}
