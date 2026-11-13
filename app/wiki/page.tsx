import type { Metadata } from "next";
import Link from "next/link";
import { getPublishedPosts } from "@/lib/blog/posts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Carlos Gomes — wiki",
  description: "A personal reference page for Carlos Gomes: AI, crypto, Forefront, Terminal, collaborations, Maio, and selected writing.",
  alternates: { canonical: "https://carlos.cv/wiki" },
  openGraph: { title: "Carlos Gomes — wiki", description: "Work, projects, ideas, and references.", url: "https://carlos.cv/wiki", type: "profile" },
};
const contents = [
  ["background", "background"], ["terminal", "terminal"], ["forefront", "forefront"],
  ["collaborations", "collaborations"], ["maio", "maio & local projects"],
  ["writing", "writing"], ["references", "references"],
];
const references = [
  { title: "Carlos Gomes — personal website", href: "https://carlos.cv", note: "Current work, collaborations, projects, and languages." },
  { title: "Forefront — CypherHunter", href: "https://www.cypherhunter.com/en/p/forefront/", note: "Founder and September 2021 funding round." },
  { title: "Going Faster with Farcaster Index and Terminal — UFO", href: "https://metacast.app/podcast/ufo/rpXLnQLE/going-faster-with-farcaster-index-and-terminal----carlos-gomes/YnWFB882", note: "Interview published 3 July 2024; Forefront, Seed Club, Mint Fund, and early Terminal work." },
];
function Ref({ n }: { n: number }) { return <sup className="ml-1 text-[10px]"><a href={`#reference-${n}`} aria-label={`Reference ${n}`} className="text-zinc-500 hover:text-black">[{n}]</a></sup>; }
function Heading({ id, children }: { id: string; children: React.ReactNode }) { return <h2 id={id} className="mb-4 scroll-mt-8 border-b border-zinc-200 pb-2 font-serif text-2xl text-zinc-950">{children}</h2>; }
export default async function WikiPage() {
  const posts = await getPublishedPosts();
  const schema = { "@context": "https://schema.org", "@type": "ProfilePage", url: "https://carlos.cv/wiki", mainEntity: { "@type": "Person", name: "Carlos Gomes", url: "https://carlos.cv", sameAs: ["https://x.com/carlosecgomes"] } };
  return <main className="mx-auto max-w-6xl px-5 py-8 text-sm text-zinc-700 sm:px-10 sm:py-12">
    <header className="border-b border-zinc-200 pb-7">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500"><Link href="/" className="text-zinc-900 hover:underline">carlos.cv</Link><span>personal wiki · updated 1 november 2026</span></div>
      <h1 className="mt-10 font-serif text-4xl tracking-tight text-zinc-950 sm:text-5xl">carlos gomes</h1>
      <p className="mt-3 text-zinc-500">builder at the intersection of ai and crypto</p>
    </header>
    <div className="mt-8 grid gap-10 lg:grid-cols-[150px_minmax(0,1fr)_240px]">
      <nav aria-label="Contents" className="lg:sticky lg:top-8 lg:self-start">
        <h2 className="mb-3 text-xs font-semibold text-zinc-950">contents</h2>
        <ol className="flex flex-wrap gap-x-5 gap-y-2 text-xs leading-6 lg:block lg:space-y-2">{contents.map(([id, name], i) => <li key={id}><a href={`#${id}`} className="hover:text-black"><span className="mr-2 text-zinc-400">{String(i + 1).padStart(2, "0")}</span>{name}</a></li>)}</ol>
      </nav>
      <aside className="rounded-sm border border-zinc-200 bg-zinc-50/60 p-5 lg:col-start-3 lg:row-start-1 lg:self-start">
        <div className="mb-5 flex items-center gap-3"><img src="/punk-logo.png" alt="Carlos’s pixel avatar" width={48} height={48} className="rounded-sm [image-rendering:pixelated]" /><span className="font-semibold text-zinc-950">carlos gomes</span></div>
        <dl className="space-y-4 text-xs leading-5">{[
          ["work", "AI, crypto, products, communities"], ["known for", "Forefront · Terminal"], ["collaborations", "Seed Club · Mint Fund · SquiggleDAO"], ["local projects", "MaioAzul · maio.cv · visitmaio.com · Kôdè"], ["languages", "English, Chinese, Portuguese; some Spanish and Italian"],
        ].map(([name, value]) => <div key={name}><dt className="text-zinc-400">{name}</dt><dd className="mt-1">{value}</dd></div>)}</dl>
        <a href="https://x.com/carlosecgomes" target="_blank" rel="noopener noreferrer" className="mt-6 inline-block underline underline-offset-4">@carlosecgomes</a>
      </aside>
      <article className="min-w-0 space-y-10 leading-7 lg:col-start-2 lg:row-start-1">
        <div><p><strong className="font-semibold text-zinc-950">Carlos Gomes</strong> builds products at the intersection of artificial intelligence and crypto. His work includes founding Forefront, building Terminal, and contributing to communities around collective creation and digital ownership.<Ref n={1} /><Ref n={3} /></p><p className="mt-4 text-xs leading-6 text-zinc-500">A personal reference page maintained on Carlos’s own website. It brings together his published profile, selected projects, writing, and external references.</p></div>
        <section><Heading id="background">background</Heading><p>Gomes’s work spans software, crypto-native communities, and local initiatives. His personal profile lists earlier work at Huobi and an ongoing interest in teams working across AI, fintech, and crypto.<Ref n={1} /></p></section>
        <section><Heading id="terminal">terminal</Heading><p>Gomes’s current profile describes Terminal AI as “financial intelligence that can act.”<Ref n={1} /> An earlier phase of the project appeared in a July 2024 UFO interview, which discussed Terminal as a tool for creating channel tokens on Farcaster, alongside Farcaster Index.<Ref n={3} /></p><p className="mt-3"><a className="underline underline-offset-4" href="https://terminal.co" target="_blank" rel="noopener noreferrer">terminal.co</a></p></section>
        <section><Heading id="forefront">forefront</Heading><p>Gomes founded Forefront, a project focused on social tokens, creators, and communities. CypherHunter records a $2.1 million funding round in September 2021 and lists Gomes as its founder.<Ref n={2} /></p></section>
        <section><Heading id="collaborations">collaborations</Heading><p>His personal website lists Seed Club, Mint Fund, and SquiggleDAO among his co-creations. The UFO interview also identifies him as an early contributor to Seed Club and Mint Fund.<Ref n={1} /><Ref n={3} /></p></section>
        <section><Heading id="maio">maio & local projects</Heading><p>Alongside his technology work, Gomes’s personal profile links to projects connected with Maio and to Kôdè.<Ref n={1} /> These form a separate strand of his work beyond AI and crypto.</p><ul className="mt-4 divide-y divide-zinc-100">{[["MaioAzul", "https://maioazul.com"], ["maio.cv", "https://maio.cv"], ["Visit Maio", "https://visitmaio.com"], ["Kôdè", "https://kode.social"]].map(([name, href]) => <li key={href} className="py-2"><a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900">{name}</a></li>)}</ul></section>
        <section><Heading id="writing">writing</Heading><p>Gomes publishes essays on this site. The list below updates as new articles are published.</p><ul className="mt-4 divide-y divide-zinc-100">{posts.map(post => <li key={String(post._id)} className="py-3"><Link href={`/blog/${post.slug}`} className="font-medium text-zinc-900 hover:underline">{post.title.toLowerCase()}</Link><span className="mt-1 block text-xs text-zinc-400">{post.publishedAt?.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</span></li>)}</ul>{!posts.length && <Link href="/blog" className="underline">browse the blog</Link>}</section>
        <section><Heading id="references">references</Heading><ol className="space-y-4 text-xs leading-6">{references.map((ref, i) => <li key={ref.href} id={`reference-${i + 1}`} className="scroll-mt-8"><span className="mr-2 text-zinc-400">[{i + 1}]</span><a href={ref.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{ref.title}</a><p className="mt-1 text-zinc-500">{ref.note}</p></li>)}</ol></section>
      </article>
    </div>
    <footer className="mt-14 flex gap-5 border-t border-zinc-200 pt-5 text-xs text-zinc-500"><Link href="/">home</Link><Link href="/blog">writing</Link></footer>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
  </main>;
}
