/**
 * Starter email templates for a new booking sheet, one per situation, in
 * Spanish (the language of the owner's venue outreach). The owner edits them
 * on the sheet's Templates page; nothing here is sent without approval.
 */
import type { TemplateTrigger } from "@/lib/types";

export const STARTER_TEMPLATES: { name: string; trigger: TemplateTrigger; subject: string; body: string }[] = [
  {
    name: "Propuesta",
    trigger: "first_contact",
    subject: "Propuesta de colaboración — {{venue}}",
    body: `Buenos días {{first_name}}:

Le escribo para presentarle nuestro proyecto y explorar la posibilidad de programarlo en {{venue}}.

[Dos o tres frases sobre el proyecto: trayectoria, artistas, formatos.]

Podemos adaptar la propuesta al espacio y a las fechas que mejor les encajen ({{dates}}).

Quedo a su disposición para ampliar información o hablar por teléfono cuando lo consideren oportuno.

Un cordial saludo,

{{signature}}`,
  },
  {
    name: "Repetidor",
    trigger: "returning",
    subject: "¡Volvemos! — {{venue}}",
    body: `Buenos días {{first_name}}:

Espero que te encuentres bien. Estamos preparando la nueva edición y nos encantaría contar de nuevo con {{venue}}.

Guardo un recuerdo estupendo de nuestra colaboración anterior. Desde entonces el proyecto ha seguido creciendo y podemos adaptar la propuesta a lo que mejor encaje con vosotros.

¿Podríamos hablar para ver cómo repetir la experiencia?

Un abrazo,

{{signature}}`,
  },
  {
    name: "Follow-up",
    trigger: "follow_up",
    subject: "Re: Propuesta de colaboración — {{venue}}",
    body: `Buenos días {{first_name}}:

Te escribo para hacer un breve seguimiento de mi correo anterior sobre la posibilidad de programar una actividad en {{venue}}.

Estamos cerrando la programación y nos encantaría contar con vosotros. El formato es flexible y se adapta a cada espacio.

Si te resulta más cómodo, estaré encantado de hablar por teléfono.

Un cordial saludo,

{{signature}}`,
  },
  {
    name: "Post-llamada",
    trigger: "after_call",
    subject: "Seguimiento de nuestra conversación — {{venue}}",
    body: `Buenos días {{first_name}}:

Muchas gracias por la conversación telefónica. Te escribo para dejar por escrito lo hablado y enviarte la información del proyecto.

[Resumen de lo hablado y enlaces.]

Quedo a tu disposición para cualquier consulta.

Un cordial saludo,

{{signature}}`,
  },
  {
    name: "Siguiente paso",
    trigger: "next_steps",
    subject: "Próximos pasos — {{venue}}",
    body: `Buenos días {{first_name}}:

Muchas gracias por vuestro interés. Para poder cerrar la fecha y el espacio necesitaríamos confirmar:

- Fecha preferida ({{dates}})
- Espacio disponible en {{venue}} ({{spaces}})
- Necesidades técnicas o logísticas por vuestra parte

Quedo a la espera de tus comentarios.

Un cordial saludo,

{{signature}}`,
  },
  {
    name: "Logística",
    trigger: "confirmed",
    subject: "Confirmación y logística — {{venue}}",
    body: `Buenos días {{first_name}}:

Estamos encantados de confirmar la actividad en {{venue}} ({{dates}}).

Para prepararla necesitaríamos coordinar:
- Fecha y horario definitivos
- Acceso al espacio para la prueba de sonido
- Contacto técnico local
- Materiales de difusión

Te enviaré próximamente el rider técnico y los materiales de prensa.

Un cordial saludo,

{{signature}}`,
  },
  {
    name: "Agradecimiento",
    trigger: "declined",
    subject: "Gracias — {{venue}}",
    body: `Buenos días {{first_name}}:

Muchas gracias por haber considerado nuestra propuesta. Entendemos que en esta ocasión no es posible.

Si en el futuro surge la posibilidad de colaborar, estaremos encantados de retomar la conversación.

Un cordial saludo,

{{signature}}`,
  },
  {
    name: "Novedades",
    trigger: "keep_informed",
    subject: "Novedades — {{sheet}}",
    body: `Buenos días {{first_name}}:

Te escribo para compartir algunas novedades de nuestro proyecto, por si son de interés para {{venue}}.

[Dos o tres novedades: nuevas fechas, artistas, grabaciones, prensa.]

Seguimos en contacto y encantados de hablar cuando lo consideres oportuno.

Un cordial saludo,

{{signature}}`,
  },
  {
    name: "Gracias tras el concierto",
    trigger: "thanks",
    subject: "¡Gracias! — {{venue}}",
    body: `Buenos días {{first_name}}:

Muchas gracias por acogernos en {{venue}}. Fue un placer trabajar con vosotros.

Os comparto algunas fotos y enlaces del concierto: [enlaces]

Esperamos volver a colaborar pronto.

Un abrazo,

{{signature}}`,
  },
];
