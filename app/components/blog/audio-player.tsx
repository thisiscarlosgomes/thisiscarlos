"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Loader2 } from "lucide-react";

const BARS = 80;
function time(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function AudioPlayer({ src, label }: { src: string; label: string }) {
  return <AudioPlayerSource key={src} src={src} label={label.toLowerCase() === "listen" ? "Listen (Gist)" : label} />;
}

function AudioPlayerSource({ src, label }: { src: string; label: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [activated, setActivated] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [decodedDuration, setDecodedDuration] = useState(0);
  const duration = mediaDuration || decodedDuration;
  function syncDuration(player: HTMLAudioElement) {
    // Some MP3s report NaN/Infinity until playback has started. Keep the last
    // valid duration and use the decoded waveform duration while metadata loads.
    if (Number.isFinite(player.duration) && player.duration > 0) {
      setMediaDuration(player.duration);
    }
  }
  const [position, setPosition] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [error, setError] = useState("");
  const [waveUnavailable, setWaveUnavailable] = useState(false);

  useEffect(() => {
    if (!activated) return;
    const controller = new AbortController();
    let context: AudioContext | undefined;
    async function waveform() {
      try {
        const response = await fetch(src, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error();
        // Bound waveform downloads; large/CORS-restricted audio still plays natively.
        const limit = 8 * 1024 * 1024;
        if (Number(response.headers.get("content-length")) > limit) {
          await response.body.cancel();
          throw new Error();
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > limit) {
            await reader.cancel();
            throw new Error();
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        if (controller.signal.aborted) return;
        context = new AudioContext();
        const decoded = await context.decodeAudioData(bytes.buffer);
        const channel = decoded.getChannelData(0);
        const samples = Array.from({ length: BARS }, (_, index) => {
          const start = Math.floor((index * channel.length) / BARS);
          const end = Math.floor(((index + 1) * channel.length) / BARS);
          let peak = 0;
          for (
            let n = start;
            n < end;
            n += Math.max(1, Math.floor((end - start) / 1000))
          )
            peak = Math.max(peak, Math.abs(channel[n]));
          return peak;
        });
        const max = Math.max(...samples, 0.001);
        if (!controller.signal.aborted) {
          setPeaks(samples.map((peak) => Math.max(0.06, peak / max)));
          if (Number.isFinite(decoded.duration) && decoded.duration > 0) {
            setDecodedDuration(decoded.duration);
          }
        }
      } catch {
        if (!controller.signal.aborted) setWaveUnavailable(true);
      } finally {
        if (context && context.state !== "closed") void context.close();
      }
    }
    void waveform();
    return () => {
      controller.abort();
      if (context && context.state !== "closed") void context.close();
    };
  }, [src, activated]);

  async function toggle() {
    const player = audio.current;
    if (!player) return;
    if (!player.paused) {
      player.pause();
      return;
    }
    try {
      setBuffering(true);
      // Assign the source inside the user gesture: no audio requests on page load.
      if (!activated) player.src = src;
      await player.play();
      setActivated(true);
      setError("");
    } catch {
      setError("Could not play this recording. Try downloading the audio.");
    } finally {
      setBuffering(false);
    }
  }
  const progress = duration ? Math.min(1, Math.max(0, position / duration)) : 0;
  return (
    <span className="wave-player" role="group" aria-label={label}>
      <audio
        ref={audio}
        preload="none"
        muted={muted}
        onRateChange={(event) => setSpeed(event.currentTarget.playbackRate)}
        onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
        onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
        onDurationChange={(event) => syncDuration(event.currentTarget)}
        onCanPlay={(event) => syncDuration(event.currentTarget)}
        onTimeUpdate={(event) => {
          syncDuration(event.currentTarget);
          setPosition(event.currentTarget.currentTime);
        }}
        onPlay={(event) => {
          syncDuration(event.currentTarget);
          setPlaying(true);
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onPause={() => { setPlaying(false); setBuffering(false); }}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setBuffering(false);
          setError("Audio is unavailable. Try downloading the file.");
        }}
      />
      <span className="wave-player-heading">
        <span className="wave-player-label">
          <Volume2 size={15} aria-hidden="true" />
          {label}
        </span>
        <a href={src} download>
          download
        </a>
      </span>
      <span className="wave-player-body">
        <button
          type="button"
          className="wave-play"
          onClick={toggle}
          aria-label={buffering ? "Loading audio" : playing ? "Pause audio" : "Play audio"}
          disabled={buffering}
          aria-busy={buffering}
        >
          {buffering ? (
            <Loader2 size={18} className="animate-spin" />
          ) : playing ? (
            <Pause size={18} fill="currentColor" />
          ) : (
            <Play size={18} fill="currentColor" />
          )}
        </button>
        <span className="wave-track">
          <svg
            viewBox="0 0 400 56"
            preserveAspectRatio="none"
            aria-hidden="true"
            data-waveform={peaks ? "ready" : "fallback"}
          >
            {(peaks || Array.from({ length: BARS }, () => 0.08)).map(
              (peak, index) => (
                <rect
                  key={index}
                  x={index * 5 + 1}
                  y={28 - peak * 25}
                  width={3}
                  height={Math.max(3, peak * 50)}
                  rx={1.5}
                  fill={index / BARS < progress ? "#18181b" : "#d4d4d8"}
                />
              ),
            )}
          </svg>
          <input
            type="range"
            aria-label="Seek audio"
            min={0}
            max={duration || 1}
            step={0.1}
            value={duration ? Math.min(position, duration) : 0}
            disabled={!duration}
            aria-valuetext={`${time(position)} of ${time(duration)}`}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (audio.current) audio.current.currentTime = value;
              setPosition(value);
            }}
          />
        </span>
      </span>
      <span className="wave-player-times">
        <span>{time(position)}</span>
        <span className="inline-flex items-center gap-3">
          <select
            aria-label="Playback speed"
            title="Playback speed"
            value={speed}
            className="cursor-pointer rounded bg-transparent px-1 py-1 text-sm text-zinc-600 focus-visible:outline-2 focus-visible:outline-zinc-500"
            onChange={(event) => {
              const rate = Number(event.target.value);
              if (audio.current) {
                audio.current.playbackRate = rate;
                audio.current.preservesPitch = true;
              }
              setSpeed(rate);
            }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={muted ? "Unmute audio" : "Mute audio"}
            title={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
            className="rounded p-1 text-zinc-600 hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-zinc-500"
            onClick={() => {
              if (audio.current) audio.current.muted = !muted;
              setMuted(!muted);
            }}
          >
            {muted ? (
              <VolumeX size={16} aria-hidden="true" />
            ) : (
              <Volume2 size={16} aria-hidden="true" />
            )}
          </button>
          <span>{time(duration)}</span>
        </span>
      </span>
      {error ? (
        <span className="wave-message" role="status">
          {error}
        </span>
      ) : waveUnavailable ? (
        <span className="wave-message">
          waveform unavailable · playback still available
        </span>
      ) : null}
    </span>
  );
}
