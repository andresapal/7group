# 7Group Platform — Setup

## Paso 1: Crear la Google Sheet

1. Ve a https://sheets.google.com con tu cuenta 7groupcorp@zohomail.com (o la que prefieras)
2. Crea una hoja nueva llamada "7Group Briefs"
3. En la primera fila pon estos headers:

timestamp | ref | negocio | nombre | telefono | email | ciudad | sector | tiempo_mercado | descripcion_negocio | servicios | diferenciador | cobertura | tiene_web | url_web | redes | captacion_actual | clientes_mes | cliente_tipico | rango_edad | tipo_cliente | objecion_comun | necesidades | dolor_principal | meta_6meses | presupuesto | urgencia | inversion_inicial | contacto_preferido | comentarios | status

4. Copia el ID de la hoja (esta en la URL: docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit)

## Paso 2: Crear el Apps Script

1. En la misma hoja, ve a Extensions > Apps Script
2. Borra todo el codigo que aparece
3. Pega el contenido del archivo `apps-script.js` (esta en esta carpeta)
4. Click en Deploy > New deployment
5. Tipo: Web app
6. Execute as: Me
7. Who has access: Anyone
8. Click Deploy y copia la URL que te da

## Paso 3: Pegar la URL en los archivos

1. Abre `onboarding.html` y busca `APPS_SCRIPT_URL` — pega la URL ahi
2. Abre `platform.html` y busca `APPS_SCRIPT_URL` — pega la URL ahi
3. Sube ambos archivos + `platform.html` al repo de GitHub
