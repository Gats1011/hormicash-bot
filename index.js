require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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

// ── KEYWORDS TARJETA DE CRÉDITO ──────────────────────────────────
const TC_KEYWORDS = ['tc', 'credito', 'crédito', 'tarjeta', 'visa', 'mastercard', 'amex', 'credit'];

function detectarTarjeta(texto) {
  const lower = texto.toLowerCase();
  return TC_KEYWORDS.some(k => {
    // Buscar como palabra separada: "taxi 30 tc" o "taxi 30 - tc" o "taxi 30 credito"
    const regex = new RegExp(`(^|\\s|[-,])${k}(\\s|[-,]|$)`, 'i');
    return regex.test(lower);
  });
}

function limpiarTextoTC(texto) {
  let limpio = texto;
  // Primero remover TC al inicio: "tc taxi 30" → "taxi 30"
  limpio = limpio.replace(/^(tc|credito|crédito|tarjeta|visa|mastercard|amex|credit)\s+/gi, '');
  // Luego remover TC al final o en medio con separadores
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

// ── ACTUALIZAR GASTO DE TARJETA EN FIRESTORE ─────────────────────
async function actualizarGastoTarjeta(telefono, monto) {
  try {
    // Buscar si el usuario tiene uid vinculado
    const userDoc = await db.collection('usuarios_whatsapp').doc(telefono).get();
    if (!userDoc.exists) return;
    const uid = userDoc.data().uid;
    if (!uid) return;
    // Sumar al gasto_actual de la tarjeta
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
  try {
    const usuariosSnap = await db.collection('usuarios_whatsapp').where('activo','==',true).get();
    for (const userDoc of usuariosSnap.docs) {
      const { telefono } = userDoc.data();
      const gastosHoy = await db.collection('gastos').where('telefono','==',telefono).where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioDia)).limit(1).get();
      if (gastosHoy.empty) {
        try {
          await twilioClient.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`, to: telefono,
            body: `🐜 *Hormicash — Recordatorio*\n\n¡Hola! Hoy no registraste ningún gasto.\n\nRecuerda que los pequeños gastos son los que más se acumulan 💸\n\nEscríbeme: _"Almuerzo 15"_ o _"Taxi 8 soles"_`
          });
        } catch(e) { console.error(`❌ Error enviando a ${telefono}:`, e.message); }
      }
    }
  } catch(e) { console.error('Error aviso nocturno:', e); }
}

setInterval(() => {
  const ahora = new Date();
  const horaUTC = ahora.getUTCHours();
  const minUTC = ahora.getUTCMinutes();
  if (horaUTC === 2 && minUTC === 0) enviarAvisosNocturno();
  if (ahora.getUTCDay() === 1 && horaUTC === 13 && minUTC === 0) enviarResumenSemanal();
}, 60000);

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

  // ── DETECCIÓN TARJETA DE CRÉDITO ─────────────────────────────
  const esTarjeta = detectarTarjeta(mensaje);
  const mensajeLimpio = esTarjeta ? limpiarTextoTC(mensaje) : mensaje;

  // ── GASTOS MÚLTIPLES ─────────────────────────────────────────
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

  // ── GASTO/INGRESO SIMPLE ─────────────────────────────────────
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
      // Actualizar acumulado de tarjeta en Firestore
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

app.get('/', (req, res) => res.send('🐜 Hormicash Bot corriendo'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));