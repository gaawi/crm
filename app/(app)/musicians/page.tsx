import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink, Lock, Music, X } from "lucide-react";
import { ContactAvatar } from "@/components/contact-avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/layout";
import { env } from "@/lib/env";
import { formatDate, formatRelative } from "@/lib/dates";
import {
  FAMILIES,
  groupByFamily,
  instrumentFamily,
  instrumentLabel,
  instrumentsMatching,
  ROSTER_STATUSES,
  type InstrumentFamily,
  type RosterStatus,
} from "@/lib/musicians/instruments";
import { Select } from "@/components/ui/field";
import { instrumentCounts, listMusicians, type MusicianRow } from "@/lib/queries/musicians";
import { cn } from "@/lib/utils";
import { RosterBadge, Stars } from "@/components/musicians/badges";
import { FilterForm } from "../_components/filter-form";
import { Segmented } from "../_components/segmented";
import { SearchInput } from "../_components/ui";
import { hrefWith, param } from "../_lib/url";
import { AddMusician } from "./add-musician";

export const metadata: Metadata = { title: "Musicians" };

const PLAYED = ["yes", "no"] as const;

export default async function MusiciansPage({ searchParams }: PageProps<"/musicians">) {
  const sp = await searchParams;
  const q = param(sp, "q", 100);
  const instrument = param(sp, "instrument", 60);
  const rosterParam = param(sp, "roster");
  const roster = ROSTER_STATUSES.some((s) => s.value === rosterParam) ? (rosterParam as RosterStatus) : undefined;
  const playedParam = param(sp, "played");
  const played = (PLAYED as readonly string[]).includes(playedParam) ? playedParam : "";
  // The private rating is folded away unless asked for (?ratings=1).
  const showRatings = param(sp, "ratings") === "1";

  // ?instrument=cello, or a whole family: ?instrument=family:strings
  const familyParam = instrument.startsWith("family:") ? instrument.slice(7) : "";
  const family = FAMILIES.some((f) => f.value === familyParam) ? (familyParam as InstrumentFamily) : null;
  const counts = await instrumentCounts();
  const familyKeys = family ? counts.map((c) => c.instrument).filter((i) => instrumentFamily(i) === family) : [];

  const [musicians] = await Promise.all([
    listMusicians({
      q: q || undefined,
      instrument: family ? undefined : instrument || undefined,
      instrumentsAny: family ? (familyKeys.length ? familyKeys : ["-"]) : undefined,
      roster,
      playedWithUs: played === "yes" ? true : played === "no" ? false : undefined,
      withRating: showRatings,
    }),
  ]);
  const groups = groupByFamily(counts);
  const current = { q, instrument, roster: roster ?? "", played, ratings: showRatings ? "1" : "" };
  const href = (patch: Partial<typeof current>) => hrefWith("/musicians", { ...current, ...patch });
  const understood = q ? instrumentsMatching(q, counts.map((c) => c.instrument)) : [];
  const filtered = Boolean(q || instrument || roster || played);
  const familyLabel = family ? FAMILIES.find((f) => f.value === family)?.label : null;

  return (
    <>
      <PageHeader
        title={
          <>
            Musicians
            <span className="ml-2 text-lg font-normal tabular-nums text-subtle md:text-base">{musicians.length}</span>
          </>
        }
        description="Who plays what, who has played with us, and who is in our roster."
      />

      <FilterForm action="/musicians" className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center" role="search" aria-label="Find a musician">
        <SearchInput
          name="q"
          defaultValue={q}
          placeholder="Instrument or name — “cellista”, “soprano”, “piano Madrid”…"
          aria-label="Search musicians by instrument, name or city"
          className="min-w-0 flex-1"
        />
        {counts.length ? (
          <Select name="instrument" defaultValue={instrument} key={instrument} aria-label="Filter by instrument" className="sm:w-60">
            <option value="">All instruments</option>
            {groups.map((g) => (
              <optgroup key={g.family} label={g.label}>
                {g.items.length > 1 ? <option value={`family:${g.family}`}>All {g.label.toLowerCase()}</option> : null}
                {g.items.map((c) => (
                  <option key={c.instrument} value={c.instrument}>
                    {instrumentLabel(c.instrument)} ({c.count})
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        ) : null}
        {roster ? <input type="hidden" name="roster" value={roster} /> : null}
        {played ? <input type="hidden" name="played" value={played} /> : null}
        {showRatings ? <input type="hidden" name="ratings" value="1" /> : null}
      </FilterForm>

      {familyLabel ? (
        <p className="mb-3 px-4 text-[13px] text-subtle md:px-0 md:text-xs">
          {familyLabel}: {familyKeys.map(instrumentLabel).join(", ") || "none yet"} ·{" "}
          <Link href={href({ instrument: "" })} className="text-muted underline-offset-2 hover:underline">
            All instruments
          </Link>
        </p>
      ) : null}

      {q && understood.length ? (
        <p className="mb-3 px-4 text-[13px] text-subtle md:px-0 md:text-xs">
          Instruments: {understood.map(instrumentLabel).join(", ")} — plus names, cities and notes matching “{q}”.
        </p>
      ) : null}

      {counts.length ? (
        <div className="mb-3 hidden flex-wrap gap-1.5 md:flex" aria-label="Instruments">
          {counts.map((c) => {
            const on = c.instrument === instrument;
            return (
              <Link
                key={c.instrument}
                href={href({ instrument: on ? "" : c.instrument })}
                aria-pressed={on}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] active:opacity-60 md:h-7 md:px-2.5 md:text-xs",
                  on ? "border-transparent bg-brand text-white" : "border-border text-muted md:hover:border-border-strong md:hover:text-fg",
                )}
              >
                {instrumentLabel(c.instrument)}
                <span className={cn("tabular-nums", on ? "text-white/80" : "text-subtle")}>{c.count}</span>
                {on ? <X className="size-3" aria-hidden /> : null}
              </Link>
            );
          })}
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center">
        <Segmented
          label="Roster"
          fill={false}
          className="md:w-auto"
          segments={[
            { href: href({ roster: "" }), label: "All", active: !roster },
            ...ROSTER_STATUSES.map((s) => ({ href: href({ roster: s.value }), label: s.short, active: roster === s.value })),
          ]}
        />
        <Segmented
          label="Played with us"
          fill={false}
          className="md:w-auto"
          segments={[
            { href: href({ played: "" }), label: "Anyone", active: !played },
            { href: href({ played: "yes" }), label: "Played with us", active: played === "yes" },
            { href: href({ played: "no" }), label: "Not yet", active: played === "no" },
          ]}
        />
        <Link
          href={href({ ratings: showRatings ? "" : "1" })}
          className="inline-flex min-h-9 items-center gap-1.5 px-1 text-[13px] text-muted hover:text-fg md:ml-auto md:text-xs"
        >
          <Lock className="size-3.5" aria-hidden />
          {showRatings ? "Hide private ratings" : "Show private ratings"}
        </Link>
      </div>

      {musicians.length ? (
        <ul className="mb-6 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface md:rounded-lg">
          {musicians.map((m) => (
            <MusicianItem
              key={m.contact.id}
              m={m}
              showRatings={showRatings}
              timezone={env.timezone}
              highlight={family ? familyKeys : instrument ? [instrument] : understood}
            />
          ))}
        </ul>
      ) : (
        <div className="mb-6">
          <EmptyState title={filtered ? "No musicians match" : "No musicians yet"}>
            {filtered ? (
              <Link href="/musicians" className="underline underline-offset-2">
                Clear the filters
              </Link>
            ) : (
              "Add one below, or open any contact and tap “Mark as musician”."
            )}
          </EmptyState>
        </div>
      )}

      <AddMusician />
    </>
  );
}

function MusicianItem({ m, showRatings, timezone, highlight }: { m: MusicianRow; showRatings: boolean; timezone: string; highlight: string[] }) {
  const c = m.contact;
  const sub = [m.basedIn, c.organization?.name].filter(Boolean).join(" · ");
  return (
    <li className="relative flex items-start gap-3 px-4 py-3 active:bg-surface-2 md:active:bg-transparent">
      <ContactAvatar contact={c} size="md" zoomable />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/contacts/${c.id}?tab=details#musician`}
            className="truncate text-[15px] font-medium text-fg after:absolute after:inset-0 hover:underline md:text-sm md:after:hidden"
          >
            {c.displayName}
          </Link>
          <RosterBadge roster={m.roster} />
          {showRatings && m.rating ? <Stars value={m.rating} className="text-[13px]" /> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {m.instruments.length ? (
            m.instruments.map((i) => (
              <Badge key={i} className={highlight.includes(i) ? "bg-brand text-white" : "bg-brand/10 text-brand"}>
                {instrumentLabel(i)}
              </Badge>
            ))
          ) : (
            <span className="text-[13px] text-subtle md:text-xs">No instruments yet</span>
          )}
        </div>
        {sub ? <p className="mt-1 truncate text-[13px] text-muted md:text-xs">{sub}</p> : null}
        <p className="mt-0.5 text-[13px] text-muted md:text-xs">
          {m.gigCount ? (
            <>
              <Music className="mr-1 inline size-3 align-[-1px]" aria-hidden />
              Played with us {m.gigCount === 1 ? "once" : `${m.gigCount}×`}
              {m.lastGig ? (
                <span className="text-subtle">
                  {" "}
                  · {m.lastGig.title}
                  {m.lastGig.playedOn ? `, ${formatDate(new Date(`${m.lastGig.playedOn}T12:00:00Z`), timezone)}` : ""}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-subtle">Hasn’t played with us yet</span>
          )}
          {c.lastContactedAt ? <span className="text-subtle"> · last email {formatRelative(c.lastContactedAt, timezone)}</span> : null}
        </p>
        {showRatings && m.ratingNote ? <p className="mt-1 text-[13px] italic text-muted md:text-xs">{m.ratingNote}</p> : null}
      </div>
      {m.website ? (
        <a
          href={m.website}
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-10 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-fg md:size-8"
          aria-label={`${c.displayName}’s website`}
          title={m.website}
        >
          <ExternalLink className="size-4" aria-hidden />
        </a>
      ) : null}
    </li>
  );
}
