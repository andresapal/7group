// ============================================
// 7Group Platform — Google Apps Script
// Pega esto en Extensions > Apps Script de tu Google Sheet
// ============================================

var SHEET_NAME = 'Sheet1';
var ALLOWED_EMAILS = ['andresapal@gmail.com','7groupcorp@zohomail.com'];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers[0] === '') {
      headers = ['timestamp','ref','negocio','nombre','telefono','email','ciudad','sector',
        'tiempo_mercado','descripcion_negocio','servicios','diferenciador','cobertura',
        'tiene_web','url_web','redes','captacion_actual','clientes_mes','cliente_tipico',
        'rango_edad','tipo_cliente','objecion_comun','necesidades','dolor_principal',
        'meta_6meses','presupuesto','urgencia','inversion_inicial','contacto_preferido',
        'comentarios','status'];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }

    var row = [];
    for (var i = 0; i < headers.length; i++) {
      var key = headers[i];
      if (key === 'timestamp') {
        row.push(new Date().toISOString());
      } else if (key === 'status') {
        row.push('new');
      } else {
        row.push(data[key] || '');
      }
    }
    sheet.appendRow(row);

    return ContentService.createTextOutput(JSON.stringify({ok: true, ref: data.ref || ''}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok: false, error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();

    if (data.length < 2) {
      return send([]);
    }

    var headers = data[0];
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = data[i][j];
      }
      rows.push(obj);
    }

    rows.reverse();

    return send(rows);
  } catch (err) {
    return send({error: err.message});
  }
}

function send(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
