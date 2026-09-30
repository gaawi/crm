"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Sanitized HTML email in a sandboxed iframe (no allow-scripts: nothing in
 * the email can run; same-origin only so the parent can measure it). The
 * frame grows to its content height and, when the email is wider than the
 * frame (600px newsletters on a phone), is scaled down with CSS zoom on its
 * root, like iOS Mail's shrink-to-fit.
 */
export function EmailFrame({ srcDoc, title }: { srcDoc: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    let frameReq = 0;

    const fit = () => {
      const doc = frame.contentDocument;
      const root = doc?.documentElement;
      if (!doc || !root || !doc.body) return;
      const available = frame.clientWidth;
      if (!available) return;
      root.style.zoom = "";
      const natural = Math.max(root.scrollWidth, doc.body.scrollWidth);
      const zoom = natural > available + 2 ? available / natural : 1;
      if (zoom < 1) root.style.zoom = String(zoom);
      const next = Math.ceil(root.getBoundingClientRect().height);
      setHeight((h) => (Math.abs(h - next) > 1 ? next : h));
    };
    const schedule = () => {
      cancelAnimationFrame(frameReq);
      frameReq = requestAnimationFrame(fit);
    };
    const attach = () => {
      const doc = frame.contentDocument;
      if (!doc?.documentElement) return;
      schedule();
      observer?.disconnect();
      observer = new ResizeObserver(schedule);
      observer.observe(doc.documentElement);
      observer.observe(frame);
      for (const img of Array.from(doc.images)) img.addEventListener("load", schedule, { once: true });
    };

    frame.addEventListener("load", attach);
    if (frame.contentDocument?.readyState === "complete") attach();
    return () => {
      frame.removeEventListener("load", attach);
      observer?.disconnect();
      cancelAnimationFrame(frameReq);
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      scrolling="no"
      style={{ height }}
      className="block w-full overflow-hidden border-0 bg-white dark:rounded-lg"
    />
  );
}
