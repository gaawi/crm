import { ImageResponse } from "next/og";
import { AppIconArt } from "@/components/app-icon";

/** PNG icons referenced by the web app manifest (192 and 512 px). */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = size === "192" ? 192 : 512;
  return new ImageResponse(<AppIconArt size={px} />, {
    width: px,
    height: px,
    headers: { "Cache-Control": "public, max-age=604800, immutable" },
  });
}
