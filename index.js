require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Resend } = require('resend');
const { google } = require('googleapis');

const resend = new Resend(process.env.RESEND_API_KEY);

// ── GMAIL OAUTH2 ──────────────────────────────────────────────────
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'https://hormicash-bot-production.up.railway.app/oauth2callback'
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

async function enviarConGmailAPI(to, subject, html) {
  const { token } = await oauth2Client.getAccessToken();

  const message = [
    `To: ${to}`,
    `From: "Hormicash 🐜" <${process.env.GMAIL_USER}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    html
  ].join('\n');

  const encoded = Buffer.from(message).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await axios.post(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
    { raw: encoded },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ── OBTENER EMAIL DEL USUARIO POR TELÉFONO ───────────────────────
async function obtenerEmailUsuario(telefono) {
  try {
    const snap = await db.collection('usuarios')
      .where('telefono', '==', telefono)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const data = snap.docs[0].data();
    return { email: data.email, nombre: data.nombre?.split(' ')[0] || 'Usuario' };
  } catch(e) { console.error('Error obteniendo email:', e); return null; }
}

// ── ENVIAR EMAIL DE RECORDATORIO ─────────────────────────────────
async function enviarEmailRecordatorio(email, nombre, diasSinRegistrar, totalMes) {
  const cur = 'S/';
  const subjects = [
    `🐜 Hormicash — ¿Registraste tus gastos hoy?`,
    `⚠️ Hormicash — Llevas ${diasSinRegistrar + 1} días sin registrar`,
    `🔥 Hormicash — Retoma el control de tus finanzas`
  ];
  const subjectIdx = diasSinRegistrar === 0 ? 0 : diasSinRegistrar <= 3 ? 1 : 2;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Inter',Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:28px;font-weight:800;color:#f59e0b">Hormi<span style="color:#22c55e">cash</span></div>
      <div style="font-size:13px;color:#8492a6;margin-top:4px">Controla tus gastos hormiga 🐜</div>
    </div>
    <div style="background:#ffffff;border-radius:16px;padding:28px 24px;box-shadow:0 2px 12px rgba(0,0,0,0.06);margin-bottom:16px">
      <div style="font-size:22px;font-weight:800;color:#1a1f36;margin-bottom:8px">
        ${diasSinRegistrar === 0
          ? `¡Hola ${nombre}! 👋`
          : diasSinRegistrar <= 3
          ? `${nombre}, llevas ${diasSinRegistrar + 1} días sin registrar 👀`
          : `${nombre}, más de una semana sin registrar 🔥`}
      </div>
      <div style="font-size:15px;color:#4a5568;line-height:1.6;margin-bottom:20px">
        ${diasSinRegistrar === 0
          ? `Hoy no has registrado ningún gasto todavía. Los gastos hormiga se acumulan sin que te des cuenta — un café aquí, un taxi allá, y al final del mes te preguntas a dónde fue tu plata.`
          : diasSinRegistrar <= 3
          ? `Llevas ${diasSinRegistrar + 1} días sin registrar tus gastos. Este mes ya llevas <strong>${cur} ${totalMes.toFixed(0)}</strong> registrado, pero podrías estar perdiendo el rastro de mucho más.`
          : `Han pasado más de 7 días sin que registres ningún gasto. Sin datos, no puedes saber en qué se va tu dinero. Retoma el control hoy.`}
      </div>
      ${totalMes > 0 ? `
      <div style="background:#f4f6fb;border-radius:10px;padding:14px 16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:13px;color:#8492a6">Registrado este mes</div>
        <div style="font-size:20px;font-weight:800;color:#ef4444">${cur} ${totalMes.toFixed(0)}</div>
      </div>` : ''}
      <div style="font-size:13px;color:#8492a6;margin-bottom:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Regístralo por WhatsApp:</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
        <span style="background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:600">"Almuerzo 15"</span>
        <span style="background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:600">"Taxi 8"</span>
        <span style="background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:600">"Café 5"</span>
      </div>
      <a href="https://hormicash.web.app" style="display:block;text-align:center;background:linear-gradient(135deg,#f59e0b,#22c55e);color:white;text-decoration:none;padding:14px 24px;border-radius:12px;font-size:15px;font-weight:700">
        Ver mi dashboard →
      </a>
    </div>
    <div style="text-align:center;font-size:12px;color:#8492a6;line-height:1.6">
      Recibes este email porque estás registrado en Hormicash.<br>
      <a href="https://hormicash.web.app" style="color:#a78bfa;text-decoration:none">hormicash.web.app</a>
    </div>
  </div>
</body>
</html>`;

  await enviarConGmailAPI(email, subjects[subjectIdx], html);
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const estadoUsuario = {};

const CATEGORIAS = ['comida','cafe','transporte','telecom','entretenimiento','salud','educacion','ropa','hogar','otros'];
const CATEGORIAS_DISPLAY = {
  comida:'🍔 Comida', cafe:'☕ Café', transporte:'🚌 Transporte', telecom:'📱 Telecom',
  entretenimiento:'🎬 Entretenimiento', salud:'💊 Salud', educacion:'📚 Educación',
  ropa:'👕 Ropa', hogar:'🏠 Hogar', otros:'📦 Otros'
};

const TC_KEYWORDS = ['tc', 'credito', 'crédito', 'tarjeta', 'visa', 'mastercard', 'amex', 'credit'];

function detectarTarjeta(texto) {
  const lower = texto.toLowerCase();
  return TC_KEYWORDS.some(k => {
    const regex = new RegExp(`(^|\\s|[-,])${k}(\\s|[-,]|$)`, 'i');
    return regex.test(lower);
  });
}

function limpiarTextoTC(texto) {
  let limpio = texto;
  limpio = limpio.replace(/^(tc|credito|crédito|tarjeta|visa|mastercard|amex|credit)\s+/gi, '');
  TC_KEYWORDS.forEach(k => {
    const regex = new RegExp(`\\s*[-,]?\\s*\\b${k}\\b\\s*[-,]?\\s*`, 'gi');
    limpio = limpio.replace(regex, ' ');
  });
  return limpio.trim();
}

async function esPremium(telefono) {
  try {
    const doc = await db.collection('usuarios_whatsapp').doc(telefono).get();
    return doc.exists && doc.data().plan === 'premium';
  } catch(e) { return false; }
}

async function registrarUsuario(telefono) {
  try {
    const doc = await db.collection('usuarios_whatsapp').doc(telefono).get();
    const esNuevo = !doc.exists;
    await db.collection('usuarios_whatsapp').doc(telefono).set({
      telefono,
      ultimo_mensaje: admin.firestore.FieldValue.serverTimestamp(),
      activo: true
    }, { merge: true });
    return esNuevo;
  } catch(e) { return false; }
}

async function verificarLimite(telefono, categoria, montoNuevo) {
  try {
    const userDoc = await db.collection('usuarios_whatsapp').doc(telefono).get();
    if (!userDoc.exists) return null;
    const userData = userDoc.data();
    if (userData.plan !== 'premium') return null;
    const limites = userData.limites || {};
    const limite = limites[categoria];
    if (!limite) return null;
    const inicioMes = new Date();
    inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
    const snapshot = await db.collection('gastos')
      .where('telefono','==',telefono)
      .where('categoria','==',categoria)
      .where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes))
      .get();
    let totalMes = 0;
    snapshot.forEach(doc => { totalMes += doc.data().monto; });
    totalMes += montoNuevo;
    const porcentaje = (totalMes / limite) * 100;
    if (porcentaje >= 100) return { tipo:'superado', totalMes, limite, porcentaje };
    if (porcentaje >= 80) return { tipo:'advertencia', totalMes, limite, porcentaje };
    return null;
  } catch(e) { return null; }
}

async function verificarAlertaContextual(telefono, categoria, montoNuevo) {
  try {
    const inicioMes = new Date();
    inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
    const hoy = new Date();
    const inicioDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const diasTranscurridos = Math.max(hoy.getDate(), 1);
    const snapshot = await db.collection('gastos')
      .where('telefono','==',telefono)
      .where('categoria','==',categoria)
      .where('tipo','==','gasto')
      .where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes))
      .get();
    let totalMes = 0, totalHoy = 0;
    snapshot.forEach(doc => {
      const d = doc.data();
      totalMes += d.monto;
      const fecha = d.fecha?.toDate ? d.fecha.toDate() : new Date(d.fecha);
      if (fecha >= inicioDia) totalHoy += d.monto;
    });
    totalHoy += montoNuevo;
    const promedioDiario = totalMes / diasTranscurridos;
    if (promedioDiario > 0 && totalHoy > promedioDiario * 1.5) {
      return {
        catDisplay: CATEGORIAS_DISPLAY[categoria] || categoria,
        totalHoy: totalHoy.toFixed(2),
        promedio: promedioDiario.toFixed(2)
      };
    }
    return null;
  } catch(e) { return null; }
}

async function actualizarGastoTarjeta(telefono, monto) {
  try {
    const userDoc = await db.collection('usuarios_whatsapp').doc(telefono).get();
    if (!userDoc.exists) return;
    const uid = userDoc.data().uid;
    if (!uid) return;
    const userRef = db.collection('usuarios').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) return;
    const tarjeta = snap.data().tarjeta || {};
    const gastoActual = (tarjeta.gasto_actual || 0) + monto;
    await userRef.update({ 'tarjeta.gasto_actual': gastoActual });
  } catch(e) { console.error('Error actualizando gasto tarjeta:', e.message); }
}

async function downloadTwilioMedia(mediaUrl) {
  const response = await axios.get(mediaUrl, {
    auth: { username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN },
    responseType: 'arraybuffer',
  });
  return { base64: Buffer.from(response.data).toString('base64'), mimeType: response.headers['content-type'] || 'image/jpeg' };
}

async function extractVoucherData(base64, mimeType) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
  const prompt = `Analiza este voucher, ticket o recibo y extrae la información del gasto.
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown, sin backticks.
Formato: {"negocio":"","monto":0.00,"moneda":"PEN","categoria":"Comida|Transporte|Entretenimiento|Salud|Educación|Ropa|Tecnología|Hogar|Otros","fecha":"YYYY-MM-DD o null","descripcion":""}
Si no es voucher: {"error":"no_voucher"}`;
  const result = await model.generateContent([{ inlineData: { data: base64, mimeType } }, prompt]);
  return JSON.parse(result.response.text().trim().replace(/```json|```/g,'').trim());
}

async function extractAudioData(base64, mimeType) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
  const prompt = `Escucha este audio y extrae el gasto o ingreso mencionado.
Responde ÚNICAMENTE JSON: {"tipo":"gasto|ingreso","negocio":"null o nombre","monto":0.00,"moneda":"PEN","categoria":"Comida|Transporte|Entretenimiento|Salud|Educación|Ropa|Tecnología|Hogar|Otros","descripcion":""}
Si no hay monto: {"error":"no_monto"}`;
  const result = await model.generateContent([{ inlineData: { data: base64, mimeType } }, prompt]);
  return JSON.parse(result.response.text().trim().replace(/```json|```/g,'').trim());
}

function limpiarLabel(texto) {
  let label = texto
    .replace(/\d+(?:[.,]\d{1,2})?\s*(?:soles?|sol|s\/)?/gi, '')
    .replace(/\b(y|e|de|en|al|el|la|los|las|un|una|con|para|por)\b/gi, ' ')
    .replace(/[^\w\sáéíóúñü]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (label.length < 2) label = 'Gasto';
  label = label.charAt(0).toUpperCase() + label.slice(1);
  return label.length > 25 ? label.substring(0, 25).trim() : label;
}

function parsearMultiplesMovimientos(texto) {
  const separadores = /\s+(?:y|e|,)\s+/gi;
  const partes = texto.split(separadores);
  if (partes.length <= 1) return null;
  const movimientos = [];
  for (const parte of partes) {
    const mov = parsearMovimiento(parte.trim());
    if (mov) movimientos.push({ ...mov, textoOriginal: parte.trim() });
  }
  return movimientos.length >= 2 ? movimientos : null;
}

function parsearMovimiento(texto) {
  const lower = texto.toLowerCase();
  const match = lower.match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const monto = parseFloat(match[1].replace(',','.'));
  if (isNaN(monto) || monto <= 0) return null;
  const ingresosKeywords = ['ingreso','sueldo','salario','pago','transferencia','depósito','deposito','freelance','propina','bono','regalo','cobro','cobré','cobre','me pagaron','ganancia'];
  if (ingresosKeywords.some(k => lower.includes(k))) {
    return { monto, tipo:'ingreso', categoria:'ingreso', label: limpiarLabel(texto) };
  }
  const cats = {
    comida:['almuerzo','comida','pollo','arroz','ceviche','menu','desayuno','cena','sandwich','pan','pizza','burger','hamburguesa','chifa','sushi','empanada','salchipapa','broaster','lomo','causa','sopa','tallarines','chaufa','anticucho','chicharron','fruta','ensalada','galleta','snack','lonche','mcdonalds','kfc','bembos','norky','pardos','la lucha','helado'],
    cafe:['café','cafe','cappuccino','latte','té','te','jugo','gaseosa','cerveza','trago','vino','frappé','frappe','milkshake','smoothie','chocolate','starbucks','tambo','boba'],
    transporte:['pasaje','bus','taxi','uber','metro','combi','moto','gasolina','grifo','estacionamiento','peaje','didi','beat','indrive','tren','aeropuerto','vuelo'],
    telecom:['recarga','celular','internet','datos','spotify','netflix','youtube','disney','hbo','amazon prime','apple','suscripción','suscripcion','plan movil','cable','telefono','teléfono','canva','google'],
    compras:['zapatillas','ropa','zapatos','tienda','regalo','camisa','polo','pantalón','jean','short','vestido','mochila','cartera','lentes','reloj','mall','saga','ripley','oechsle','zara','nike','adidas','tottus','plaza vea','wong','sodimac','perfume','maquillaje'],
    entretenimiento:['cine','juego','fiesta','bar','discoteca','karaoke','concierto','evento','steam','play','videojuego','boleto','entrada','parque','juerga','cumpleaños'],
    hogar:['alquiler','renta','luz','agua','gas','limpieza','mueble','decoración','mantenimiento','reparación','lavandería','detergente'],
    salud:['farmacia','doctor','medicina','gym','gimnasio','dentista','hospital','clínica','clinica','pastilla','vitamina','crema','shampoo','higiene','terapia','consulta','botica','inkafarma','mifarma'],
    educacion:['libro','curso','universidad','pucp','upn','upc','ulima','usil','unmsm','copias','impresión','cuaderno','lapicero','útiles','matrícula','pensión','academia','tutoría','certificado','examen','material','boleta pucp','mensualidad'],
    otros:['yape','plin','tunki','billetera','transferencia','deposito','depósito','lukita','agente','cajero','retiro','deuda','préstamo']
  };
  let categoria = 'otros';
  for (const [cat,kws] of Object.entries(cats)) { if (kws.some(k=>lower.includes(k))) { categoria=cat; break; } }
  return { monto, tipo:'gasto', categoria, label: limpiarLabel(texto) };
}

function mensajeAlerta(alerta, catDisplay) {
  return alerta.tipo === 'superado'
    ? `\n\n🔴 *¡Superaste tu límite en ${catDisplay}!*\nLlevás S/ ${alerta.totalMes.toFixed(2)} de S/ ${alerta.limite}`
    : `\n\n⚠️ *Llevas el ${Math.round(alerta.porcentaje)}% de tu límite en ${catDisplay}*\nS/ ${alerta.totalMes.toFixed(2)} de S/ ${alerta.limite}`;
}

async function enviarResumenSemanal() {
  console.log('📅 Enviando resumen semanal...');
  const ahora = new Date();
  const inicioSemana = new Date(ahora);
  inicioSemana.setDate(ahora.getDate() - 7);
  inicioSemana.setHours(0,0,0,0);
  try {
    const usuariosSnap = await db.collection('usuarios_whatsapp').where('activo','==',true).get();
    for (const userDoc of usuariosSnap.docs) {
      const { telefono } = userDoc.data();
      const snapshot = await db.collection('gastos')
        .where('telefono','==',telefono)
        .where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioSemana))
        .get();
      if (snapshot.empty) continue;
      let totalGastos=0, totalIngresos=0;
      const cats={};
      snapshot.forEach(doc => {
        const d=doc.data();
        if(d.tipo==='ingreso'){totalIngresos+=d.monto;}
        else{totalGastos+=d.monto; cats[d.categoria]=(cats[d.categoria]||0)+d.monto;}
      });
      const topCat = Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
      const balance = totalIngresos - totalGastos;
      let msg = `📅 *Resumen semanal Hormicash*\n━━━━━━━━━━━━━━\n💸 Gastos: S/ ${totalGastos.toFixed(2)}\n💰 Ingresos: S/ ${totalIngresos.toFixed(2)}\n${balance>=0?'🟢':'🔴'} Balance: S/ ${balance.toFixed(2)}\n`;
      if (topCat) msg += `\n🏆 Mayor gasto: *${CATEGORIAS_DISPLAY[topCat[0]]||topCat[0]}* (S/ ${topCat[1].toFixed(2)})\n`;
      msg += `\n_¡Sigue así! Registra tus gastos esta semana 💪_`;
      try {
        await twilioClient.messages.create({ from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`, to: telefono, body: msg });
      } catch(e) { console.error(`Error resumen semanal ${telefono}:`, e.message); }
    }
  } catch(e) { console.error('Error resumen semanal:', e); }
}

async function generarConsejoIA(telefono) {
  try {
    const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
    const snapshot = await db.collection('gastos').where('telefono','==',telefono).where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes)).get();
    if (snapshot.empty) return null;
    let totalGastos=0, totalIngresos=0, count=0;
    const cats={};
    snapshot.forEach(doc => {
      const d=doc.data();
      if(d.tipo==='ingreso'){totalIngresos+=d.monto;}
      else{totalGastos+=d.monto; count++; cats[d.categoria]=(cats[d.categoria]||0)+d.monto;}
    });
    const topCat = Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
    const balance = totalIngresos - totalGastos;
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const prompt = `Eres un asesor financiero personal amigable para peruanos jóvenes.
Datos del usuario este mes:
- Total gastos: S/ ${totalGastos.toFixed(2)}
- Total ingresos: S/ ${totalIngresos.toFixed(2)}
- Balance: S/ ${balance.toFixed(2)}
- Categoría con más gastos: ${topCat ? `${topCat[0]} (S/ ${topCat[1].toFixed(2)})` : 'N/A'}
- Número de transacciones: ${count}
Da UN consejo financiero corto, personalizado, práctico y motivador en español peruano.
Máximo 2 oraciones. Sin asteriscos ni emojis excesivos. Solo el texto del consejo.`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch(e) { return null; }
}

async function enviarAvisosNocturno() {
  console.log('🌙 Ejecutando aviso nocturno...');
  const ahora = new Date();
  const inicioDia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const hace7dias = new Date(inicioDia); hace7dias.setDate(hace7dias.getDate() - 7);

  // Aviso que se agrega al final de cada recordatorio
  const avisoJoin = `\n\n_💡 ¿Dejaste de recibir mis mensajes? Escribe *join [tu-código]* al +1 415 523 8886 para reconectarte._`;

  try {
    const usuariosSnap = await db.collection('usuarios_whatsapp').where('activo','==',true).get();
    for (const userDoc of usuariosSnap.docs) {
      const { telefono } = userDoc.data();
      const gastosRecientes = await db.collection('gastos')
        .where('telefono','==',telefono)
        .where('fecha','>=',admin.firestore.Timestamp.fromDate(hace7dias))
        .get();
      const diasConGastos = new Set();
      gastosRecientes.forEach(d => {
        const f = d.data().fecha?.toDate ? d.data().fecha.toDate() : new Date(d.data().fecha);
        diasConGastos.add(`${f.getFullYear()}-${f.getMonth()}-${f.getDate()}`);
      });
      const hoyKey = `${ahora.getFullYear()}-${ahora.getMonth()}-${ahora.getDate()}`;
      const registroHoy = diasConGastos.has(hoyKey);
      if (registroHoy) continue;
      let diasSinRegistrar = 0;
      for (let i = 1; i <= 7; i++) {
        const d = new Date(inicioDia); d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        if (!diasConGastos.has(key)) diasSinRegistrar++;
        else break;
      }
      let msg;
      if (diasSinRegistrar === 0) {
        msg = `🐜 *Hormicash — Recordatorio*\n\n¡Hola! Hoy no registraste ningún gasto todavía.\n\nRecuerda que los pequeños gastos son los que más se acumulan 💸\n\nEscríbeme: _"Almuerzo 15"_ o _"Taxi 8 soles"_${avisoJoin}`;
      } else if (diasSinRegistrar === 1) {
        msg = `🐜 *Hormicash — ¿Todo bien?*\n\nLlevas 2 días sin registrar gastos. Los gastos hormiga se acumulan sin que te des cuenta 👀\n\nEscríbeme cualquier gasto del día, aunque sea pequeño:\n_"Café 5"_ o _"Bus 2.50"_${avisoJoin}`;
      } else if (diasSinRegistrar <= 3) {
        msg = `⚠️ *Hormicash — Llevas ${diasSinRegistrar + 1} días sin registrar*\n\nEstás perdiendo el control de tus gastos hormiga 🐜\n\nVuelve a registrar hoy y retoma el hábito. Solo toma 5 segundos:\n_"Almuerzo 15"_${avisoJoin}`;
      } else {
        msg = `🔥 *Hormicash — Más de una semana sin registrar*\n\nTus finanzas te necesitan. Retoma el control hoy 💪\n\nEmpieza de nuevo con un gasto simple:\n_"Cualquier cosa + monto"_\n\nVe tu dashboard: https://hormicash.web.app${avisoJoin}`;
      }
      const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      const gastosDelMes = await db.collection('gastos')
        .where('telefono','==',telefono)
        .where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes))
        .get();
      let totalMes = 0;
      gastosDelMes.forEach(d => { if(d.data().tipo !== 'ingreso') totalMes += d.data().monto || 0; });
      try {
        await twilioClient.messages.create({
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
          to: telefono,
          body: msg
        });
        console.log(`✅ Recordatorio enviado a ${telefono} (${diasSinRegistrar + 1} días sin registrar)`);
        const userData = await obtenerEmailUsuario(telefono);
        if (userData?.email) {
          await enviarEmailRecordatorio(userData.email, userData.nombre, diasSinRegistrar, totalMes);
          console.log(`📧 Email enviado a ${userData.email}`);
        }
      } catch(e) { console.error(`❌ Error enviando a ${telefono}:`, e.message); }
    }
  } catch(e) { console.error('Error aviso nocturno:', e); }
}

setInterval(() => {
  const ahora = new Date();
  const horaUTC = ahora.getUTCHours();
  const minUTC = ahora.getUTCMinutes();
  if ((horaUTC === 2 || horaUTC === 1) && minUTC === 0) enviarAvisosNocturno();
  if (ahora.getUTCDay() === 1 && horaUTC === 13 && minUTC === 0) enviarResumenSemanal();
}, 60000);

// ── OAUTH2 ENDPOINTS ──────────────────────────────────────────────
app.get('/auth/gmail', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.send'],
    prompt: 'consent'
  });
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.send(`<pre>REFRESH TOKEN:\n${tokens.refresh_token}</pre>`);
  } catch(e) {
    res.send(`Error: ${e.message}`);
  }
});

// ── WEBHOOK WHATSAPP ──────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body?.trim() || '';
  const telefono = req.body.From || '';
  const numMedia = parseInt(req.body.NumMedia || '0');
  const twiml = new twilio.twiml.MessagingResponse();

  const esNuevo = await registrarUsuario(telefono);

  if (esNuevo) {
    estadoUsuario[telefono] = { esperando: 'bienvenida_limites' };
    twiml.message(`🐜 *¡Bienvenido a Hormicash!*\n\nSoy tu asistente de gastos hormiga. Registra tus gastos por:\n\n📸 Foto de voucher\n🎙️ Mensaje de voz\n💬 Texto: _"Almuerzo 15"_\n💳 Tarjeta de crédito: _"Taxi 30 TC"_\n\n─────────────────\n¿Quieres configurar *límites de gasto* mensuales? ⭐ Premium\n\n1️⃣ Sí, configurar ahora\n2️⃣ Lo haré después`);
    return res.type('text/xml').send(twiml.toString());
  }

  if (estadoUsuario[telefono]?.esperando === 'bienvenida_limites') {
    if (mensaje === '1') {
      const premium = await esPremium(telefono);
      if (!premium) {
        delete estadoUsuario[telefono];
        twiml.message(`⭐ *Función Premium*\n\nActiva tu plan en: https://hormicash.web.app\n\nPor ahora ya puedes registrar gastos 🐜`);
      } else {
        estadoUsuario[telefono] = { esperando:'limite_categoria', limites:{}, categoriaIndex:0 };
        twiml.message(`💰 ¿Límite mensual para *${CATEGORIAS_DISPLAY[CATEGORIAS[0]]}*?\n\nEscribe el monto o _"saltar"_.\n_(1 de ${CATEGORIAS.length})_`);
      }
    } else {
      delete estadoUsuario[telefono];
      twiml.message(`¡Perfecto! Edita tus límites cuando quieras en:\nhttps://hormicash.web.app\n\nEscribe _"Almuerzo 15"_ para empezar 🐜`);
    }
    return res.type('text/xml').send(twiml.toString());
  }

  if (estadoUsuario[telefono]?.esperando === 'meta_ahorro') {
    delete estadoUsuario[telefono];
    const meta = parseFloat(mensaje.replace(',','.'));
    if (isNaN(meta) || meta <= 0) {
      twiml.message('❌ Monto inválido. Escribe /meta para intentar de nuevo.');
    } else {
      await db.collection('usuarios_whatsapp').doc(telefono).set({ meta_ahorro: meta }, { merge:true });
      twiml.message(`🎯 *¡Meta configurada!*\n\nQuieres ahorrar *S/ ${meta.toFixed(0)}* este mes.\n\nVe tu progreso en: https://hormicash.web.app\n\n💪 ¡Tú puedes lograrlo!`);
    }
    return res.type('text/xml').send(twiml.toString());
  }

  if (estadoUsuario[telefono]?.esperando === 'limite_categoria') {
    const estado = estadoUsuario[telefono];
    if (mensaje.toLowerCase() !== 'saltar') {
      const monto = parseFloat(mensaje.replace(',','.'));
      if (!isNaN(monto) && monto > 0) estado.limites[CATEGORIAS[estado.categoriaIndex]] = monto;
    }
    estado.categoriaIndex++;
    if (estado.categoriaIndex < CATEGORIAS.length) {
      twiml.message(`💰 ¿Límite para *${CATEGORIAS_DISPLAY[CATEGORIAS[estado.categoriaIndex]]}*?\n\nEscribe el monto o _"saltar"_.\n_(${estado.categoriaIndex+1} de ${CATEGORIAS.length})_`);
    } else {
      await db.collection('usuarios_whatsapp').doc(telefono).set({ limites: estado.limites }, { merge:true });
      delete estadoUsuario[telefono];
      const resumen = Object.entries(estado.limites).map(([c,m]) => `  • ${CATEGORIAS_DISPLAY[c]}: S/ ${m}`).join('\n');
      twiml.message(`✅ *¡Límites configurados!*\n\n${resumen}\n\nTe avisaré cuando te acerques 🎯\nEdítalos en: https://hormicash.web.app`);
    }
    return res.type('text/xml').send(twiml.toString());
  }

  if (numMedia > 0) {
    const mediaUrl = req.body.MediaUrl0;
    const mediaMime = req.body.MediaContentType0 || 'image/jpeg';
    try {
      const { base64, mimeType } = await downloadTwilioMedia(mediaUrl);
      const mime = mimeType || mediaMime;
      if (mediaMime.startsWith('audio/')) {
        const audio = await extractAudioData(base64, mime);
        if (audio.error === 'no_monto') { twiml.message('🎙️ No pude identificar un monto.\nIntenta: "Almuerzo en La Lucha, veinte soles"'); return res.type('text/xml').send(twiml.toString()); }
        const esIngreso = audio.tipo === 'ingreso';
        const cat = audio.categoria?.toLowerCase() || 'otros';
        const labelAudio = audio.negocio || audio.descripcion || (esIngreso?'Ingreso por voz':'Gasto por voz');
        await db.collection('gastos').add({ telefono, monto:audio.monto, tipo:audio.tipo||'gasto', categoria:cat, label:labelAudio, descripcion:audio.descripcion, fuente:'audio_whatsapp', mensaje:'[audio]', fecha:admin.firestore.FieldValue.serverTimestamp() });
        let resp = esIngreso
          ? `💰 *Ingreso por voz*\n\n💵 S/ ${audio.monto.toFixed(2)}\n📝 ${labelAudio}\n\nEscribe /resumen para ver tu balance`
          : `✅ *Gasto por voz*\n\n🏪 ${labelAudio}\n💰 S/ ${audio.monto.toFixed(2)}\n📂 ${CATEGORIAS_DISPLAY[cat]||cat}\n\nEscribe /resumen para ver tu balance`;
        if (!esIngreso) {
          const a = await verificarLimite(telefono,cat,audio.monto); if(a) resp += mensajeAlerta(a, CATEGORIAS_DISPLAY[cat]||cat);
          const alerta = await verificarAlertaContextual(telefono,cat,audio.monto);
          if(alerta) resp += `\n\n💡 Hoy ya llevas S/ ${alerta.totalHoy} en ${alerta.catDisplay}, por encima de tu promedio diario (S/ ${alerta.promedio})`;
        }
        twiml.message(resp);
      } else {
        const voucher = await extractVoucherData(base64, mime);
        if (voucher.error === 'no_voucher') { twiml.message('📸 No pude identificar un voucher.\nEnvía una foto clara de tu ticket.'); return res.type('text/xml').send(twiml.toString()); }
        const cat = voucher.categoria?.toLowerCase() || 'otros';
        const labelVoucher = voucher.negocio || 'Voucher';
        await db.collection('gastos').add({ telefono, monto:voucher.monto, tipo:'gasto', categoria:cat, label:labelVoucher, descripcion:voucher.descripcion, fecha_voucher:voucher.fecha, fuente:'voucher_whatsapp', mensaje:'[imagen]', fecha:admin.firestore.FieldValue.serverTimestamp() });
        let resp = `✅ *Voucher registrado*\n\n🏪 ${labelVoucher}\n💰 S/ ${voucher.monto.toFixed(2)}\n📂 ${CATEGORIAS_DISPLAY[cat]||cat}\n📝 ${voucher.descripcion}\n\nEscribe /resumen para ver tu balance`;
        const a = await verificarLimite(telefono,cat,voucher.monto); if(a) resp += mensajeAlerta(a, CATEGORIAS_DISPLAY[cat]||cat);
        const alerta = await verificarAlertaContextual(telefono,cat,voucher.monto);
        if(alerta) resp += `\n\n💡 Hoy ya llevas S/ ${alerta.totalHoy} en ${alerta.catDisplay}, por encima de tu promedio diario (S/ ${alerta.promedio})`;
        twiml.message(resp);
      }
    } catch(err) { console.error('Error media:', err); twiml.message('❌ No pude procesar el archivo. Intenta de nuevo.'); }
    return res.type('text/xml').send(twiml.toString());
  }

  if (estadoUsuario[telefono]?.esperando === 'resumen') {
    const opcion = mensaje;
    delete estadoUsuario[telefono];
    const ahora = new Date();
    let desde, periodo;
    if (opcion==='1') { desde=new Date(ahora.getFullYear(),ahora.getMonth(),ahora.getDate()); periodo='Hoy'; }
    else if (opcion==='2') { desde=new Date(ahora); desde.setDate(ahora.getDate()-7); periodo='Esta semana'; }
    else if (opcion==='3') { desde=new Date(ahora.getFullYear(),ahora.getMonth(),1); periodo='Este mes'; }
    else { twiml.message('❌ Opción no válida.\nEscribe /resumen para intentar de nuevo.'); return res.type('text/xml').send(twiml.toString()); }
    const snapshot = await db.collection('gastos').where('telefono','==',telefono).where('fecha','>=',admin.firestore.Timestamp.fromDate(desde)).get();
    let totalGastos=0, totalIngresos=0, totalTarjeta=0;
    const cats={};
    snapshot.forEach(doc => {
      const d=doc.data();
      if(d.tipo==='ingreso'){totalIngresos+=d.monto;}
      else{
        totalGastos+=d.monto;
        cats[d.categoria]=(cats[d.categoria]||0)+d.monto;
        if(d.fuente_pago==='tarjeta') totalTarjeta+=d.monto;
      }
    });
    let resCats = '';
    for (const [c,m] of Object.entries(cats)) resCats += `  • ${CATEGORIAS_DISPLAY[c]||c}: S/ ${m.toFixed(2)}\n`;
    const balance = totalIngresos-totalGastos;
    let msg = `📊 *Resumen - ${periodo}*\n━━━━━━━━━━━━━━\n💸 Gastos: S/ ${totalGastos.toFixed(2)}\n${resCats}💰 Ingresos: S/ ${totalIngresos.toFixed(2)}\n━━━━━━━━━━━━━━\n${balance>=0?'🟢':'🔴'} Balance: S/ ${balance.toFixed(2)}`;
    if (totalTarjeta > 0) msg += `\n\n💳 Tarjeta de crédito: S/ ${totalTarjeta.toFixed(2)}`;
    twiml.message(msg);
    return res.type('text/xml').send(twiml.toString());
  }

  if (mensaje.toLowerCase() === '/resumen') {
    estadoUsuario[telefono] = { esperando:'resumen' };
    twiml.message(`📊 *¿Qué resumen deseas?*\n\n1️⃣ Hoy\n2️⃣ Esta semana\n3️⃣ Este mes\n\nResponde con el número.`);
    return res.type('text/xml').send(twiml.toString());
  }

  if (mensaje.toLowerCase() === '/limites') {
    const premium = await esPremium(telefono);
    if (!premium) { twiml.message(`⭐ *Función Premium*\n\nActívala en: https://hormicash.web.app`); return res.type('text/xml').send(twiml.toString()); }
    estadoUsuario[telefono] = { esperando:'limite_categoria', limites:{}, categoriaIndex:0 };
    twiml.message(`💰 *Configurar límites*\n\n¿Límite para *${CATEGORIAS_DISPLAY[CATEGORIAS[0]]}*?\n\nEscribe el monto o _"saltar"_.\n_(1 de ${CATEGORIAS.length})_`);
    return res.type('text/xml').send(twiml.toString());
  }

  if (mensaje.toLowerCase() === '/consejo') {
    const premium = await esPremium(telefono);
    if (!premium) { twiml.message(`⭐ *Función Premium*\n\nActívala en: https://hormicash.web.app`); return res.type('text/xml').send(twiml.toString()); }
    twiml.message('💡 Analizando tus gastos...');
    res.type('text/xml').send(twiml.toString());
    const consejo = await generarConsejoIA(telefono);
    if (consejo) {
      await twilioClient.messages.create({ from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`, to: telefono, body: `💡 *Consejo personalizado*\n\n${consejo}` });
    }
    return;
  }

  if (mensaje.toLowerCase() === '/meta') {
    const premium = await esPremium(telefono);
    if (!premium) { twiml.message(`⭐ *Función Premium*\n\nActívala en: https://hormicash.web.app`); return res.type('text/xml').send(twiml.toString()); }
    estadoUsuario[telefono] = { esperando:'meta_ahorro' };
    twiml.message(`🎯 *Meta de ahorro mensual*\n\n¿Cuánto quieres ahorrar este mes?\nEscribe el monto en soles:`);
    return res.type('text/xml').send(twiml.toString());
  }

  const esTarjeta = detectarTarjeta(mensaje);
  const mensajeLimpio = esTarjeta ? limpiarTextoTC(mensaje) : mensaje;

  const multiples = parsearMultiplesMovimientos(mensajeLimpio);
  if (multiples) {
    let respuesta = `✅ *${multiples.length} gastos registrados*${esTarjeta ? ' 💳' : ''}\n\n`;
    for (const mov of multiples) {
      const gastoData = {
        telefono, monto:mov.monto, tipo:mov.tipo, categoria:mov.categoria,
        label:mov.label, fuente:'texto_whatsapp', mensaje:mov.textoOriginal,
        fecha:admin.firestore.FieldValue.serverTimestamp()
      };
      if (esTarjeta) gastoData.fuente_pago = 'tarjeta';
      await db.collection('gastos').add(gastoData);
      if (esTarjeta) await actualizarGastoTarjeta(telefono, mov.monto);
      respuesta += `${mov.tipo==='ingreso'?'💰':'🐜'}${esTarjeta?' 💳':''} *${mov.label}* — S/ ${mov.monto.toFixed(2)} (${CATEGORIAS_DISPLAY[mov.categoria]||mov.categoria})\n`;
    }
    respuesta += `\nEscribe /resumen para ver tu balance`;
    twiml.message(respuesta);
    return res.type('text/xml').send(twiml.toString());
  }

  const mov = parsearMovimiento(mensajeLimpio);
  if (!mov) {
    twiml.message('No entendí el monto 🤔\n\n*Gastos:* "Almuerzo 15"\n*Tarjeta:* "Taxi 30 TC" o "Netflix 45 CREDITO"\n*Múltiples:* "Almuerzo 15 y taxi 8"\n*Ingresos:* "Ingreso 500 sueldo"\n*Voucher:* 📸 foto\n*Voz:* 🎙️ audio\n\n*Comandos:*\n/resumen — Ver balance\n/limites ⭐ — Límites de gasto\n/meta ⭐ — Meta de ahorro\n/consejo ⭐ — Consejo con IA');
  } else {
    const gastoData = {
      telefono, monto:mov.monto, tipo:mov.tipo, categoria:mov.categoria,
      label:mov.label, fuente:'texto_whatsapp', mensaje,
      fecha:admin.firestore.FieldValue.serverTimestamp()
    };
    if (esTarjeta) gastoData.fuente_pago = 'tarjeta';
    await db.collection('gastos').add(gastoData);

    let resp;
    if (esTarjeta) {
      await actualizarGastoTarjeta(telefono, mov.monto);
      resp = `💳 *Gasto con tarjeta registrado*\n\n🏪 ${mov.label}\n💰 S/ ${mov.monto.toFixed(2)}\n📂 ${CATEGORIAS_DISPLAY[mov.categoria]||mov.categoria}\n\n_Registrado en tu tarjeta de crédito_\nEscribe /resumen para ver tu balance`;
    } else if (mov.tipo === 'ingreso') {
      resp = `💰 S/ ${mov.monto.toFixed(2)} ingreso registrado\n📝 ${mov.label}\nEscribe /resumen para ver tu balance`;
    } else {
      resp = `✅ S/ ${mov.monto.toFixed(2)} gasto registrado\n🐜 ${mov.label}\nEscribe /resumen para ver tu balance`;
    }

    if (mov.tipo === 'gasto') {
      const a = await verificarLimite(telefono,mov.categoria,mov.monto);
      if(a) resp += mensajeAlerta(a, CATEGORIAS_DISPLAY[mov.categoria]||mov.categoria);
      const alerta = await verificarAlertaContextual(telefono, mov.categoria, mov.monto);
      if(alerta) resp += `\n\n💡 Hoy ya llevas S/ ${alerta.totalHoy} en ${alerta.catDisplay}, por encima de tu promedio diario (S/ ${alerta.promedio})`;
    }
    twiml.message(resp);
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// ── ENDPOINT RECATEGORIZACIÓN MASIVA CON IA ───────────────────────
app.post('/recategorizar', async (req, res) => {
  const { clave } = req.body;
  if (clave !== 'hormicash_admin_2024') return res.json({ error: 'No autorizado' });

  const CATS_VALIDAS = ['comida','cafe','transporte','telecom','compras','entretenimiento','hogar','salud','educacion','otros'];

  async function categorizarGemini(label) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
      const prompt = `Clasifica este gasto en UNA categoría exacta: comida, cafe, transporte, telecom, compras, entretenimiento, hogar, salud, educacion, otros.
Gasto: "${label}"
Responde SOLO con la categoría, sin explicación. Ejemplos:
- "Taxi" → transporte
- "Wafer" → comida  
- "Betano" → entretenimiento
- "Netflix" → telecom
- "Perfume" → compras
- "Pago de préstamo" → otros`;
      const result = await model.generateContent(prompt);
      const cat = result.response.text().trim().toLowerCase().replace(/[^a-záéíóúñ]/g,'');
      return CATS_VALIDAS.includes(cat) ? cat : 'otros';
    } catch(e) { return 'otros'; }
  }

  try {
    const snap = await db.collection('gastos').get();
    const todos = snap.docs.filter(d => {
      const data = d.data();
      return (data.tipo === 'gasto' || (!data.tipo && data.monto)) && data.categoria === 'otros';
    });

    let procesados = 0, errores = 0;
    // Lotes de 5 para no saturar Gemini
    for (let i = 0; i < todos.length; i += 5) {
      const lote = todos.slice(i, i + 5);
      await Promise.all(lote.map(async (d) => {
        try {
          const data = d.data();
          const label = data.label || data.mensaje || '';
          if (!label || label === '[imagen]' || label === '[audio]') return;
          const cat = await categorizarGemini(label);
          await db.collection('gastos').doc(d.id).update({ categoria: cat });
          procesados++;
        } catch(e) { errores++; }
      }));
      await new Promise(r => setTimeout(r, 500));
    }
    res.json({ procesados, errores, total: todos.length });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.get('/', (req, res) => res.send('🐜 Hormicash Bot corriendo'));

app.get('/test-email', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.send('Falta ?email=tucorreo@gmail.com');
  try {
    await enviarEmailRecordatorio(email, 'Stefano', 2, 1165);
    res.send(`✅ Email enviado a ${email}`);
  } catch(e) {
    res.send(`❌ Error: ${e.message}`);
  }
});

app.get('/usuarios-emails', async (req, res) => {
  try {
    const snap = await db.collection('usuarios').get();
    const usuarios = [];
    snap.forEach(d => {
      const data = d.data();
      if (data.email) usuarios.push({
        nombre: data.nombre?.split(' ')[0] || 'Usuario',
        email: data.email,
        plan: data.plan || 'free',
        telefono: data.telefono || ''
      });
    });
    res.json({ total: usuarios.length, usuarios });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.get('/enviar-recordatorio-todos', async (req, res) => {
  const clave = req.query.clave;
  if (clave !== process.env.ADMIN_SECRET) return res.send('❌ No autorizado');
  try {
    const snap = await db.collection('usuarios').get();
    let enviados = 0, errores = 0;
    const resultados = [];
    for (const d of snap.docs) {
      const data = d.data();
      if (!data.email) continue;
      const nombre = data.nombre?.split(' ')[0] || 'Usuario';
      try {
        await enviarEmailRecordatorio(data.email, nombre, 1, 0);
        enviados++;
        resultados.push({ email: data.email, status: '✅' });
        await new Promise(r => setTimeout(r, 200));
      } catch(e) {
        errores++;
        resultados.push({ email: data.email, status: `❌ ${e.message}` });
      }
    }
    res.json({ enviados, errores, resultados });
  } catch(e) {
    res.json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));