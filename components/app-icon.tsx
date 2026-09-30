/** App icon artwork for ImageResponse (PNG icons for iOS / PWA). */
export function AppIconArt({ size }: { size: number }) {
  const bar = (width: number, top: number) => (
    <div
      style={{
        position: "absolute",
        left: size * 0.26,
        top: size * top,
        width: size * width,
        height: size * 0.075,
        borderRadius: size * 0.04,
        background: "#fafafa",
      }}
    />
  );
  return (
    <div style={{ width: size, height: size, background: "#18181b", display: "flex", position: "relative" }}>
      {bar(0.48, 0.3)}
      {bar(0.48, 0.46)}
      {bar(0.32, 0.62)}
    </div>
  );
}
