import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { MAX_TAGLINE, PROFILE_KIND_LABEL, PROFILE_KINDS, profileFormValues, type OrgProfile } from "@/lib/organizations/profile";
import { ActionForm, FormSubmit } from "../../_components/action-form";
import { FormActions, GroupTitle } from "../../_components/ui";
import { removeOrganizationProfileAction, updateOrganizationProfileAction } from "../actions";

/**
 * The owner's "Edit profile" form: the profile Claude researched (or a new
 * one), with lists typed one item per line.
 */
export function ProfileForm({ organizationId, profile, cancelHref }: { organizationId: string; profile: OrgProfile | null; cancelHref: string }) {
  const v = profileFormValues(profile);
  const text = { autoComplete: "off" } as const;
  const url = { autoComplete: "off", autoCapitalize: "off", autoCorrect: "off", spellCheck: false } as const;
  return (
    <section aria-label="Edit profile" className="mb-6">
      <GroupTitle>{profile ? "Edit profile" : "Add a profile"}</GroupTitle>
      <ActionForm
        action={updateOrganizationProfileAction.bind(null, organizationId)}
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 md:rounded-lg"
      >
        <Field
          label="One-line summary"
          htmlFor="p-tagline"
          hint="What they are, e.g. Chamber music festival. Shown in lists with the city and country; empty = the kind."
        >
          <Input id="p-tagline" name="tagline" maxLength={MAX_TAGLINE} defaultValue={v.tagline} placeholder="Chamber music festival" {...text} />
        </Field>
        <Field label="Summary" htmlFor="p-summary" hint="Two to four sentences: who they are and what they do.">
          <Textarea id="p-summary" name="summary" rows={4} required maxLength={1500} defaultValue={v.summary} />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Kind" htmlFor="p-kind">
            <Select id="p-kind" name="kind" defaultValue={v.kind}>
              <option value="">—</option>
              {PROFILE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PROFILE_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City" htmlFor="p-city">
            <Input id="p-city" name="city" maxLength={80} defaultValue={v.city} placeholder="Kuopio" {...text} />
          </Field>
          <Field label="Country" htmlFor="p-country">
            <Input id="p-country" name="country" maxLength={60} defaultValue={v.country} placeholder="Finland" {...text} />
          </Field>
          <Field label="Address" htmlFor="p-address" hint="Street address, shown as a Google Maps link.">
            <Input id="p-address" name="address" maxLength={200} defaultValue={v.address} placeholder="Kuopionlahdenkatu 23" {...text} />
          </Field>
          <Field label="Area / region" htmlFor="p-location" hint="Optional; shown only without a city and country.">
            <Input id="p-location" name="location" maxLength={200} defaultValue={v.location} placeholder="Northern Savonia" {...text} />
          </Field>
          <Field label="Dates / season" htmlFor="p-dates">
            <Input id="p-dates" name="dates" maxLength={300} defaultValue={v.dates} placeholder="Every July · season Oct–May" {...text} />
          </Field>
          <Field label="Scale" htmlFor="p-scale">
            <Input id="p-scale" name="scale" maxLength={300} defaultValue={v.scale} placeholder="30 shows, 12,000 tickets" {...text} />
          </Field>
        </div>
        <Field label="Programs" htmlFor="p-programming" hint="What they program: genres, formats.">
          <Textarea id="p-programming" name="programming" rows={3} maxLength={2000} defaultValue={v.programming} />
        </Field>
        <Field
          label="Venues"
          htmlFor="p-venues"
          hint="One per line: Name — type — capacity — @ address — photo https:// link (e.g. Main hall — black box theatre — 450 — @ Calle Mayor 1). Each links to Google Maps."
        >
          <Textarea id="p-venues" name="venues" rows={3} defaultValue={v.venues} {...text} />
        </Field>
        <Field label="Audience" htmlFor="p-audience">
          <Input id="p-audience" name="audience" maxLength={600} defaultValue={v.audience} {...text} />
        </Field>
        <Field label="Highlights" htmlFor="p-highlights" hint="Past artists or projects, one per line.">
          <Textarea id="p-highlights" name="highlights" rows={3} defaultValue={v.highlights} />
        </Field>
        <Field label="Why ADAR" htmlFor="p-fit" hint="Why and how ADAR could work with them.">
          <Textarea id="p-fit" name="fitForAdar" rows={3} maxLength={2000} defaultValue={v.fitForAdar} />
        </Field>
        <Field label="Ideas" htmlFor="p-ideas" hint="Concrete collaboration ideas, one per line.">
          <Textarea id="p-ideas" name="ideas" rows={3} defaultValue={v.ideas} />
        </Field>
        <Field
          label="Image URLs"
          htmlFor="p-images"
          hint="Up to 8, one per line, https:// only. Optional caption after a dash: https://… — Main hall."
        >
          <Textarea id="p-images" name="images" rows={3} defaultValue={v.images} {...url} />
        </Field>
        <Field label="Links" htmlFor="p-links" hint="One per line: Label — https://…">
          <Textarea id="p-links" name="links" rows={3} defaultValue={v.links} {...url} />
        </Field>
        <FormActions>
          <FormSubmit pendingLabel="Saving…">Save profile</FormSubmit>
          <ButtonLink href={cancelHref} variant="ghost" scroll={false}>
            Cancel
          </ButtonLink>
        </FormActions>
      </ActionForm>
      {profile ? (
        <form action={removeOrganizationProfileAction.bind(null, organizationId)} className="mt-3 flex justify-end">
          <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…" className="text-danger">
            Remove profile
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
