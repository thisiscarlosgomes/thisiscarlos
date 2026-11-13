import { getTweet } from "react-tweet/api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) return Response.json({ data: null }, { status: 400 });
  try {
    const data = await getTweet(id, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) });
    return Response.json({ data: data ?? null }, {
      status: data ? 200 : 404,
      headers: { "Cache-Control": data ? "public, s-maxage=3600, stale-while-revalidate=86400" : "public, s-maxage=60" },
    });
  } catch {
    return Response.json({ data: null }, { status: 502 });
  }
}
