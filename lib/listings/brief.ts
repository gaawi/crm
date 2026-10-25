import { noEmDash } from "@/lib/text/no-em-dash";
import { LISTING_COSTS, methodLabel, statusLabel, type SubmissionStatus } from "./constants";
import type { ListingEvent, PlatformForEvent } from "@/lib/queries/listings";

/**
 * The brief for an outside agent (ChatGPT, a VA): the concert's facts and,
 * for every platform still to do (or blocked), how to submit there. The
 * agent reports back in a fixed table so the owner can mark each row.
 * Written in Spanish, the owner's language.
 */

const OPEN: SubmissionStatus[] = ["todo", "blocked", "sent"];

function when(event: ListingEvent): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: event.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(event.startsAt);
}

export function listingBrief(event: ListingEvent, platforms: PlatformForEvent[]): string {
  const lines: string[] = [];
  lines.push(`# Publicar el concierto "${event.title}" en calendarios y medios de Nueva York`, "");
  lines.push("## Datos del concierto (usa exactamente estos, no inventes nada)");
  lines.push(`- Título: ${event.title}`);
  lines.push(`- Fecha y hora: ${when(event)} (hora de ${event.timeZone})`);
  if (event.venue) lines.push(`- Sala: ${event.venue}`);
  if (event.address) lines.push(`- Dirección: ${event.address}`);
  if (event.prices) lines.push(`- Precios: ${event.prices}`);
  if (event.ticketUrl) lines.push(`- Entradas: ${event.ticketUrl}`);
  if (event.infoUrl) lines.push(`- Más información: ${event.infoUrl}`);
  if (event.imageUrl) lines.push(`- Imagen oficial: ${event.imageUrl}`);
  if (event.description) lines.push("", "### Descripción", event.description);
  if (event.notes) lines.push("", "### Notas", event.notes);

  const open = platforms.filter((p) => p.active && OPEN.includes(p.submission?.status ?? "todo"));
  const done = platforms.filter((p) => p.submission && !OPEN.includes(p.submission.status));
  lines.push("", `## Plataformas pendientes (${open.length})`);
  open.forEach((p, i) => {
    const status = p.submission?.status ?? "todo";
    lines.push("", `### ${i + 1}. ${p.name}${status !== "todo" ? ` (estado actual: ${statusLabel(status)})` : ""}`);
    lines.push(`- Método: ${methodLabel(p.method)}`);
    if (p.submitUrl) lines.push(`- Dónde enviar: ${p.submitUrl}`);
    if (p.email) lines.push(`- Email: ${p.email}`);
    if (p.website && p.website !== p.submitUrl) lines.push(`- Web: ${p.website}`);
    lines.push(`- Login: ${p.loginRequired ? `sí${p.loginAccount ? ` (${p.loginAccount})` : ""}` : "no hace falta"}`);
    const cost = LISTING_COSTS.find((c) => c.value === p.cost)?.value;
    lines.push(`- Coste: ${cost === "free" ? "gratis" : cost === "paid" ? `de pago${p.costNote ? ` (${p.costNote})` : ""}. NO pagues sin permiso` : `desconocido${p.costNote ? ` (${p.costNote})` : ""}`}`);
    if (p.leadDays != null) lines.push(`- Antelación que piden: ${p.leadDays} días`);
    if (p.audience) lines.push(`- Público: ${p.audience}`);
    if (p.instructions) lines.push(`- Instrucciones: ${p.instructions}`);
    if (p.notes) lines.push(`- Notas: ${p.notes}`);
    if (p.submission?.notes) lines.push(`- Notas de este concierto: ${p.submission.notes}`);
  });
  if (done.length) {
    lines.push("", "## Ya hechas (no repetir)");
    for (const p of done) lines.push(`- ${p.name}: ${statusLabel(p.submission!.status)}${p.submission!.sentAt ? ` (${p.submission!.sentAt})` : ""}`);
  }
  lines.push(
    "",
    "## Reglas",
    "- No pagues nada, no crees cuentas nuevas y no aceptes condiciones comerciales sin mi permiso.",
    "- No dupliques fichas que ya existan; si encuentras una con datos erróneos, anótalo.",
    "- Si un captcha o un login te bloquea, déjalo como bloqueado y dime qué falta.",
    "",
    "## Cómo informarme",
    "Al terminar, devuélveme una tabla con una fila por plataforma: Plataforma | Estado (Sent, Received, Published, Rejected, Blocked o Skipped) | Fecha | Enlace de confirmación | Enlace público | Notas.",
  );
  return noEmDash(lines.join("\n"));
}
