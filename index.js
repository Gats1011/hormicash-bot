require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Twilio client (para enviar mensajes proactivos)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Express
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── ESTADO DE CONVERSACIÓN (en memoria) ──────────────────────────
const estadoUsuario = {};

// ── FUNCIÓN: Registrar usuario en Firestore ──────────────────────
async function registrarUsuario(telefono) {
  try {
    await db.collection('usuarios_whatsapp').doc(telefono).set({
      telefono,
      ultimo_mensaje: admin.firestore.FieldValue.serverTimestamp(),
      activo: true
    }, { merge: true });
  } catch (e) {
    console.error('Error registrando usuario:', e);
  }
}

// ── FUNCIÓN: Descargar media de Twilio como base64 ───────────────
async function downloadTwilioMedia(mediaUrl) {
  const response = await axios.get(mediaUrl, {
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN,
    },
    responseType: 'arraybuffer',
  });
  const base64 = Buffer.from(response.data).toString('base64');
  const mimeType = response.headers['content-type'] || 'image/jpeg';
  return { base64, mimeType };
}

// ── FUNCIÓN: Extraer datos del voucher con Gemini Vision ─────────
async function extractVoucherData(base64, mimeType) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const prompt = `Analiza este voucher, ticket o recibo y extrae la información del gasto.
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown, sin backticks.

Formato exacto:
{
  "negocio": "nombre del negocio o establecimiento",
  "monto": 0.00,
  "moneda": "PEN",
  "categoria": "una de: Comida, Transporte, Entretenimiento, Salud, Educación, Ropa, Tecnología, Hogar, Otros",
  "fecha": "YYYY-MM-DD o null si no se puede leer",
  "descripcion": "breve descripción del gasto en máximo 10 palabras"
}

Si la imagen no es un voucher o ticket, responde: {"error": "no_voucher"}`;

  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType } },
    prompt,
  ]);

  const text = result.response.text().trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── FUNCIÓN: Extraer gasto desde audio con Gemini ────────────────
async function extractAudioData(base64, mimeType) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const prompt = `Escucha este audio de voz en español y extrae la información de un gasto o ingreso mencionado.
Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, sin markdown, sin backticks.

Formato exacto:
{
  "tipo": "gasto o ingreso",
  "negocio": "nombre del lugar o null si no se menciona",
  "monto": 0.00,
  "moneda": "PEN",
  "categoria": "una de: Comida, Transporte, Entretenimiento, Salud, Educación, Ropa, Tecnología, Hogar, Otros",
  "descripcion": "breve descripción del gasto en máximo 10 palabras"
}

Ejemplos de frases que puede decir el usuario:
- "Almuerzo en La Lucha, veinte soles" → tipo: gasto, negocio: La Lucha, monto: 20, categoria: Comida
- "Taxi al trabajo, ocho soles" → tipo: gasto, negocio: null, monto: 8, categoria: Transporte
- "Cobré doscientos de freelance" → tipo: ingreso, negocio: null, monto: 200, categoria: null

Si no se puede identificar un monto claro, responde: {"error": "no_monto"}`;

  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType } },
    prompt,
  ]);

  const text = result.response.text().trim();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── FUNCIÓN: Parser de movimientos (gastos e ingresos) ───────────
function parsearMovimiento(texto) {
  const lower = texto.toLowerCase();
  const match = lower.match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const monto = parseFloat(match[1].replace(',', '.'));
  if (isNaN(monto) || monto <= 0) return null;

  const ingresosKeywords = ['ingreso','sueldo','salario','pago','transferencia','depósito','deposito','freelance','propina','bono','regalo','cobro','cobré','cobre','me pagaron','ganancia'];
  const esIngreso = ingresosKeywords.some(k => lower.includes(k));

  if (esIngreso) {
    const desc = texto.replace(/\d+(?:[.,]\d{1,2})?/g, '').replace(/soles?|sol|s\//gi, '').trim();
    const label = desc.length > 2 ? desc.charAt(0).toUpperCase() + desc.slice(1) : 'Ingreso';
    return { monto, tipo: 'ingreso', categoria: 'ingreso', label };
  }

  const categorias = {
    comida: ['almuerzo','comida','pollo','arroz','ceviche','menu','desayuno','cena','sandwich','pan','pizza','burger'],
    cafe: ['café','cafe','cappuccino','latte','té','te','bebida','jugo'],
    transporte: ['pasaje','bus','taxi','uber','metro','combi','moto'],
    telecom: ['recarga','celular','internet','datos','spotify','netflix'],
  };

  let categoria = 'otros';
  for (const [cat, keywords] of Object.entries(categorias)) {
    if (keywords.some(k => lower.includes(k))) {
      categoria = cat;
      break;
    }
  }

  const desc = texto.replace(/\d+(?:[.,]\d{1,2})?/g, '').replace(/soles?|sol|s\//gi, '').trim();
  const label = desc.length > 2 ? desc.charAt(0).toUpperCase() + desc.slice(1) : 'Gasto';

  return { monto, tipo: 'gasto', categoria, label };
}

// ── CRON JOB: Aviso nocturno a las 9pm hora Perú (2am UTC) ──────
async function enviarAvisosNocturno() {
  console.log('🌙 Ejecutando aviso nocturno...');

  const ahora = new Date();
  const inicioDia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

  try {
    // Obtener todos los usuarios activos
    const usuariosSnap = await db.collection('usuarios_whatsapp')
      .where('activo', '==', true)
      .get();

    for (const userDoc of usuariosSnap.docs) {
      const { telefono } = userDoc.data();

      // Verificar si registró algún gasto hoy
      const gastosHoy = await db.collection('gastos')
        .where('telefono', '==', telefono)
        .where('fecha', '>=', admin.firestore.Timestamp.fromDate(inicioDia))
        .limit(1)
        .get();

      if (gastosHoy.empty) {
        // No registró gastos hoy → enviar aviso
        try {
          await twilioClient.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
            to: telefono,
            body:
              `🐜 *Hormicash — Recordatorio*\n\n` +
              `¡Hola! Hoy no registraste ningún gasto.\n\n` +
              `Recuerda que los pequeños gastos son los que más se acumulan 💸\n\n` +
              `Escríbeme cualquier gasto ahora:\n` +
              `_"Almuerzo 15"_ o _"Taxi 8 soles"_`
          });
          console.log(`✅ Aviso enviado a ${telefono}`);
        } catch (e) {
          console.error(`❌ Error enviando a ${telefono}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('Error en aviso nocturno:', e);
  }
}

// ── SCHEDULER: Verificar cada minuto si es hora de enviar ────────
setInterval(() => {
  const ahora = new Date();
  // Hora Perú = UTC-5, entonces 9pm Perú = 2am UTC
  const horaUTC = ahora.getUTCHours();
  const minUTC = ahora.getUTCMinutes();
  if (horaUTC === 2 && minUTC === 0) {
    enviarAvisosNocturno();
  }
}, 60 * 1000);

// ── WEBHOOK ──────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body || '';
  const telefono = req.body.From || '';
  const numMedia = parseInt(req.body.NumMedia || '0');
  const twiml = new twilio.twiml.MessagingResponse();

  // ── REGISTRAR USUARIO AUTOMÁTICAMENTE ───────────────────────────
  await registrarUsuario(telefono);

  // ── FLUJO MEDIA (imagen o audio) ────────────────────────────────
  if (numMedia > 0) {
    const mediaUrl = req.body.MediaUrl0;
    const mediaMime = req.body.MediaContentType0 || 'image/jpeg';
    const esAudio = mediaMime.startsWith('audio/');

    try {
      const { base64, mimeType } = await downloadTwilioMedia(mediaUrl);
      const mime = mimeType || mediaMime;

      // ── AUDIO ──────────────────────────────────────────────────
      if (esAudio) {
        const audio = await extractAudioData(base64, mime);

        if (audio.error === 'no_monto') {
          twiml.message('🎙️ No pude identificar un monto en el audio.\nIntenta decir: "Almuerzo en La Lucha, veinte soles"');
          return res.type('text/xml').send(twiml.toString());
        }

        const esIngreso = audio.tipo === 'ingreso';

        await db.collection('gastos').add({
          telefono,
          monto: audio.monto,
          tipo: audio.tipo || 'gasto',
          categoria: audio.categoria ? audio.categoria.toLowerCase() : 'otros',
          label: audio.negocio || audio.descripcion || (esIngreso ? 'Ingreso por voz' : 'Gasto por voz'),
          descripcion: audio.descripcion,
          fuente: 'audio_whatsapp',
          mensaje: '[audio]',
          fecha: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (esIngreso) {
          twiml.message(
            `💰 *Ingreso registrado por voz*\n\n` +
            `💵 S/ ${audio.monto.toFixed(2)}\n` +
            `📝 ${audio.descripcion}\n\n` +
            `Escribe /resumen para ver tu balance`
          );
        } else {
          twiml.message(
            `✅ *Gasto registrado por voz*\n\n` +
            `🏪 ${audio.negocio || 'Sin negocio'}\n` +
            `💰 S/ ${audio.monto.toFixed(2)}\n` +
            `📂 ${audio.categoria}\n` +
            `📝 ${audio.descripcion}\n\n` +
            `Escribe /resumen para ver tu balance`
          );
        }

      // ── IMAGEN (voucher) ───────────────────────────────────────
      } else {
        const voucher = await extractVoucherData(base64, mime);

        if (voucher.error === 'no_voucher') {
          twiml.message('📸 No pude identificar un voucher en esa imagen.\nEnvía una foto clara de tu ticket o recibo.');
          return res.type('text/xml').send(twiml.toString());
        }

        await db.collection('gastos').add({
          telefono,
          monto: voucher.monto,
          tipo: 'gasto',
          categoria: voucher.categoria ? voucher.categoria.toLowerCase() : 'otros',
          label: voucher.negocio || 'Voucher',
          descripcion: voucher.descripcion,
          fecha_voucher: voucher.fecha,
          fuente: 'voucher_whatsapp',
          mensaje: '[imagen]',
          fecha: admin.firestore.FieldValue.serverTimestamp(),
        });

        twiml.message(
          `✅ *Gasto registrado desde voucher*\n\n` +
          `🏪 ${voucher.negocio}\n` +
          `💰 S/ ${voucher.monto.toFixed(2)}\n` +
          `📂 ${voucher.categoria}\n` +
          `📝 ${voucher.descripcion}\n\n` +
          `Escribe /resumen para ver tu balance`
        );
      }

    } catch (err) {
      console.error('Error procesando media:', err);
      twiml.message('❌ No pude procesar el archivo. Intenta de nuevo.');
    }

    return res.type('text/xml').send(twiml.toString());
  }

  // ── FLUJO TEXTO ─────────────────────────────────────────────────

  // ── PASO 2: Usuario está eligiendo tipo de resumen ───────────────
  if (estadoUsuario[telefono]?.esperando === 'resumen') {
    const opcion = mensaje.trim();
    delete estadoUsuario[telefono];

    const ahora = new Date();
    let desde;
    let periodo;

    if (opcion === '1') {
      desde = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
      periodo = 'Hoy';
    } else if (opcion === '2') {
      desde = new Date(ahora);
      desde.setDate(ahora.getDate() - 7);
      periodo = 'Esta semana';
    } else if (opcion === '3') {
      desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      periodo = 'Este mes';
    } else {
      twiml.message('❌ Opción no válida.\nEscribe /resumen para intentar de nuevo.');
      return res.type('text/xml').send(twiml.toString());
    }

    const snapshot = await db.collection('gastos')
      .where('telefono', '==', telefono)
      .where('fecha', '>=', admin.firestore.Timestamp.fromDate(desde))
      .get();

    let totalGastos = 0;
    let totalIngresos = 0;
    const categorias = {};

    snapshot.forEach(doc => {
      const d = doc.data();
      if (d.tipo === 'ingreso') {
        totalIngresos += d.monto;
      } else {
        totalGastos += d.monto;
        categorias[d.categoria] = (categorias[d.categoria] || 0) + d.monto;
      }
    });

    let resumenCategorias = '';
    for (const [cat, monto] of Object.entries(categorias)) {
      resumenCategorias += `  • ${cat}: S/ ${monto.toFixed(2)}\n`;
    }

    const balance = totalIngresos - totalGastos;
    const balanceEmoji = balance >= 0 ? '🟢' : '🔴';

    twiml.message(
      `📊 *Resumen - ${periodo}*\n` +
      `━━━━━━━━━━━━━━\n` +
      `💸 Gastos: S/ ${totalGastos.toFixed(2)}\n` +
      `${resumenCategorias}` +
      `💰 Ingresos: S/ ${totalIngresos.toFixed(2)}\n` +
      `━━━━━━━━━━━━━━\n` +
      `${balanceEmoji} Balance: S/ ${balance.toFixed(2)}`
    );

    return res.type('text/xml').send(twiml.toString());
  }

  // ── PASO 1: Usuario escribe /resumen → mostrar menú ──────────────
  if (mensaje.trim().toLowerCase() === '/resumen') {
    estadoUsuario[telefono] = { esperando: 'resumen' };
    twiml.message(
      `📊 *¿Qué resumen deseas?*\n\n` +
      `1️⃣ Hoy\n` +
      `2️⃣ Esta semana\n` +
      `3️⃣ Este mes\n\n` +
      `Responde con el número de tu elección.`
    );
    return res.type('text/xml').send(twiml.toString());
  }

  // ── REGISTRO DE GASTO/INGRESO POR TEXTO ──────────────────────────
  const mov = parsearMovimiento(mensaje);
  if (!mov) {
    twiml.message(
      'No entendí el monto 🤔\n\n' +
      '*Gastos:* "Almuerzo 15" o "Café 8 soles"\n' +
      '*Ingresos:* "Ingreso 500 sueldo" o "Cobré 200 freelance"\n' +
      '*Voucher:* Envía una foto de tu ticket 📸\n' +
      '*Voz:* Envía un audio con tu gasto 🎙️\n\n' +
      'Escribe /resumen para ver tu balance'
    );
  } else {
    await db.collection('gastos').add({
      telefono,
      monto: mov.monto,
      tipo: mov.tipo,
      categoria: mov.categoria,
      label: mov.label,
      fuente: 'texto_whatsapp',
      mensaje,
      fecha: admin.firestore.FieldValue.serverTimestamp()
    });

    if (mov.tipo === 'ingreso') {
      twiml.message(`💰 S/ ${mov.monto.toFixed(2)} ingreso registrado\n📝 ${mov.label}\nEscribe /resumen para ver tu balance`);
    } else {
      twiml.message(`✅ S/ ${mov.monto.toFixed(2)} gasto registrado\n🐜 ${mov.label}\nEscribe /resumen para ver tu balance`);
    }
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

app.get('/', (req, res) => res.send('🐜 Hormicash Bot corriendo'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
