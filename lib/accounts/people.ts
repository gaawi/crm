/**
 * Who each sending account belongs to, so screens can say plainly "Sent from
 * Guillermo" / "Sent from Josefina" with their photo (mass mailings, Today,
 * Approvals). Safe for client and server.
 */
export interface AccountPerson {
  name: string;
  photoUrl: string | null;
}

const GUILLERMO: AccountPerson = { name: "Guillermo", photoUrl: "https://creartbox.nyc/assets/img/guillermo-laporta.png" };
const JOSEFINA: AccountPerson = { name: "Josefina", photoUrl: "https://creartbox.nyc/assets/img/josefina-urraca.png" };
const CREARTBOX: AccountPerson = { name: "CreArtBox", photoUrl: null };

const BY_EMAIL: Record<string, AccountPerson> = {
  "guillermo@creartbox.nyc": GUILLERMO,
  "guillermolaporta@gmail.com": GUILLERMO,
  "josefinaupd@gmail.com": JOSEFINA,
  "info@creartbox.nyc": CREARTBOX,
  "marketing@creartbox.nyc": CREARTBOX,
};

export function accountPerson(email: string | null | undefined): AccountPerson {
  const key = (email ?? "").toLowerCase();
  return BY_EMAIL[key] ?? { name: key.split("@")[0] || "?", photoUrl: null };
}
