/** The guest list, with a slot for a contact card opened over it (tap a person). */
export default function GuestListLayout({ children, modal }: LayoutProps<"/promotion/c/[eventId]/guests">) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
