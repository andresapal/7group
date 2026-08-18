# Aseguralo — Guía para Fabian

## Qué cambió

Ahora tienes un **Inbox de Leads** dentro del ERP: cada persona que quiera cotizar un seguro llega automáticamente, sin que tengas que copiar/pegar de WhatsApp.

Los leads entran por 3 caminos:

1. **Formulario web** — el cliente lo llena en 60 segundos
2. **WhatsApp** — respondes con un mensaje que le manda el link del formulario
3. **Llamada / referido** — lo cargas tú manual en 30 segundos

Todos aparecen en el mismo Inbox del ERP.

---

## 1) Cómo abrir el ERP

- Entra a: **https://7group.site/agente/aseguralo/**
- Ingresa con tu cuenta Google (**aseguralo@outlook.com** con la que ya tienes acceso)
- Verás en la parte de arriba un menú: Polizas · **Cotizador** · Dashboard · Comisiones · Facturacion · Renovaciones · Siniestros · Clientes

**Empieza siempre por Cotizador** — ahí vive todo tu pipeline de ventas en 3 pestañas:

```
[ INBOX (5) ]   [ EN COTIZACIÓN (3) ]   [ POR EMITIR (2) ]
```

- **INBOX** → leads nuevos que te acaban de contactar (WA, formulario, llamada). Es lo primero del día.
- **EN COTIZACIÓN** → las cotizaciones que ya armaste y estás esperando respuesta del cliente.
- **POR EMITIR** → cotizaciones aceptadas por el cliente, listas para emitir la póliza.

El número al lado de cada pestaña es cuántos pendientes tienes.

---

## 2) El link del formulario y el QR

- **Link para compartir:** `https://7group.site/agente/aseguralo/lead/`
- **QR imprimible:** entra al ERP → *Cotizador* → botón *QR formulario* → **Descargar PNG**

Ese QR lo puedes:
- Pegar en tu tarjeta de presentación
- Publicar en Instagram / redes
- Poner en la vitrina de la oficina
- Mandarlo en respuestas automáticas de WhatsApp

---

## 3) Configurar la respuesta automática de WhatsApp

Esto es lo más importante. Cada vez que alguien te escriba a WhatsApp por primera vez, tu WhatsApp Business le manda solo el link del formulario. El cliente lo llena y aparece en tu Inbox.

**Pasos en tu celular:**

1. Instala **WhatsApp Business** desde Play Store / App Store (es gratis, distinto al WhatsApp normal)
2. Configúralo con el número **316 520 6865**
3. Ve a: **Configuración → Herramientas para la empresa → Mensaje de bienvenida**
4. Activa la opción
5. Pega este texto:

```
Hola, gracias por escribir a Aseguralo. Soy Fabian Carrera.

Para cotizarte más rápido, cuéntame en este formulario de 60 segundos:
https://7group.site/agente/aseguralo/lead/

Si prefieres, escríbeme directo por aquí qué necesitas asegurar y con gusto te oriento.
```

6. En "Destinatarios" escoge **Todos** (o solo *Personas que no están en la libreta*, como prefieras)
7. Guardar

Listo. Cada persona nueva recibe ese mensaje al escribirte, y si llena el formulario, aparece en tu Inbox con todos los datos.

---

## 4) Qué haces cuando entra un lead

En **Cotizador → Inbox** vas a ver algo así:

| Fecha | Cliente | Teléfono | Tipo | Detalle | Urgencia | Origen | Estado | Acciones |
|---|---|---|---|---|---|---|---|---|
| 2026-08-18 | Camila Ruiz | 3105551234 | Vehiculo | placa ABC123... | Ya | form-web | Nuevo | **WA · Cotizar** |

**Botones a la derecha:**

- **WA (verde)** → abre WhatsApp del cliente con el mensaje inicial de bienvenida del tipo correspondiente. **No tienes que escribir nada**, ya viene armado con el saludo por su nombre y la lista de datos que necesitas. Cuando lo mandes, el lead pasa a estado *Contactado* automáticamente.
- **Cotizar (azul)** → salta a la pestaña **En cotización** con los datos del cliente ya cargados, para que hagas la comparativa entre aseguradoras. El lead se mueve solo de columna.

**Cuando el cliente acepte una cotización**, cámbiala a estado "Aceptada" — automáticamente aparece en la pestaña **Por emitir** para que arranques con la emisión de la póliza (esa parte con OCR de cédula/tarjeta llega en fase 3; por ahora la cargas manual desde *Polizas → + Nueva Poliza*).

---

## 5) Los mensajes de bienvenida están precargados

Cuando aprietas el botón **WA** al lado de un lead, se envía uno de estos mensajes según el tipo:

- 🚗 Vehículo
- 🏥 Salud
- 🏠 Hogar
- ❤️ Vida
- 🏢 Empresa
- 🔑 Arrendamiento
- 📋 Cumplimiento
- ✈️ Póliza de viaje
- Otro

Si quieres cambiar cualquiera, entra al ERP → *Cotizador* → botón **Plantillas** → editas → Guardar.

---

## 6) Correo de aviso

Cada vez que entre un lead nuevo por el formulario, te llega un correo a **aseguralo@outlook.com** con todos los datos del cliente y un botón para abrir WhatsApp directo.

Copia oculta llega a Andrés (**7groupcorp@zohomail.com**) para seguimiento.

---

## 7) Lead manual (para llamadas)

Si un cliente te llama por teléfono o te llega por referido, aprieta **+ Nuevo prospecto** en Cotizador y llenas en 30 segundos:

- Nombre
- Correo
- Teléfono
- Tipo
- Detalle rápido
- Urgencia
- Origen (Llamada / Referido / etc.)

Queda registrado igual que si hubiera entrado por el formulario.

---

## 8) ¿Alguien te escribió WA sin llenar el formulario?

Aprieta **Pegar chat WA** en Cotizador, pega la conversación (o el primer mensaje), aprieta **Analizar** y el sistema extrae automáticamente el nombre, teléfono, tipo, placa, año, marca, y crea el lead. Revisas y guardas.

---

## Resumen rápido — tu día en el ERP

1. Abres **Cotizador** → estás en la pestaña **Inbox** con los leads del día
2. **Alguien te escribe WA** → tu respuesta automática le manda el link del formulario → aparece en tu Inbox
3. **Alguien te llama** → aprietas *+ Nuevo prospecto* → lo cargas en 30 segundos
4. Aprietas **WA** al lado del lead → mandas el saludo con la lista de datos (auto)
5. Cliente responde con los datos → aprietas **Cotizar** → saltas a la pestaña **En cotización** con datos precargados → armas la comparativa
6. Cliente acepta → marcas la cotización como "Aceptada" → aparece en **Por emitir** → emites la póliza

Cualquier duda, escríbeme.

— Andrés · 7group
