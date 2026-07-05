# Hero Banner — Plan de Mensajes Rotativos
*Estrategia de contenido · Pendiente de implementación*

---

## Recomendación estratégica: 6 mensajes

**¿Por qué 6?**
- Rotación a 4 segundos por mensaje = ciclo de 24 segundos
- Tiempo promedio en el hero antes de hacer scroll: 8-15 segundos
- El usuario ve 2-3 mensajes antes de bajar — suficiente para enganchar
- 6 cubre los ángulos clave sin diluir el mensaje
- Menos de 4 = poca variedad; más de 8 = nadie los ve todos

**Efecto visual recomendado:** fade suave (opacity) o typewriter — NO slide lateral (distrae en mobile).

**Velocidad:** 4 segundos visibles + 0.6s transición

---

## Mensajes — EN (mercado USA)

Orden estratégico: dolor → aspiración → diferencial → urgencia → vertical → promesa

| # | Mensaje principal | Subtexto (si aplica) |
|---|-------------------|----------------------|
| 1 | **Stop operating in Excel and WhatsApp.** | We design and implement AI solutions that optimize your time and operational processes. |
| 2 | **Quote in seconds. Close in minutes. Deliver every time.** | Automated quoting, real-time order management, and KPI dashboards — in one platform. |
| 3 | **One platform. Every operation. Zero chaos.** | From quoting to delivery, fully automated and white-labeled for your brand. |
| 4 | **Your competitors already automated. Will you?** | The companies winning in logistics aren't working harder. They built smarter systems. |
| 5 | **Built for logistics. Proven in real operations.** | We didn't build this in a lab. We built it to run our own business — then opened it to yours. |
| 6 | **AI agents that work while you sleep.** | Transport, logistics, cargo generation, warehousing, and CEO-level insights — fully automated. |

---

## Mensajes — ES (mercado Colombia / LATAM)

| # | Mensaje principal | Subtexto (si aplica) |
|---|-------------------|----------------------|
| 1 | **Deja de operar en Excel y WhatsApp.** | Diseñamos e implementamos soluciones de IA que optimizan tu tiempo y procesos operativos. |
| 2 | **Cotiza en segundos. Cierra en minutos. Entrega siempre.** | Motor de cotizaciones, gestión de órdenes en tiempo real y KPIs — en una sola plataforma. |
| 3 | **Una plataforma. Toda la operación. Cero caos.** | De la cotización a la entrega, automatizado y con tu marca. |
| 4 | **Tu competencia ya automatizó. ¿Y tú?** | Las empresas que están ganando en logística no trabajan más duro. Construyeron sistemas más inteligentes. |
| 5 | **Construido para logística. Probado en operación real.** | No lo hicimos en un laboratorio. Lo construimos para operar nuestro propio negocio — y luego lo abrimos al tuyo. |
| 6 | **Agentes de IA que trabajan mientras duermes.** | Transporte, logística, generación de carga, bodegaje y gestión gerencial — 100% automatizados. |

---

## Mensajes — Landings geo (Florida / Georgia / Texas)

Estos combinan el mensaje geo-específico del hero actual con los rotativos.
El primer mensaje siempre es el gancho geográfico, luego los 5 generales.

### Florida
| # | Mensaje |
|---|---------|
| 1 | **Florida businesses move fast. Your operations should too.** *(geo anchor — stays first)* |
| 2 | Quote in seconds. Close in minutes. Deliver every time. |
| 3 | One platform. Every operation. Zero chaos. |
| 4 | Your competitors already automated. Will you? |
| 5 | AI agents for transport, logistics, warehousing — and your CEO. |
| 6 | Built for logistics. Proven in real operations. |

### Georgia
| # | Mensaje |
|---|---------|
| 1 | **Atlanta leads the Southeast. Your operations should too.** *(geo anchor)* |
| 2–6 | *Mismos 5 mensajes que Florida* |

### Texas
| # | Mensaje |
|---|---------|
| 1 | **Texas runs big. Your operations need infrastructure to match.** *(geo anchor)* |
| 2–6 | *Mismos 5 mensajes que Florida* |

---

## Notas de implementación (para cuando se codifique)

- El subtexto también debe cambiar con cada mensaje (o usar uno fijo genérico)
- El CTA ("Let's talk" / "Hablemos") no cambia — siempre visible
- En mobile: acortar los mensajes si superan 2 líneas
- Accessibility: `aria-live="polite"` en el contenedor rotativo
- Archivos a modificar: `index.html`, `es/index.html`, `florida/index.html`, `georgia/index.html`, `texas/index.html`
- CSS: `@keyframes fadeMessage` o typewriter via JS
- Considerar pausa al hover (como el carousel de clientes)

---

*Estado: PENDIENTE DE IMPLEMENTACIÓN*
*Aprobación de mensajes requerida antes de codificar*
