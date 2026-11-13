import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isOwnerSessionValueValid, VOICE_NOTES_OWNER_COOKIE } from "@/lib/voice-notes/auth";
import { connectToDatabase } from "@/lib/db";
import { BlogView } from "@/models/BlogView";
import { BlogPost } from "@/models/BlogPost";
export const metadata = { title: "Blog analytics", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function Analytics({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const jar = await cookies();
  if (!isOwnerSessionValueValid(jar.get(VOICE_NOTES_OWNER_COOKIE)?.value || "")) redirect("/lg?next=/admin/analytics");
  const requested = Number((await searchParams).days);
  const days = [7, 30, 90].includes(requested) ? requested : 30;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const since = new Date(today.getTime() - (days - 1) * 86400000);
  await connectToDatabase();
  const [data, posts] = await Promise.all([
    BlogView.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $facet: {
        totals: [{ $group: { _id: null, views: { $sum: 1 }, visitors: { $addToSet: "$visitor" } } }, { $project: { views: 1, visitors: { $size: "$visitors" } } }],
        daily: [{ $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, views: { $sum: 1 } } }],
        articles: [{ $group: { _id: "$path", views: { $sum: 1 }, visitors: { $addToSet: "$visitor" } } }, { $project: { views: 1, visitors: { $size: "$visitors" } } }, { $sort: { views: -1 } }],
        sources: [{ $group: { _id: "$referrer", views: { $sum: 1 } } }, { $sort: { views: -1 } }, { $limit: 10 }],
      } },
    ]),
    BlogPost.find({ published: true }).select("title slug").lean(),
  ]);
  const result = data[0];
  const totals = result.totals[0] || { views: 0, visitors: 0 };
  const series = Array.from({ length: days }, (_, i) => {
    const date = new Date(since.getTime() + i * 86400000).toISOString().slice(0, 10);
    return { date, views: Number(result.daily.find((d: { _id: string }) => d._id === date)?.views || 0) };
  });
  const max = Math.max(1, ...series.map(d => d.views));
  const names = new Map(posts.map(p => [`/blog/${p.slug}`, p.title])); names.set("/blog", "blog index");
  return <main className="mx-auto max-w-4xl px-5 py-10 text-sm text-zinc-800">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><Link href="/admin" className="text-zinc-500">writing</Link><h1 className="mt-3 text-xl font-semibold">blog analytics</h1></div>
      <nav aria-label="Date range" className="flex gap-2">{[7, 30, 90].map(n => <Link key={n} href={`?days=${n}`} aria-current={days === n ? "page" : undefined} className={`rounded-lg px-3 py-2 ${days === n ? "bg-zinc-900 text-white" : "bg-zinc-100"}`}>{n} days</Link>)}</nav>
    </header>
    <div className="my-8 grid grid-cols-2 gap-4">{[["page views", totals.views], ["visitors", totals.visitors]].map(([label, value]) => <section key={label} className="rounded-xl border border-zinc-200 p-5"><h2 className="text-zinc-500">{label}</h2><p className="mt-2 text-3xl font-semibold tabular-nums">{Number(value).toLocaleString()}</p></section>)}</div>
    <section className="rounded-xl border border-zinc-200 p-5"><h2 className="font-medium">daily views</h2>
      {!totals.views && <p className="mt-3 text-zinc-500">No visits recorded yet. Data starts when tracking goes live.</p>}
      <div className="mt-5 flex h-32 items-end gap-1" role="img" aria-label={`Daily views from ${series[0].date} to ${series.at(-1)?.date}. ${totals.views} total.`}>{series.map(d => <div key={d.date} title={`${d.date}: ${d.views} views`} className={`min-w-0 flex-1 rounded-t ${d.views ? "bg-zinc-900" : "bg-zinc-100"}`} style={{ height: `${Math.max(2, d.views / max * 100)}%` }} />)}</div>
      <div className="mt-2 flex justify-between text-xs text-zinc-500"><span>{series[0].date}</span><span>{series.at(-1)?.date}</span></div>
    </section>
    <section className="mt-8"><h2 className="mb-3 font-medium">pages</h2><div className="overflow-x-auto"><table className="w-full text-left"><thead className="text-zinc-500"><tr><th className="py-3 font-normal">page</th><th className="px-3 text-right font-normal">views</th><th className="text-right font-normal">visitors</th></tr></thead><tbody>{result.articles.map((row: { _id: string; views: number; visitors: number }) => <tr key={row._id} className="border-t border-zinc-100"><td className="py-3 pr-3 break-words"><Link href={row._id} className="hover:underline">{names.get(row._id) || row._id}</Link></td><td className="px-3 text-right tabular-nums">{row.views}</td><td className="text-right tabular-nums">{row.visitors}</td></tr>)}</tbody></table></div></section>
    <section className="mt-8"><h2 className="mb-3 font-medium">referrers</h2>{result.sources.map((row: { _id: string; views: number }) => <div key={row._id} className="flex justify-between gap-3 border-t border-zinc-100 py-3"><span className="break-all">{row._id}</span><span>{row.views}</span></div>)}</section>
    <p className="mt-8 text-xs leading-6 text-zinc-500">UTC dates · Anonymous browser IDs, no IP addresses stored. Repeat views of the same page within 30 minutes count once. Signed-in owner visits, known bots, and Do Not Track browsers are excluded. Visitors are approximate; blocked tracking and cleared storage affect counts. Data is kept for 90 days.</p>
  </main>;
}
