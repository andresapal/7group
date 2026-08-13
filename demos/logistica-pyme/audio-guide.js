/* ============================================================
   ERP AGENT — 7Group Logistics
   Conversational voice assistant · Bilingual ES/EN
   Hablas o escribes → te lleva donde necesitas dentro del ERP
   ============================================================ */
(function(){
'use strict';

var LANG='es';
var SYNTH=window.speechSynthesis;
var RECOG=null;
var LISTENING=false;
var MESSAGES=[];
var PANEL=null;
var BTN=null;
var VOICES=[];

// ---- Detect language ----
function detectLang(){
  try{var u=new URLSearchParams(location.search);if(u.get('lang')==='en')return'en';}catch(e){}
  try{if(localStorage.getItem('7g_lang')==='en')return'en';}catch(e){}
  var hl=document.documentElement.lang;
  if(hl&&hl.startsWith('en'))return'en';
  return'es';
}

// ---- Current module detection ----
function currentModule(){
  var p=location.pathname;
  if(p.indexOf('/shipment')>-1)return'shipment';
  if(p.indexOf('/inventario')>-1)return'inventario';
  if(p.indexOf('/bodega')>-1)return'bodega';
  if(p.indexOf('/despachos')>-1)return'despachos';
  if(p.indexOf('/agentes')>-1)return'agentes';
  if(p.indexOf('/logistica-pyme')>-1)return'recibo';
  return'unknown';
}

// ---- Module base path ----
var BASE='/demos/logistica-pyme/';

// ---- Intent engine ----
var INTENTS=[
  // Navigation
  {keys:['shipment','envio','envios','embarque','embarques','ship','captur','receipt','recib documento','subir documento','upload'],
   action:'nav', target:BASE+'shipment/', module:'Shipment',
   es:'Te llevo a Shipment para capturar envios.',
   en:'Taking you to Shipment to capture shipments.'},

  {keys:['recibo','recibir','receiv','receiving','recepcion','preaviso','preavisos'],
   action:'nav', target:BASE, module:'Recibo',
   es:'Te llevo a Recibo para gestionar la recepcion de mercancia.',
   en:'Taking you to Receiving to manage goods reception.'},

  {keys:['inventario','inventory','stock','producto','productos','sku','items'],
   action:'nav', target:BASE+'inventario/', module:'Inventario',
   es:'Te llevo a Inventario para ver tu stock.',
   en:'Taking you to Inventory to see your stock.'},

  {keys:['bodega','warehouse','picking','packing','orden','preparar','preparacion'],
   action:'nav', target:BASE+'bodega/', module:'Bodega',
   es:'Te llevo a Bodega para gestionar ordenes de preparacion.',
   en:'Taking you to Warehouse to manage preparation orders.'},

  {keys:['despacho','despachos','dispatch','dispatches','salida','enviar mercancia','sacar'],
   action:'nav', target:BASE+'despachos/', module:'Despachos',
   es:'Te llevo a Despachos para crear ordenes de salida.',
   en:'Taking you to Dispatches to create exit orders.'},

  {keys:['agente','agentes','agent','agents','operario','operarios','conductor','personal','equipo'],
   action:'nav', target:BASE+'agentes/', module:'Agentes',
   es:'Te llevo a Agentes para gestionar tu personal.',
   en:'Taking you to Agents to manage your staff.'},

  {keys:['portal','inicio','home','proyectos','demos','volver'],
   action:'nav', target:'/demos/', module:'Portal',
   es:'Te llevo al portal principal.',
   en:'Taking you to the main portal.'},

  // Actions
  {keys:['crear despacho','nuevo despacho','new dispatch','create dispatch','despachar'],
   action:'nav', target:BASE+'despachos/', module:'Despachos',
   es:'Te llevo a Despachos para crear una nueva orden de salida.',
   en:'Taking you to Dispatches to create a new exit order.'},

  {keys:['crear orden','nueva orden','new order','create order'],
   action:'nav', target:BASE+'bodega/', module:'Bodega',
   es:'Te llevo a Bodega para crear una nueva orden de preparacion.',
   en:'Taking you to Warehouse to create a new preparation order.'},

  {keys:['escanear','scan','barcode','codigo','qr'],
   action:'nav', target:BASE+'shipment/', module:'Shipment',
   es:'Te llevo a Shipment para escanear documentos o codigos.',
   en:'Taking you to Shipment to scan documents or codes.'},

  {keys:['alerta','alertas','alert','alerts','vencimiento','vencer','bajo stock','low stock','minimo'],
   action:'nav', target:BASE+'inventario/?tab=4', module:'Inventario > Alertas',
   es:'Te llevo a las alertas de inventario.',
   en:'Taking you to inventory alerts.'},

  {keys:['movimiento','movimientos','movement','movements','entrada','salida','historial'],
   action:'nav', target:BASE+'inventario/?tab=3', module:'Inventario > Movimientos',
   es:'Te llevo al historial de movimientos.',
   en:'Taking you to movement history.'},

  {keys:['lote','lotes','batch','fifo','fefo','vencimiento','expiry'],
   action:'nav', target:BASE+'inventario/?tab=2', module:'Inventario > Lotes',
   es:'Te llevo al control de lotes FIFO y FEFO.',
   en:'Taking you to FIFO and FEFO batch control.'},

  {keys:['cross dock','crossdock','cross-dock','transbordo'],
   action:'nav', target:BASE+'shipment/', module:'Shipment > Cross-Docking',
   es:'Te llevo a Shipment donde puedes activar cross-docking en un embarque.',
   en:'Taking you to Shipment where you can enable cross-docking on a shipment.'},

  // Data queries (read from DOM/localStorage)
  {keys:['cuanto','cuantos','how many','total','cantidad'],
   action:'query', queryType:'count',
   es:'Déjame revisar los datos...',
   en:'Let me check the data...'},

  // Help / What can I do
  {keys:['ayuda','help','que puedo','what can','como','how to','funciona','explain','explicar'],
   action:'help',
   es:'Puedo ayudarte a navegar el ERP. Dime cosas como: "llevame a inventario", "quiero crear un despacho", "muéstrame las alertas", "ir a shipment". También puedo llevarte a cualquier modulo con solo decir su nombre.',
   en:'I can help you navigate the ERP. Say things like: "take me to inventory", "I want to create a dispatch", "show me alerts", "go to shipment". I can also take you to any module by just saying its name.'},

  // Greetings
  {keys:['hola','hello','hi','hey','buenas','buenos','que tal'],
   action:'greet',
   es:'Hola, soy tu asistente del ERP. Dime a donde quieres ir o que necesitas hacer.',
   en:'Hi, I am your ERP assistant. Tell me where you want to go or what you need to do.'},

  // Where am I
  {keys:['donde estoy','where am i','que modulo','which module','ubicacion'],
   action:'location',
   es:'', en:''}
];

function matchIntent(text){
  var t=text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  var best=null;
  var bestScore=0;

  for(var i=0;i<INTENTS.length;i++){
    var intent=INTENTS[i];
    var score=0;
    for(var j=0;j<intent.keys.length;j++){
      var key=intent.keys[j].normalize('NFD').replace(/[̀-ͯ]/g,'');
      if(t.indexOf(key)>-1){
        score+=key.length;// longer match = more specific
      }
    }
    if(score>bestScore){
      bestScore=score;
      best=intent;
    }
  }
  return best;
}

// ---- Map module name to voice key ----
function moduleVoiceKey(target){
  if(target.indexOf('/shipment')>-1)return'shipment';
  if(target.indexOf('/inventario')>-1)return'inventario';
  if(target.indexOf('/bodega')>-1)return'bodega';
  if(target.indexOf('/despachos')>-1)return'despachos';
  if(target.indexOf('/agentes')>-1)return'agentes';
  if(target.indexOf('/logistica-pyme')>-1&&target.indexOf('/shipment')<0)return'recibo';
  return null;
}

// ---- Execute intent ----
function executeIntent(intent,originalText){
  if(!intent){
    var resp=LANG==='en'
      ?'I didn\'t understand. Try saying a module name like "inventory", "shipment", or "dispatches". Say "help" for more options.'
      :'No entendi. Intenta decir un nombre de modulo como "inventario", "shipment", o "despachos". Di "ayuda" para mas opciones.';
    addMessage('agent',resp);
    playVoice('unknown',resp);
    return;
  }

  switch(intent.action){
    case 'nav':
      var msg=LANG==='en'?intent.en:intent.es;
      addMessage('agent',msg);
      var navKey=moduleVoiceKey(intent.target);
      playVoice(navKey?'nav-'+navKey:null,msg);
      setTimeout(function(){
        window.location.href=intent.target;
      },2000);
      break;

    case 'help':
      var hmsg=LANG==='en'?intent.en:intent.es;
      addMessage('agent',hmsg);
      playVoice('help',hmsg);
      break;

    case 'greet':
      var gmsg=LANG==='en'?intent.en:intent.es;
      addMessage('agent',gmsg);
      playVoice('greet',gmsg);
      break;

    case 'location':
      var mod=currentModule();
      var lmsg=LANG==='en'
        ?'You are currently in the '+mod+' module.'
        :'Estas en el modulo de '+mod+'.';
      addMessage('agent',lmsg);
      playVoice('loc-'+mod,lmsg);
      break;

    case 'query':
      handleQuery(intent,originalText);
      break;
  }
}

function handleQuery(intent,text){
  var mod=currentModule();
  var resp='';

  // Try to read KPI values from DOM
  try{
    var kpis=document.querySelectorAll('.kpi-val');
    if(kpis.length>0){
      var data=[];
      kpis.forEach(function(k){
        var label=k.parentElement.querySelector('.kpi-label');
        if(label) data.push(label.textContent+': '+k.textContent);
      });
      resp=LANG==='en'
        ?'Here\'s what I see in '+mod+': '+data.join(', ')+'.'
        :'Esto veo en '+mod+': '+data.join(', ')+'.';
    } else {
      resp=LANG==='en'
        ?'I can\'t see summary data on this page. Try navigating to a module with dashboards.'
        :'No veo datos de resumen en esta pagina. Intenta ir a un modulo con indicadores.';
    }
  }catch(e){
    resp=LANG==='en'?'Could not read the data.':'No pude leer los datos.';
  }

  addMessage('agent',resp);
  speak(resp);
}

// ---- Voice playback (pre-recorded mp3 with TTS fallback) ----
var VOICE_BASE=BASE+'Voice/';
var VOICE_PLAYER=null;
var VOICE_MAP={
  // Greetings & help
  'greet':'saludo.mp3',
  'help':'ayuda.mp3',
  'unknown':'no-entendi.mp3',
  // Navigation
  'nav-shipment':'ir-shipment.mp3',
  'nav-recibo':'ir-recibo.mp3',
  'nav-inventario':'ir-inventario.mp3',
  'nav-bodega':'ir-bodega.mp3',
  'nav-despachos':'ir-despachos.mp3',
  'nav-agentes':'ir-agentes.mp3',
  // Location
  'loc-shipment':'modulo-shipment.mp3',
  'loc-recibo':'modulo-recibo.mp3',
  'loc-inventario':'modulo-inventario.mp3',
  'loc-bodega':'modulo-bodega.mp3',
  'loc-despachos':'modulo-despachos.mp3',
  'loc-agentes':'modulo-agentes.mp3'
};

function playVoice(key,fallbackText){
  // Stop any current audio
  if(VOICE_PLAYER){try{VOICE_PLAYER.pause();VOICE_PLAYER.currentTime=0;}catch(e){}}
  if(SYNTH)SYNTH.cancel();

  var file=VOICE_MAP[key];
  if(file){
    VOICE_PLAYER=new Audio(VOICE_BASE+file);
    VOICE_PLAYER.play().catch(function(){
      // Autoplay blocked or file missing → fallback to TTS
      speakTTS(fallbackText);
    });
  } else {
    // No recording for this key → use TTS
    speakTTS(fallbackText);
  }
}

function speakTTS(text){
  if(!SYNTH)return;
  SYNTH.cancel();
  VOICES=SYNTH.getVoices();
  var target=LANG==='en'?'en':'es';
  var voice=null;
  for(var i=0;i<VOICES.length;i++){
    if(VOICES[i].lang.startsWith(target)){
      if(/google|microsoft|samantha|paulina|monica|jorge/i.test(VOICES[i].name)){voice=VOICES[i];break;}
      if(!voice)voice=VOICES[i];
    }
  }
  var u=new SpeechSynthesisUtterance(text);
  u.lang=LANG==='en'?'en-US':'es-CO';
  u.rate=1.05;u.pitch=1;
  if(voice)u.voice=voice;
  SYNTH.speak(u);
}

// Backward-compatible speak function
function speak(text){speakTTS(text);}

// ---- Speech recognition ----
// iOS Safari fix: abort() + destroy + recreate on each use
var MIC_TIMEOUT=null;

function killMic(){
  // Force-stop everything
  if(MIC_TIMEOUT){clearTimeout(MIC_TIMEOUT);MIC_TIMEOUT=null;}
  if(RECOG){
    try{RECOG.abort();}catch(e){}
    // iOS: remove all handlers to prevent zombie callbacks
    RECOG.onresult=null;
    RECOG.onend=null;
    RECOG.onerror=null;
    RECOG.onspeechend=null;
    RECOG=null;
  }
  LISTENING=false;
  updateMicBtn();
}

function createRecognition(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR)return null;
  var r=new SR();
  r.continuous=false;
  r.interimResults=true;
  r.lang=LANG==='en'?'en-US':'es-CO';
  r.maxAlternatives=1;

  var gotFinal=false;

  r.onresult=function(e){
    var transcript='';
    for(var i=e.resultIndex;i<e.results.length;i++){
      transcript+=e.results[i][0].transcript;
    }
    var inp=document.getElementById('erpAgentInput');
    if(inp)inp.value=transcript;

    if(e.results[e.results.length-1].isFinal){
      gotFinal=true;
      killMic();
      processInput(transcript);
    }
  };

  r.onspeechend=function(){
    // iOS fires speechend but not always onend
    setTimeout(function(){
      if(LISTENING)killMic();
    },500);
  };

  r.onend=function(){
    // Fires when recognition stops (all platforms)
    if(!gotFinal){
      // Stopped without result — just clean up
      killMic();
    }
  };

  r.onerror=function(e){
    killMic();
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){
      addMessage('agent',LANG==='en'?'Microphone access denied. Allow it in browser settings.':'Microfono denegado. Permitelo en ajustes del navegador.');
    } else if(e.error==='no-speech'){
      addMessage('agent',LANG==='en'?'I didn\'t hear anything. Tap the mic and try again.':'No escuche nada. Toca el microfono e intenta de nuevo.');
    }
  };

  return r;
}

function toggleMic(){
  if(LISTENING){
    // STOP — force kill on all platforms including iOS
    killMic();
    return;
  }

  // START — create fresh instance each time (iOS fix)
  killMic();// clean any zombie
  RECOG=createRecognition();
  if(!RECOG){
    addMessage('agent',LANG==='en'?'Speech recognition not supported. Use Chrome or Safari.':'Reconocimiento de voz no soportado. Usa Chrome o Safari.');
    return;
  }

  try{
    RECOG.start();
    LISTENING=true;
    updateMicBtn();
    // Safety timeout: auto-stop after 10s if iOS doesn't fire onend
    MIC_TIMEOUT=setTimeout(function(){
      if(LISTENING){
        var inp=document.getElementById('erpAgentInput');
        if(inp&&inp.value.trim()){
          processInput(inp.value);
        }
        killMic();
      }
    },10000);
  }catch(e){
    killMic();
  }
}

function updateMicBtn(){
  var mic=document.getElementById('erpAgentMic');
  if(!mic)return;
  if(LISTENING){
    mic.classList.add('listening');
    mic.title=LANG==='en'?'Listening... tap to stop':'Escuchando... toca para parar';
  } else {
    mic.classList.remove('listening');
    mic.title=LANG==='en'?'Tap to speak':'Toca para hablar';
  }
}

// ---- Process user input ----
function processInput(text){
  if(!text||!text.trim())return;
  text=text.trim();
  addMessage('user',text);
  var inp=document.getElementById('erpAgentInput');
  if(inp)inp.value='';

  var intent=matchIntent(text);
  setTimeout(function(){executeIntent(intent,text);},300);
}

// ---- Chat UI ----
function addMessage(role,text){
  MESSAGES.push({role:role,text:text,time:new Date()});
  renderMessages();
}

function renderMessages(){
  var list=document.getElementById('erpAgentMessages');
  if(!list)return;
  var html='';
  for(var i=0;i<MESSAGES.length;i++){
    var m=MESSAGES[i];
    var cls=m.role==='user'?'ea-msg ea-user':'ea-msg ea-agent';
    html+='<div class="'+cls+'">'+escHtml(m.text)+'</div>';
  }
  list.innerHTML=html;
  list.scrollTop=list.scrollHeight;
}

function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ---- Inject CSS ----
function injectCSS(){
  if(document.getElementById('ea-styles'))return;
  var s=document.createElement('style');
  s.id='ea-styles';
  s.textContent=`
    .ea-fab{position:fixed;bottom:90px;right:24px;z-index:500;width:48px;height:48px;border-radius:50%;background:var(--cyan,#5ee7f7);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(94,231,247,.35);transition:transform .2s,box-shadow .2s;color:var(--bg,#060a0e)}
    .ea-fab:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(94,231,247,.5)}
    .ea-fab.open{background:var(--bg3,#131a24);color:var(--white,#e2e8f0);box-shadow:0 4px 20px rgba(0,0,0,.4)}
    .ea-fab svg{width:24px;height:24px}

    .ea-panel{position:fixed;bottom:150px;right:24px;z-index:501;width:360px;max-width:calc(100vw - 32px);height:420px;max-height:calc(100vh - 200px);background:var(--bg2,#0c1117);border:1px solid var(--border2,rgba(148,163,184,.12));border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden;font-family:'Inter',-apple-system,sans-serif}
    @media(max-width:480px){
      .ea-panel{bottom:16px;right:8px;left:8px;width:auto;max-width:none;height:auto;max-height:70vh;border-radius:14px}
      .ea-fab{bottom:80px;right:16px;width:44px;height:44px}
      .ea-fab.open{bottom:16px;right:16px}
    }
    .ea-panel.open{display:flex}

    .ea-head{padding:14px 16px;background:var(--bg3,#131a24);border-bottom:1px solid var(--border,rgba(148,163,184,.08));display:flex;align-items:center;justify-content:space-between}
    .ea-title{font-size:13px;font-weight:700;color:var(--cyan,#5ee7f7);display:flex;align-items:center;gap:8px}
    .ea-title svg{width:18px;height:18px}
    .ea-dot{width:6px;height:6px;border-radius:50%;background:var(--green,#22c55e);animation:ea-blink 2s ease-in-out infinite}
    @keyframes ea-blink{0%,100%{opacity:1}50%{opacity:.3}}
    .ea-close{background:none;border:none;color:var(--dim,#64748b);cursor:pointer;font-size:18px;padding:4px;line-height:1;transition:.2s}
    .ea-close:hover{color:var(--white,#e2e8f0)}
    .ea-module{font-size:9px;font-weight:600;color:var(--dim,#64748b);padding:6px 16px;border-bottom:1px solid var(--border,rgba(148,163,184,.08));letter-spacing:.5px;text-transform:uppercase}

    .ea-messages{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px}
    .ea-msg{max-width:85%;padding:10px 14px;border-radius:12px;font-size:13px;line-height:1.5;word-wrap:break-word}
    .ea-agent{align-self:flex-start;background:var(--bg3,#131a24);color:var(--white,#e2e8f0);border-bottom-left-radius:4px}
    .ea-user{align-self:flex-end;background:rgba(94,231,247,.12);color:var(--cyan,#5ee7f7);border-bottom-right-radius:4px}

    .ea-input-row{padding:10px 12px;border-top:1px solid var(--border,rgba(148,163,184,.08));display:flex;gap:6px;align-items:center;background:var(--bg3,#131a24)}
    .ea-input{flex:1;background:var(--bg,#060a0e);border:1px solid var(--border2,rgba(148,163,184,.12));border-radius:8px;padding:10px 12px;color:var(--white,#e2e8f0);font-size:13px;font-family:inherit;outline:none;transition:border .2s}
    .ea-input:focus{border-color:var(--cyan,#5ee7f7)}
    .ea-input::placeholder{color:var(--muted,#334155)}
    .ea-send{width:36px;height:36px;border-radius:8px;background:rgba(94,231,247,.1);border:1px solid rgba(94,231,247,.2);color:var(--cyan,#5ee7f7);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.2s;flex-shrink:0}
    .ea-send:hover{background:rgba(94,231,247,.2)}
    .ea-send svg{width:16px;height:16px}

    .ea-mic{width:42px;height:42px;border-radius:50%;background:var(--cyan,#5ee7f7);border:none;color:var(--bg,#060a0e);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.2s;flex-shrink:0;box-shadow:0 2px 8px rgba(94,231,247,.3)}
    .ea-mic:hover{transform:scale(1.08);box-shadow:0 4px 14px rgba(94,231,247,.4)}
    .ea-mic svg{width:20px;height:20px}
    .ea-mic.listening{background:var(--red,#ef4444);color:#fff;box-shadow:0 0 0 4px rgba(239,68,68,.25);animation:ea-pulse 1.5s ease-in-out infinite}
    @keyframes ea-pulse{0%,100%{box-shadow:0 0 0 4px rgba(239,68,68,.25)}50%{box-shadow:0 0 0 12px rgba(239,68,68,0)}}

    .ea-suggestions{padding:8px 16px;display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--border,rgba(148,163,184,.08))}
    .ea-chip{padding:5px 10px;font-size:10px;font-weight:600;background:var(--bg,#060a0e);border:1px solid var(--border2,rgba(148,163,184,.12));border-radius:6px;color:var(--dim,#64748b);cursor:pointer;transition:.2s;white-space:nowrap}
    .ea-chip:hover{border-color:var(--cyan,#5ee7f7);color:var(--cyan,#5ee7f7)}
  `;
  document.head.appendChild(s);
}

// ---- Build UI ----
function buildUI(){
  injectCSS();

  // FAB
  BTN=document.createElement('button');
  BTN.className='ea-fab';
  BTN.title=LANG==='en'?'ERP Assistant':'Asistente ERP';
  BTN.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  BTN.onclick=togglePanel;
  document.body.appendChild(BTN);

  // Panel
  var mod=currentModule();
  var placeholder=LANG==='en'?'Ask me anything...':'Preguntame lo que quieras...';
  var welcomeMsg=LANG==='en'
    ?'Hi! I\'m your ERP assistant. Tell me where you want to go or ask me anything about the system. You can also use the microphone.'
    :'Hola! Soy tu asistente del ERP. Dime a donde quieres ir o preguntame lo que necesites. Tambien puedes usar el microfono.';

  PANEL=document.createElement('div');
  PANEL.className='ea-panel';
  PANEL.innerHTML=`
    <div class="ea-head">
      <div class="ea-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        ERP Agent
        <span class="ea-dot"></span>
      </div>
      <button class="ea-close" id="eaClose">&#x2715;</button>
    </div>
    <div class="ea-module" id="eaModule">${mod.toUpperCase()}</div>
    <div class="ea-messages" id="erpAgentMessages"></div>
    <div class="ea-suggestions" id="eaSuggestions"></div>
    <div class="ea-input-row">
      <button class="ea-mic" id="erpAgentMic" title="${LANG==='en'?'Press to speak':'Presiona para hablar'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </button>
      <input class="ea-input" id="erpAgentInput" placeholder="${placeholder}" autocomplete="off">
      <button class="ea-send" id="eaSend" title="${LANG==='en'?'Send':'Enviar'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  `;
  document.body.appendChild(PANEL);

  // Events
  PANEL.querySelector('#eaClose').onclick=function(){togglePanel();};
  PANEL.querySelector('#erpAgentMic').onclick=function(){toggleMic();};
  PANEL.querySelector('#eaSend').onclick=function(){
    var inp=document.getElementById('erpAgentInput');
    if(inp&&inp.value.trim())processInput(inp.value);
  };
  PANEL.querySelector('#erpAgentInput').addEventListener('keydown',function(e){
    if(e.key==='Enter'&&this.value.trim()){processInput(this.value);}
  });

  // Welcome message
  addMessage('agent',welcomeMsg);

  // Suggestions
  renderSuggestions();
}

function renderSuggestions(){
  var box=document.getElementById('eaSuggestions');
  if(!box)return;
  var chips=LANG==='en'
    ?[{t:'Inventory',q:'take me to inventory'},{t:'Shipment',q:'go to shipment'},{t:'Dispatches',q:'dispatches'},{t:'Where am I?',q:'where am I'},{t:'Help',q:'help'}]
    :[{t:'Inventario',q:'inventario'},{t:'Shipment',q:'shipment'},{t:'Despachos',q:'despachos'},{t:'Donde estoy?',q:'donde estoy'},{t:'Ayuda',q:'ayuda'}];

  var html='';
  for(var i=0;i<chips.length;i++){
    html+='<div class="ea-chip" data-q="'+chips[i].q+'">'+chips[i].t+'</div>';
  }
  box.innerHTML=html;
  box.querySelectorAll('.ea-chip').forEach(function(c){
    c.onclick=function(){processInput(this.getAttribute('data-q'));};
  });
}

function togglePanel(){
  if(!PANEL)return;
  var open=PANEL.classList.toggle('open');
  BTN.classList.toggle('open',open);
  if(open){
    BTN.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    var inp=document.getElementById('erpAgentInput');
    if(inp)setTimeout(function(){inp.focus();},200);
  } else {
    BTN.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    if(SYNTH)SYNTH.cancel();
    if(LISTENING&&RECOG){RECOG.stop();LISTENING=false;updateMicBtn();}
  }
}

// ---- Init ----
window.ERPAgent={
  init:function(opts){
    opts=opts||{};
    LANG=opts.lang||detectLang();
    buildUI();
    // Load voices async
    if(SYNTH&&SYNTH.onvoiceschanged!==undefined){
      SYNTH.onvoiceschanged=function(){VOICES=SYNTH.getVoices();};
    }
  }
};

})();
