require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');

// Firebase
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Express
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Parser de gastos
function parsearGasto(texto) {
  const lower = texto.toLowerCase();
  const match = lower.match(/(\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const monto = parseFloat(match[1].replace(',', '.'));
  if (isNaN(monto) || monto <= 0) return null;

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

  return { monto, categoria, label };
}

// Webhook de Twilio
app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body || '';
  const telefono = req.body.From || '';
  const twiml = new twilio.twiml.MessagingResponse();

  if (mensaje.toLowerCase() === '/resumen') {
    const snapshot = await db.collection('gastos')
      .where('telefono', '==', telefono)
      .orderBy('fecha', 'desc')
      .limit(10)
      .get();

    if (snapshot.empty) {
      twiml.message('No tienes gastos registrados hoy 📋');
    } else {
      let total = 0;
      snapshot.forEach(doc => total += doc.data().monto);
      twiml.message(`📊 Tus últimos gastos:\nTotal: S/ ${total.toFixed(2)}\n${snapshot.size} transacciones registradas`);
    }
  } else {
    const gasto = parsearGasto(mensaje);
    if (!gasto) {
      twiml.message('No entendí el monto 🤔\nEscribe algo como: "Almuerzo 15" o "Café 8 soles"');
    } else {
      await db.collection('gastos').add({
        telefono,
        monto: gasto.monto,
        categoria: gasto.categoria,
        label: gasto.label,
        mensaje,
        fecha: admin.firestore.FieldValue.serverTimestamp()
      });
      twiml.message(`✅ S/ ${gasto.monto.toFixed(2)} registrado\n🐜 ${gasto.label}\nEscribe /resumen para ver tus gastos`);
    }
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

app.get('/', (req, res) => res.send('🐜 Hormicash Bot corriendo'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));