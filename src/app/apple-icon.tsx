import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#0f8f73",
          color: "#f8faf7",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            border: "9px solid rgba(248, 250, 247, 0.92)",
            borderRadius: 42,
            display: "flex",
            fontSize: 78,
            fontWeight: 800,
            height: 120,
            justifyContent: "center",
            lineHeight: 1,
            width: 120,
          }}
        >
          $
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
