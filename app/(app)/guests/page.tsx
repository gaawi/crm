import { redirect } from "next/navigation";

/** The guest lists moved into Concert list. */
export default function GuestListsPage() {
  redirect("/concerts");
}
