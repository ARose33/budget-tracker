import { ImageResponse } from "next/og";

export const size = {
  width: 192,
  height: 192,
};

export const contentType = "image/png";

export default function Icon() {
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
            border: "10px solid rgba(248, 250, 247, 0.92)",
            borderRadius: 44,
            display: "flex",
            fontSize: 82,
            fontWeight: 800,
            height: 128,
            justifyContent: "center",
            lineHeight: 1,
            width: 128,
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
