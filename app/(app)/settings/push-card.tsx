"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushPublicKeyAction, removePushSubscriptionAction, savePushSubscriptionAction, testPushAction } from "./push-actions";

type State = "loading" | "unsupported" | "needs-home-screen" | "denied" | "off" | "on";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/**
 * Settings → Notifications: turn on notifications on this device (the iPhone
 * web app on the Home Screen, or a desktop browser). Replies from campaign
 * contacts and mailings waiting for approval arrive as notifications.
 */
export function PushCard() {
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    (async () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      let next: State;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        next = ios && !standalone ? "needs-home-screen" : "unsupported";
      } else if (Notification.permission === "denied") {
        next = "denied";
      } else {
        const reg = await navigator.serviceWorker.getRegistration("/");
        next = (await reg?.pushManager.getSubscription()) ? "on" : "off";
      }
      if (live) setState(next);
    })().catch(() => live && setState("unsupported"));
    return () => {
      live = false;
    };
  }, []);

  const turnOn = () =>
    start(async () => {
      setMessage(null);
      try {
        // Must be the first await after the tap: Safari asks only from a user gesture.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setState(permission === "denied" ? "denied" : "off");
          return;
        }
        const reg = await registration();
        await navigator.serviceWorker.ready;
        const key = await pushPublicKeyAction();
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
        const saved = await savePushSubscriptionAction(sub.toJSON(), navigator.userAgent);
        if (!saved.ok) {
          setMessage(saved.error ?? "Could not turn notifications on.");
          return;
        }
        setState("on");
        const test = await testPushAction();
        setMessage(test.ok ? "Done. A test notification is on its way." : `Saved, but the test failed: ${test.error}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not turn notifications on.");
      }
    });

  const turnOff = () =>
    start(async () => {
      setMessage(null);
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe().catch(() => {});
      }
      setState("off");
    });

  const test = () =>
    start(async () => {
      const r = await testPushAction();
      setMessage(r.ok ? "Test notification sent." : `It didn't go through: ${r.error}`);
    });

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      {state === "loading" ? <p className="text-muted">Checking this device…</p> : null}
      {state === "needs-home-screen" ? (
        <p className="text-muted">
          On iPhone, open Vela from its icon on the Home Screen (Share, then Add to Home Screen in Safari) and come back here.
        </p>
      ) : null}
      {state === "unsupported" ? <p className="text-muted">This browser can&apos;t receive notifications.</p> : null}
      {state === "denied" ? (
        <p className="text-muted">
          Notifications are blocked for Vela. On iPhone: Settings, Notifications, Vela, Allow Notifications. Then come back here.
        </p>
      ) : null}
      {state === "off" ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-muted">Get a notification on this device when a campaign contact replies or a mass mailing is waiting for your approval.</p>
          <Button variant="primary" onClick={turnOn} disabled={pending}>
            <Bell className="size-4" /> {pending ? "Turning on…" : "Turn on notifications"}
          </Button>
        </div>
      ) : null}
      {state === "on" ? (
        <div className="flex flex-col items-start gap-2">
          <p>
            <span className="font-medium text-emerald-700 dark:text-emerald-400">On for this device.</span>{" "}
            <span className="text-muted">Replies from campaign contacts and mailings to approve arrive here.</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={test} disabled={pending}>
              <Bell className="size-4" /> Send a test
            </Button>
            <Button variant="ghost" onClick={turnOff} disabled={pending}>
              <BellOff className="size-4" /> Turn off
            </Button>
          </div>
        </div>
      ) : null}
      {message ? <p className="text-[13px] text-muted" aria-live="polite">{message}</p> : null}
    </div>
  );
}
