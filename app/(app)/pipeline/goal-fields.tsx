"use client";

import { useState } from "react";
import { GoalKindOptions } from "@/components/goals";
import { Field, Select } from "@/components/ui/field";
import { GOAL_KINDS, OPPORTUNITY_STAGES, stageLabel } from "@/lib/constants";
import type { OpportunityKind, OpportunityStage } from "@/lib/types";

/**
 * Goal type + stage selects of the goal form (form fields "kind" and
 * "stage"). The stage names follow the goal picked ("Offer sent" for Get
 * booked, "Request sent" for Use of a space…), and the goal's hint shows
 * below.
 */
export function GoalKindStageFields({
  kind: initialKind,
  stage,
  idPrefix,
}: {
  kind: OpportunityKind;
  stage: OpportunityStage;
  idPrefix: string;
}) {
  const [kind, setKind] = useState<OpportunityKind>(initialKind);
  const hint = GOAL_KINDS.find((k) => k.value === kind)?.hint;
  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Goal" htmlFor={`${idPrefix}-kind`}>
          <Select id={`${idPrefix}-kind`} name="kind" value={kind} onChange={(e) => setKind(e.currentTarget.value as OpportunityKind)}>
            <GoalKindOptions />
          </Select>
        </Field>
        <Field label="Stage" htmlFor={`${idPrefix}-stage`}>
          <Select id={`${idPrefix}-stage`} name="stage" defaultValue={stage}>
            {OPPORTUNITY_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {stageLabel(s.value, kind)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {hint ? <p className="text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}
