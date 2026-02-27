import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "edge";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export async function GET(request: NextRequest) {
  const logoUrl = new URL("/punk-source.png", request.url).toString();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
        }}
      >
        <img
          src={logoUrl}
          width={84}
          height={84}
          style={{ imageRendering: "pixelated" }}
          alt="Punk"
        />
      </div>
    ),
    {
      ...size,
    }
  );
}
