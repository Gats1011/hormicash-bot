require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Express
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Parser de movimientos (gastos e ingresos)
function parsearMovimiento(texto) {
  const lower = texto.toLowerCase();
  const match = lower.match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const monto = parseFloat(match[1].replace(',', '.'));
  if (isNaN(monto) || monto <= 0) return null;

  // Detectar si es ingreso
  const ingresosKeywords = ['ingreso','sueldo','salario','pago','transferencia','depósito','deposito','freelance','propina','bono','regalo','cobro','cobré','cobre','me pagaron','ganancia'];
  const esIngreso = ingresosKeywords.some(k => lower.includes(k));

  if (esIngreso) {
    const desc = texto.replace(/\d+(?:[.,]\d{1,2})?/g, '').replace(/soles?|sol|s\//gi, '').trim();
    const label = desc.length > 2 ? desc.charAt(0).toUpperCase() + desc.slice(1) : 'Ingreso';
    return { monto, tipo: 'ingreso', categoria: 'ingreso', label };
  }

  // Es gasto — categorizar
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

// Webhook de Twilio
app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body || '';
  const telefono = req.body.From || '';
  const twiml = new twilio.twiml.MessagingResponse();

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
        '*Ingresos:* "Ingreso 500 sueldo" o "Cobré 200 freelance"\n\n' +
        'Escribe /resumen para ver tu balance'
      );
    } else {
      await db.collection('gastos').add({
        telefono,
        monto: mov.monto,
        tipo: mov.tipo,
        categoria: mov.categoria,
        label: mov.label,
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
