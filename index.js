require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Resend } = require('resend');
const { google } = require('googleapis');

const resend = new Resend(process.env.RESEND_API_KEY);

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'https://hormicash-bot-production.up.railway.app/oauth2callback'
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

async function enviarConGmailAPI(to, subject, html) {
  const { token } = await oauth2Client.getAccessToken();
  const message = [`To: ${to}`,`From: "Hormicash 🐜" <${process.env.GMAIL_USER}>`,`Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,`MIME-Version: 1.0`,`Content-Type: text/html; charset=UTF-8`,``,html].join('\n');
  const encoded = Buffer.from(message).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  await axios.post(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,{raw:encoded},{headers:{Authorization:`Bearer ${token}`}});
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function detectarIdioma(texto) {
  const lower = texto.toLowerCase();
  const ptWords = ['olá','ola','oi','bom dia','boa tarde','boa noite','obrigado','obrigada','tudo bem','tudo bom','gastar','gastei','paguei','quanto','reais','real'];
  const enWords = ['hello','hi','hey','good morning','good afternoon','spent','expense','cost','paid','dollars','bucks','how much'];
  const ptScore = ptWords.filter(w=>lower.includes(w)).length;
  const enScore = enWords.filter(w=>lower.includes(w)).length;
  if (ptScore > enScore && ptScore > 0) return 'pt';
  if (enScore > ptScore && enScore > 0) return 'en';
  return 'es';
}

const i18n = {
  bienvenida: {
    es: (n) => `🐜 *¡Bienvenido a Hormicash!*\n\nSoy tu asistente de gastos hormiga. Registra tus gastos por:\n\n📸 Foto de voucher\n🎙️ Mensaje de voz\n💬 Texto: _"Almuerzo 15"_\n💳 Tarjeta de crédito: _"Taxi 30 TC"_\n\n─────────────────\n¿Quieres configurar *límites de gasto* mensuales? ⭐ Premium\n\n1️⃣ Sí, configurar ahora\n2️⃣ Lo haré después`,
    en: (n) => `🐜 *Welcome to Hormicash!*\n\nI'm your expense tracker assistant. Log your expenses by:\n\n📸 Receipt photo\n🎙️ Voice message\n💬 Text: _"Lunch 15"_\n💳 Credit card: _"Taxi 30 TC"_\n\n─────────────────\nWant to set monthly *spending limits*? ⭐ Premium\n\n1️⃣ Yes, set up now\n2️⃣ I'll do it later`,
    pt: (n) => `🐜 *Bem-vindo ao Hormicash!*\n\nSou seu assistente de gastos. Registre seus gastos por:\n\n📸 Foto do recibo\n🎙️ Mensagem de voz\n💬 Texto: _"Almoço 15"_\n💳 Cartão de crédito: _"Táxi 30 TC"_\n\n─────────────────\nQuer configurar *limites de gastos* mensais? ⭐ Premium\n\n1️⃣ Sim, configurar agora\n2️⃣ Farei depois`,
  },
  noEntendi: {
    es: `No entendí el monto 🤔\n\n*Gastos:* "Almuerzo 15"\n*Tarjeta:* "Taxi 30 TC" o "Netflix 45 CREDITO"\n*Múltiples:* "Almuerzo 15 y taxi 8"\n*Ingresos:* "Ingreso 500 sueldo"\n*Voucher:* 📸 foto\n*Voz:* 🎙️ audio\n\n*Comandos:*\n/resumen — Ver balance\n/borrar — Eliminar un gasto\n/limites ⭐ — Límites de gasto\n/meta ⭐ — Meta de ahorro\n/consejo ⭐ — Consejo con IA`,
    en: `I didn't understand the amount 🤔\n\n*Expenses:* "Lunch 15"\n*Card:* "Taxi 30 TC" or "Netflix 45 CREDIT"\n*Multiple:* "Lunch 15 and taxi 8"\n*Income:* "Income 500 salary"\n*Receipt:* 📸 photo\n*Voice:* 🎙️ audio\n\n*Commands:*\n/summary — View balance\n/delete — Delete an expense\n/limits ⭐ — Spending limits\n/goal ⭐ — Savings goal\n/tip ⭐ — AI advice`,
    pt: `Não entendi o valor 🤔\n\n*Gastos:* "Almoço 15"\n*Cartão:* "Táxi 30 TC" ou "Netflix 45 CREDITO"\n*Múltiplos:* "Almoço 15 e táxi 8"\n*Renda:* "Renda 500 salário"\n*Recibo:* 📸 foto\n*Voz:* 🎙️ áudio\n\n*Comandos:*\n/resumo — Ver saldo\n/deletar — Deletar um gasto\n/limites ⭐ — Limites de gastos\n/meta ⭐ — Meta de poupança\n/dica ⭐ — Dica com IA`,
  },
  sinJoin: {
    es: `👋 ¡Hola! Para empezar a usar Hormicash necesitas conectarte primero.\n\nEnvía exactamente este mensaje:\n\n*join worse-lying*\n\nAl número *+1 415 523 8886* por WhatsApp.\n\n_(Si ya lo hiciste hace más de 72 horas, debes enviarlo de nuevo — el sandbox expira cada 3 días)_`,
    en: `👋 Hi! To start using Hormicash you need to connect first.\n\nSend exactly this message:\n\n*join worse-lying*\n\nTo *+1 415 523 8886* on WhatsApp.\n\n_(If you did it more than 72 hours ago, you need to send it again — the sandbox expires every 3 days)_`,
    pt: `👋 Olá! Para começar a usar o Hormicash você precisa se conectar primeiro.\n\nEnvie exatamente esta mensagem:\n\n*join worse-lying*\n\nPara *+1 415 523 8886* no WhatsApp.\n\n_(Se você fez isso há mais de 72 horas, precisa enviar novamente — o sandbox expira a cada 3 dias)_`,
  },
};

async function obtenerEmailUsuario(telefono) {
  try {
    const snap = await db.collection('usuarios').where('telefono','==',telefono).limit(1).get();
    if (snap.empty) return null;
    const data = snap.docs[0].data();
    return { email: data.email, nombre: data.nombre?.split(' ')[0] || 'Usuario' };
  } catch(e) { return null; }
}

async function enviarEmailRecordatorio(email, nombre, diasSinRegistrar, totalMes) {
  const cur = 'S/';
  const subjects = [`🐜 Hormicash — ¿Registraste tus gastos hoy?`,`⚠️ Hormicash — Llevas ${diasSinRegistrar+1} días sin registrar`,`🔥 Hormicash — Retoma el control de tus finanzas`];
  const subjectIdx = diasSinRegistrar===0?0:diasSinRegistrar<=3?1:2;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f4f6fb;font-family:'Inter',Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:32px 16px"><div style="text-align:center;margin-bottom:24px"><div style="font-size:28px;font-weight:800;color:#f59e0b">Hormi<span style="color:#22c55e">cash</span></div></div><div style="background:#fff;border-radius:16px;padding:28px 24px;margin-bottom:16px"><div style="font-size:22px;font-weight:800;color:#1a1f36;margin-bottom:8px">${diasSinRegistrar===0?`¡Hola ${nombre}! 👋`:diasSinRegistrar<=3?`${nombre}, llevas ${diasSinRegistrar+1} días sin registrar 👀`:`${nombre}, más de una semana sin registrar 🔥`}</div>${totalMes>0?`<div style="background:#f4f6fb;border-radius:10px;padding:14px 16px;margin-bottom:20px;display:flex;justify-content:space-between"><div style="font-size:13px;color:#8492a6">Registrado este mes</div><div style="font-size:20px;font-weight:800;color:#ef4444">${cur} ${totalMes.toFixed(0)}</div></div>`:''}<a href="https://hormicash.web.app" style="display:block;text-align:center;background:linear-gradient(135deg,#f59e0b,#22c55e);color:white;text-decoration:none;padding:14px 24px;border-radius:12px;font-size:15px;font-weight:700">Ver mi dashboard →</a></div></div></body></html>`;
  await enviarConGmailAPI(email, subjects[subjectIdx], html);
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use((req,res,next) => {
  res.header('Access-Control-Allow-Origin','https://hormicash.web.app');
  res.header('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.sendStatus(200);
  next();
});

const estadoUsuario = {};
const CATEGORIAS = ['comida','cafe','transporte','telecom','entretenimiento','salud','educacion','ropa','hogar','otros'];
const CATEGORIAS_DISPLAY = {comida:'🍔 Comida',cafe:'☕ Café',transporte:'🚌 Transporte',telecom:'📱 Telecom',entretenimiento:'🎬 Entretenimiento',salud:'💊 Salud',educacion:'📚 Educación',ropa:'👕 Ropa',hogar:'🏠 Hogar',otros:'📦 Otros'};
const TC_KEYWORDS = ['tc','credito','crédito','tarjeta','visa','mastercard','amex','credit'];

function detectarTarjeta(texto) {
  const lower = texto.toLowerCase();
  return TC_KEYWORDS.some(k => new RegExp(`(^|\\s|[-,])${k}(\\s|[-,]|$)`,'i').test(lower));
}
function limpiarTextoTC(texto) {
  let limpio = texto;
  limpio = limpio.replace(/^(tc|credito|crédito|tarjeta|visa|mastercard|amex|credit)\s+/gi,'');
  TC_KEYWORDS.forEach(k => { limpio = limpio.replace(new RegExp(`\\s*[-,]?\\s*\\b${k}\\b\\s*[-,]?\\s*`,'gi'),' '); });
  return limpio.trim();
}
async function esPremium(telefono) {
  try { const doc=await db.collection('usuarios_whatsapp').doc(telefono).get(); return doc.exists&&doc.data().plan==='premium'; } catch(e) { return false; }
}
async function registrarUsuario(telefono) {
  try { const doc=await db.collection('usuarios_whatsapp').doc(telefono).get(); const esNuevo=!doc.exists; await db.collection('usuarios_whatsapp').doc(telefono).set({telefono,ultimo_mensaje:admin.firestore.FieldValue.serverTimestamp(),activo:true},{merge:true}); return esNuevo; } catch(e) { return false; }
}
async function verificarLimite(telefono,categoria,montoNuevo) {
  try {
    const userDoc=await db.collection('usuarios_whatsapp').doc(telefono).get(); if(!userDoc.exists) return null;
    const userData=userDoc.data(); if(userData.plan!=='premium') return null;
    const limite=(userData.limites||{})[categoria]; if(!limite) return null;
    const inicioMes=new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
    const snapshot=await db.collection('gastos').where('telefono','==',telefono).where('categoria','==',categoria).where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes)).get();
    let totalMes=0; snapshot.forEach(doc=>{totalMes+=doc.data().monto;}); totalMes+=montoNuevo;
    const porcentaje=(totalMes/limite)*100;
    if(porcentaje>=100) return {tipo:'superado',totalMes,limite,porcentaje};
    if(porcentaje>=80) return {tipo:'advertencia',totalMes,limite,porcentaje};
    return null;
  } catch(e) { return null; }
}
async function verificarAlertaContextual(telefono,categoria,montoNuevo) {
  try {
    const inicioMes=new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
    const hoy=new Date(); const inicioDia=new Date(hoy.getFullYear(),hoy.getMonth(),hoy.getDate());
    const diasTranscurridos=Math.max(hoy.getDate(),1);
    const snapshot=await db.collection('gastos').where('telefono','==',telefono).where('categoria','==',categoria).where('tipo','==','gasto').where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes)).get();
    let totalMes=0,totalHoy=0;
    snapshot.forEach(doc=>{const d=doc.data();totalMes+=d.monto;const fecha=d.fecha?.toDate?d.fecha.toDate():new Date(d.fecha);if(fecha>=inicioDia)totalHoy+=d.monto;});
    totalHoy+=montoNuevo;
    const promedioDiario=totalMes/diasTranscurridos;
    if(promedioDiario>0&&totalHoy>promedioDiario*1.5) return {catDisplay:CATEGORIAS_DISPLAY[categoria]||categoria,totalHoy:totalHoy.toFixed(2),promedio:promedioDiario.toFixed(2)};
    return null;
  } catch(e) { return null; }
}
async function actualizarGastoTarjeta(telefono,monto) {
  try {
    const userDoc=await db.collection('usuarios_whatsapp').doc(telefono).get(); if(!userDoc.exists) return;
    const uid=userDoc.data().uid; if(!uid) return;
    const userRef=db.collection('usuarios').doc(uid); const snap=await userRef.get(); if(!snap.exists) return;
    await userRef.update({'tarjeta.gasto_actual':(snap.data().tarjeta?.gasto_actual||0)+monto});
  } catch(e) { console.error('Error tarjeta:',e.message); }
}
async function downloadTwilioMedia(mediaUrl) {
  const response=await axios.get(mediaUrl,{auth:{username:process.env.TWILIO_ACCOUNT_SID,password:process.env.TWILIO_AUTH_TOKEN},responseType:'arraybuffer'});
  return {base64:Buffer.from(response.data).toString('base64'),mimeType:response.headers['content-type']||'image/jpeg'};
}
async function extractVoucherData(base64,mimeType) {
  const model=genAI.getGenerativeModel({model:'gemini-2.5-flash-lite'});
  const prompt=`Analiza este voucher y extrae la información del gasto.\nResponde ÚNICAMENTE JSON válido sin markdown.\nFormato: {"negocio":"","monto":0.00,"moneda":"PEN","categoria":"Comida|Transporte|Entretenimiento|Salud|Educación|Ropa|Tecnología|Hogar|Otros","fecha":"YYYY-MM-DD o null","descripcion":""}\nSi no es voucher: {"error":"no_voucher"}`;
  const result=await model.generateContent([{inlineData:{data:base64,mimeType}},prompt]);
  return JSON.parse(result.response.text().trim().replace(/```json|```/g,'').trim());
}
async function extractAudioData(base64,mimeType) {
  const model=genAI.getGenerativeModel({model:'gemini-2.5-flash-lite'});
  const prompt=`Escucha este audio y extrae el gasto o ingreso.\nResponde ÚNICAMENTE JSON: {"tipo":"gasto|ingreso","negocio":"null o nombre","monto":0.00,"moneda":"PEN","categoria":"Comida|Transporte|Entretenimiento|Salud|Educación|Ropa|Tecnología|Hogar|Otros","descripcion":""}\nSi no hay monto: {"error":"no_monto"}`;
  const result=await model.generateContent([{inlineData:{data:base64,mimeType}},prompt]);
  return JSON.parse(result.response.text().trim().replace(/```json|```/g,'').trim());
}
function limpiarLabel(texto) {
  let label=texto.replace(/\d+(?:[.,]\d{1,2})?\s*(?:soles?|sol|s\/)?/gi,'').replace(/\b(y|e|de|en|al|el|la|los|las|un|una|con|para|por)\b/gi,' ').replace(/[^\w\sáéíóúñü]/gi,' ').replace(/\s+/g,' ').trim();
  if(label.length<2) label='Gasto';
  label=label.charAt(0).toUpperCase()+label.slice(1);
  return label.length>25?label.substring(0,25).trim():label;
}
function parsearMultiplesMovimientos(texto) {
  const partes=texto.split(/\s+(?:y|e|,)\s+/gi); if(partes.length<=1) return null;
  const movimientos=[];
  for(const parte of partes){const mov=parsearMovimiento(parte.trim());if(mov)movimientos.push({...mov,textoOriginal:parte.trim()});}
  return movimientos.length>=2?movimientos:null;
}
function parsearMovimiento(texto) {
  const lower=texto.toLowerCase();
  const match=lower.match(/(\d+(?:[.,]\d{1,2})?)/); if(!match) return null;
  const monto=parseFloat(match[1].replace(',','.')); if(isNaN(monto)||monto<=0) return null;
  const ingresosKw=['ingreso','sueldo','salario','pago','transferencia','depósito','deposito','freelance','propina','bono','regalo','cobro','cobré','cobre','me pagaron','ganancia'];
  if(ingresosKw.some(k=>lower.includes(k))) return {monto,tipo:'ingreso',categoria:'ingreso',label:limpiarLabel(texto)};
  const cats={
    comida:['almuerzo','comida','pollo','arroz','ceviche','menu','menú','desayuno','cena','sandwich','pan','pizza','burger','hamburguesa','chifa','sushi','empanada','salchipapa','broaster','lomo','causa','sopa','tallarines','chaufa','anticucho','chicharron','fruta','ensalada','galleta','snack','lonche','mcdonalds','kfc','bembos','norky','pardos','la lucha','helado','limonada','jugo','gaseosa','bebida','agua mineral','wafer','choco','chocolate','caramelo','dulce','piqueo','sazonador','sazonadores','salsa','ketchup','mostaza','ají','ajo','condimento','fideos','atún','atun','conserva','arroz integral','verdura','verduras','carne','huevo','huevos','leche','yogurt','yogur','frugos','mercado','feria','minimarket','bodega','tamales','papa','papas','yuca','ensaladita','tostadas','cereal','avena','milo','nesquik','mantequilla','mermelada','queso'],
    cafe:['café','cafe','cappuccino','latte','té','te','frappé','frappe','milkshake','smoothie','starbucks','tambo','boba','matcha','cold brew'],
    transporte:['pasaje','bus','taxi','uber','metro','combi','moto','gasolina','grifo','estacionamiento','peaje','didi','beat','indrive','tren','aeropuerto','vuelo','mototaxi','colectivo','bicicleta','scooter','rappi moto','cabify'],
    telecom:['recarga','celular','internet','datos','spotify','netflix','youtube','disney','hbo','amazon prime','apple','suscripción','suscripcion','plan movil','cable','telefono','teléfono','canva','google','chatgpt','openai','claude','twitch','crunchyroll','paramount','star plus','directv'],
    compras:['zapatillas','ropa','zapatos','tienda','regalo','camisa','polo','pantalón','jean','short','vestido','mochila','cartera','lentes','reloj','mall','saga','ripley','oechsle','zara','nike','adidas','tottus','plaza vea','wong','sodimac','perfume','maquillaje','cosméticos','cosmeticos','accesorio','accesorios','bolso','billetera','gorra','casaca','abrigo','deportivo','falabella','hm','shein','amazon','aliexpress','jockey plaza'],
    entretenimiento:['cine','juego','fiesta','bar','discoteca','karaoke','concierto','evento','steam','play','videojuego','boleto','entrada','parque','juerga','cumpleaños','betano','apuesta','casino','trago','tragos','cerveza','vino','ron','pisco','copa','shots','chela','chelita'],
    hogar:['alquiler','renta','luz','agua','gas','limpieza','mueble','decoración','mantenimiento','reparación','lavandería','detergente','jabón','jabon','papel higienico','papel','toalla','escoba','trapeador','bolsa','bolsas','foco','pilas','pila','desinfectante','lejia','lejía','lavavajillas','suavizante','ambientador','balde'],
    salud:['farmacia','doctor','medicina','gym','gimnasio','dentista','hospital','clínica','clinica','pastilla','vitamina','crema','shampoo','higiene','terapia','consulta','botica','inkafarma','mifarma','acondicionador','desodorante','protector solar','hilo dental','cepillo','pasta dental','mascarilla','alcohol','algodón','curitas','termómetro','lentes de contacto'],
    educacion:['libro','curso','universidad','pucp','upn','upc','ulima','usil','unmsm','copias','impresión','cuaderno','lapicero','útiles','matrícula','pensión','academia','tutoría','certificado','examen','material','boleta pucp','mensualidad','udemy','coursera','platzi','bootcamp','taller','seminario','congreso','impresiones','folder','archivador'],
    otros:['yape','plin','tunki','lukita','agente','cajero','retiro','deuda','préstamo','prestamo','itf','comisión','comision','interés','interes','multa','penalidad','seguro','póliza','poliza']
  };
  let categoria='otros';
  for(const [cat,kws] of Object.entries(cats)){if(kws.some(k=>lower.includes(k))){categoria=cat;break;}}
  return {monto,tipo:'gasto',categoria,label:limpiarLabel(texto)};
}
function mensajeAlerta(alerta,catDisplay) {
  return alerta.tipo==='superado'
    ?`\n\n🔴 *¡Superaste tu límite en ${catDisplay}!*\nLlevás S/ ${alerta.totalMes.toFixed(2)} de S/ ${alerta.limite}`
    :`\n\n⚠️ *Llevas el ${Math.round(alerta.porcentaje)}% de tu límite en ${catDisplay}*\nS/ ${alerta.totalMes.toFixed(2)} de S/ ${alerta.limite}`;
}

async function enviarResumenSemanal() {
  const ahora=new Date(); const inicioSemana=new Date(ahora); inicioSemana.setDate(ahora.getDate()-7); inicioSemana.setHours(0,0,0,0);
  try {
    const usuariosSnap=await db.collection('usuarios_whatsapp').where('activo','==',true).get();
    for(const userDoc of usuariosSnap.docs){
      const {telefono}=userDoc.data();
      const snapshot=await db.collection('gastos').where('telefono','==',telefono).where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioSemana)).get();
      if(snapshot.empty) continue;
      let totalGastos=0,totalIngresos=0; const cats={};
      snapshot.forEach(doc=>{const d=doc.data();if(d.tipo==='ingreso'){totalIngresos+=d.monto;}else{totalGastos+=d.monto;cats[d.categoria]=(cats[d.categoria]||0)+d.monto;}});
      const topCat=Object.entries(cats).sort((a,b)=>b[1]-a[1])[0]; const balance=totalIngresos-totalGastos;
      let msg=`📅 *Resumen semanal Hormicash*\n━━━━━━━━━━━━━━\n💸 Gastos: S/ ${totalGastos.toFixed(2)}\n💰 Ingresos: S/ ${totalIngresos.toFixed(2)}\n${balance>=0?'🟢':'🔴'} Balance: S/ ${balance.toFixed(2)}\n`;
      if(topCat) msg+=`\n🏆 Mayor gasto: *${CATEGORIAS_DISPLAY[topCat[0]]||topCat[0]}* (S/ ${topCat[1].toFixed(2)})\n`;
      msg+=`\n_¡Sigue así! Registra tus gastos esta semana 💪_`;
      try{await twilioClient.messages.create({from:`whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,to:telefono,body:msg});}catch(e){console.error(`Error semanal ${telefono}:`,e.message);}
    }
  } catch(e){console.error('Error resumen semanal:',e);}
}

async function generarConsejoIA(telefono) {
  try {
    const inicioMes=new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
    const snapshot=await db.collection('gastos').where('telefono','==',telefono).where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes)).get();
    if(snapshot.empty) return null;
    let totalGastos=0,totalIngresos=0,count=0; const cats={};
    snapshot.forEach(doc=>{const d=doc.data();if(d.tipo==='ingreso'){totalIngresos+=d.monto;}else{totalGastos+=d.monto;count++;cats[d.categoria]=(cats[d.categoria]||0)+d.monto;}});
    const topCat=Object.entries(cats).sort((a,b)=>b[1]-a[1])[0]; const balance=totalIngresos-totalGastos;
    const model=genAI.getGenerativeModel({model:'gemini-2.5-flash-lite'});
    const prompt=`Eres un asesor financiero personal amigable para peruanos jóvenes.\nDatos del usuario este mes:\n- Total gastos: S/ ${totalGastos.toFixed(2)}\n- Total ingresos: S/ ${totalIngresos.toFixed(2)}\n- Balance: S/ ${balance.toFixed(2)}\n- Categoría con más gastos: ${topCat?`${topCat[0]} (S/ ${topCat[1].toFixed(2)})`:'N/A'}\n- Número de transacciones: ${count}\nDa UN consejo financiero corto, personalizado, práctico y motivador en español peruano.\nMáximo 2 oraciones. Sin asteriscos ni emojis excesivos. Solo el texto del consejo.`;
    const result=await model.generateContent(prompt);
    return result.response.text().trim();
  } catch(e){return null;}
}

async function enviarAvisosNocturno() {
  console.log('🌙 Ejecutando aviso nocturno...');
  const ahora=new Date(); const inicioDia=new Date(ahora.getFullYear(),ahora.getMonth(),ahora.getDate());
  const hace7dias=new Date(inicioDia); hace7dias.setDate(hace7dias.getDate()-7);
  const avisoJoin=`\n\n_💡 ¿Dejaste de recibir mis mensajes? Escribe *join worse-lying* al +1 415 523 8886 para reconectarte._`;
  try {
    const usuariosSnap=await db.collection('usuarios_whatsapp').where('activo','==',true).get();
    for(const userDoc of usuariosSnap.docs){
      const {telefono}=userDoc.data();
      const gastosRecientes=await db.collection('gastos').where('telefono','==',telefono).where('fecha','>=',admin.firestore.Timestamp.fromDate(hace7dias)).get();
      const diasConGastos=new Set();
      gastosRecientes.forEach(d=>{const f=d.data().fecha?.toDate?d.data().fecha.toDate():new Date(d.data().fecha);diasConGastos.add(`${f.getFullYear()}-${f.getMonth()}-${f.getDate()}`);});
      const hoyKey=`${ahora.getFullYear()}-${ahora.getMonth()}-${ahora.getDate()}`;
      if(diasConGastos.has(hoyKey)) continue;
      let diasSinRegistrar=0;
      for(let i=1;i<=7;i++){const d=new Date(inicioDia);d.setDate(d.getDate()-i);const key=`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;if(!diasConGastos.has(key))diasSinRegistrar++;else break;}
      let msg;
      if(diasSinRegistrar===0) msg=`🐜 *Hormicash — Recordatorio*\n\n¡Hola! Hoy no registraste ningún gasto todavía.\n\nEscríbeme: _"Almuerzo 15"_ o _"Taxi 8 soles"_${avisoJoin}`;
      else if(diasSinRegistrar===1) msg=`🐜 *Hormicash — ¿Todo bien?*\n\nLlevas 2 días sin registrar gastos 👀\n\n_"Café 5"_ o _"Bus 2.50"_${avisoJoin}`;
      else if(diasSinRegistrar<=3) msg=`⚠️ *Hormicash — Llevas ${diasSinRegistrar+1} días sin registrar*\n\nVuelve a registrar hoy:\n_"Almuerzo 15"_${avisoJoin}`;
      else msg=`🔥 *Hormicash — Más de una semana sin registrar*\n\nRetoma el control hoy 💪\n\nhttps://hormicash.web.app${avisoJoin}`;
      const inicioMes=new Date(ahora.getFullYear(),ahora.getMonth(),1);
      const gastosDelMes=await db.collection('gastos').where('telefono','==',telefono).where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes)).get();
      let totalMes=0; gastosDelMes.forEach(d=>{if(d.data().tipo!=='ingreso')totalMes+=d.data().monto||0;});
      try{
        await twilioClient.messages.create({from:`whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,to:telefono,body:msg});
        const userData=await obtenerEmailUsuario(telefono);
        if(userData?.email) await enviarEmailRecordatorio(userData.email,userData.nombre,diasSinRegistrar,totalMes);
      }catch(e){console.error(`❌ Error enviando a ${telefono}:`,e.message);}
    }
  }catch(e){console.error('Error aviso nocturno:',e);}
}

setInterval(()=>{
  const ahora=new Date(); const horaUTC=ahora.getUTCHours(),minUTC=ahora.getUTCMinutes();
  if((horaUTC===2||horaUTC===1)&&minUTC===0) enviarAvisosNocturno();
  if(ahora.getUTCDay()===1&&horaUTC===13&&minUTC===0) enviarResumenSemanal();
},60000);

app.get('/auth/gmail',(req,res)=>{res.redirect(oauth2Client.generateAuthUrl({access_type:'offline',scope:['https://www.googleapis.com/auth/gmail.send'],prompt:'consent'}));});
app.get('/oauth2callback',async(req,res)=>{try{const{tokens}=await oauth2Client.getToken(req.query.code);res.send(`<pre>REFRESH TOKEN:\n${tokens.refresh_token}</pre>`);}catch(e){res.send(`Error: ${e.message}`);}});

// ── WEBHOOK WHATSAPP ──────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body?.trim() || '';
  const telefono = req.body.From || '';
  const numMedia = parseInt(req.body.NumMedia || '0');
  const twiml = new twilio.twiml.MessagingResponse();
  const idioma = detectarIdioma(mensaje);

  const esJoin = mensaje.toLowerCase().startsWith('join ');
  if (!esJoin) {
    const docCheck = await db.collection('usuarios_whatsapp').doc(telefono).get();
    if (!docCheck.exists) {
      const pareceMensajeValido = /\d/.test(mensaje) || mensaje.startsWith('/');
      if (!pareceMensajeValido) {
        twiml.message(i18n.sinJoin[idioma] || i18n.sinJoin.es);
        return res.type('text/xml').send(twiml.toString());
      }
    }
  }

  const esNuevo = await registrarUsuario(telefono);
  if (esNuevo || idioma !== 'es') await db.collection('usuarios_whatsapp').doc(telefono).set({ idioma }, { merge: true });
  if (esNuevo) { estadoUsuario[telefono]={esperando:'bienvenida_limites'}; twiml.message(i18n.bienvenida[idioma](telefono)); return res.type('text/xml').send(twiml.toString()); }

  if (estadoUsuario[telefono]?.esperando==='bienvenida_limites') {
    if (mensaje==='1') {
      const premium=await esPremium(telefono);
      if (!premium) { delete estadoUsuario[telefono]; twiml.message(`⭐ *Función Premium*\n\nActiva tu plan en: https://hormicash.web.app\n\nPor ahora ya puedes registrar gastos 🐜`); }
      else { estadoUsuario[telefono]={esperando:'limite_categoria',limites:{},categoriaIndex:0}; twiml.message(`💰 ¿Límite mensual para *${CATEGORIAS_DISPLAY[CATEGORIAS[0]]}*?\n\nEscribe el monto o _"saltar"_.\n_(1 de ${CATEGORIAS.length})_`); }
    } else { delete estadoUsuario[telefono]; twiml.message(`¡Perfecto! Edita tus límites en:\nhttps://hormicash.web.app\n\nEscribe _"Almuerzo 15"_ para empezar 🐜`); }
    return res.type('text/xml').send(twiml.toString());
  }

  if (estadoUsuario[telefono]?.esperando==='meta_ahorro') {
    delete estadoUsuario[telefono];
    const meta=parseFloat(mensaje.replace(',','.'));
    if (isNaN(meta)||meta<=0) twiml.message('❌ Monto inválido. Escribe /meta para intentar de nuevo.');
    else { await db.collection('usuarios_whatsapp').doc(telefono).set({meta_ahorro:meta},{merge:true}); twiml.message(`🎯 *¡Meta configurada!*\n\nQuieres ahorrar *S/ ${meta.toFixed(0)}* este mes.\n\nVe tu progreso en: https://hormicash.web.app\n\n💪 ¡Tú puedes lograrlo!`); }
    return res.type('text/xml').send(twiml.toString());
  }

  if (estadoUsuario[telefono]?.esperando==='limite_categoria') {
    const estado=estadoUsuario[telefono];
    if (mensaje.toLowerCase()!=='saltar') { const monto=parseFloat(mensaje.replace(',','.')); if(!isNaN(monto)&&monto>0) estado.limites[CATEGORIAS[estado.categoriaIndex]]=monto; }
    estado.categoriaIndex++;
    if (estado.categoriaIndex<CATEGORIAS.length) twiml.message(`💰 ¿Límite para *${CATEGORIAS_DISPLAY[CATEGORIAS[estado.categoriaIndex]]}*?\n\nEscribe el monto o _"saltar"_.\n_(${estado.categoriaIndex+1} de ${CATEGORIAS.length})_`);
    else { await db.collection('usuarios_whatsapp').doc(telefono).set({limites:estado.limites},{merge:true}); delete estadoUsuario[telefono]; const resumen=Object.entries(estado.limites).map(([c,m])=>`  • ${CATEGORIAS_DISPLAY[c]}: S/ ${m}`).join('\n'); twiml.message(`✅ *¡Límites configurados!*\n\n${resumen}\n\nTe avisaré cuando te acerques 🎯\nEdítalos en: https://hormicash.web.app`); }
    return res.type('text/xml').send(twiml.toString());
  }

  if (estadoUsuario[telefono]?.esperando==='confirmar_borrar') {
    const estado=estadoUsuario[telefono]; const opcion=parseInt(mensaje.trim()); delete estadoUsuario[telefono];
    if (mensaje.toLowerCase()==='cancelar'||isNaN(opcion)) { twiml.message('❌ Cancelado. No se eliminó ningún gasto.'); return res.type('text/xml').send(twiml.toString()); }
    const gastoABorrar=estado.gastos[opcion-1];
    if (!gastoABorrar) { twiml.message('❌ Número inválido. Escribe /borrar para intentar de nuevo.'); return res.type('text/xml').send(twiml.toString()); }
    try { await db.collection('gastos').doc(gastoABorrar.id).delete(); twiml.message(`🗑️ *Gasto eliminado*\n\n_${gastoABorrar.label}_ — S/ ${gastoABorrar.monto.toFixed(2)}\n\nEscribe /resumen para ver tu balance actualizado.`); }
    catch(e) { twiml.message('❌ No pude eliminar el gasto. Intenta de nuevo.'); }
    return res.type('text/xml').send(twiml.toString());
  }

  if (numMedia > 0) {
    const mediaUrl=req.body.MediaUrl0, mediaMime=req.body.MediaContentType0||'image/jpeg';
    try {
      const {base64,mimeType}=await downloadTwilioMedia(mediaUrl); const mime=mimeType||mediaMime;
      if (mediaMime.startsWith('audio/')) {
        const audio=await extractAudioData(base64,mime);
        if (audio.error==='no_monto') { twiml.message('🎙️ No pude identificar un monto.\nIntenta: "Almuerzo en La Lucha, veinte soles"'); return res.type('text/xml').send(twiml.toString()); }
        const esIngreso=audio.tipo==='ingreso', cat=audio.categoria?.toLowerCase()||'otros', labelAudio=audio.negocio||audio.descripcion||(esIngreso?'Ingreso por voz':'Gasto por voz');
        await db.collection('gastos').add({telefono,monto:audio.monto,tipo:audio.tipo||'gasto',categoria:cat,label:labelAudio,descripcion:audio.descripcion,fuente:'audio_whatsapp',mensaje:'[audio]',fecha:admin.firestore.FieldValue.serverTimestamp()});
        let resp=esIngreso?`💰 *Ingreso por voz*\n\n💵 S/ ${audio.monto.toFixed(2)}\n📝 ${labelAudio}\n\nEscribe /resumen para ver tu balance`:`✅ *Gasto por voz*\n\n🏪 ${labelAudio}\n💰 S/ ${audio.monto.toFixed(2)}\n📂 ${CATEGORIAS_DISPLAY[cat]||cat}\n\nEscribe /resumen para ver tu balance`;
        if(!esIngreso){const a=await verificarLimite(telefono,cat,audio.monto);if(a)resp+=mensajeAlerta(a,CATEGORIAS_DISPLAY[cat]||cat);const alerta=await verificarAlertaContextual(telefono,cat,audio.monto);if(alerta)resp+=`\n\n💡 Hoy ya llevas S/ ${alerta.totalHoy} en ${alerta.catDisplay}, por encima de tu promedio diario (S/ ${alerta.promedio})`;}
        twiml.message(resp);
      } else {
        const voucher=await extractVoucherData(base64,mime);
        if (voucher.error==='no_voucher') { twiml.message('📸 No pude identificar un voucher.\nEnvía una foto clara de tu ticket.'); return res.type('text/xml').send(twiml.toString()); }
        const cat=voucher.categoria?.toLowerCase()||'otros', labelVoucher=voucher.negocio||'Voucher';
        await db.collection('gastos').add({telefono,monto:voucher.monto,tipo:'gasto',categoria:cat,label:labelVoucher,descripcion:voucher.descripcion,fecha_voucher:voucher.fecha,fuente:'voucher_whatsapp',mensaje:'[imagen]',fecha:admin.firestore.FieldValue.serverTimestamp()});
        let resp=`✅ *Voucher registrado*\n\n🏪 ${labelVoucher}\n💰 S/ ${voucher.monto.toFixed(2)}\n📂 ${CATEGORIAS_DISPLAY[cat]||cat}\n📝 ${voucher.descripcion}\n\nEscribe /resumen para ver tu balance`;
        const a=await verificarLimite(telefono,cat,voucher.monto);if(a)resp+=mensajeAlerta(a,CATEGORIAS_DISPLAY[cat]||cat);
        const alerta=await verificarAlertaContextual(telefono,cat,voucher.monto);if(alerta)resp+=`\n\n💡 Hoy ya llevas S/ ${alerta.totalHoy} en ${alerta.catDisplay}, por encima de tu promedio diario (S/ ${alerta.promedio})`;
        twiml.message(resp);
      }
    }catch(err){console.error('Error media:',err);twiml.message('❌ No pude procesar el archivo. Intenta de nuevo.');}
    return res.type('text/xml').send(twiml.toString());
  }

  if (estadoUsuario[telefono]?.esperando==='resumen') {
    const opcion=mensaje; delete estadoUsuario[telefono];
    const ahora=new Date(); let desde,periodo;
    const offsetPeru = 5*60*60*1000;
    if(opcion==='1'){desde=new Date(new Date(ahora.getFullYear(),ahora.getMonth(),ahora.getDate()).getTime()+offsetPeru);periodo='Hoy';}
    else if(opcion==='2'){desde=new Date(ahora.getTime()-(7*24*60*60*1000));desde=new Date(new Date(desde.getFullYear(),desde.getMonth(),desde.getDate()).getTime()+offsetPeru);periodo='Esta semana';}
    else if(opcion==='3'){desde=new Date(new Date(ahora.getFullYear(),ahora.getMonth(),1).getTime()+offsetPeru);periodo='Este mes';}
    else{twiml.message('❌ Opción no válida.\nEscribe /resumen para intentar de nuevo.');return res.type('text/xml').send(twiml.toString());}
    const snapshot=await db.collection('gastos').where('telefono','==',telefono).where('fecha','>=',admin.firestore.Timestamp.fromDate(desde)).get();
    let totalGastos=0,totalIngresos=0,totalTarjeta=0; const cats={};
    snapshot.forEach(doc=>{const d=doc.data();if(d.tipo==='ingreso'){totalIngresos+=d.monto;}else{totalGastos+=d.monto;cats[d.categoria]=(cats[d.categoria]||0)+d.monto;if(d.fuente_pago==='tarjeta')totalTarjeta+=d.monto;}});
    let resCats=''; for(const[c,m]of Object.entries(cats)) resCats+=`  • ${CATEGORIAS_DISPLAY[c]||c}: S/ ${m.toFixed(2)}\n`;
    const balance=totalIngresos-totalGastos;
    let msg=`📊 *Resumen - ${periodo}*\n━━━━━━━━━━━━━━\n💸 Gastos: S/ ${totalGastos.toFixed(2)}\n${resCats}💰 Ingresos: S/ ${totalIngresos.toFixed(2)}\n━━━━━━━━━━━━━━\n${balance>=0?'🟢':'🔴'} Balance: S/ ${balance.toFixed(2)}`;
    if(totalTarjeta>0) msg+=`\n\n💳 Tarjeta de crédito: S/ ${totalTarjeta.toFixed(2)}`;
    twiml.message(msg); return res.type('text/xml').send(twiml.toString());
  }

  if (mensaje.toLowerCase()==='/resumen') { estadoUsuario[telefono]={esperando:'resumen'}; twiml.message(`📊 *¿Qué resumen deseas?*\n\n1️⃣ Hoy\n2️⃣ Esta semana\n3️⃣ Este mes\n\nResponde con el número.`); return res.type('text/xml').send(twiml.toString()); }

  // ── /BORRAR ───────────────────────────────────────────────────
  if (mensaje.toLowerCase()==='/borrar'||mensaje.toLowerCase()==='/delete'||mensaje.toLowerCase()==='/deletar') {
    try {
      const snapshot = await db.collection('gastos')
        .where('telefono', '==', telefono)
        .orderBy('fecha', 'desc')
        .limit(10)
        .get();
      if (snapshot.empty) { twiml.message('📭 No tienes gastos registrados para eliminar.'); return res.type('text/xml').send(twiml.toString()); }
      const gastos = [];
      snapshot.forEach(doc => {
        const d = doc.data();
        if (d.tipo === 'ingreso') return;
        if (gastos.length >= 5) return;
        gastos.push({ id: doc.id, label: d.label || d.descripcion || '—', monto: d.monto || 0, fecha: d.fecha?.toDate ? d.fecha.toDate() : new Date() });
      });
      if (gastos.length === 0) { twiml.message('📭 No tienes gastos registrados para eliminar.'); return res.type('text/xml').send(twiml.toString()); }
      let lista = `🗑️ *¿Cuál gasto quieres eliminar?*\n\n`;
      gastos.forEach((g, i) => {
        const fechaStr = g.fecha.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' });
        lista += `${i + 1}️⃣ ${g.label} — S/ ${g.monto.toFixed(2)} _(${fechaStr})_\n`;
      });
      lista += `\nResponde con el número o escribe *cancelar*.`;
      estadoUsuario[telefono] = { esperando: 'confirmar_borrar', gastos };
      twiml.message(lista);
    } catch(e) { console.error('Error en /borrar:', e); twiml.message('❌ No pude cargar tus gastos. Intenta de nuevo.'); }
    return res.type('text/xml').send(twiml.toString());
  }

  if (mensaje.toLowerCase()==='/limites') { const premium=await esPremium(telefono); if(!premium){twiml.message(`⭐ *Función Premium*\n\nActívala en: https://hormicash.web.app`);return res.type('text/xml').send(twiml.toString());} estadoUsuario[telefono]={esperando:'limite_categoria',limites:{},categoriaIndex:0}; twiml.message(`💰 *Configurar límites*\n\n¿Límite para *${CATEGORIAS_DISPLAY[CATEGORIAS[0]]}*?\n\nEscribe el monto o _"saltar"_.\n_(1 de ${CATEGORIAS.length})_`); return res.type('text/xml').send(twiml.toString()); }

  if (mensaje.toLowerCase()==='/consejo') {
    const premium=await esPremium(telefono); if(!premium){twiml.message(`⭐ *Función Premium*\n\nActívala en: https://hormicash.web.app`);return res.type('text/xml').send(twiml.toString());}
    twiml.message('💡 Analizando tus gastos...'); res.type('text/xml').send(twiml.toString());
    const consejo=await generarConsejoIA(telefono); if(consejo) await twilioClient.messages.create({from:`whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,to:telefono,body:`💡 *Consejo personalizado*\n\n${consejo}`}); return;
  }

  if (mensaje.toLowerCase()==='/meta') { const premium=await esPremium(telefono); if(!premium){twiml.message(`⭐ *Función Premium*\n\nActívala en: https://hormicash.web.app`);return res.type('text/xml').send(twiml.toString());} estadoUsuario[telefono]={esperando:'meta_ahorro'}; twiml.message(`🎯 *Meta de ahorro mensual*\n\n¿Cuánto quieres ahorrar este mes?\nEscribe el monto en soles:`); return res.type('text/xml').send(twiml.toString()); }

  const esTarjeta=detectarTarjeta(mensaje), mensajeLimpio=esTarjeta?limpiarTextoTC(mensaje):mensaje;
  const multiples=parsearMultiplesMovimientos(mensajeLimpio);
  if (multiples) {
    let respuesta=`✅ *${multiples.length} gastos registrados*${esTarjeta?' 💳':''}\n\n`;
    for(const mov of multiples){const gastoData={telefono,monto:mov.monto,tipo:mov.tipo,categoria:mov.categoria,label:mov.label,fuente:'texto_whatsapp',mensaje:mov.textoOriginal,fecha:admin.firestore.FieldValue.serverTimestamp()};if(esTarjeta)gastoData.fuente_pago='tarjeta';await db.collection('gastos').add(gastoData);if(esTarjeta)await actualizarGastoTarjeta(telefono,mov.monto);respuesta+=`${mov.tipo==='ingreso'?'💰':'🐜'}${esTarjeta?' 💳':''} *${mov.label}* — S/ ${mov.monto.toFixed(2)} (${CATEGORIAS_DISPLAY[mov.categoria]||mov.categoria})\n`;}
    respuesta+=`\nEscribe /resumen para ver tu balance`; twiml.message(respuesta); return res.type('text/xml').send(twiml.toString());
  }

  const mov=parsearMovimiento(mensajeLimpio);
  if (!mov) {
    const userDoc=await db.collection('usuarios_whatsapp').doc(telefono).get();
    twiml.message(i18n.noEntendi[userDoc.data()?.idioma||'es']||i18n.noEntendi.es);
  } else {
    const gastoData={telefono,monto:mov.monto,tipo:mov.tipo,categoria:mov.categoria,label:mov.label,fuente:'texto_whatsapp',mensaje,fecha:admin.firestore.FieldValue.serverTimestamp()};
    if(esTarjeta) gastoData.fuente_pago='tarjeta';
    await db.collection('gastos').add(gastoData);
    let resp;
    if(esTarjeta){await actualizarGastoTarjeta(telefono,mov.monto);resp=`💳 *Gasto con tarjeta registrado*\n\n🏪 ${mov.label}\n💰 S/ ${mov.monto.toFixed(2)}\n📂 ${CATEGORIAS_DISPLAY[mov.categoria]||mov.categoria}\n\n_Registrado en tu tarjeta de crédito_\nEscribe /resumen para ver tu balance`;}
    else if(mov.tipo==='ingreso') resp=`💰 S/ ${mov.monto.toFixed(2)} ingreso registrado\n📝 ${mov.label}\nEscribe /resumen para ver tu balance`;
    else resp=`✅ S/ ${mov.monto.toFixed(2)} gasto registrado\n🐜 ${mov.label}\nEscribe /resumen para ver tu balance`;
    if(mov.tipo==='gasto'){const a=await verificarLimite(telefono,mov.categoria,mov.monto);if(a)resp+=mensajeAlerta(a,CATEGORIAS_DISPLAY[mov.categoria]||mov.categoria);const alerta=await verificarAlertaContextual(telefono,mov.categoria,mov.monto);if(alerta)resp+=`\n\n💡 Hoy ya llevas S/ ${alerta.totalHoy} en ${alerta.catDisplay}, por encima de tu promedio diario (S/ ${alerta.promedio})`;}
    twiml.message(resp);
  }
  res.type('text/xml').send(twiml.toString());
});

// ── ENDPOINT ANÁLISIS MES CON GEMINI ─────────────────────────────
app.post('/api/analisis-mes', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Falta el prompt' });
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const result = await model.generateContent(prompt);
    res.json({ texto: result.response.text().trim() });
  } catch(e) { console.error('Error análisis mes:', e); res.status(500).json({ error: e.message }); }
});

app.post('/recategorizar', async (req, res) => {
  const { clave } = req.body;
  if (clave !== 'hormicash_admin_2024') return res.json({ error: 'No autorizado' });
  const CATS_VALIDAS = ['comida','cafe','transporte','telecom','compras','entretenimiento','hogar','salud','educacion','otros'];
  async function categorizarGemini(label) {
    try {
      const model=genAI.getGenerativeModel({model:'gemini-2.5-flash-lite'});
      const result=await model.generateContent(`Clasifica este gasto en UNA categoría exacta: comida, cafe, transporte, telecom, compras, entretenimiento, hogar, salud, educacion, otros.\nGasto: "${label}"\nResponde SOLO con la categoría, sin explicación.`);
      const cat=result.response.text().trim().toLowerCase().replace(/[^a-záéíóúñ]/g,'');
      return CATS_VALIDAS.includes(cat)?cat:'otros';
    } catch(e){return 'otros';}
  }
  try {
    const snap=await db.collection('gastos').get();
    const todos=snap.docs.filter(d=>{const data=d.data();return(data.tipo==='gasto'||(!data.tipo&&data.monto))&&data.categoria==='otros';});
    let procesados=0,errores=0;
    for(let i=0;i<todos.length;i+=5){
      const lote=todos.slice(i,i+5);
      await Promise.all(lote.map(async(d)=>{try{const data=d.data();const label=data.label||data.mensaje||'';if(!label||label==='[imagen]'||label==='[audio]')return;const cat=await categorizarGemini(label);await db.collection('gastos').doc(d.id).update({categoria:cat});procesados++;}catch(e){errores++;}}));
      await new Promise(r=>setTimeout(r,500));
    }
    res.json({procesados,errores,total:todos.length});
  }catch(e){res.json({error:e.message});}
});

app.get('/',(req,res)=>res.send('🐜 Hormicash Bot corriendo'));
app.get('/test-email',async(req,res)=>{const email=req.query.email;if(!email)return res.send('Falta ?email=');try{await enviarEmailRecordatorio(email,'Stefano',2,1165);res.send(`✅ Email enviado a ${email}`);}catch(e){res.send(`❌ Error: ${e.message}`);}});
app.get('/usuarios-emails',async(req,res)=>{try{const snap=await db.collection('usuarios').get();const usuarios=[];snap.forEach(d=>{const data=d.data();if(data.email)usuarios.push({nombre:data.nombre?.split(' ')[0]||'Usuario',email:data.email,plan:data.plan||'free',telefono:data.telefono||''});});res.json({total:usuarios.length,usuarios});}catch(e){res.json({error:e.message});}});
app.get('/enviar-recordatorio-todos',async(req,res)=>{if(req.query.clave!==process.env.ADMIN_SECRET)return res.send('❌ No autorizado');try{const snap=await db.collection('usuarios').get();let enviados=0,errores=0,resultados=[];for(const d of snap.docs){const data=d.data();if(!data.email)continue;const nombre=data.nombre?.split(' ')[0]||'Usuario';try{await enviarEmailRecordatorio(data.email,nombre,1,0);enviados++;resultados.push({email:data.email,status:'✅'});await new Promise(r=>setTimeout(r,200));}catch(e){errores++;resultados.push({email:data.email,status:`❌ ${e.message}`});}}res.json({enviados,errores,resultados});}catch(e){res.json({error:e.message});}});

app.post('/api/claude', async (req, res) => {
  try {
    const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify(req.body)});
    res.json(await response.json());
  }catch(e){res.status(500).json({error:e.message});}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));