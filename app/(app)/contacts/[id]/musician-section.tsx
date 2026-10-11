import Link from "next/link";
import { ExternalLink, Lock, Music, Trash2 } from "lucide-react";
import { Badge, ProjectDot } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatDate } from "@/lib/dates";
import { INSTRUMENTS, instrumentLabel, ROSTER_STATUSES } from "@/lib/musicians/instruments";
import type { MusicianGig, MusicianProfile } from "@/lib/queries/musicians";
import type { Contact, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RosterBadge, Stars } from "@/components/musicians/badges";
import { ActionForm, FormSubmit } from "../../_components/action-form";
import { FormActions, GroupAction, GroupTitle, iconButtonClass } from "../../_components/ui";
import { addGigAction, deleteGigAction, markMusicianAction, removeMusicianAction, saveMusicianAction } from "../../musicians/actions";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 md:grid md:grid-cols-[6rem_minmax(0,1fr)] md:gap-3 md:py-2">
      <dt className="text-[13px] text-muted md:text-sm">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-[15px] text-fg md:mt-0 md:text-sm">{children}</dd>
    </div>
  );
}

const none = <span className="text-subtle">—</span>;

/**
 * Contact page → Musician: instruments, roster, what they played with us,
 * website and a private rating that stays folded away until asked for.
 */
export function MusicianSection({
  contact,
  profile,
  gigs,
  projects,
  editing,
  timezone,
}: {
  contact: Contact;
  profile: MusicianProfile | null;
  gigs: MusicianGig[];
  projects: Project[];
  editing: boolean;
  timezone: string;
}) {
  const base = `/contacts/${contact.id}?tab=details`;
  if (!profile) {
    return (
      <section aria-label="Musician" id="musician" className="scroll-mt-20">
        <GroupTitle>Musician</GroupTitle>
        <form
          action={markMusicianAction.bind(null, contact.id)}
          className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3 md:rounded-lg"
        >
          <Music className="size-4 shrink-0 text-subtle" aria-hidden />
          <p className="min-w-0 flex-1 text-[13px] text-muted md:text-xs">
            Plays or sings? Add instruments, the concerts they did with us and whether they are in our roster.
          </p>
          <Button type="submit" size="sm" variant="secondary">
            Mark as musician
          </Button>
        </form>
      </section>
    );
  }

  if (editing) return <MusicianForm contact={contact} profile={profile} cancelHref={`${base}#musician`} />;

  return (
    <section aria-label="Musician" id="musician" className="scroll-mt-20">
      <GroupTitle actions={<GroupAction href={`${base}&edit=musician#musician`}>Edit</GroupAction>}>Musician</GroupTitle>
      <dl className="divide-y divide-border rounded-xl border border-border bg-surface md:rounded-lg md:py-1 md:[&>div]:border-0">
        <Row label="Plays">
          {profile.instruments.length ? (
            <span className="flex flex-wrap gap-1">
              {profile.instruments.map((i) => (
                <Link key={i} href={`/musicians?instrument=${encodeURIComponent(i)}`} className="active:opacity-60">
                  <Badge className="bg-brand/10 text-brand">{instrumentLabel(i)}</Badge>
                </Link>
              ))}
            </span>
          ) : (
            <Link href={`${base}&edit=musician#musician`} scroll={false} className="text-muted underline-offset-2 hover:underline">
              Add instruments
            </Link>
          )}
        </Row>
        <Row label="Roster">
          <span className="flex flex-wrap items-center gap-2">
            <RosterBadge roster={profile.roster} />
            <span className="text-[13px] text-subtle md:text-xs">{ROSTER_STATUSES.find((s) => s.value === profile.roster)?.hint}</span>
          </span>
        </Row>
        <Row label="Based in">{profile.basedIn || none}</Row>
        <Row label="Website">
          {profile.website ? (
            <a href={profile.website} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 hover:underline">
              <span className="truncate">{profile.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</span>
              <ExternalLink className="size-3.5 shrink-0 text-subtle" aria-hidden />
            </a>
          ) : (
            none
          )}
        </Row>
        <Row label="Notes">{profile.notes ? <p className="prose-plain">{profile.notes}</p> : none}</Row>
        <Row label="Rating">
          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-muted active:opacity-60 [&::-webkit-details-marker]:hidden">
              <Lock className="size-3.5" aria-hidden />
              <span className="group-open:hidden">Private · show</span>
              <span className="hidden group-open:inline">Private · hide</span>
            </summary>
            <div className="mt-1.5">
              {profile.rating ? <Stars value={profile.rating} /> : <span className="text-subtle">Not rated</span>}
              {profile.ratingNote ? <p className="prose-plain mt-1 text-muted">{profile.ratingNote}</p> : null}
            </div>
          </details>
        </Row>
      </dl>

      <GroupTitle className="mt-5">Played with us{gigs.length ? ` · ${gigs.length}` : ""}</GroupTitle>
      <div className="divide-y divide-border rounded-xl border border-border bg-surface md:rounded-lg">
        {gigs.map((g) => (
          <div key={g.id} className="flex items-start gap-2 px-4 py-2.5 md:py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] text-fg md:text-sm">{g.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-subtle md:text-xs">
                {g.playedOn ? <span>{formatDate(new Date(`${g.playedOn}T12:00:00Z`), timezone)}</span> : <span>No date</span>}
                {g.instrument ? <span>{instrumentLabel(g.instrument)}</span> : null}
                {g.project ? (
                  <span className="inline-flex items-center gap-1">
                    <ProjectDot color={g.project.color} />
                    {g.project.name}
                  </span>
                ) : null}
              </p>
              {g.notes ? <p className="prose-plain mt-1 text-[13px] text-muted md:text-xs">{g.notes}</p> : null}
            </div>
            <form action={deleteGigAction.bind(null, contact.id, g.id)}>
              <button type="submit" className={cn(iconButtonClass, "text-subtle")} aria-label={`Remove “${g.title}”`} title="Remove">
                <Trash2 className="size-4" aria-hidden />
              </button>
            </form>
          </div>
        ))}
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-[15px] text-muted active:opacity-60 md:min-h-9 md:text-sm [&::-webkit-details-marker]:hidden">
            {gigs.length ? "Add another concert" : "Add a concert or project they played with us"}
          </summary>
          <ActionForm action={addGigAction.bind(null, contact.id)} className="flex flex-col gap-3 px-4 pb-4">
            <Field label="What" htmlFor="gig-title">
              <Input id="gig-title" name="title" placeholder="Festival ADAR 2025 · Schubert Quintet" autoComplete="off" required maxLength={300} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <Field label="Date" htmlFor="gig-date" hint="Optional.">
                <Input id="gig-date" name="playedOn" type="date" />
              </Field>
              <Field label="Played" htmlFor="gig-instrument" hint="Optional.">
                <Input id="gig-instrument" name="instrument" list="instrument-options" defaultValue={profile.instruments[0] ? instrumentLabel(profile.instruments[0]) : ""} autoComplete="off" />
              </Field>
            </div>
            {projects.length ? (
              <Field label="Project" htmlFor="gig-project">
                <Select id="gig-project" name="projectId" defaultValue="">
                  <option value="">—</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Notes" htmlFor="gig-notes">
              <Textarea id="gig-notes" name="notes" rows={2} maxLength={2000} />
            </Field>
            <FormActions>
              <FormSubmit pendingLabel="Adding…">Add</FormSubmit>
            </FormActions>
          </ActionForm>
        </details>
      </div>
      <InstrumentOptions />
    </section>
  );
}

function InstrumentOptions() {
  return (
    <datalist id="instrument-options">
      {INSTRUMENTS.map((i) => (
        <option key={i.key} value={i.label} />
      ))}
    </datalist>
  );
}

function MusicianForm({ contact, profile, cancelHref }: { contact: Contact; profile: MusicianProfile; cancelHref: string }) {
  return (
    <section aria-label="Edit musician" id="musician" className="scroll-mt-20">
      <GroupTitle>Edit musician</GroupTitle>
      <ActionForm
        action={saveMusicianAction.bind(null, contact.id)}
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg"
      >
        <Field label="Instruments / voice" htmlFor="instruments" hint="Comma separated, in English or Spanish: “cello, viola da gamba”, “soprano”.">
          <Input
            id="instruments"
            name="instruments"
            defaultValue={profile.instruments.map(instrumentLabel).join(", ")}
            autoComplete="off"
            autoCapitalize="off"
          />
        </Field>
        <Field label="Roster" htmlFor="roster">
          <Select id="roster" name="roster" defaultValue={profile.roster}>
            {ROSTER_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} — {s.hint}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Based in" htmlFor="basedIn">
          <Input id="basedIn" name="basedIn" defaultValue={profile.basedIn ?? ""} placeholder="Madrid, Spain" autoComplete="off" maxLength={200} />
        </Field>
        <Field label="Website" htmlFor="website">
          <Input id="website" name="website" type="text" inputMode="url" autoCapitalize="off" defaultValue={profile.website ?? ""} placeholder="https://" autoComplete="off" />
        </Field>
        <Field label="Notes" htmlFor="musician-notes" hint="Repertoire, ensembles, availability, fee…">
          <Textarea id="musician-notes" name="notes" rows={4} defaultValue={profile.notes ?? ""} maxLength={5000} />
        </Field>
        <details className="rounded-md border border-border px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-muted [&::-webkit-details-marker]:hidden">
            <Lock className="size-3.5" aria-hidden /> Private rating — would we play with them again?
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <Field label="Rating" htmlFor="rating">
              <Select id="rating" name="rating" defaultValue={profile.rating ? String(profile.rating) : ""}>
                <option value="">Not rated</option>
                <option value="5">★★★★★ Absolutely</option>
                <option value="4">★★★★ Yes</option>
                <option value="3">★★★ Maybe</option>
                <option value="2">★★ Rather not</option>
                <option value="1">★ No</option>
              </Select>
            </Field>
            <Field label="Private note" htmlFor="ratingNote" hint="Only you see this. Never in emails, exports or Claude.">
              <Textarea id="ratingNote" name="ratingNote" rows={3} defaultValue={profile.ratingNote ?? ""} maxLength={2000} />
            </Field>
          </div>
        </details>
        <FormActions>
          <FormSubmit pendingLabel="Saving…">Save</FormSubmit>
          <ButtonLink href={cancelHref} variant="ghost" scroll={false}>
            Cancel
          </ButtonLink>
        </FormActions>
      </ActionForm>
      <form action={removeMusicianAction.bind(null, contact.id)} className="mt-2 px-4 md:px-0">
        <button type="submit" className="text-[13px] text-subtle hover:text-danger md:text-xs">
          Not a musician — remove the musician card (the concerts they played are kept)
        </button>
      </form>
      <InstrumentOptions />
    </section>
  );
}
