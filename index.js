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

// Express
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── FUNCIÓN: Descargar imagen de Twilio como base64 ──────────────
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
  return JSON.parse(text);
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

// ── WEBHOOK ──────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body || '';
  const telefono = req.body.From || '';
  const numMedia = parseInt(req.body.NumMedia || '0');
  const twiml = new twilio.twiml.MessagingResponse();

  // ── FLUJO VOUCHER (imagen) ──────────────────────────────────────
  if (numMedia > 0) {
    const mediaUrl = req.body.MediaUrl0;
    const mediaMime = req.body.MediaContentType0 || 'image/jpeg';

    try {
      const { base64, mimeType } = await downloadTwilioMedia(mediaUrl);
      const voucher = await extractVoucherData(base64, mimeType || mediaMime);

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

    } catch (err) {
      console.error('Error procesando voucher:', err);
      twiml.message('❌ No pude leer el voucher. Intenta con una foto más clara o con mejor iluminación.');
    }

    return res.type('text/xml').send(twiml.toString());
  }

  // ── FLUJO TEXTO ─────────────────────────────────────────────────
  if (mensaje.toLowerCase() === '/resumen') {
    const hoy = new Date();
    hoy.setHours(0,0,0,0);

    const snapshot = await db.collection('gastos')
      .where('telefono', '==', telefono)
      .orderBy('fecha', 'desc')
      .limit(20)
      .get();

    if (snapshot.empty) {
      twiml.message('No tienes movimientos registrados 📋');
    } else {
      let totalGastos = 0;
      let totalIngresos = 0;
      let countGastos = 0;
      let countIngresos = 0;

      snapshot.forEach(doc => {
        const d = doc.data();
        const fecha = d.fecha?.toDate ? d.fecha.toDate() : new Date(d.fecha);
        if (fecha >= hoy) {
          if (d.tipo === 'ingreso') {
            totalIngresos += d.monto;
            countIngresos++;
          } else {
            totalGastos += d.monto;
            countGastos++;
          }
        }
      });

      const balance = totalIngresos - totalGastos;
      const emoji = balance >= 0 ? '✅' : '⚠️';

      twiml.message(
        `📊 *Resumen de hoy*\n\n` +
        `💰 Ingresos: S/ ${totalIngresos.toFixed(2)} (${countIngresos})\n` +
        `💸 Gastos: S/ ${totalGastos.toFixed(2)} (${countGastos})\n` +
        `${emoji} Balance: S/ ${balance.toFixed(2)}`
      );
    }
  } else {
    const mov = parsearMovimiento(mensaje);
    if (!mov) {
      twiml.message(
        'No entendí el monto 🤔\n\n' +
        '*Gastos:* "Almuerzo 15" o "Café 8 soles"\n' +
        '*Ingresos:* "Ingreso 500 sueldo" o "Cobré 200 freelance"\n' +
        '*Voucher:* Envía una foto de tu ticket 📸\n\n' +
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
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

app.get('/', (req, res) => res.send('🐜 Hormicash Bot corriendo'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));