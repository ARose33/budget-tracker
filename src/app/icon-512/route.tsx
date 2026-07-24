import { ImageResponse } from "next/og";

export async function GET() {
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
          padding: 52,
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            border: "24px solid rgba(248, 250, 247, 0.92)",
            borderRadius: 116,
            display: "flex",
            fontSize: 218,
            fontWeight: 800,
            height: 332,
            justifyContent: "center",
            lineHeight: 1,
            width: 332,
          }}
        >
          $
        </div>
      </div>
    ),
    {
      width: 512,
      height: 512,
    }
  );
}
