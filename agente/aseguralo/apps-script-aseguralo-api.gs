/**
 * Aseguralo Sheet API — MASTER (reemplaza el código actual del script #2 "18z3a7...")
 * Sheet: 1kazh3aAAmpmzmyQrd14KASKxxNx3R9Fu
 *
 * Endpoints:
 *   GET  ?callback=xxx                     → devuelve todas las pólizas de POLRES (JSONP opcional)
 *   POST {action:'add', ...}               → añade una póliza en POLRES
 *   POST {action:'update', poliza, ...}    → actualiza póliza existente
 *   POST {action:'lead', ...}              → añade un lead en LEADS + correo + Telegram
 *   POST {action:'cotizacion-aceptada',...}→ notifica venta ganada (correo + Telegram)
 *   POST {action:'poliza-emitida', ...}    → notifica emisión de póliza
 *
 * Cron opcional: revisarRenovacionesUrgentes() — corre diario, avisa vencidas + <7 días.
 */

var SHEET_ID   = '1kazh3aAAmpmzmyQrd14KASKxxNx3R9Fu';
var TAB_POLRES = 'POLRES';
var TAB_LEADS  = 'LEADS';
var TAB_COTS   = 'COTIZACIONES';
var TAB_LIQS   = 'LIQUIDACIONES';

// Porcentajes de comision tipicos aseguradora -> Aseguralo (%)
var COMISION_PCT = {'Auto':12,'Vehiculo':12,'SOAT':8,'Vida':15,'Salud':10,'Hogar':18,'Empresa':10,'Arrendamiento':10,'Cumplimiento':8,'Viaje':20,'Otro':10};
// Modelo C - descendente con piso: 50% año 1, 35% año 2, 25% año 3, 15% año 4+
function pct7GroupPorRenovacion_(n){
  n = Number(n)||1;
  if(n<=1) return 50;
  if(n===2) return 35;
  if(n===3) return 25;
  return 15;
}

// ---- Notificaciones ----
var FABIAN_EMAIL       = 'aseguralo@outlook.com';
var COPIA_ADMIN        = '7groupcorp@zohomail.com';
var TELEGRAM_BOT_TOKEN = '8803208867:AAFUoq9iXIUWNCYC1AvFc1pnyBknRR2D1m8';
var TELEGRAM_CHAT_ID   = '1081707115'; // Andrés (@Andresapal)
var FABIAN_WA          = '573165206865';

// Gemini (OCR de PDFs de cotizaciones) - key server-side, no expuesta al navegador
var GEMINI_API_KEY = 'AQ.Ab8RN6KJKsV6YSlxTndUrQ18WBNXwloiaOykdelWLnSfcvrGwQ';
var GEMINI_MODEL   = 'gemini-3.6-flash';

function getSheet(name) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName(name);
}

/* ============================================
   READ (Sheet → ERP)
   ============================================ */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'polizas';
    // 'me' es publico (permite descubrir rol antes de autenticar)
    // 'config' es publico (parametros globales, no datos sensibles)
    if (action === 'me') return doGetMe_(e);
    if (action === 'config') return doGetConfig_(e);

    // Todo lo demas requiere email autenticado
    var perfil = authGate_(e);
    if(!perfil) return jsonResponse({error: 'no autorizado — email requerido o rol invalido'});

    if (action === 'leads') return doGetLeads_(e, perfil);
    if (action === 'cotizaciones') return doGetCotizaciones_(e, perfil);
    if (action === 'liquidaciones') return doGetLiquidaciones_(e, perfil);
    if (action === 'intermediarios') return doGetIntermediarios_(e, perfil);

    // POLRES (polizas) - filtrado por rol
    var sheet = getSheet(TAB_POLRES);
    if (!sheet) return jsonResponse({error: 'Sheet POLRES not found'});

    var data = sheet.getDataRange().getValues();
    var rows = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var poliza = String(row[3] || '').trim();
      if (!poliza) continue;

      rows.push({
        aseguradora: String(row[0] || '').trim(),
        agente:      String(row[1] || '').trim(),
        ramo:        String(row[2] || '').trim(),
        poliza:      poliza,
        nombre:      String(row[4] || '').trim(),
        telefono:    String(row[7] || '').trim(),
        documento:   String(row[8] || '').trim(),
        fnac:        formatDate(row[10]),
        desde:       formatDate(row[20]),
        hasta:       formatDate(row[21]),
        anulacion:   formatDate(row[22]),
        tipo:        String(row[26] || '').trim(),
        riesgo:      String(row[27] || '').trim(),
        valorAsegurado: Number(row[28]) || 0,
        prima_s1:    Number(row[29]) || 0,
        prima_s2:    0,
        prima_s3:    0,
        cobertura:   String(row[27] || '').trim(),
        colaborador: String(row[1] || '').trim(),
        observaciones: String(row[32] || '').trim()
      });
    }

    // Filtro por rol: asesor solo ve las polizas de su intermediario
    rows = filtrarPolizasPorRol_(rows, perfil);

    var callback = (e && e.parameter && e.parameter.callback) ? e.parameter.callback : null;
    var json = JSON.stringify({status: 'ok', count: rows.length, rows: rows, ts: new Date().toISOString()});

    if (callback) {
      return ContentService.createTextOutput(callback + '(' + json + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return jsonResponse({error: err.message});
  }
}

/* ---- READ leads (Sheet LEADS → ERP Inbox) ---- */
function doGetLeads_(e, perfil) {
  // Segunda linea de defensa: si perfil no viene, exigir authGate
  if(!perfil){ perfil = authGate_(e); if(!perfil) return jsonResponse({error:'no autorizado'}); }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB_LEADS);
  if (!sheet) return jsonResponse({status:'ok', count:0, rows:[]});
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[1]) continue;
    rows.push({
      timestamp: formatDate(row[0]) || String(row[0]||''),
      id:        String(row[1]),
      nombre:    String(row[2]||''),
      correo:    String(row[3]||''),
      telefono:  String(row[4]||''),
      tipo:      String(row[5]||''),
      detalle:   String(row[6]||''),
      urgencia:  String(row[7]||''),
      origen:    String(row[8]||''),
      estado:    String(row[9]||'Nuevo'),
      notas:     String(row[10]||''),
      intermediario: String(row[11]||'')
    });
  }
  // Filtro por rol
  rows = filtrarLeadsPorRol_(rows, perfil);
  rows.sort(function(a,b){return (b.timestamp||'').localeCompare(a.timestamp||'')});
  var callback = (e && e.parameter && e.parameter.callback) ? e.parameter.callback : null;
  var json = JSON.stringify({status:'ok', count:rows.length, rows:rows, ts:new Date().toISOString()});
  if (callback) return ContentService.createTextOutput(callback+'('+json+')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ============================================
   WRITE (ERP → Sheet) + LEADS + NOTIFICACIONES
   ============================================ */
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action  = payload.action || 'add';

    // Actions publicas (no requieren auth, o auth se hace adentro):
    // - 'lead' viene del formulario publico externo (form-web), sin sesion
    // - 'gemini-pdf' es upload de PDF durante cotizacion, cualquier user auth puede
    // - 'usuario-toggle' ya valida requester_email internamente
    var PUBLICAS = {'lead':1, 'gemini-pdf':1, 'usuario-toggle':1};

    var perfil = null;
    if(!PUBLICAS[action]){
      perfil = authGate_(payload);
      if(!perfil) return jsonResponse({error:'no autorizado — email requerido o rol invalido'});
    }

    // Actions SOLO admin/dueno (escritura sensible)
    var SOLO_ADMIN = {
      'liquidacion-update':1,
      'intermediario-add':1,
      'intermediario-update':1,
      'config-set':1,
      'add':1,          // polizas
      'update':1,       // polizas
      'poliza-emitida':1,
      'admin-delete-leads':1
    };
    if(SOLO_ADMIN[action] && !esAdminODuenoRol_(perfil)){
      return jsonResponse({error:'accion permitida solo para admin/dueno'});
    }

    // Actions que asesor puede pero SOLO sobre sus propios registros
    // (la validacion de propiedad se hace dentro de cada handler)
    if (action === 'lead')                 return handleLead_(payload);
    if (action === 'cotizacion-aceptada')  return handleCotAceptada_(payload, perfil);
    if (action === 'liquidacion-update')   return handleLiquidacionUpdate_(payload);
    if (action === 'poliza-emitida')       return handlePolizaEmitida_(payload);
    if (action === 'add')                  return handlePolizaAdd_(payload);
    if (action === 'update')               return handlePolizaUpdate_(payload);
    if (action === 'gemini-pdf')           return handleGeminiPDF_(payload);
    if (action === 'cotizacion-save')      return handleCotizacionSave_(payload, perfil);
    if (action === 'cotizacion-delete')    return handleCotizacionDelete_(payload, perfil);
    if (action === 'cotizacion-ganadora')  return handleCotizacionGanadora_(payload, perfil);
    if (action === 'lead-update')          return handleLeadUpdate_(payload, perfil);
    if (action === 'intermediario-add')    return handleIntermediarioAdd_(payload);
    if (action === 'intermediario-update') return handleIntermediarioUpdate_(payload);
    if (action === 'config-set')           return handleConfigSet_(payload);
    if (action === 'usuario-toggle')       return handleUsuarioToggle_(payload);
    if (action === 'admin-delete-leads')   return handleAdminDeleteLeads_(payload);

    return jsonResponse({error: 'Unknown action: ' + action});
  } catch (err) {
    return jsonResponse({error: err.message});
  }
}

/* Helper: verifica que el lead_id pertenezca al perfil (asesor). Admin/dueno siempre pasa. */
function esMiLead_(lead_id, perfil){
  if(esAdminODuenoRol_(perfil)) return true;
  if(!lead_id) return false;
  var mio = String(perfil.intermediario||'').toLowerCase().trim();
  try{
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName(TAB_LEADS);
    if(!sh) return false;
    var data = sh.getDataRange().getValues();
    for(var i=1;i<data.length;i++){
      if(String(data[i][1]) === String(lead_id)){
        return String(data[i][11]||'').toLowerCase().trim() === mio;
      }
    }
  }catch(e){}
  return false;
}

/* ---- LEADS (form público / manual del ERP) ---- */
function handleLead_(d) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB_LEADS);
  if (!sheet) {
    sheet = ss.insertSheet(TAB_LEADS);
    sheet.getRange(1,1,1,12).setValues([[
      'timestamp','id','nombre','correo','telefono','tipo','detalle','urgencia','origen','estado','notas','intermediario'
    ]]);
    sheet.setFrozenRows(1);
  } else {
    // Migracion: agregar col intermediario si no existe
    var hdr1 = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
    if (hdr1.indexOf('intermediario') < 0) {
      sheet.getRange(1, hdr1.length+1).setValue('intermediario');
    }
  }
  var id = 'LD-' + Utilities.formatDate(new Date(), 'GMT-5', 'yyMMdd-HHmmss');
  var tel = (d.telefono||'').replace(/[^0-9]/g,'');
  var interm = (d.intermediario||'').trim();
  var row = [
    d.fecha || new Date().toISOString(),
    id,
    (d.nombre||'').trim(),
    (d.correo||'').trim(),
    tel,
    d.tipo||'',
    d.detalle||'',
    d.urgencia||'',
    d.origen||'form-web',
    'Nuevo',
    '',
    interm
  ];
  sheet.appendRow(row);
  // Si es un intermediario nuevo, agregarlo al catalogo maestro
  if (interm) ensureIntermediario_(interm);

  // Correo tipo tarjeta HTML a Fabian + copia admin
  try {
    var subject = 'Nuevo lead Aseguralo · ' + row[5] + ' · ' + row[2];
    var detalleHtml = (row[6] || '(sin detalle)').replace(/\n/g, '<br>').replace(/\|/g, ' · ');
    var waLink = 'https://wa.me/57' + row[4];
    var html =
      '<div style="font-family:Manrope,Arial,sans-serif;max-width:560px;margin:0 auto;background:#f5f7fa;padding:20px">' +
        '<div style="background:#304770;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0">' +
          '<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.75">Aseguralo · Nuevo lead</div>' +
          '<div style="font-size:22px;font-weight:800;margin-top:4px">' + row[2] + '</div>' +
          '<div style="font-size:13px;opacity:.85;margin-top:2px">' + row[5] + ' &middot; ' + row[8] + '</div>' +
        '</div>' +
        '<div style="background:#fff;padding:22px;border:1px solid #e4e7ed;border-top:none">' +
          '<table style="width:100%;font-size:14px;color:#0f172a;border-collapse:collapse">' +
            '<tr><td style="padding:8px 0;color:#64748b;width:110px">ID</td><td style="padding:8px 0;font-family:monospace">' + id + '</td></tr>' +
            '<tr><td style="padding:8px 0;color:#64748b">Fecha</td><td style="padding:8px 0">' + row[0] + '</td></tr>' +
            '<tr><td style="padding:8px 0;color:#64748b">Correo</td><td style="padding:8px 0"><a href="mailto:' + row[3] + '" style="color:#45AAFF;text-decoration:none">' + row[3] + '</a></td></tr>' +
            '<tr><td style="padding:8px 0;color:#64748b">WhatsApp</td><td style="padding:8px 0"><a href="' + waLink + '" style="color:#25d366;text-decoration:none;font-weight:600">' + row[4] + '</a></td></tr>' +
            '<tr><td style="padding:8px 0;color:#64748b;vertical-align:top">Detalle</td><td style="padding:8px 0;line-height:1.5">' + detalleHtml + '</td></tr>' +
          '</table>' +
          '<div style="margin-top:20px;display:flex;gap:8px;flex-wrap:wrap">' +
            '<a href="' + waLink + '" style="background:#25d366;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Abrir WhatsApp con el cliente</a>' +
            '<a href="https://7group.site/agente/aseguralo/" style="background:#45AAFF;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Ir al ERP</a>' +
          '</div>' +
        '</div>' +
        '<div style="text-align:center;padding:14px;font-size:11px;color:#94a3b8">Aseguralo · Corredor de Seguros · Bogotá</div>' +
      '</div>';
    MailApp.sendEmail({to: FABIAN_EMAIL, cc: COPIA_ADMIN, subject: subject, htmlBody: html});
  } catch(e){}

  // Confirmación al CLIENTE (si dejo correo válido)
  try {
    if (row[3] && /@/.test(row[3])) {
      var primerNombre = String(row[2]||'').split(/\s+/)[0] || '';
      MailApp.sendEmail({
        to: row[3],
        replyTo: FABIAN_EMAIL,
        name: 'Fabian Carrera - Aseguralo',
        subject: 'Recibimos tu solicitud - Aseguralo',
        body:
          'Hola ' + primerNombre + ',\n\n' +
          'Recibimos tu solicitud de cotización para seguro de ' + row[5] + '.\n\n' +
          'Fabian Carrera te contactará por WhatsApp en menos de 2 horas hábiles con las alternativas disponibles.\n\n' +
          'Si necesitas escribirnos directamente:\n' +
          'WhatsApp: https://wa.me/' + FABIAN_WA + '\n' +
          'Correo: ' + FABIAN_EMAIL + '\n\n' +
          'Gracias por confiar en nosotros.\n\n' +
          '---\nAseguralo · Corredor de Seguros · Bogotá\nID solicitud: ' + id
      });
    }
  } catch(e){}

  telegramNotify_('*Nuevo lead Aseguralo*\n' +
    'Nombre: ' + row[2] + '\n' +
    'Tel: ' + row[4] + '\n' +
    'Tipo: ' + row[5] + '\n' +
    'Detalle: ' + (row[6] || '—') + '\n' +
    'Origen: ' + row[8]);

  return jsonResponse({status: 'ok', id: id});
}

/* ---- COTIZACIÓN ACEPTADA (crea liquidacion + notifica) ---- */
function handleCotAceptada_(d, perfil) {
  if(perfil && !esMiLead_(d.id, perfil)) return jsonResponse({error:'no autorizado sobre este lead'});
  var msg = '*Cotización aceptada · venta ganada*\n' +
    'Cliente: ' + (d.cliente||'') + '\n' +
    'Tipo: ' + (d.tipo||'') + '\n' +
    'Prima: ' + (d.prima||'') + '\n' +
    'Aseguradora: ' + (d.aseguradora||'') + '\n' +
    'Cotización: ' + (d.id||'');
  telegramNotify_(msg);

  // Crear liquidacion automatica
  try {
    var origen = (d.origen||'form-web').toLowerCase();
    // 7GROUP recibe solo si el lead entro por canales de captacion 7group
    var aplica7Group = origen.indexOf('form')>=0 || origen.indexOf('erp')>=0 || origen.indexOf('nuevo')>=0 || origen.indexOf('whatsapp')>=0;
    var pctAseg = COMISION_PCT[d.tipo] || COMISION_PCT['Otro'];
    var prima = Number(d.prima)||0;
    var comAseguralo = Math.round(prima * pctAseg / 100);
    var intermLead = d.intermediario || getIntermediarioDeLead_(d.id) || 'Fabian Carrera';
    crearLiquidacion_({
      lead_id: d.id||'', cliente:d.cliente||'', poliza:'', aseguradora:d.aseguradora||'',
      tipo:d.tipo||'', prima:prima, pct_aseguralo:pctAseg, com_aseguralo:comAseguralo,
      origen: d.origen||'', aplica7Group:aplica7Group,
      intermediario: intermLead
    });
  } catch(e){}

  try {
    MailApp.sendEmail({
      to: FABIAN_EMAIL, cc: COPIA_ADMIN,
      subject: 'Cotización aceptada · ' + (d.cliente||''),
      body: 'El cliente aceptó la cotización.\n\n' +
        'Cotización: ' + (d.id||'') + '\n' +
        'Cliente: ' + (d.cliente||'') + '\n' +
        'Tipo: ' + (d.tipo||'') + '\n' +
        'Aseguradora: ' + (d.aseguradora||'') + '\n' +
        'Prima: ' + (d.prima||'') + '\n\n' +
        'Se creo la liquidacion automatica en la tab LIQUIDACIONES.\n' +
        'Siguiente paso: emitir póliza.'
    });
  } catch(e){}
  return jsonResponse({status: 'ok'});
}

/* ---- PÓLIZA EMITIDA ---- */
function handlePolizaEmitida_(d) {
  var msg = '*Póliza emitida*\n' +
    'No: ' + (d.poliza||'') + '\n' +
    'Cliente: ' + (d.cliente||'') + '\n' +
    'Tipo: ' + (d.tipo||'') + '\n' +
    'Aseguradora: ' + (d.aseguradora||'') + '\n' +
    'Vigencia: ' + (d.desde||'') + ' → ' + (d.hasta||'');
  telegramNotify_(msg);
  try {
    MailApp.sendEmail({
      to: FABIAN_EMAIL, cc: COPIA_ADMIN,
      subject: 'Póliza emitida · ' + (d.poliza||''),
      body: 'Se emitió una nueva póliza.\n\n' +
        'No: ' + (d.poliza||'') + '\n' +
        'Cliente: ' + (d.cliente||'') + '\n' +
        'Tipo: ' + (d.tipo||'') + '\n' +
        'Aseguradora: ' + (d.aseguradora||'') + '\n' +
        'Vigencia: ' + (d.desde||'') + ' a ' + (d.hasta||'')
    });
  } catch(e){}
  return jsonResponse({status: 'ok'});
}

/* ---- ADD nueva póliza (estructura POLRES actual: 33 columnas) ---- */
function handlePolizaAdd_(payload) {
  var sheet = getSheet(TAB_POLRES);
  if (!sheet) return jsonResponse({error: 'Sheet POLRES not found'});

  var colCount = Math.max(sheet.getLastColumn(), 33);
  var newRow = [];
  for (var c = 0; c < colCount; c++) newRow.push('');
  newRow[0]  = payload.aseguradora || 'ALLIANZ';
  newRow[1]  = payload.agente      || 'Fabian Carrera';
  newRow[2]  = payload.ramo        || '';
  newRow[3]  = payload.poliza      || '';
  newRow[4]  = payload.nombre      || '';
  newRow[7]  = payload.telefono    || '';
  newRow[8]  = payload.documento   || '';
  newRow[10] = payload.fnac        || '';
  newRow[20] = payload.desde       || '';
  newRow[21] = payload.hasta       || '';
  newRow[26] = payload.tipo        || '';
  newRow[27] = payload.riesgo      || '';
  newRow[28] = payload.valorAsegurado || 0;
  newRow[29] = payload.prima       || 0;
  newRow[32] = payload.observaciones || '';
  sheet.appendRow(newRow);
  return jsonResponse({status: 'ok', action: 'added', row: sheet.getLastRow()});
}

/* ---- UPDATE póliza existente (busca por col POLIZA = D) ---- */
function handlePolizaUpdate_(payload) {
  var sheet = getSheet(TAB_POLRES);
  if (!sheet) return jsonResponse({error: 'Sheet POLRES not found'});

  var data = sheet.getDataRange().getValues();
  var target = String(payload.poliza).trim();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][3]).trim() === target) {
      var r = i + 1;
      if (payload.nombre         !== undefined) sheet.getRange(r,  5).setValue(payload.nombre);
      if (payload.telefono       !== undefined) sheet.getRange(r,  8).setValue(payload.telefono);
      if (payload.documento      !== undefined) sheet.getRange(r,  9).setValue(payload.documento);
      if (payload.desde          !== undefined) sheet.getRange(r, 21).setValue(payload.desde);
      if (payload.hasta          !== undefined) sheet.getRange(r, 22).setValue(payload.hasta);
      if (payload.anulacion      !== undefined) sheet.getRange(r, 23).setValue(payload.anulacion);
      if (payload.tipo           !== undefined) sheet.getRange(r, 27).setValue(payload.tipo);
      if (payload.riesgo         !== undefined) sheet.getRange(r, 28).setValue(payload.riesgo);
      if (payload.valorAsegurado !== undefined) sheet.getRange(r, 29).setValue(payload.valorAsegurado);
      if (payload.prima          !== undefined) sheet.getRange(r, 30).setValue(payload.prima);
      if (payload.observaciones  !== undefined) sheet.getRange(r, 33).setValue(payload.observaciones);
      return jsonResponse({status: 'ok', action: 'updated', row: r});
    }
  }
  return jsonResponse({error: 'Poliza not found', poliza: target});
}

/* ============================================
   CRON DIARIO — Renovaciones urgentes
   Setup: Apps Script → menú "Triggers" (reloj) →
         Add Trigger → Function: revisarRenovacionesUrgentes
         Event source: Time-driven · Day timer · 7am – 8am
   ============================================ */
function revisarRenovacionesUrgentes() {
  var sheet = getSheet(TAB_POLRES);
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  var hoy = new Date();
  var proximas = [];
  var vencidas = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var poliza = String(row[3]||'').trim();
    if (!poliza) continue;
    if (row[22]) continue; // anulada (col W = FH ANULACION)
    var hasta = row[21];    // col V = FH RENOVACION
    if (!(hasta instanceof Date)) continue;
    var dias = Math.floor((hasta - hoy) / 86400000);
    if (dias >= 0 && dias <= 7) {
      proximas.push({poliza:poliza, cliente:row[4], tel:row[7], dias:dias, hasta:formatDate(hasta)});
    } else if (dias < 0 && dias > -7) {
      vencidas.push({poliza:poliza, cliente:row[4], tel:row[7], dias:dias, hasta:formatDate(hasta)});
    }
  }
  if (!proximas.length && !vencidas.length) return;

  var body = 'Aseguralo · Renovaciones urgentes\n\n';
  if (vencidas.length) {
    body += '=== VENCIDAS (' + vencidas.length + ') ===\n';
    vencidas.forEach(function(r){
      body += '• ' + r.cliente + ' · pol ' + r.poliza + ' · vencida hace ' + Math.abs(r.dias) + 'd · tel ' + r.tel + '\n';
    });
    body += '\n';
  }
  if (proximas.length) {
    body += '=== PRÓXIMAS 7 DÍAS (' + proximas.length + ') ===\n';
    proximas.forEach(function(r){
      body += '• ' + r.cliente + ' · pol ' + r.poliza + ' · vence en ' + r.dias + 'd (' + r.hasta + ') · tel ' + r.tel + '\n';
    });
  }
  try {
    MailApp.sendEmail({
      to: FABIAN_EMAIL, cc: COPIA_ADMIN,
      subject: 'Aseguralo · ' + (vencidas.length + proximas.length) + ' renovaciones urgentes hoy',
      body: body
    });
  } catch(e){}

  telegramNotify_('*Renovaciones urgentes hoy*\n' +
    'Vencidas: ' + vencidas.length + '\n' +
    'Próximas 7 días: ' + proximas.length + '\n\n' +
    'Detalle en correo o abre: https://7group.site/agente/aseguralo/');
}

/* ---- Actualiza campos de un LEAD existente (ej: cambiar estado) ---- */
function handleLeadUpdate_(d, perfil) {
  if(perfil && !esMiLead_(d.id, perfil)) return jsonResponse({error:'no autorizado sobre este lead'});
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB_LEADS);
  if (!sheet) return jsonResponse({error: 'Tab LEADS no existe'});
  var data = sheet.getDataRange().getValues();
  var target = String(d.id || '').trim();
  if (!target) return jsonResponse({error: 'Falta id del lead'});
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === target) {
      var r = i + 1;
      // headers: timestamp(1) id(2) nombre(3) correo(4) telefono(5) tipo(6) detalle(7) urgencia(8) origen(9) estado(10) notas(11)
      if (d.estado   !== undefined) sheet.getRange(r, 10).setValue(d.estado);
      if (d.notas    !== undefined) sheet.getRange(r, 11).setValue(d.notas);
      if (d.detalle  !== undefined) sheet.getRange(r,  7).setValue(d.detalle);
      if (d.correo   !== undefined) sheet.getRange(r,  4).setValue(d.correo);
      return jsonResponse({status: 'ok', row: r});
    }
  }
  return jsonResponse({error: 'Lead no encontrado', id: target});
}

/* ---- OCR de PDFs de cotizaciones via Gemini (proxy server-side) ----
   El ERP manda el PDF en base64 + prompt; nosotros llamamos a Gemini
   y devolvemos el JSON extraido. La API key vive aqui, nunca en el frontend. */
/* Prompt reforzado con instrucciones especificas por aseguradora (dadas por Fabian) */
function promptCotizacionPDF_(basePrompt) {
  var extra = '\n\nINSTRUCCIONES ESPECIFICAS POR ASEGURADORA (importante para extraer bien la prima):\n' +
    '- ALLIANZ: buscar el campo "Anual - Prima total vigencia" o "Prima total vigencia" en la casilla AutosPlus/AutosElite. Suele estar en la hoja 3. Ejemplo esperado: 1930530.\n' +
    '- ALLIANZ + VIDA (estudio de seguro vida deudores u otros vida): el PDF trae 3 planes (Basica / Optima / Superior o equivalentes). Toma los datos de la opcion "OPTIMA" como principal (prima_total, valor_asegurado, coberturas). Guarda las otras 2 opciones en el array "planes_alternos" con nombre y prima. Pon "plan_seleccionado":"Optima". Si el plan Optima no existe con ese nombre, elige el intermedio.\n' +
    '- AXA COLPATRIA (AXXA): buscar "TOTAL A PAGAR EN PESOS". Ejemplo esperado: 1958504.\n' +
    '- SEGUROS DEL ESTADO: buscar "Prima total" en la pagina 3, seccion "seguros elite para carro". Ejemplo esperado: 2439507.\n' +
    '- BMI (BMI Colombia / BMI Companies / seguro deudor vida u otros): buscar "Prima anual", "Valor de la Prima", "Prima total" o "TOTAL A PAGAR". BMI puede traer coberturas de vida + accidentes + enfermedades graves; consolidar la prima total del contrato. Aseguradora identificable por logo/texto "BMI" en encabezado.\n' +
    'Regla general: si hay varias primas (distintos planes), toma la del plan principal cotizado (o "Optima" cuando aplique). Devuelve la prima como numero entero SIN decimales, SIN puntos, SIN comas.\n\n' +
    'COHERENCIA CRITICA de coberturas:\n' +
    '  - Los textos y montos de "coberturas_principales" y "coberturas_detalle" DEBEN ser del mismo plan cuya prima extrajiste. NO mezclar valores de planes distintos (Basica, Optima, Superior).\n' +
    '  - Ejemplo Allianz Vida: si el plan Optima cubre $200M por muerte y el Superior cubre $500M, en las coberturas del Optima debes decir $200M — nunca $500M aunque ese numero aparezca en el mismo PDF.\n' +
    '  - Los montos citados en el texto DEBEN ser coherentes con "valor_asegurado". Si no puedes confirmar el monto exacto del plan seleccionado, mejor omite la cifra y di solo el nombre de la cobertura.\n' +
    '  - Reportar un monto incorrecto genera un error de responsabilidad comercial. Ante duda, se breve.';
  return (basePrompt || 'Analiza este PDF de cotizacion de seguro y devuelve JSON.') + extra;
}

function handleGeminiPDF_(d) {
  try {
    if (!d.pdfBase64) return jsonResponse({error:'Falta pdfBase64'});
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + GEMINI_API_KEY;
    var geminiPayload = {
      contents: [{ parts: [
        { inline_data: { mime_type: 'application/pdf', data: d.pdfBase64 } },
        { text: promptCotizacionPDF_(d.prompt) }
      ]}],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    };
    var payloadStr = JSON.stringify(geminiPayload);
    // Retry hasta 3 veces si Gemini devuelve 503/429 (saturacion)
    var res, code, lastErr = '';
    for (var attempt = 0; attempt < 3; attempt++) {
      res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: payloadStr,
        muteHttpExceptions: true
      });
      code = res.getResponseCode();
      if (code === 200) break;
      lastErr = res.getContentText().substring(0, 300);
      if (code !== 503 && code !== 429) break; // solo reintentar en saturacion
      Utilities.sleep(1500 * (attempt + 1));
    }
    if (code !== 200) return jsonResponse({error: 'Gemini HTTP ' + code, detail: lastErr});
    var j = JSON.parse(res.getContentText());
    var txt = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
    if (!txt) return jsonResponse({error: 'Gemini devolvio respuesta vacia', raw: JSON.stringify(j).substring(0,400)});
    txt = String(txt).replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
    try {
      var parsed = JSON.parse(txt);
      return jsonResponse({status: 'ok', data: parsed});
    } catch (e) {
      return jsonResponse({error: 'JSON invalido de Gemini', raw: txt.substring(0, 400)});
    }
  } catch (err) {
    return jsonResponse({error: err.message || String(err)});
  }
}

/* ============================================
   COTIZACIONES (sync web <-> mobile)
   ============================================ */
function ensureCotsSheet_(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var s = ss.getSheetByName(TAB_COTS);
  if(!s){
    s = ss.insertSheet(TAB_COTS);
    s.getRange(1,1,1,12).setValues([[
      'lead_id','slot','aseguradora','prima','desde','hasta','valor_asegurado','deducible','coberturas','nombre_archivo','ganadora','ts'
    ]]);
    s.setFrozenRows(1);
  }
  return s;
}

function doGetCotizaciones_(e, perfil){
  if(!perfil){ perfil = authGate_(e); if(!perfil) return jsonResponse({error:'no autorizado'}); }
  var s = ensureCotsSheet_();
  var data = s.getDataRange().getValues();
  var rows = [];
  for(var i=1;i<data.length;i++){
    var r = data[i];
    if(!r[0]) continue;
    rows.push({
      lead_id: String(r[0]),
      slot: String(r[1]),
      aseguradora: String(r[2]||''),
      prima: Number(r[3])||0,
      desde: formatDate(r[4]),
      hasta: formatDate(r[5]),
      valor_asegurado: Number(r[6])||0,
      deducible: Number(r[7])||0,
      coberturas: String(r[8]||''),
      nombre_archivo: String(r[9]||''),
      ganadora: !!r[10],
      ts: String(r[11]||'')
    });
  }
  // Filtro por rol: asesor solo ve cotizaciones de sus leads
  if(!esAdminODuenoRol_(perfil)){
    var mio = String(perfil.intermediario||'').toLowerCase().trim();
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName(TAB_LEADS);
    var permitidos = {};
    if(sh){
      var ld = sh.getDataRange().getValues();
      for(var j=1;j<ld.length;j++){
        if(String(ld[j][11]||'').toLowerCase().trim() === mio){
          permitidos[String(ld[j][1])] = true;
        }
      }
    }
    rows = rows.filter(function(r){ return permitidos[r.lead_id]; });
  }
  return jsonResponse({status:'ok', count:rows.length, rows:rows, ts:new Date().toISOString()});
}

/* Guarda/actualiza una cotizacion (por lead_id + slot). */
function handleCotizacionSave_(d, perfil){
  if(perfil && !esMiLead_(d.lead_id, perfil)) return jsonResponse({error:'no autorizado sobre este lead'});
  if(!d.lead_id || !d.slot) return jsonResponse({error:'Falta lead_id o slot'});
  var s = ensureCotsSheet_();
  var data = s.getDataRange().getValues();
  var found = -1;
  for(var i=1;i<data.length;i++){
    if(String(data[i][0])===String(d.lead_id) && String(data[i][1])===String(d.slot)){ found=i+1; break; }
  }
  var row = [
    d.lead_id, d.slot, d.aseguradora||'', Number(d.prima)||0,
    d.desde||'', d.hasta||'',
    Number(d.valor_asegurado||d.valorAsegurado)||0,
    Number(d.deducible)||0,
    d.coberturas||'', d.nombre_archivo||d.nombreArchivo||'',
    d.ganadora?true:false,
    new Date().toISOString()
  ];
  if(found>0){
    s.getRange(found,1,1,12).setValues([row]);
    return jsonResponse({status:'ok', action:'updated', row:found});
  } else {
    s.appendRow(row);
    return jsonResponse({status:'ok', action:'added', row:s.getLastRow()});
  }
}

function handleCotizacionDelete_(d, perfil){
  if(perfil && !esMiLead_(d.lead_id, perfil)) return jsonResponse({error:'no autorizado sobre este lead'});
  if(!d.lead_id || !d.slot) return jsonResponse({error:'Falta lead_id o slot'});
  var s = ensureCotsSheet_();
  var data = s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    if(String(data[i][0])===String(d.lead_id) && String(data[i][1])===String(d.slot)){
      s.deleteRow(i+1);
      return jsonResponse({status:'ok', row:i+1});
    }
  }
  return jsonResponse({error:'No encontrada'});
}

/* Marca UNA cotizacion como ganadora (y quita ganadora de las otras del mismo lead) */
function handleCotizacionGanadora_(d, perfil){
  if(perfil && !esMiLead_(d.lead_id, perfil)) return jsonResponse({error:'no autorizado sobre este lead'});
  if(!d.lead_id) return jsonResponse({error:'Falta lead_id'});
  var s = ensureCotsSheet_();
  var data = s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    if(String(data[i][0])===String(d.lead_id)){
      var esGan = d.slot ? (String(data[i][1])===String(d.slot)) : false;
      s.getRange(i+1, 11).setValue(esGan);
    }
  }
  return jsonResponse({status:'ok'});
}

/* ============================================
   LIQUIDACIONES (comisiones Aseguralo <-> 7GROUP)
   ============================================ */
/* Schema LIQUIDACIONES (25 cols):
   1  id
   2  fecha_venta
   3  lead_id
   4  cliente
   5  poliza
   6  aseguradora
   7  tipo
   8  prima
   9  pct_aseguralo          (pct comision del ramo, ej. 12% Auto)
   10 com_aseguralo          (comision total = prima * pct)
   11 pct_7group             (pct del pool Fabian que va a 7group, segun anio renovacion)
   12 com_7group             (valor 7group)
   13 origen
   14 renovacion             (1 primera, 2+ renovacion N)
   15 estado_pago_aseguralo
   16 fecha_pago_aseguralo
   17 estado_pago_7group
   18 fecha_pago_7group
   -- Desglose asesor / Fabian / sostenimiento --
   19 intermediario          (nombre)
   20 pct_asesor             (% del split hacia el asesor)
   21 com_asesor             (valor asesor)
   22 pct_fabian             (% del split hacia Fabian pool)
   23 com_fabian_bruta       (valor Fabian antes de reparto 7group)
   24 com_fabian_neta        (valor Fabian tras reparto 7group, ANTES de sostenimiento — su 100%)
   25 sostenimiento_pct
   26 sostenimiento_valor
   27 neto_fabian            (com_fabian_neta - sostenimiento_valor)
*/
function ensureLiqsSheet_(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var s = ss.getSheetByName(TAB_LIQS);
  var headers = [
    'id','fecha_venta','lead_id','cliente','poliza','aseguradora','tipo','prima',
    'pct_aseguralo','com_aseguralo','pct_7group','com_7group','origen','renovacion',
    'estado_pago_aseguralo','fecha_pago_aseguralo','estado_pago_7group','fecha_pago_7group',
    'intermediario','pct_asesor','com_asesor','pct_fabian','com_fabian_bruta','com_fabian_neta',
    'sostenimiento_pct','sostenimiento_valor','neto_fabian'
  ];
  if(!s){
    s = ss.insertSheet(TAB_LIQS);
    s.getRange(1,1,1,headers.length).setValues([headers]);
    s.setFrozenRows(1);
    return s;
  }
  // Migracion suave: si faltan cols, extender
  var lc = s.getLastColumn();
  if(lc < headers.length){
    s.getRange(1, lc+1, 1, headers.length - lc).setValues([headers.slice(lc)]);
  }
  return s;
}

/* Cuenta cuantas liquidaciones ya existen para ese lead_id (para saber si es primera o renovacion N) */
function contarLiqsLead_(lead_id){
  if(!lead_id) return 0;
  var s = ensureLiqsSheet_();
  var data = s.getDataRange().getValues();
  var n = 0;
  for(var i=1;i<data.length;i++){
    if(String(data[i][2])===String(lead_id)) n++;
  }
  return n;
}

/* Chequea si ya existe liquidacion para ese lead + poliza (dedupe) */
function existeLiquidacion_(lead_id, poliza){
  if(!lead_id) return false;
  var s = ensureLiqsSheet_();
  var data = s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    if(String(data[i][2])===String(lead_id) && String(data[i][4])===String(poliza||'')) return true;
  }
  return false;
}

/* Devuelve la fila (1-indexed) de una liquidacion sin poliza asignada (esperando el nro real) */
function getLiqSinPoliza_(lead_id){
  if(!lead_id) return 0;
  var s = ensureLiqsSheet_();
  var data = s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    if(String(data[i][2])===String(lead_id) && !String(data[i][4]||'').trim()) return i+1;
  }
  return 0;
}

/* ============================================
   MOTOR DE COMISIONES (cascada + sostenimiento)
   ============================================
   Reparto por poliza:
   1. comisionTotal = prima * pct_ramo
   2. Split intermediario: comAsesor = comTotal * pctAsesor%, comFabianBruta = comTotal * pctFabian%
   3. Sobre comFabianBruta aplica reparto Fabian<->7group segun anio (50/35/25/15 -> Fabian)
      com7Group  = comFabianBruta * pct7group%   ("aplica7Group" = true)
      comFabianNeta = comFabianBruta - com7Group   (esto es el "100% de Fabian")
   4. Sostenimiento = comFabianNeta * pctSostenimiento%
   5. netoFabian = comFabianNeta - sostenimiento
*/
function calcularComision_(intermediarioNombre, prima, pctRamo, numRenov, aplica7Group, pctSostenimiento){
  prima = Number(prima)||0;
  pctRamo = Number(pctRamo)||0;
  numRenov = Number(numRenov)||1;
  pctSostenimiento = Number(pctSostenimiento);
  if(isNaN(pctSostenimiento)) pctSostenimiento = getConfigNumber_('sostenimiento_pct', 35);

  var comTotal = Math.round(prima * pctRamo / 100);

  var cfg = getIntermediarioConfig_(intermediarioNombre) || {pctAsesor:100, pctFabian:0, tipo:'asesor'};
  var pctAsesor = cfg.pctAsesor, pctFabian = cfg.pctFabian;

  var comAsesor      = Math.round(comTotal * pctAsesor / 100);
  var comFabianBruta = Math.round(comTotal * pctFabian / 100);

  // Regla dueno: si el intermediario es el mismo Fabian, TODO va al pool Fabian (aunque pct_asesor=100)
  if(cfg.tipo === 'dueno'){
    comFabianBruta = comTotal;
    comAsesor = 0;
  }
  // Regla referido_admin (Andres = 7group): su %asesor va al pool 7group como referido directo
  // (no al asesor persona) — pero se guarda como comAsesor para trazabilidad y el consumer decide
  // como agregarlo. El %fabian igual entra al pool de Fabian.

  // Reparto Fabian <-> 7group sobre comFabianBruta
  // El split asesor/Fabian queda FIJO ano tras ano (Erika siempre 70/30).
  // Pero el %Fabian (ej. ese 30%) se convierte en "su 100%" y sobre eso aplica la
  // cascada 50/35/25/15 con 7GROUP segun renovacion (ano 1 = 50/50, ano 2 = 65/35, etc.)
  var pct7 = aplica7Group ? pct7GroupPorRenovacion_(numRenov) : 0;
  var com7Group      = Math.round(comFabianBruta * pct7 / 100);
  var comFabianNeta  = comFabianBruta - com7Group;  // el "100% de Fabian" tras 7group

  // Sostenimiento sobre el 100% de Fabian
  var sosten = Math.round(comFabianNeta * pctSostenimiento / 100);
  var netoFabian = comFabianNeta - sosten;

  return {
    comTotal: comTotal,
    pctAsesor: pctAsesor, comAsesor: comAsesor,
    pctFabian: pctFabian, comFabianBruta: comFabianBruta,
    pct7Group: pct7,      com7Group: com7Group,
    comFabianNeta: comFabianNeta,
    sostenimientoPct: pctSostenimiento, sostenimientoValor: sosten,
    netoFabian: netoFabian
  };
}

function crearLiquidacion_(d){
  var s = ensureLiqsSheet_();
  var id = 'LQ-' + Utilities.formatDate(new Date(), 'GMT-5', 'yyMMdd-HHmmss');
  var numRenov = Number(d.renovacion) || (contarLiqsLead_(d.lead_id) + 1);
  var interm = d.intermediario || 'Fabian Carrera';
  var aplica7 = d.aplica7Group !== false; // default true

  var calc = calcularComision_(interm, d.prima, d.pct_aseguralo, numRenov, aplica7, d.sostenimiento_pct);

  s.appendRow([
    id, new Date().toISOString(), d.lead_id||'', d.cliente||'', d.poliza||'',
    d.aseguradora||'', d.tipo||'', Number(d.prima)||0,
    Number(d.pct_aseguralo)||0, calc.comTotal,
    calc.pct7Group, calc.com7Group,
    d.origen||'', numRenov,
    'pendiente', '',
    aplica7?'pendiente':'no-aplica', '',
    interm, calc.pctAsesor, calc.comAsesor, calc.pctFabian, calc.comFabianBruta,
    calc.comFabianNeta, calc.sostenimientoPct, calc.sostenimientoValor, calc.netoFabian
  ]);
  return Object.assign({id:id, num_renovacion:numRenov}, calc);
}

function doGetLiquidaciones_(e, perfil){
  if(!perfil){ perfil = authGate_(e); if(!perfil) return jsonResponse({error:'no autorizado'}); }
  var s = ensureLiqsSheet_();
  var data = s.getDataRange().getValues();
  var rows = [];
  for(var i=1;i<data.length;i++){
    var r = data[i];
    if(!r[0]) continue;
    rows.push({
      id:String(r[0]), fecha_venta:formatDate(r[1])||String(r[1]||''),
      lead_id:String(r[2]||''), cliente:String(r[3]||''),
      poliza:String(r[4]||''), aseguradora:String(r[5]||''),
      tipo:String(r[6]||''), prima:Number(r[7])||0,
      pct_aseguralo:Number(r[8])||0, com_aseguralo:Number(r[9])||0,
      pct_7group:Number(r[10])||0, com_7group:Number(r[11])||0,
      origen:String(r[12]||''),
      renovacion:Number(r[13])||1,
      estado_pago_aseguralo:String(r[14]||'pendiente'),
      fecha_pago_aseguralo:formatDate(r[15])||'',
      estado_pago_7group:String(r[16]||'pendiente'),
      fecha_pago_7group:formatDate(r[17])||'',
      intermediario:String(r[18]||''),
      pct_asesor:Number(r[19])||0,
      com_asesor:Number(r[20])||0,
      pct_fabian:Number(r[21])||0,
      com_fabian_bruta:Number(r[22])||0,
      com_fabian_neta:Number(r[23])||0,
      sostenimiento_pct:Number(r[24])||0,
      sostenimiento_valor:Number(r[25])||0,
      neto_fabian:Number(r[26])||0
    });
  }
  // Filtro por rol
  rows = filtrarLiqsPorRol_(rows, perfil);
  // orden fecha DESC
  rows.sort(function(a,b){return (b.fecha_venta||'').localeCompare(a.fecha_venta||'')});
  return jsonResponse({status:'ok', count:rows.length, rows:rows});
}

/* Actualiza estados de pago de una liquidacion */
function handleLiquidacionUpdate_(d){
  if(!d.id) return jsonResponse({error:'Falta id'});
  var s = ensureLiqsSheet_();
  var data = s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    if(String(data[i][0])===String(d.id)){
      var r = i+1;
      if(d.estado_pago_aseguralo!==undefined){
        s.getRange(r,15).setValue(d.estado_pago_aseguralo);
        if(d.estado_pago_aseguralo==='cobrado' && !data[i][15]) s.getRange(r,16).setValue(new Date().toISOString().slice(0,10));
      }
      if(d.estado_pago_7group!==undefined){
        s.getRange(r,17).setValue(d.estado_pago_7group);
        if(d.estado_pago_7group==='pagado' && !data[i][17]){
          s.getRange(r,18).setValue(new Date().toISOString().slice(0,10));
          // Notificar a 7GROUP por Telegram
          try {
            telegramNotify_('*Pago 7GROUP recibido*\n'+
              'Cliente: '+String(data[i][3])+'\n'+
              'Monto: $'+Number(data[i][11]).toLocaleString('es-CO')+'\n'+
              'Liquidacion: '+String(data[i][0]));
          } catch(e){}
        }
      }
      if(d.poliza!==undefined) s.getRange(r,5).setValue(d.poliza);
      return jsonResponse({status:'ok',row:r});
    }
  }
  return jsonResponse({error:'Liquidacion no encontrada',id:d.id});
}

/* ============================================
   DETECTOR AUTOMATICO DE VENTAS 7GROUP (blindaje)
   Corre diariamente via trigger. Cruza POLRES <-> LEADS 7GROUP.
   Si detecta un cliente 7GROUP con poliza registrada y sin liquidacion,
   la crea automatico + notifica Telegram.
   ============================================ */
function normalizarStr_(s){
  return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
}
function normalizarTel_(s){
  var t = String(s||'').replace(/[^0-9]/g,'');
  return t.length>=10 ? t.slice(-10) : t;
}
function normalizarDoc_(s){
  return String(s||'').replace(/[^0-9]/g,'');
}
function matchLeadPoliza_(lead, polNombre, polDoc, polTel){
  var puntos = 0;
  // Match doc (fuerte)
  if(lead.documento && normalizarDoc_(lead.documento) === normalizarDoc_(polDoc)) puntos += 2;
  // Match telefono (medio)
  if(lead.telefono && normalizarTel_(lead.telefono) === normalizarTel_(polTel)) puntos += 1;
  // Match nombre normalizado (contiene o exacto)
  if(lead.nombre && polNombre){
    var n1 = normalizarStr_(lead.nombre), n2 = normalizarStr_(polNombre);
    if(n1 && n2){
      if(n1===n2) puntos += 2;
      else if(n1.indexOf(n2)>=0 || n2.indexOf(n1)>=0) puntos += 1;
    }
  }
  return puntos >= 2; // umbral: 2 senales concordantes = match seguro
}

function detectarVentasAutomaticas(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sPol = ss.getSheetByName(TAB_POLRES);
  var sLeads = ss.getSheetByName(TAB_LEADS);
  if(!sPol || !sLeads){ Logger.log('POLRES o LEADS no existen'); return; }

  var polData = sPol.getDataRange().getValues();
  var leadData = sLeads.getDataRange().getValues();

  // Leads 7GROUP (origen: form-web / erp / whatsapp / nuevo)
  var leads7G = [];
  for(var i=1;i<leadData.length;i++){
    var r = leadData[i]; if(!r[1]) continue;
    var origen = String(r[8]||'').toLowerCase();
    if(origen.indexOf('form')<0 && origen.indexOf('erp')<0 && origen.indexOf('whatsapp')<0 && origen.indexOf('nuevo')<0) continue;
    leads7G.push({
      id:String(r[1]), nombre:String(r[2]||''), correo:String(r[3]||''),
      telefono:String(r[4]||''), tipo:String(r[5]||''), origen:origen,
      documento:'', // los leads no siempre tienen doc, se rellena por telefono/nombre
      intermediario: String(r[11]||'Fabian Carrera')
    });
  }
  if(!leads7G.length){ Logger.log('No hay leads 7GROUP'); return; }

  var creadas = 0, ya = 0;
  var hoy = new Date();
  var haceMeses = new Date(hoy.getTime() - 6*30*86400000); // 6 meses atras

  for(var j=1;j<polData.length;j++){
    var row = polData[j];
    var poliza = String(row[3]||'').trim(); if(!poliza) continue;
    // POLRES columnas: 0 aseguradora, 1 agente, 2 ramo, 3 poliza, 4 nombre, 7 tel, 8 doc, 20 desde, 21 hasta, 22 anulada, 26 tipo, 29 prima
    if(row[22]) continue; // anulada
    var desde = row[20];
    if(desde instanceof Date && desde < haceMeses) continue; // solo polizas recientes
    var polNombre = String(row[4]||'');
    var polDoc    = String(row[8]||'');
    var polTel    = String(row[7]||'');
    var aseguradora = String(row[0]||'');
    var tipo = String(row[2]||row[26]||''); // ramo o tipo
    var prima = Number(row[29])||0;

    // Cruzar contra cada lead 7GROUP
    for(var k=0;k<leads7G.length;k++){
      var lead = leads7G[k];
      if(!matchLeadPoliza_(lead, polNombre, polDoc, polTel)) continue;
      // Ya existe liquidacion para este lead+poliza exacta? Skip.
      if(existeLiquidacion_(lead.id, poliza)){ ya++; break; }
      // Existe liquidacion previa SIN poliza asignada? (creada por handleCotAceptada). UPDATE con poliza real.
      var filaPendiente = getLiqSinPoliza_(lead.id);
      if(filaPendiente){
        var sLiq = ensureLiqsSheet_();
        sLiq.getRange(filaPendiente, 5).setValue(poliza); // col poliza
        // actualizar prima real si difiere significativamente
        sLiq.getRange(filaPendiente, 8).setValue(prima);
        var pctAsegE = COMISION_PCT[tipo] || COMISION_PCT['Otro'];
        var comAsegE = Math.round(prima * pctAsegE / 100);
        sLiq.getRange(filaPendiente, 9).setValue(pctAsegE);
        sLiq.getRange(filaPendiente,10).setValue(comAsegE);
        // recalcular com_7group
        var pct7E = Number(sLiq.getRange(filaPendiente,11).getValue())||0;
        sLiq.getRange(filaPendiente,12).setValue(Math.round(comAsegE * pct7E / 100));
        creadas++;
        telegramNotify_('*Poliza asociada a liquidacion 7GROUP*\n'+
          'Cliente: '+polNombre+'\nPoliza: '+poliza+'\nAseguradora: '+aseguradora+'\nPrima: $'+prima.toLocaleString('es-CO'));
        break;
      }
      // No existia liquidacion previa -> crear nueva (asesor no marco pero SI registro poliza)
      var pctAseg = COMISION_PCT[tipo] || COMISION_PCT['Otro'];
      var comAseg = Math.round(prima * pctAseg / 100);
      var res = crearLiquidacion_({
        lead_id: lead.id, cliente: polNombre, poliza: poliza,
        aseguradora: aseguradora, tipo: tipo, prima: prima,
        pct_aseguralo: pctAseg, com_aseguralo: comAseg,
        origen: lead.origen + ' [auto-detectado POLRES]',
        aplica7Group: true,
        intermediario: lead.intermediario || 'Fabian Carrera'
      });
      creadas++;
      telegramNotify_('*Venta 7GROUP detectada automaticamente (asesor no marco)*\n' +
        'Cliente: ' + polNombre + '\nPoliza: ' + poliza + '\nAseguradora: ' + aseguradora + '\n' +
        'Prima: $' + prima.toLocaleString('es-CO') + '\n' +
        'Comision 7GROUP: $' + (res.com7Group||0).toLocaleString('es-CO') + ' (' + res.pct7Group + '% - reno ' + res.num_renovacion + ')\n' +
        'ALERTA: el asesor no la marco manualmente. Detectada por cross-match diario.');
      break;
    }
  }
  Logger.log('Detector: ' + creadas + ' liquidaciones creadas/actualizadas, ' + ya + ' ya existian');
  return {creadas:creadas, existentes:ya};
}

/* ============================================
   HELPERS
   ============================================ */
function telegramNotify_(msg) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'post',
      payload: {chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown'},
      muteHttpExceptions: true
    });
  } catch(e){}
}

function formatDate(v) {
  if (!v) return '';
  if (v instanceof Date) {
    var y = v.getFullYear();
    var m = String(v.getMonth() + 1).padStart(2, '0');
    var d = String(v.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  var s = String(v);
  var parts = s.split('/');
  if (parts.length === 3) return parts[2] + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0');
  return s;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function testAccess() {
  var sheet = getSheet(TAB_POLRES);
  Logger.log('Sheet: ' + (sheet ? sheet.getName() : 'NOT FOUND'));
  Logger.log('Rows: ' + sheet.getLastRow());
  Logger.log('Cols: ' + sheet.getLastColumn());
  Logger.log('First poliza (D2): ' + sheet.getRange(2, 4).getValue());
  Logger.log('First nombre (E2): ' + sheet.getRange(2, 5).getValue());
  Logger.log('First tel (H2): ' + sheet.getRange(2, 8).getValue());
}

function testTelegram() {
  telegramNotify_('Prueba de notificación Aseguralo · ' + new Date().toISOString());
}

/* ============================================
   LIMPIEZA DE TESTS (correr 1 sola vez desde editor)
   Borra:
   - LEADS con origen 'debug' o nombre en la lista de tests
   - COTIZACIONES asociadas a esos LEADS
   - LIQUIDACIONES asociadas a esos LEADS
   ============================================ */
/* ============================================
   ADMIN DELETE LEADS (borra leads seleccionados + cotizaciones + liquidaciones)
   Payload: { ids: ['LD-...', 'LD-...'] }
   Requiere admin/dueno (validado en doPost)
   ============================================ */
function handleAdminDeleteLeads_(d){
  var ids = Array.isArray(d.ids) ? d.ids.map(String) : [];
  if(!ids.length) return jsonResponse({error:'array ids requerido'});
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var out = {leads:0, cots:0, liqs:0, ids:ids};

  // LEADS
  var sLeads = ss.getSheetByName(TAB_LEADS);
  if(sLeads){
    var data = sLeads.getDataRange().getValues();
    var filas = [];
    for(var i=1;i<data.length;i++){
      if(ids.indexOf(String(data[i][1]||'')) >= 0) filas.push(i+1);
    }
    filas.sort(function(a,b){return b-a;}).forEach(function(f){ sLeads.deleteRow(f); out.leads++; });
  }
  // COTIZACIONES (col 0 = lead_id)
  var sCots = ss.getSheetByName(TAB_COTS);
  if(sCots){
    var data = sCots.getDataRange().getValues();
    var filas = [];
    for(var i=1;i<data.length;i++){
      if(ids.indexOf(String(data[i][0]||'')) >= 0) filas.push(i+1);
    }
    filas.sort(function(a,b){return b-a;}).forEach(function(f){ sCots.deleteRow(f); out.cots++; });
  }
  // LIQUIDACIONES (col 2 = lead_id)
  var sLiq = ss.getSheetByName(TAB_LIQS);
  if(sLiq){
    var data = sLiq.getDataRange().getValues();
    var filas = [];
    for(var i=1;i<data.length;i++){
      if(ids.indexOf(String(data[i][2]||'')) >= 0) filas.push(i+1);
    }
    filas.sort(function(a,b){return b-a;}).forEach(function(f){ sLiq.deleteRow(f); out.liqs++; });
  }
  return jsonResponse({status:'ok', borrados:out});
}

function limpiarTests_(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sLeads = ss.getSheetByName(TAB_LEADS);
  if(!sLeads){ Logger.log('LEADS no existe'); return; }

  // Nombres considerados tests (case-insensitive, comparacion exacta tras trim)
  var TEST_NAMES = ['juan andres aparicio', 'andres aparicio', 'test debug'];
  var TEST_IDS_MANUAL = []; // agregar IDs especificos si hace falta
  var data = sLeads.getDataRange().getValues();
  var idsBorrar = [];
  var filasBorrar = []; // fila 1-indexed

  for(var i=1; i<data.length; i++){
    var r = data[i];
    var id = String(r[1]||'');
    var nombre = String(r[2]||'').toLowerCase().trim();
    var origen = String(r[8]||'').toLowerCase().trim();
    var esTest = origen === 'debug' ||
                 TEST_NAMES.indexOf(nombre) >= 0 ||
                 TEST_IDS_MANUAL.indexOf(id) >= 0;
    if(esTest){
      idsBorrar.push(id);
      filasBorrar.push(i+1); // 1-indexed
    }
  }

  Logger.log('LEADS a borrar (' + idsBorrar.length + '): ' + idsBorrar.join(', '));

  // Borrar de LEADS (de abajo hacia arriba para no descuadrar indices)
  filasBorrar.sort(function(a,b){return b-a;}).forEach(function(f){ sLeads.deleteRow(f); });

  // Borrar COTIZACIONES asociadas
  var sCots = ss.getSheetByName(TAB_COTS);
  if(sCots){
    var cd = sCots.getDataRange().getValues();
    var borrCots = [];
    for(var j=1; j<cd.length; j++){
      if(idsBorrar.indexOf(String(cd[j][0]||'')) >= 0) borrCots.push(j+1);
    }
    borrCots.sort(function(a,b){return b-a;}).forEach(function(f){ sCots.deleteRow(f); });
    Logger.log('COTIZACIONES borradas: ' + borrCots.length);
  }

  // Borrar LIQUIDACIONES asociadas
  var sLiq = ss.getSheetByName(TAB_LIQS);
  if(sLiq){
    var ld = sLiq.getDataRange().getValues();
    var borrLiq = [];
    for(var k=1; k<ld.length; k++){
      // col 3 (index 2) es lead_id en LIQUIDACIONES
      if(idsBorrar.indexOf(String(ld[k][2]||'')) >= 0) borrLiq.push(k+1);
    }
    borrLiq.sort(function(a,b){return b-a;}).forEach(function(f){ sLiq.deleteRow(f); });
    Logger.log('LIQUIDACIONES borradas: ' + borrLiq.length);
  }

  Logger.log('Limpieza completada.');
  return {leads: idsBorrar.length, ids: idsBorrar};
}

/* ============================================
   INTERMEDIARIOS (catalogo maestro con % configurables)
   Columnas: nombre | activo | pct_asesor | pct_fabian | tipo | email_login | ts
   tipo: 'dueno' | 'asesor' | 'referido_admin' (Andres = 7group)
   ============================================ */
var TAB_INTERMED = 'INTERMEDIARIOS';
/* Semilla oficial segun tabla de la instruccion */
var INTERMED_SEMILLA = [
  { nombre:'Fabian Carrera',  pctAsesor:100, pctFabian:0,  tipo:'dueno',          email:'aseguralo@outlook.com' },
  { nombre:'Monica Torres',   pctAsesor:100, pctFabian:0,  tipo:'asesor',         email:'' },
  { nombre:'Judith Neira',    pctAsesor:100, pctFabian:0,  tipo:'asesor',         email:'' },
  { nombre:'Erika Pinzon',    pctAsesor:70,  pctFabian:30, tipo:'asesor',         email:'' },
  { nombre:'Sandra Marin',    pctAsesor:60,  pctFabian:40, tipo:'asesor',         email:'' },
  { nombre:'Andres Aparicio', pctAsesor:50,  pctFabian:50, tipo:'referido_admin', email:'andresapal@gmail.com' }
];

function ensureIntermediariosSheet_(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var s = ss.getSheetByName(TAB_INTERMED);
  if(!s){
    s = ss.insertSheet(TAB_INTERMED);
    s.getRange(1,1,1,7).setValues([['nombre','activo','pct_asesor','pct_fabian','tipo','email_login','ts']]);
    s.setFrozenRows(1);
    var seed = INTERMED_SEMILLA.map(function(x){
      return [x.nombre,'si',x.pctAsesor,x.pctFabian,x.tipo,x.email,new Date().toISOString()];
    });
    s.getRange(2,1,seed.length,7).setValues(seed);
    return s;
  }
  // Migracion: asegurar 7 cols
  var hdr = s.getRange(1,1,1,Math.max(s.getLastColumn(),1)).getValues()[0];
  var expected = ['nombre','activo','pct_asesor','pct_fabian','tipo','email_login','ts'];
  var needsMig = expected.some(function(h,i){ return hdr[i]!==h; });
  if(needsMig){
    // Backup nombres existentes (col 1)
    var existentes = s.getLastRow()>1
      ? s.getRange(2,1,s.getLastRow()-1,1).getValues().map(function(r){return String(r[0]||'').trim();}).filter(Boolean)
      : [];
    s.clear();
    s.getRange(1,1,1,7).setValues([expected]);
    s.setFrozenRows(1);
    // Reponer semilla + preservar los que ya estaban (con defaults)
    var seed = INTERMED_SEMILLA.map(function(x){
      return [x.nombre,'si',x.pctAsesor,x.pctFabian,x.tipo,x.email,new Date().toISOString()];
    });
    var seedNames = INTERMED_SEMILLA.map(function(x){return x.nombre.toLowerCase();});
    existentes.forEach(function(n){
      if(seedNames.indexOf(n.toLowerCase())<0){
        seed.push([n,'si',100,0,'asesor','',new Date().toISOString()]);
      }
    });
    s.getRange(2,1,seed.length,7).setValues(seed);
  }
  return s;
}

/* Lee el catalogo. Admin/dueno ve todo. Asesor solo su propio registro + lista de nombres (para dropdowns). */
function doGetIntermediarios_(e, perfil){
  if(!perfil){ perfil = authGate_(e); if(!perfil) return jsonResponse({error:'no autorizado'}); }
  var s = ensureIntermediariosSheet_();
  var data = s.getDataRange().getValues();
  var full = [];
  var names = [];
  var mio = String(perfil.intermediario||'').toLowerCase().trim();
  var esAdminD = esAdminODuenoRol_(perfil);
  for(var i=1;i<data.length;i++){
    var n = String(data[i][0]||'').trim();
    if(!n) continue;
    var act = String(data[i][1]||'si').toLowerCase();
    var o = {
      nombre: n,
      activo: act,
      pctAsesor: Number(data[i][2])||0,
      pctFabian: Number(data[i][3])||0,
      tipo: String(data[i][4]||'asesor'),
      email: esAdminD ? String(data[i][5]||'') : '' // asesor no ve emails de otros
    };
    // Asesor solo ve su propio registro completo. Los nombres siguen expuestos (para dropdowns).
    if(esAdminD || n.toLowerCase().trim() === mio){ full.push(o); }
    if(act!=='no') names.push(n);
  }
  var json = JSON.stringify({status:'ok', rows:names, full:full, ts:new Date().toISOString()});
  var cb = (e&&e.parameter&&e.parameter.callback)||null;
  if(cb) return ContentService.createTextOutput(cb+'('+json+')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* Agrega intermediario si no existe (default 100/0, tipo asesor) */
function ensureIntermediario_(nombre){
  nombre = String(nombre||'').trim(); if(!nombre) return;
  var s = ensureIntermediariosSheet_();
  var data = s.getDataRange().getValues();
  var normNew = nombre.toLowerCase();
  for(var i=1;i<data.length;i++){
    if(String(data[i][0]||'').trim().toLowerCase() === normNew) return;
  }
  s.appendRow([nombre, 'si', 100, 0, 'asesor', '', new Date().toISOString()]);
}

function handleIntermediarioAdd_(d){
  var nombre = String(d.nombre||'').trim();
  if(!nombre) return jsonResponse({error:'nombre requerido'});
  ensureIntermediario_(nombre);
  return jsonResponse({status:'ok', nombre:nombre});
}

/* Actualiza campos de un intermediario existente (por nombre) */
/* ============================================
   PERMISOS Y USUARIOS (rol basado en email)
   ============================================ */
var ADMIN_EMAILS = ['andresapal@gmail.com','andresapalt@gmail.com','7groupcorp@zohomail.com'];

/* Deriva el rol del usuario a partir del email:
   - admin: 7GROUP (Andres, admin email)
   - dueno: Fabian (email en INTERMEDIARIOS con tipo=dueno)
   - asesor: cualquier intermediario con tipo=asesor y activo=si
   - anonimo: sin match */
function getRolYPerfil_(email){
  email = String(email||'').trim().toLowerCase();
  var perfil = {
    email: email, rol: 'anonimo', nombre: '', tipo: '', activo: 'no',
    intermediario: '', permisos: {}
  };
  if(!email) return perfil;

  // Admin fijo (7GROUP)
  if(ADMIN_EMAILS.indexOf(email) >= 0){
    perfil.rol = 'admin';
    perfil.nombre = '7Group';
    perfil.tipo = 'admin';
    perfil.activo = 'si';
    perfil.intermediario = 'Andres Aparicio';
    perfil.permisos = permisosPorRol_('admin');
    return perfil;
  }

  // Buscar en INTERMEDIARIOS por email_login
  var s = ensureIntermediariosSheet_();
  var data = s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    var em = String(data[i][5]||'').trim().toLowerCase();
    if(em === email){
      perfil.nombre = String(data[i][0]||'');
      perfil.tipo = String(data[i][4]||'asesor');
      perfil.activo = String(data[i][1]||'no').toLowerCase();
      perfil.intermediario = perfil.nombre;
      perfil.rol = (perfil.tipo === 'dueno') ? 'dueno'
                  : (perfil.tipo === 'referido_admin') ? 'admin'
                  : 'asesor';
      perfil.permisos = permisosPorRol_(perfil.rol);
      return perfil;
    }
  }
  return perfil;
}

/* Matriz de permisos por rol (extensible desde tab PERMISOS si se crea en el futuro).
   Devuelve flags booleanos que el frontend usa para mostrar/ocultar UI. */
function permisosPorRol_(rol){
  var base = {
    verTodo: false, editarConfig: false, gestionarUsuarios: false,
    verDashboardCompleto: false, verComisionesDetalle: false, verSostenimiento: false,
    editarPctIntermediarios: false, verFacturacion: false, verRenovaciones: false,
    verSiniestros: false, verClientes: false, verPolizasTodas: false,
    verLeadsTodos: false, verLiquidacionesTodas: false,
    marcarLiquidacionPagada: false, subirPDFCotizacion: true
  };
  if(rol === 'admin' || rol === 'dueno'){
    Object.keys(base).forEach(function(k){ base[k] = true; });
  } else if(rol === 'asesor'){
    // Ve solo su propia info; sin config/admin.
    base.verFacturacion = false;
    base.verRenovaciones = true;   // propias
    base.verSiniestros = true;     // propios
    base.verClientes = true;       // propios
  }
  return base;
}

function doGetMe_(e){
  var email = (e && e.parameter && e.parameter.email) || '';
  var perfil = getRolYPerfil_(email);
  var json = JSON.stringify({status:'ok', perfil:perfil, ts:new Date().toISOString()});
  var cb = (e && e.parameter && e.parameter.callback) || null;
  if(cb) return ContentService.createTextOutput(cb+'('+json+')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* Solo admin/dueno puede activar/desactivar usuarios por email.
   Requerimos que el request incluya el email del solicitante para validar. */
function handleUsuarioToggle_(d){
  // Acepta 'email' (inyectado por interceptor) o 'requester_email' (compat)
  var requesterEmail = String(d.email || d.requester_email || '').toLowerCase();
  var req = getRolYPerfil_(requesterEmail);
  if(req.rol !== 'admin' && req.rol !== 'dueno'){
    return jsonResponse({error:'Sin permiso: solo admin/dueno puede gestionar usuarios'});
  }
  var targetNombre = String(d.nombre||'').trim();
  var nuevoActivo = String(d.activo||'si').toLowerCase();
  if(!targetNombre) return jsonResponse({error:'nombre requerido'});
  if(['si','no'].indexOf(nuevoActivo)<0) return jsonResponse({error:'activo debe ser si/no'});

  var s = ensureIntermediariosSheet_();
  var data = s.getDataRange().getValues();
  var norm = targetNombre.toLowerCase();
  for(var i=1;i<data.length;i++){
    if(String(data[i][0]||'').trim().toLowerCase() === norm){
      s.getRange(i+1, 2).setValue(nuevoActivo);
      s.getRange(i+1, 7).setValue(new Date().toISOString());
      _CACHE_INTERM = null;
      return jsonResponse({status:'ok', nombre:targetNombre, activo:nuevoActivo});
    }
  }
  return jsonResponse({error:'no encontrado: '+targetNombre});
}

function handleIntermediarioUpdate_(d){
  var nombre = String(d.nombre||'').trim();
  if(!nombre) return jsonResponse({error:'nombre requerido'});
  var s = ensureIntermediariosSheet_();
  var data = s.getDataRange().getValues();
  var norm = nombre.toLowerCase();
  for(var i=1;i<data.length;i++){
    if(String(data[i][0]||'').trim().toLowerCase() === norm){
      var row = i+1;
      if(d.activo!==undefined)    s.getRange(row,2).setValue(d.activo);
      if(d.pctAsesor!==undefined) s.getRange(row,3).setValue(Number(d.pctAsesor)||0);
      if(d.pctFabian!==undefined) s.getRange(row,4).setValue(Number(d.pctFabian)||0);
      if(d.tipo!==undefined)      s.getRange(row,5).setValue(d.tipo);
      if(d.email!==undefined)     s.getRange(row,6).setValue(d.email);
      s.getRange(row,7).setValue(new Date().toISOString());
      _CACHE_INTERM = null;
      return jsonResponse({status:'ok', nombre:nombre});
    }
  }
  return jsonResponse({error:'no encontrado: '+nombre});
}

/* ============================================
   CONFIG (parametros globales editables: sostenimiento_pct, etc.)
   ============================================ */
var TAB_CONFIG = 'CONFIG';
var CONFIG_SEED = [
  ['sostenimiento_pct', '35', 'Gastos de sostenimiento/admin de Aseguralo (% sobre comision neta Fabian)']
];

function ensureConfigSheet_(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var s = ss.getSheetByName(TAB_CONFIG);
  if(!s){
    s = ss.insertSheet(TAB_CONFIG);
    s.getRange(1,1,1,3).setValues([['clave','valor','descripcion']]);
    s.setFrozenRows(1);
    s.getRange(2,1,CONFIG_SEED.length,3).setValues(CONFIG_SEED);
  }
  return s;
}
function doGetConfig_(e){
  var s = ensureConfigSheet_();
  var data = s.getDataRange().getValues();
  var out = {};
  for(var i=1;i<data.length;i++){
    var k = String(data[i][0]||'').trim();
    if(k) out[k] = String(data[i][1]||'');
  }
  var json = JSON.stringify({status:'ok', config:out, ts:new Date().toISOString()});
  var cb = (e&&e.parameter&&e.parameter.callback)||null;
  if(cb) return ContentService.createTextOutput(cb+'('+json+')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
function handleConfigSet_(d){
  var k = String(d.clave||'').trim();
  if(!k) return jsonResponse({error:'clave requerida'});
  var s = ensureConfigSheet_();
  var data = s.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    if(String(data[i][0]||'').trim() === k){
      s.getRange(i+1,2).setValue(String(d.valor||''));
      _CACHE_CONFIG = null;
      return jsonResponse({status:'ok', clave:k, valor:String(d.valor||'')});
    }
  }
  s.appendRow([k, String(d.valor||''), String(d.descripcion||'')]);
  _CACHE_CONFIG = null;
  return jsonResponse({status:'ok', clave:k, valor:String(d.valor||''), nuevo:true});
}
var _CACHE_CONFIG = null;
function getConfigNumber_(clave, defVal){
  if(!_CACHE_CONFIG){
    var s = ensureConfigSheet_();
    var data = s.getDataRange().getValues();
    _CACHE_CONFIG = {};
    for(var i=1;i<data.length;i++){
      _CACHE_CONFIG[String(data[i][0]||'').trim()] = String(data[i][1]||'');
    }
  }
  var v = _CACHE_CONFIG[clave];
  if(v===undefined || v==='') return defVal;
  var n = Number(v);
  return isNaN(n) ? defVal : n;
}

/* Cache en memoria del proceso (invalidada por handleIntermediarioUpdate_) */
var _CACHE_INTERM = null;
function getIntermediarioConfig_(nombre){
  if(!_CACHE_INTERM){
    var s = ensureIntermediariosSheet_();
    var data = s.getDataRange().getValues();
    _CACHE_INTERM = {};
    for(var i=1;i<data.length;i++){
      var n = String(data[i][0]||'').trim();
      if(!n) continue;
      _CACHE_INTERM[n.toLowerCase()] = {
        nombre: n,
        pctAsesor: Number(data[i][2])||0,
        pctFabian: Number(data[i][3])||0,
        tipo: String(data[i][4]||'asesor'),
        email: String(data[i][5]||'')
      };
    }
  }
  return _CACHE_INTERM[String(nombre||'').toLowerCase()] || null;
}

/* ============================================
   AUTH GATE (seguridad por rol en cada action)
   Extrae email del requester y devuelve perfil, o null si no autorizado.
   Uso: var perfil = authGate_(e/payload); if(!perfil) return jsonResponse({error:'no autorizado'});
   ============================================ */
function authGate_(source){
  var email = '';
  if(source && source.parameter){
    // GET: e.parameter.email
    email = String(source.parameter.email||'').toLowerCase().trim();
  } else if(source && typeof source === 'object'){
    // POST: payload.email
    email = String(source.email||'').toLowerCase().trim();
  }
  if(!email) return null;
  var perfil = getRolYPerfil_(email);
  if(!perfil || perfil.rol==='anonimo') return null;
  if(perfil.rol==='asesor' && perfil.activo!=='si') return null; // asesor inactivo
  return perfil;
}
function esAdminODuenoRol_(perfil){
  return perfil && (perfil.rol==='admin' || perfil.rol==='dueno');
}
function esAdminODuenoRol_v2_(perfil){ return esAdminODuenoRol_(perfil); }

/* Filtros de datos por rol */
function filtrarLeadsPorRol_(rows, perfil){
  if(esAdminODuenoRol_(perfil)) return rows;
  var mio = String(perfil.intermediario||'').toLowerCase().trim();
  return rows.filter(function(r){ return String(r.intermediario||'').toLowerCase().trim() === mio; });
}
function filtrarPolizasPorRol_(rows, perfil){
  if(esAdminODuenoRol_(perfil)) return rows;
  var mio = String(perfil.intermediario||'').toLowerCase().trim();
  return rows.filter(function(r){
    // Poliza puede tener 'agente' o 'colaborador' o 'intermediario' - normalizamos
    var interm = String(r.intermediario||r.agente||r.colaborador||'').toLowerCase().trim();
    return interm === mio;
  });
}
function filtrarLiqsPorRol_(rows, perfil){
  if(esAdminODuenoRol_(perfil)) return rows;
  var mio = String(perfil.intermediario||'').toLowerCase().trim();
  return rows.filter(function(r){ return String(r.intermediario||'').toLowerCase().trim() === mio; });
}
function filtrarCotsPorRol_(rows, perfil, leadsPermitidosIds){
  if(esAdminODuenoRol_(perfil)) return rows;
  // Cotizaciones se filtran por lead_id permitido
  return rows.filter(function(r){ return leadsPermitidosIds.indexOf(String(r.lead_id||'')) >= 0; });
}

/* Lee el intermediario asociado a un lead_id desde el sheet LEADS */
function getIntermediarioDeLead_(lead_id){
  if(!lead_id) return '';
  try{
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName(TAB_LEADS);
    if(!sh) return '';
    var data = sh.getDataRange().getValues();
    for(var i=1;i<data.length;i++){
      if(String(data[i][1]) === String(lead_id)) return String(data[i][11]||'').trim();
    }
  }catch(e){}
  return '';
}
