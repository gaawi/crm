"use client";

import { useEffect, useRef } from "react";

/**
 * A window event fired after an activity is logged or deleted, or a row's
 * status is set from a timeline, so client-loaded timelines (the sheet's
 * History drawer) reload themselves. Server-rendered data refreshes on its
 * own: the server actions call refresh().
 */
export const ACTIVITY_CHANGED_EVENT = "crm:activity-changed";

export interface ActivityChangedDetail {
  opportunityId?: string | null;
  contactId?: string | null;
  organizationId?: string | null;
}

export function emitActivityChanged(detail: ActivityChangedDetail): void {
  window.dispatchEvent(new CustomEvent<ActivityChangedDetail>(ACTIVITY_CHANGED_EVENT, { detail }));
}

/** Calls `handler` on every ACTIVITY_CHANGED_EVENT (the latest handler; no re-subscribe on each render). */
export function useActivityChanged(handler: (detail: ActivityChangedDetail) => void): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  useEffect(() => {
    const listener = (event: Event) => ref.current((event as CustomEvent<ActivityChangedDetail>).detail ?? {});
    window.addEventListener(ACTIVITY_CHANGED_EVENT, listener);
    return () => window.removeEventListener(ACTIVITY_CHANGED_EVENT, listener);
  }, []);
}
