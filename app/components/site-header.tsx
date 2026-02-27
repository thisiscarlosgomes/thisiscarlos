"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";

type Pixel = {
  id: string;
  x: number;
  y: number;
  color: string;
  delay: number;
  fromX: number;
  fromY: number;
  rotate: number;
};

const LOGO_SIZE = 28;
const PIXEL_GRID = 32;

function PixelLogo() {
  const [pixels, setPixels] = useState<Pixel[] | null>(null);
  const [replayCount, setReplayCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const img = new Image();
    img.src = "/punk-logo-24.png";

    img.onload = () => {
      if (!mounted) return;

      const canvas = document.createElement("canvas");
      canvas.width = PIXEL_GRID;
      canvas.height = PIXEL_GRID;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, PIXEL_GRID, PIXEL_GRID);
      const data = ctx.getImageData(0, 0, PIXEL_GRID, PIXEL_GRID).data;
      const nextPixels: Pixel[] = [];

      for (let y = 0; y < PIXEL_GRID; y += 1) {
        for (let x = 0; x < PIXEL_GRID; x += 1) {
          const i = (y * PIXEL_GRID + x) * 4;
          const a = data[i + 3];
          if (a < 20) continue;

          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          nextPixels.push({
            id: `${x}-${y}`,
            x,
            y,
            color: `rgba(${r}, ${g}, ${b}, ${a / 255})`,
            delay: Math.random() * 0.2 + (x + y) * 0.004,
            fromX: (Math.random() - 0.5) * 24,
            fromY: (Math.random() - 0.5) * 24 - 4,
            rotate: (Math.random() - 0.5) * 40,
          });
        }
      }

      setPixels(nextPixels);
    };

    return () => {
      mounted = false;
    };
  }, []);

  const cellSize = LOGO_SIZE / PIXEL_GRID;
  const hasPixels = Array.isArray(pixels) && pixels.length > 0;

  return (
    <div
      role="img"
      aria-label="Punk logo"
      className="relative overflow-hidden rounded-sm"
      style={{ width: LOGO_SIZE, height: LOGO_SIZE }}
      onMouseEnter={() => {
        if (!hasPixels) return;
        setReplayCount((value) => value + 1);
      }}
    >
      <motion.img
        src="/punk-logo-24.png"
        alt=""
        aria-hidden="true"
        width={LOGO_SIZE}
        height={LOGO_SIZE}
        className="absolute inset-0 block rounded-sm [image-rendering:pixelated]"
        initial={false}
        animate={{ opacity: hasPixels ? 0 : 1 }}
        transition={{ duration: 0.14, ease: "easeOut" }}
      />

      {hasPixels
        ? pixels.map((pixel) => (
            <motion.span
              key={`${pixel.id}-${replayCount}`}
              className="absolute block"
              style={{
                left: pixel.x * cellSize,
                top: pixel.y * cellSize,
                width: cellSize,
                height: cellSize,
                backgroundColor: pixel.color,
              }}
              initial={{
                opacity: 0,
                x: pixel.fromX,
                y: pixel.fromY,
                rotate: pixel.rotate,
                scale: 0.65,
              }}
              animate={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
              transition={{
                duration: 0.48,
                delay: pixel.delay,
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          ))
        : null}
    </div>
  );
}

type SiteHeaderProps = {
  showCallButton?: boolean;
  showPitchButton?: boolean;
  showCallsLink?: boolean;
};

export function SiteHeader({
  showCallButton = true,
  showPitchButton = false,
  showCallsLink = true,
}: SiteHeaderProps) {
  const linkActionClass =
    "inline-flex items-center text-sm font-medium underline underline-offset-4 text-zinc-900";

  return (
    <header className="mb-10 flex items-center justify-between gap-4">
      <Link href="/" className="flex items-center gap-2">
        <PixelLogo />
        <span className="sr-only">Carlos</span>
      </Link>

      <div className="flex items-center gap-2">
        {showPitchButton ? (
          <span className="inline-flex items-center gap-4">
            {showCallsLink ? (
              <Link href="/l" className={linkActionClass}>
                calls
              </Link>
            ) : null}
            <Link href="/v" className={linkActionClass}>
              notes
            </Link>
          </span>
        ) : null}

        {showCallButton ? (
          <Link
            href="/c"
            className="inline-flex items-center rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800"
          >
            Call me
          </Link>
        ) : null}
      </div>
    </header>
  );
}
