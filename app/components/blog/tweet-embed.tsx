"use client";

import { EmbeddedTweet, TweetSkeleton, useTweet } from "react-tweet";

export function TweetEmbed({ id }: { id: string }) {
  const { data, isLoading } = useTweet(id, `/api/tweets/${id}`);
  return (
    <div className="tweet-embed not-prose" data-theme="light">
      {isLoading ? <TweetSkeleton /> : data ? <EmbeddedTweet tweet={data} /> : (
        <div className="rounded-xl border border-zinc-200 p-4 text-sm text-zinc-500" role="status">
          <p>This tweet couldn’t be loaded.</p>
          <a className="mt-2 inline-block underline underline-offset-4" href={`https://x.com/i/web/status/${id}`} target="_blank" rel="noopener noreferrer">View on X</a>
        </div>
      )}
    </div>
  );
}
