#!/usr/bin/env node
/**
 * Regenerate the Vela icons from lib/brand/vela-mark.json (the same geometry
 * as components/brand/vela-logo.tsx):
 *   app/icon.svg                     favicon (Next.js file convention)
 *   app/apple-icon.png               180×180, iPhone home screen
 *   public/icons/vela-192.png        PWA
 *   public/icons/vela-512.png        PWA
 *   public/icons/vela-maskable-512.png  PWA maskable (mark inside the 80% safe zone)
 * Uses sharp (installed with Next.js). Usage: node scripts/generate-brand-icons.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sharp = createRequire(`${root}package.json`)("sharp");
const mark = JSON.parse(readFileSync(`${root}lib/brand/vela-mark.json`, "utf8"));

/** The mark in white on a brand tile. `inset` shrinks the artwork (maskable icons); `radius` 0 = square. */
function tileSvg({ radius = mark.tileRadius, inset = 0 } = {}) {
  const scale = 1 - inset * 2;
  const offset = 16 * (1 - scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mark.viewBox}">
<defs><clipPath id="vela-sail"><path d="${mark.sail}"/></clipPath></defs>
<rect width="32" height="32" rx="${radius}" fill="${mark.brand}"/>
<g transform="translate(${offset} ${offset}) scale(${scale})">
<path d="${mark.mast}" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/>
<path d="${mark.sail}" fill="#fff"/>
<g clip-path="url(#vela-sail)" stroke="${mark.brand}" stroke-width="1.1" fill="none">${mark.staff.map((d) => `<path d="${d}"/>`).join("")}</g>
<path d="${mark.wave}" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/>
</g>
</svg>
`;
}

const png = (svg, size) => sharp(Buffer.from(svg), { density: 1200 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

writeFileSync(`${root}app/icon.svg`, tileSvg());
// iOS rounds the corners itself: square tiles for the home screen and PWA.
writeFileSync(`${root}app/apple-icon.png`, await png(tileSvg({ radius: 0, inset: 0.08 }), 180));
writeFileSync(`${root}public/icons/vela-192.png`, await png(tileSvg({ radius: 0, inset: 0.08 }), 192));
writeFileSync(`${root}public/icons/vela-512.png`, await png(tileSvg({ radius: 0, inset: 0.08 }), 512));
writeFileSync(`${root}public/icons/vela-maskable-512.png`, await png(tileSvg({ radius: 0, inset: 0.16 }), 512));
console.log("Vela icons written.");
