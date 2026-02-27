"use client";

import { useEffect, useState } from "react";

function formatBeijingTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  const dayPeriod = (parts.find((part) => part.type === "dayPeriod")?.value ?? "").toLowerCase();

  return `${hour}:${minute}${dayPeriod}`;
}

function getBeijingHour(date: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    hour: "numeric",
    hour12: false,
  }).format(date);

  return Number.parseInt(hour, 10);
}

function getIsNight(hour: number): boolean {
  return hour >= 0 && hour < 6;
}

export function BeijingTime() {
  const [time, setTime] = useState(() => formatBeijingTime(new Date()));
  const [beijingHour, setBeijingHour] = useState(() => getBeijingHour(new Date()));
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(formatBeijingTime(now));
      setBeijingHour(getBeijingHour(now));
    };
    update();
    const interval = window.setInterval(update, 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setFrameIndex((value) => value + 1);
    }, 700);

    return () => window.clearInterval(interval);
  }, []);

  const isNight = getIsNight(beijingHour);
  const sleepingFrames = ["(=^-ω-^=) zzz", "(=^-ω-^=) Zzz", "(=^-ω-^=) z Z z"];
  const workingFrames = ["(=^･ω･^=)", "(=^･o･^=)", "(=^･ω･^=)"];
  const frames = isNight ? sleepingFrames : workingFrames;
  const kaomoji = frames[frameIndex % frames.length];

  return (
    <div className="mt-16 mb-6 flex items-center justify-between gap-4 pb-8 text-sm text-black">
      <p className="text-sm font-normal">{time} in Beijing</p>
      <p className="pr-2 text-right text-sm leading-none text-black" aria-hidden="true">
        {kaomoji}
      </p>
    </div>
  );
}
