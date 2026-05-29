require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function enviarEmail({ to, from, subject, html }) {
  const { data, error } = await resend.emails.send({ from, to, subject, html });
  if (error) throw new Error(JSON.stringify(error));
  return data;
}

const BASE_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#f0f2f5; font-family:'Manrope',Arial,sans-serif; }
  .wrap { max-width:560px; margin:0 auto; padding:32px 16px; }
  .logo { text-align:center; margin-bottom:28px; font-size:26px; font-weight:800; color:#111; letter-spacing:-0.5px; }
  .logo span { color:#52C97A; }
  .card { background:#fff; border-radius:20px; padding:32px 28px; margin-bottom:12px; }
  .footer { text-align:center; font-size:12px; color:#9ca3af; padding:16px 0 8px; line-height:1.6; }
  .footer a { color:#1A6B3C; text-decoration:none; }
  .btn { display:block; text-align:center; background:linear-gradient(135deg,#1A6B3C,#52C97A);
         color:#fff !important; text-decoration:none; padding:15px 24px; border-radius:14px;
         font-size:15px; font-weight:700; letter-spacing:0.2px; }
  .stat-box { background:#f8faf9; border-radius:12px; padding:14px 18px; margin:16px 0;
              display:flex; justify-content:space-between; align-items:center; }
  .stat-label { font-size:13px; color:#6b7280; font-weight:600; }
  .stat-value { font-size:20px; font-weight:800; color:#1A6B3C; }
  .stat-value.red { color:#ef4444; }
  .tag { display:inline-block; background:#e8f7ee; color:#1A6B3C; font-size:12px;
         font-weight:700; padding:4px 10px; border-radius:20px; margin-bottom:16px; }
`;
function htmlWrapper(content) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${BASE_STYLE}</style></head>
  <body><div class="wrap">${content}</div></body></html>`;
}
function logoHeader() { return `<div class="logo">Hormi<span>cash</span> 🐜</div>`; }
function footer(unsubText = 'recordatorios') {
  return `<div class="footer">
    © ${new Date().getFullYear()} Hormicash · Lima, Perú<br>
    <a href="https://hormicash.com">hormicash.com</a> ·
    <a href="https://hormicash.com/dashboard.html">Mi dashboard</a><br>
    <span style="color:#d1d5db">Recibiste este correo porque activaste los ${unsubText} de Hormicash.</span>
  </div>`;
}

// ── 1. BIENVENIDA ─────────────────────────────────────────────────
async function enviarEmailBienvenida(email, nombre) {
  const html = htmlWrapper(`
    ${logoHeader()}
    <div class="card">
      <div class="tag">¡Bienvenido/a!</div>
      <h1 style="font-size:24px;font-weight:800;color:#111;margin-bottom:10px;line-height:1.3">
        Hola ${nombre}, ya eres parte de Hormicash 🎉
      </h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin-bottom:24px">
        Empezaste a tomar control de tus <strong style="color:#111">gastos hormiga</strong> —
        esos pequeños gastos diarios que al final del mes suman más de lo que crees.
      </p>
      <p style="color:#374151;font-size:14px;line-height:1.8;margin-bottom:24px">
        📲 <strong>Registra por WhatsApp</strong> — escribe "Almuerzo 15" y listo<br>
        📸 <strong>Foto de voucher</strong> — la IA extrae el monto automáticamente<br>
        🎙️ <strong>Mensaje de voz</strong> — di el gasto y lo registramos<br>
        📊 <strong>Dashboard</strong> — ve tus categorías y tendencias
      </p>
      <a href="https://hormicash.com/dashboard.html" class="btn">Ver mi dashboard →</a>
    </div>
    <div class="card" style="background:#f8faf9;border:1px solid #e5e7eb">
      <p style="font-size:13px;color:#6b7280;line-height:1.7">
        💡 <strong style="color:#111">Consejo de inicio:</strong> empieza registrando
        solo tus gastos del día de hoy. En 3 semanas ya tendrás un patrón claro de
        dónde se va tu plata.
      </p>
    </div>
    ${footer('correos de Hormicash')}
  `);
  return enviarEmail({ to: email, from: 'Hormicash <hola@hormicash.com>', subject: `${nombre}, tu cuenta de Hormicash está lista`, html });
}

// ── 2. RECORDATORIO DE GASTOS ─────────────────────────────────────
async function enviarEmailRecordatorio(email, nombre, diasSinRegistrar, totalMes) {
  const esPrimerAviso = diasSinRegistrar === 0;
  const esMedio = diasSinRegistrar >= 1 && diasSinRegistrar <= 3;
  const esFuerte = diasSinRegistrar >= 4;
  const subjects = [
    `${nombre}, ¿registraste tus gastos hoy? 🐜`,
    `Llevas ${diasSinRegistrar + 1} días sin registrar, ${nombre} 👀`,
    `Más de una semana sin registrar, ${nombre} 🔥`
  ];
  const subject = esPrimerAviso ? subjects[0] : esMedio ? subjects[1] : subjects[2];
  const titulo = esPrimerAviso ? `¿Ya registraste tus gastos de hoy?`
    : esMedio ? `Llevas ${diasSinRegistrar + 1} días sin registrar`
    : `Una semana sin registrar... ¿todo bien?`;
  const mensaje = esPrimerAviso
    ? `Solo toma 5 segundos. Escríbele a Hormicash por WhatsApp con algo como <strong>"Almuerzo 15"</strong> y ya queda guardado.`
    : esMedio
    ? `No pasa nada, todos tenemos días ocupados. Pero tus gastos siguen corriendo aunque no los registres. Vuelve cuando puedas.`
    : `Cuando dejas de registrar, los gastos hormiga se acumulan sin que te des cuenta. ¿Volvemos a empezar?`;
  const statBox = totalMes > 0 ? `
    <div class="stat-box">
      <span class="stat-label">Registrado este mes</span>
      <span class="stat-value red">S/ ${totalMes.toFixed(0)}</span>
    </div>` : '';
  const html = htmlWrapper(`
    ${logoHeader()}
    <div class="card">
      <div class="tag">${esFuerte ? '🔥 Re-enganche' : '⏰ Recordatorio'}</div>
      <h1 style="font-size:22px;font-weight:800;color:#111;margin-bottom:10px;line-height:1.3">${titulo}</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin-bottom:20px">${mensaje}</p>
      ${statBox}
      <a href="https://hormicash.com/dashboard.html" class="btn">${esFuerte ? 'Retomar el control →' : 'Registrar ahora →'}</a>
    </div>
    ${footer('recordatorios')}
  `);
  return enviarEmail({ to: email, from: 'Hormicash <recordatorio@hormicash.com>', subject, html });
}

// ── 3. RESUMEN SEMANAL ────────────────────────────────────────────
async function enviarEmailResumenSemanal(email, nombre, { totalGastos, totalIngresos, balance, categorias }) {
  const CATS_DISPLAY = { comida:'🍔 Comida', cafe:'☕ Café', transporte:'🚌 Transporte', telecom:'📱 Telecom', entretenimiento:'🎬 Entretenimiento', salud:'💊 Salud', educacion:'📚 Educación', compras:'🛍️ Compras', hogar:'🏠 Hogar', otros:'📦 Otros' };
  const topCats = categorias.slice(0, 3).map(c => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6">
      <span style="font-size:14px;color:#374151;font-weight:600">${CATS_DISPLAY[c.nombre] || c.nombre}</span>
      <span style="font-size:14px;font-weight:800;color:#ef4444">S/ ${c.monto.toFixed(2)}</span>
    </div>`).join('');
  const html = htmlWrapper(`
    ${logoHeader()}
    <div class="card">
      <div class="tag">📅 Resumen semanal</div>
      <h1 style="font-size:22px;font-weight:800;color:#111;margin-bottom:20px;line-height:1.3">Tu semana en números, ${nombre}</h1>
      <div class="stat-box"><span class="stat-label">Gastos esta semana</span><span class="stat-value red">S/ ${totalGastos.toFixed(2)}</span></div>
      <div class="stat-box" style="margin-top:8px"><span class="stat-label">Ingresos esta semana</span><span class="stat-value">S/ ${totalIngresos.toFixed(2)}</span></div>
      <div class="stat-box" style="margin-top:8px;background:${balance >= 0 ? '#e8f7ee' : '#fef2f2'}">
        <span class="stat-label">Balance</span>
        <span class="stat-value ${balance < 0 ? 'red' : ''}">${balance >= 0 ? '+' : ''}S/ ${balance.toFixed(2)}</span>
      </div>
      ${categorias.length > 0 ? `<div style="margin-top:20px;margin-bottom:8px"><p style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Top categorías</p>${topCats}</div>` : ''}
      <div style="margin-top:20px"><a href="https://hormicash.com/dashboard.html" class="btn">Ver dashboard completo →</a></div>
    </div>
    ${footer('resúmenes semanales')}
  `);
  return enviarEmail({ to: email, from: 'Hormicash <recordatorio@hormicash.com>', subject: `Tu resumen semanal está listo, ${nombre} 📊`, html });
}

// ── 4. BIENVENIDA PREMIUM ─────────────────────────────────────────
async function enviarEmailBienvenidaPremium(email, nombre) {
  const html = htmlWrapper(`
    ${logoHeader()}
    <div class="card" style="border-top:4px solid #1A6B3C">
      <div class="tag">⭐ Premium activado</div>
      <h1 style="font-size:24px;font-weight:800;color:#111;margin-bottom:10px;line-height:1.3">¡Ya eres Premium, ${nombre}! 🎉</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin-bottom:24px">
        Gracias por confiar en Hormicash. Ahora tienes acceso completo a todas las herramientas para controlar tus finanzas.
      </p>
      <div style="background:#f8faf9;border-radius:12px;padding:18px;margin-bottom:24px">
        <p style="font-size:13px;font-weight:700;color:#1A6B3C;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px">Lo que desbloqueaste</p>
        <p style="font-size:14px;color:#374151;line-height:1.9">
          💳 <strong>Tarjeta de crédito</strong> — ciclo BCP, cierre y pago<br>
          🎯 <strong>Límites por categoría</strong> — alertas cuando te acercas<br>
          📊 <strong>Análisis avanzado</strong> — tendencias y comparativas<br>
          🤖 <strong>Consejo con IA</strong> — personalizado a tus gastos<br>
          📄 <strong>Reporte PDF mensual</strong> — exporta tu historial
        </p>
      </div>
      <a href="https://hormicash.com/dashboard.html" class="btn">Explorar Premium →</a>
    </div>
    ${footer('correos de Hormicash')}
  `);
  return enviarEmail({ to: email, from: 'Hormicash <hola@hormicash.com>', subject: `¡Ya eres Premium, ${nombre}! Bienvenido al control total 🌟`, html });
}

// ── 5. ALERTA CIERRE TARJETA ──────────────────────────────────────
async function enviarEmailCierreTarjeta(email, nombre, { diasParaCierre, gastoActual, limiteTC }) {
  const porcentaje = limiteTC ? Math.min((gastoActual / limiteTC) * 100, 100) : null;
  const barColor = porcentaje >= 80 ? '#ef4444' : porcentaje >= 60 ? '#f59e0b' : '#1A6B3C';
  const progreso = (porcentaje !== null) ? `
    <div style="margin:16px 0">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:13px;color:#6b7280">Uso del límite</span>
        <span style="font-size:13px;font-weight:700;color:${barColor}">${Math.round(porcentaje)}%</span>
      </div>
      <div style="background:#e5e7eb;border-radius:20px;height:8px">
        <div style="background:${barColor};width:${porcentaje}%;height:8px;border-radius:20px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <span style="font-size:12px;color:#9ca3af">S/ ${gastoActual.toFixed(2)}</span>
        <span style="font-size:12px;color:#9ca3af">Límite S/ ${limiteTC.toFixed(2)}</span>
      </div>
    </div>` : `
    <div class="stat-box" style="margin:16px 0">
      <span class="stat-label">Gasto acumulado este ciclo</span>
      <span class="stat-value red">S/ ${gastoActual.toFixed(2)}</span>
    </div>`;
  const html = htmlWrapper(`
    ${logoHeader()}
    <div class="card" style="border-top:4px solid #f59e0b">
      <div class="tag" style="background:#fef3cd;color:#b45309">⚠️ Cierre en ${diasParaCierre} día${diasParaCierre !== 1 ? 's' : ''}</div>
      <h1 style="font-size:22px;font-weight:800;color:#111;margin-bottom:10px;line-height:1.3">Tu tarjeta BCP cierra pronto, ${nombre}</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin-bottom:8px">
        El <strong>día 22</strong> cierra tu ciclo. Los gastos que hagas después ya entran al siguiente mes.
      </p>
      ${progreso}
      <a href="https://hormicash.com/dashboard.html" class="btn" style="background:linear-gradient(135deg,#d97706,#f59e0b)">Ver mi tarjeta →</a>
    </div>
    ${footer('alertas de tarjeta')}
  `);
  return enviarEmail({ to: email, from: 'Hormicash <recordatorio@hormicash.com>', subject: `⚠️ Tu tarjeta BCP cierra en ${diasParaCierre} días, ${nombre}`, html });
}

// ── 6. REPORTE MENSUAL ────────────────────────────────────────────
async function enviarEmailReporteMensual(email, nombre, { mes, totalGastos, totalIngresos, balance, topCategoria }) {
  const CATS_DISPLAY = { comida:'🍔 Comida', cafe:'☕ Café', transporte:'🚌 Transporte', telecom:'📱 Telecom', entretenimiento:'🎬 Entretenimiento', salud:'💊 Salud', educacion:'📚 Educación', compras:'🛍️ Compras', hogar:'🏠 Hogar', otros:'📦 Otros' };
  const html = htmlWrapper(`
    ${logoHeader()}
    <div class="card">
      <div class="tag">📄 Reporte mensual</div>
      <h1 style="font-size:22px;font-weight:800;color:#111;margin-bottom:10px;line-height:1.3">Tu reporte de ${mes} está listo</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin-bottom:20px">Aquí está el resumen de tu mes, ${nombre}. Descarga el PDF completo desde tu dashboard.</p>
      <div class="stat-box"><span class="stat-label">Gastos en ${mes}</span><span class="stat-value red">S/ ${totalGastos.toFixed(2)}</span></div>
      <div class="stat-box" style="margin-top:8px"><span class="stat-label">Ingresos en ${mes}</span><span class="stat-value">S/ ${totalIngresos.toFixed(2)}</span></div>
      <div class="stat-box" style="margin-top:8px;background:${balance >= 0 ? '#e8f7ee' : '#fef2f2'}">
        <span class="stat-label">Balance final</span>
        <span class="stat-value ${balance < 0 ? 'red' : ''}">${balance >= 0 ? '+' : ''}S/ ${balance.toFixed(2)}</span>
      </div>
      ${topCategoria ? `<div style="background:#f8faf9;border-radius:12px;padding:14px 16px;margin:16px 0"><p style="font-size:13px;color:#6b7280">Mayor gasto del mes</p><p style="font-size:16px;font-weight:800;color:#111;margin-top:4px">${CATS_DISPLAY[topCategoria.nombre] || topCategoria.nombre} — <span style="color:#ef4444">S/ ${topCategoria.monto.toFixed(2)}</span></p></div>` : ''}
      <a href="https://hormicash.com/dashboard.html" class="btn">Descargar PDF →</a>
    </div>
    ${footer('reportes mensuales')}
  `);
  return enviarEmail({ to: email, from: 'Hormicash <hola@hormicash.com>', subject: `Tu reporte de ${mes} está listo, ${nombre} 📄`, html });
}

// ── 7. RE-ENGAGEMENT ──────────────────────────────────────────────
async function enviarEmailReengagement(email, nombre, diasInactivo) {
  const html = htmlWrapper(`
    ${logoHeader()}
    <div class="card">
      <div class="tag" style="background:#fef2f2;color:#b91c1c">🔥 Te extrañamos</div>
      <h1 style="font-size:22px;font-weight:800;color:#111;margin-bottom:10px;line-height:1.3">${nombre}, llevas ${diasInactivo} días sin registrar</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin-bottom:16px">
        Sabemos que la vida se pone ocupada. Pero en ${diasInactivo} días, los <strong style="color:#111">gastos hormiga</strong> se acumularon sin que los puedas ver.
      </p>
      <div style="background:#f8faf9;border-radius:12px;padding:18px;margin-bottom:20px">
        <p style="font-size:14px;color:#374151;line-height:1.8">
          💡 <strong>¿Sabías que?</strong> Un café diario de S/ 8 al mes son <strong>S/ 240</strong>. Tres semanas sin registrar = S/ 180 sin trackear.
        </p>
      </div>
      <a href="https://hormicash.com/dashboard.html" class="btn">Retomar control →</a>
    </div>
    <div class="card" style="background:#f8faf9;border:1px solid #e5e7eb;margin-top:0">
      <p style="font-size:13px;color:#6b7280;text-align:center;line-height:1.7">
        Solo escríbele al bot de WhatsApp<br>
        <strong style="color:#111">"Almuerzo 15"</strong> y ya está registrado. Así de fácil.
      </p>
    </div>
    ${footer('recordatorios de re-enganche')}
  `);
  return enviarEmail({ to: email, from: 'Hormicash <recordatorio@hormicash.com>', subject: `${nombre}, llevas ${diasInactivo} días sin registrar gastos 👀`, html });
}

// ── 8. RECORDATORIO SEMANAL FREE ─────────────────────────────────
async function enviarEmailRecordatorioFree(email, nombre, { cantidadSemana, totalSemana }) {
  const sinRegistrar = cantidadSemana === 0;
  const poco = cantidadSemana >= 1 && cantidadSemana <= 3;
  // bastante = 4+

  const subject = sinRegistrar
    ? `${nombre}, esta semana no registraste ningún gasto 🐜`
    : poco
    ? `${nombre}, vas bien — sigue registrando tus gastos 💪`
    : `${nombre}, ¡buena semana! Pero te estás perdiendo algo 📊`;

  const tag = sinRegistrar ? '⏰ Recordatorio' : poco ? '💪 Vas bien' : '🌟 Gran semana';
  const tagStyle = sinRegistrar
    ? ''
    : poco
    ? 'background:#e8f7ee;color:#1A6B3C'
    : 'background:#fef3cd;color:#b45309';

  const titulo = sinRegistrar
    ? `Esta semana no registraste ningún gasto`
    : poco
    ? `Registraste ${cantidadSemana} gasto${cantidadSemana > 1 ? 's' : ''} esta semana`
    : `¡Registraste ${cantidadSemana} gastos esta semana!`;

  const mensajePrincipal = sinRegistrar
    ? `Tus gastos hormiga corrieron solos esta semana. Un café, un pasaje, una recarga — sin registrarlos nunca sabrás cuánto suman al mes.`
    : poco
    ? `Vas por buen camino. Intenta registrar todo lo que gastes esta semana — en 30 días tendrás un patrón claro de dónde se va tu plata.`
    : `Llevas un registro consistente. ¿Sabías que con Premium puedes ver análisis por categoría, alertas cuando te pasas de tu límite y un consejo personalizado con IA cada semana?`;

  const statBox = totalSemana > 0 ? `
    <div class="stat-box">
      <span class="stat-label">Registrado esta semana</span>
      <span class="stat-value red">S/ ${totalSemana.toFixed(0)}</span>
    </div>` : '';

  const ctaTexto = sinRegistrar || poco
    ? 'Registrar ahora →'
    : 'Ver mi análisis →';

  const tipBox = sinRegistrar ? `
    <div class="card" style="background:#f8faf9;border:1px solid #e5e7eb;margin-top:0">
      <p style="font-size:13px;color:#6b7280;text-align:center;line-height:1.7">
        Solo escríbele al bot por WhatsApp<br>
        <strong style="color:#111">"Almuerzo 15"</strong> — así de fácil 🐜
      </p>
    </div>` : poco ? `
    <div class="card" style="background:#f8faf9;border:1px solid #e5e7eb;margin-top:0">
      <p style="font-size:13px;color:#6b7280;line-height:1.7">
        💡 <strong style="color:#111">Tip:</strong> registra también por foto de voucher o mensaje de voz. Así no se te escapa ningún gasto.
      </p>
    </div>` : `
    <div class="card" style="background:#f8faf9;border:1px solid #e5e7eb;margin-top:0">
      <p style="font-size:13px;color:#6b7280;line-height:1.7">
        ⭐ <strong style="color:#111">Premium por S/ 15/mes</strong> — análisis avanzado, límites por categoría, consejo con IA y reporte PDF mensual.<br><br>
        <a href="https://hormicash.com/dashboard.html" style="color:#1A6B3C;font-weight:700">Activar Premium →</a>
      </p>
    </div>`;

  const html = htmlWrapper(`
    ${logoHeader()}
    <div class="card">
      <div class="tag" style="${tagStyle}">${tag}</div>
      <h1 style="font-size:22px;font-weight:800;color:#111;margin-bottom:10px;line-height:1.3">${titulo}</h1>
      <p style="color:#6b7280;font-size:15px;line-height:1.6;margin-bottom:20px">${mensajePrincipal}</p>
      ${statBox}
      <a href="https://hormicash.com/dashboard.html" class="btn">${ctaTexto}</a>
    </div>
    ${tipBox}
    ${footer('recordatorios semanales')}
  `);
  return enviarEmail({ to: email, from: 'Hormicash <recordatorio@hormicash.com>', subject, html });
}

// ── HELPERS ───────────────────────────────────────────────────────
async function calcularTotalMes(uid) {
  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
  try {
    const snap = await db.collection('gastos').where('uid','==',uid).where('tipo','==','gasto').where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes)).get();
    let total = 0; snap.forEach(d => { total += d.data().monto || 0; }); return total;
  } catch(e) { return 0; }
}
async function onNuevoUsuario(email, nombre) {
  if (!email) return;
  try { await enviarEmailBienvenida(email, nombre); console.log(`✅ Email bienvenida → ${email}`); }
  catch(e) { console.error(`❌ Bienvenida ${email}:`, e.message); }
}
async function onActivoPremium(email, nombre) {
  if (!email) return;
  try { await enviarEmailBienvenidaPremium(email, nombre); console.log(`✅ Email premium → ${email}`); }
  catch(e) { console.error(`❌ Premium ${email}:`, e.message); }
}

// ── CRONS ─────────────────────────────────────────────────────────
async function cronRecordatorioDiario() {
  const ahora = new Date();
  try {
    const usuariosSnap = await db.collection('usuarios').get();
    for (const doc of usuariosSnap.docs) {
      const data = doc.data(); if (!data.email) continue;
      const nombre = data.nombre?.split(' ')[0] || 'Usuario';
      const gastosSnap = await db.collection('gastos').where('uid','==',doc.id).orderBy('fecha','desc').limit(1).get();
      if (gastosSnap.empty) continue;
      const ultimoGasto = gastosSnap.docs[0].data().fecha?.toDate?.() || new Date(0);
      const diasSinRegistrar = Math.floor((ahora - ultimoGasto) / (1000*60*60*24));
      if (diasSinRegistrar < 1) continue;
      if (diasSinRegistrar >= 7) {
        const yaEnviado = data.ultimo_reengagement?.toDate?.();
        if (yaEnviado && (ahora - yaEnviado) < 7*24*60*60*1000) continue;
        await enviarEmailReengagement(data.email, nombre, diasSinRegistrar);
        await db.collection('usuarios').doc(doc.id).update({ ultimo_reengagement: admin.firestore.FieldValue.serverTimestamp() });
        continue;
      }
      const totalMes = await calcularTotalMes(doc.id);
      await enviarEmailRecordatorio(data.email, nombre, diasSinRegistrar, totalMes);
      await new Promise(r => setTimeout(r, 150));
    }
  } catch(e) { console.error('Error cron recordatorio:', e); }
}

async function cronResumenSemanal() {
  const ahora = new Date();
  const inicioSemana = new Date(ahora.getTime() - 7*24*60*60*1000); inicioSemana.setHours(0,0,0,0);
  try {
    const usuariosSnap = await db.collection('usuarios').get();
    for (const doc of usuariosSnap.docs) {
      const data = doc.data(); if (!data.email) continue;
      const nombre = data.nombre?.split(' ')[0] || 'Usuario';
      const snapshot = await db.collection('gastos').where('uid','==',doc.id).where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioSemana)).get();
      if (snapshot.empty) continue;
      let totalGastos=0, totalIngresos=0; const cats={};
      snapshot.forEach(d => { const g=d.data(); if(g.tipo==='ingreso'){totalIngresos+=g.monto;}else{totalGastos+=g.monto;cats[g.categoria]=(cats[g.categoria]||0)+g.monto;} });
      const categorias = Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([nombre,monto])=>({nombre,monto}));
      await enviarEmailResumenSemanal(data.email, nombre, { totalGastos, totalIngresos, balance: totalIngresos-totalGastos, categorias });
      await new Promise(r => setTimeout(r, 150));
    }
  } catch(e) { console.error('Error cron semanal:', e); }
}

async function cronAlertaTarjeta() {
  const hoy = new Date(); const dia = hoy.getDate();
  if (![18,19,20].includes(dia)) return;
  const diasParaCierre = 22 - dia;
  try {
    const snap = await db.collection('usuarios').where('plan','==','premium').get();
    for (const doc of snap.docs) {
      const data = doc.data(); if (!data.email || !data.tarjeta) continue;
      const nombre = data.nombre?.split(' ')[0] || 'Usuario';
      await enviarEmailCierreTarjeta(data.email, nombre, { diasParaCierre, gastoActual: data.tarjeta.gasto_actual||0, limiteTC: data.tarjeta.limite||null });
      await new Promise(r => setTimeout(r, 150));
    }
  } catch(e) { console.error('Error cron tarjeta:', e); }
}

// ── NUEVO: RECORDATORIO SEMANAL FREE ─────────────────────────────
async function cronRecordatorioFree() {
  const ahora = new Date();
  const hace7dias = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
  hace7dias.setHours(0,0,0,0);
  try {
    const usuariosSnap = await db.collection('usuarios').where('plan','==','free').get();
    for (const doc of usuariosSnap.docs) {
      const data = doc.data(); if (!data.email) continue;
      const nombre = data.nombre?.split(' ')[0] || 'Usuario';

      // Contar gastos de los últimos 7 días
      const gastosSnap = await db.collection('gastos')
        .where('uid','==',doc.id)
        .where('tipo','==','gasto')
        .where('fecha','>=',admin.firestore.Timestamp.fromDate(hace7dias))
        .get();

      let cantidadSemana = 0;
      let totalSemana = 0;
      gastosSnap.forEach(d => {
        cantidadSemana++;
        totalSemana += d.data().monto || 0;
      });

      try {
        await enviarEmailRecordatorioFree(data.email, nombre, { cantidadSemana, totalSemana });
        console.log(`✅ Recordatorio free (${cantidadSemana} gastos) → ${data.email}`);
      } catch(e) {
        console.error(`❌ Recordatorio free ${data.email}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 150));
    }
  } catch(e) { console.error('Error cron free:', e); }
}

// ── SCHEDULER MEJORADO ────────────────────────────────────────────
let _ultimoRecordatorio = null;
let _ultimoSemanal = null;
let _ultimaTarjeta = null;
let _ultimoFree = null;

setInterval(() => {
  const ahora = new Date();
  const horaUTC = ahora.getUTCHours();
  const diaSemana = ahora.getUTCDay(); // 0=dom, 1=lun ... 5=vie, 6=sab
  const fechaHoy = ahora.toISOString().slice(0, 10);
  const semanaKey = `${ahora.getUTCFullYear()}-W${Math.floor(ahora.getTime() / (7*24*60*60*1000))}`;

  // Recordatorio diario premium — 8pm Perú = 01:00 UTC
  if (horaUTC === 1 && _ultimoRecordatorio !== fechaHoy) {
    _ultimoRecordatorio = fechaHoy;
    cronRecordatorioDiario();
  }

  // Resumen semanal premium — lunes 8am Perú = lunes 13:00 UTC
  if (diaSemana === 1 && horaUTC === 13 && _ultimoSemanal !== semanaKey) {
    _ultimoSemanal = semanaKey;
    cronResumenSemanal();
  }

  // Alerta tarjeta premium — 9am Perú = 14:00 UTC
  if (horaUTC === 14 && _ultimaTarjeta !== fechaHoy) {
    _ultimaTarjeta = fechaHoy;
    cronAlertaTarjeta();
  }

  // Recordatorio semanal FREE — viernes 9pm Perú = sábado 02:00 UTC
  if (diaSemana === 6 && horaUTC === 2 && _ultimoFree !== semanaKey) {
    _ultimoFree = semanaKey;
    cronRecordatorioFree();
  }

}, 60000);

// ════════════════════════════════════════════════════════════════
// FIREBASE + GEMINI + WHATSAPP
// ════════════════════════════════════════════════════════════════
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const META_API_URL = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

function normalizarTelefono(telefono) { return telefono.replace('whatsapp:', '').replace(/\s/g, ''); }

async function registrarEvento(tipo, datos = {}) {
  try { await db.collection('metricas').add({ tipo, fecha: admin.firestore.FieldValue.serverTimestamp(), ...datos }); }
  catch(e) { console.error('Error metrica:', e.message); }
}

async function enviarMensaje(telefono, texto) {
  const to = normalizarTelefono(telefono).replace('+', '');
  await axios.post(META_API_URL, { messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });
}

async function downloadMetaMedia(mediaId) {
  const urlResp = await axios.get(`https://graph.facebook.com/v20.0/${mediaId}`, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
  const mediaUrl = urlResp.data.url; const mimeType = urlResp.data.mime_type || 'image/jpeg';
  const mediaResp = await axios.get(mediaUrl, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, responseType: 'arraybuffer' });
  return { base64: Buffer.from(mediaResp.data).toString('base64'), mimeType };
}

function detectarIdioma(texto) {
  const lower = texto.toLowerCase();
  const ptWords = ['oi','bom dia','boa tarde','boa noite','obrigado','obrigada','tudo bem','tudo bom','gastar','gastei','paguei','quanto','reais','real'];
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
};

async function obtenerEmailUsuario(telefono) {
  try {
    telefono = normalizarTelefono(telefono);
    const snap = await db.collection('usuarios').where('telefono','==',telefono).limit(1).get();
    if (snap.empty) return null;
    const data = snap.docs[0].data();
    return { email: data.email, nombre: data.nombre?.split(' ')[0] || 'Usuario' };
  } catch(e) { return null; }
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use((req,res,next) => {
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.sendStatus(200);
  next();
});

const estadoUsuario = {};
const CATEGORIAS = ['comida','cafe','transporte','telecom','entretenimiento','salud','educacion','ropa','hogar','otros'];
const CATEGORIAS_DISPLAY = {comida:'🍔 Comida',cafe:'☕ Café',transporte:'🚌 Transporte',telecom:'📱 Telecom',entretenimiento:'🎬 Entretenimiento',salud:'💊 Salud',educacion:'📚 Educación',ropa:'👕 Ropa',hogar:'🏠 Hogar',otros:'📦 Otros'};
const TC_KEYWORDS = ['tc','credito','crédito','tarjeta','visa','mastercard','amex','credit'];

function detectarTarjeta(texto) { const lower = texto.toLowerCase(); return TC_KEYWORDS.some(k => new RegExp(`(^|\\s|[-,])${k}(\\s|[-,]|$)`,'i').test(lower)); }
function limpiarTextoTC(texto) { let limpio=texto; limpio=limpio.replace(/^(tc|credito|crédito|tarjeta|visa|mastercard|amex|credit)\s+/gi,''); TC_KEYWORDS.forEach(k=>{limpio=limpio.replace(new RegExp(`\\s*[-,]?\\s*\\b${k}\\b\\s*[-,]?\\s*`,'gi'),' ');}); return limpio.trim(); }
async function esPremium(telefono) { telefono=normalizarTelefono(telefono); try{const doc=await db.collection('usuarios_whatsapp').doc(telefono).get();return doc.exists&&doc.data().plan==='premium';}catch(e){return false;} }
async function registrarUsuario(telefono) {
  telefono=normalizarTelefono(telefono);
  try {
    const doc=await db.collection('usuarios_whatsapp').doc(telefono).get(); const esNuevo=!doc.exists;
    await db.collection('usuarios_whatsapp').doc(telefono).set({telefono,ultimo_mensaje:admin.firestore.FieldValue.serverTimestamp(),activo:true},{merge:true});
    if(esNuevo) await registrarEvento('nuevo_usuario',{telefono,canal:'whatsapp'});
    return esNuevo;
  } catch(e){return false;}
}
async function verificarLimite(telefono,categoria,montoNuevo) {
  telefono=normalizarTelefono(telefono);
  try {
    const userDoc=await db.collection('usuarios_whatsapp').doc(telefono).get();if(!userDoc.exists)return null;
    const userData=userDoc.data();if(userData.plan!=='premium')return null;
    const limite=(userData.limites||{})[categoria];if(!limite)return null;
    const inicioMes=new Date();inicioMes.setDate(1);inicioMes.setHours(0,0,0,0);
    const snapshot=await db.collection('gastos').where('telefono','==',telefono).where('categoria','==',categoria).where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes)).get();
    let totalMes=0;snapshot.forEach(doc=>{totalMes+=doc.data().monto;});totalMes+=montoNuevo;
    const porcentaje=(totalMes/limite)*100;
    if(porcentaje>=100)return{tipo:'superado',totalMes,limite,porcentaje};
    if(porcentaje>=80)return{tipo:'advertencia',totalMes,limite,porcentaje};
    return null;
  }catch(e){return null;}
}
async function verificarAlertaContextual(telefono,categoria,montoNuevo) {
  telefono=normalizarTelefono(telefono);
  try {
    const inicioMes=new Date();inicioMes.setDate(1);inicioMes.setHours(0,0,0,0);
    const hoy=new Date();const inicioDia=new Date(hoy.getFullYear(),hoy.getMonth(),hoy.getDate());
    const diasTranscurridos=Math.max(hoy.getDate(),1);
    const snapshot=await db.collection('gastos').where('telefono','==',telefono).where('categoria','==',categoria).where('tipo','==','gasto').where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes)).get();
    let totalMes=0,totalHoy=0;
    snapshot.forEach(doc=>{const d=doc.data();totalMes+=d.monto;const fecha=d.fecha?.toDate?d.fecha.toDate():new Date(d.fecha);if(fecha>=inicioDia)totalHoy+=d.monto;});
    totalHoy+=montoNuevo;
    const promedioDiario=totalMes/diasTranscurridos;
    if(promedioDiario>0&&totalHoy>promedioDiario*1.5)return{catDisplay:CATEGORIAS_DISPLAY[categoria]||categoria,totalHoy:totalHoy.toFixed(2),promedio:promedioDiario.toFixed(2)};
    return null;
  }catch(e){return null;}
}
async function actualizarGastoTarjeta(telefono,monto) {
  telefono=normalizarTelefono(telefono);
  try {
    const userDoc=await db.collection('usuarios_whatsapp').doc(telefono).get();if(!userDoc.exists)return;
    const uid=userDoc.data().uid;if(!uid)return;
    const userRef=db.collection('usuarios').doc(uid);const snap=await userRef.get();if(!snap.exists)return;
    await userRef.update({'tarjeta.gasto_actual':(snap.data().tarjeta?.gasto_actual||0)+monto});
  }catch(e){console.error('Error tarjeta:',e.message);}
}
async function obtenerUidPorTelefono(telefono) {
  telefono=normalizarTelefono(telefono);
  try {
    const snap=await db.collection('usuarios').where('telefono','==',telefono).limit(1).get();
    if(!snap.empty)return snap.docs[0].id;
    const snap2=await db.collection('usuarios').where('telefono','==',`whatsapp:${telefono}`).limit(1).get();
    if(!snap2.empty)return snap2.docs[0].id;
    return null;
  }catch(e){return null;}
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
  if(label.length<2)label='Gasto';
  label=label.charAt(0).toUpperCase()+label.slice(1);
  return label.length>25?label.substring(0,25).trim():label;
}
function parsearMultiplesMovimientos(texto) {
  const partes=texto.split(/\s+(?:y|e|,)\s+/gi);if(partes.length<=1)return null;
  const movimientos=[];
  for(const parte of partes){const mov=parsearMovimiento(parte.trim());if(mov)movimientos.push({...mov,textoOriginal:parte.trim()});}
  return movimientos.length>=2?movimientos:null;
}
function parsearMovimiento(texto) {
  const lower=texto.toLowerCase();
  const match=lower.match(/(\d+(?:[.,]\d{1,2})?)/);if(!match)return null;
  const monto=parseFloat(match[1].replace(',','.'));if(isNaN(monto)||monto<=0)return null;
  const ingresosKw=['ingreso','sueldo','salario','pago','transferencia','depósito','deposito','freelance','propina','bono','regalo','cobro','cobré','cobre','me pagaron','ganancia'];
  if(ingresosKw.some(k=>lower.includes(k)))return{monto,tipo:'ingreso',categoria:'ingreso',label:limpiarLabel(texto)};
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
  for(const[cat,kws]of Object.entries(cats)){if(kws.some(k=>lower.includes(k))){categoria=cat;break;}}
  return{monto,tipo:'gasto',categoria,label:limpiarLabel(texto)};
}
function mensajeAlerta(alerta,catDisplay) {
  return alerta.tipo==='superado'
    ?`\n\n🔴 *¡Superaste tu límite en ${catDisplay}!*\nLlevás S/ ${alerta.totalMes.toFixed(2)} de S/ ${alerta.limite}`
    :`\n\n⚠️ *Llevas el ${Math.round(alerta.porcentaje)}% de tu límite en ${catDisplay}*\nS/ ${alerta.totalMes.toFixed(2)} de S/ ${alerta.limite}`;
}

async function generarConsejoIA(telefono) {
  telefono=normalizarTelefono(telefono);
  try {
    const inicioMes=new Date();inicioMes.setDate(1);inicioMes.setHours(0,0,0,0);
    const snapshot=await db.collection('gastos').where('telefono','==',telefono).where('fecha','>=',admin.firestore.Timestamp.fromDate(inicioMes)).get();
    if(snapshot.empty)return null;
    let totalGastos=0,totalIngresos=0,count=0;const cats={};
    snapshot.forEach(doc=>{const d=doc.data();if(d.tipo==='ingreso'){totalIngresos+=d.monto;}else{totalGastos+=d.monto;count++;cats[d.categoria]=(cats[d.categoria]||0)+d.monto;}});
    const topCat=Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];const balance=totalIngresos-totalGastos;
    const model=genAI.getGenerativeModel({model:'gemini-2.5-flash-lite'});
    const prompt=`Eres un asesor financiero personal amigable para peruanos jóvenes.\nDatos del usuario este mes:\n- Total gastos: S/ ${totalGastos.toFixed(2)}\n- Total ingresos: S/ ${totalIngresos.toFixed(2)}\n- Balance: S/ ${balance.toFixed(2)}\n- Categoría con más gastos: ${topCat?`${topCat[0]} (S/ ${topCat[1].toFixed(2)})`:'N/A'}\n- Número de transacciones: ${count}\nDa UN consejo financiero corto, personalizado, práctico y motivador en español peruano.\nMáximo 2 oraciones. Sin asteriscos ni emojis excesivos. Solo el texto del consejo.`;
    const result=await model.generateContent(prompt);
    return result.response.text().trim();
  }catch(e){return null;}
}

// ── RUTAS ─────────────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode=req.query['hub.mode'], token=req.query['hub.verify_token'], challenge=req.query['hub.challenge'];
  console.log(`Webhook GET: mode=${mode}, token=${token}`);
  if(mode==='subscribe'&&token===VERIFY_TOKEN){console.log('✅ Webhook verificado');res.status(200).send(challenge);}
  else{res.sendStatus(403);}
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry=req.body?.entry?.[0]; const change=entry?.changes?.[0]; const value=change?.value;
    if(value?.statuses)return;
    const messages=value?.messages; if(!messages||messages.length===0)return;
    const msgObj=messages[0]; const telefonoRaw=msgObj.from; const telefono=normalizarTelefono(`+${telefonoRaw}`);
    const tipo=msgObj.type; let mensaje='',tieneMedia=false,mediaId=null,mediaMime=null;
    if(tipo==='text'){mensaje=msgObj.text?.body?.trim()||'';}
    else if(tipo==='image'){tieneMedia=true;mediaId=msgObj.image?.id;mediaMime=msgObj.image?.mime_type||'image/jpeg';}
    else if(tipo==='audio'||tipo==='voice'){tieneMedia=true;mediaId=(msgObj.audio||msgObj.voice)?.id;mediaMime=(msgObj.audio||msgObj.voice)?.mime_type||'audio/ogg';}
    else if(tipo==='document'){tieneMedia=true;mediaId=msgObj.document?.id;mediaMime=msgObj.document?.mime_type||'application/pdf';}
    else if(['call','reaction','sticker','location','contacts','unsupported'].includes(tipo)){console.log(`Tipo ignorado: ${tipo}`);return;}
    else{console.log(`Tipo desconocido: ${tipo}`);return;}

    const idioma=detectarIdioma(mensaje);
    const esNuevo=await registrarUsuario(telefono);
    if(esNuevo||idioma!=='es')await db.collection('usuarios_whatsapp').doc(telefono).set({idioma},{merge:true});
    if(esNuevo){
      estadoUsuario[telefono]={esperando:'bienvenida_limites'};
      await enviarMensaje(telefono,i18n.bienvenida[idioma](telefono));
      await enviarMensaje(telefono, `📧 Te enviamos un correo de bienvenida a tu email.\n\n¡Revísalo! Y si no lo ves, búscalo en *Spam* y márcalo como "No es spam" para que te lleguen tus recordatorios y resúmenes semanales 🙌`);
      const userInfo=await obtenerEmailUsuario(telefono);
      if(userInfo?.email) onNuevoUsuario(userInfo.email,userInfo.nombre).catch(e=>console.error('Email bienvenida:',e.message));
      return;
    }

    if(estadoUsuario[telefono]?.esperando==='bienvenida_limites'){
      if(mensaje==='1'){
        const premium=await esPremium(telefono);
        if(!premium){delete estadoUsuario[telefono];await registrarEvento('intento_premium',{telefono,canal:'whatsapp',origen:'bienvenida'});await enviarMensaje(telefono,`⭐ *Función Premium*\n\nActiva tu plan en: https://hormicash.com/dashboard.html\n\nPor ahora ya puedes registrar gastos 🐜`);}
        else{estadoUsuario[telefono]={esperando:'limite_categoria',limites:{},categoriaIndex:0};await enviarMensaje(telefono,`💰 ¿Límite mensual para *${CATEGORIAS_DISPLAY[CATEGORIAS[0]]}*?\n\nEscribe el monto o _"saltar"_.\n_(1 de ${CATEGORIAS.length})_`);}
      }else{delete estadoUsuario[telefono];await enviarMensaje(telefono,`¡Perfecto! Edita tus límites en:\nhttps://hormicash.com/dashboard.html\n\nEscribe _"Almuerzo 15"_ para empezar 🐜`);}
      return;
    }

    if(estadoUsuario[telefono]?.esperando==='meta_ahorro'){
      delete estadoUsuario[telefono];
      const meta=parseFloat(mensaje.replace(',','.'));
      if(isNaN(meta)||meta<=0)await enviarMensaje(telefono,'❌ Monto inválido. Escribe /meta para intentar de nuevo.');
      else{await db.collection('usuarios_whatsapp').doc(telefono).set({meta_ahorro:meta},{merge:true});await enviarMensaje(telefono,`🎯 *¡Meta configurada!*\n\nQuieres ahorrar *S/ ${meta.toFixed(0)}* este mes.\n\nVe tu progreso en: https://hormicash.com/dashboard.html\n\n💪 ¡Tú puedes lograrlo!`);}
      return;
    }

    if(estadoUsuario[telefono]?.esperando==='limite_categoria'){
      const estado=estadoUsuario[telefono];
      if(mensaje.toLowerCase()!=='saltar'){const monto=parseFloat(mensaje.replace(',','.'));if(!isNaN(monto)&&monto>0)estado.limites[CATEGORIAS[estado.categoriaIndex]]=monto;}
      estado.categoriaIndex++;
      if(estado.categoriaIndex<CATEGORIAS.length)await enviarMensaje(telefono,`💰 ¿Límite para *${CATEGORIAS_DISPLAY[CATEGORIAS[estado.categoriaIndex]]}*?\n\nEscribe el monto o _"saltar"_.\n_(${estado.categoriaIndex+1} de ${CATEGORIAS.length})_`);
      else{await db.collection('usuarios_whatsapp').doc(telefono).set({limites:estado.limites},{merge:true});delete estadoUsuario[telefono];const resumen=Object.entries(estado.limites).map(([c,m])=>`  • ${CATEGORIAS_DISPLAY[c]}: S/ ${m}`).join('\n');await enviarMensaje(telefono,`✅ *¡Límites configurados!*\n\n${resumen}\n\nTe avisaré cuando te acerques 🎯\nEdítalos en: https://hormicash.com/dashboard.html`);}
      return;
    }

    if(estadoUsuario[telefono]?.esperando==='confirmar_borrar'){
      const estado=estadoUsuario[telefono];const opcion=parseInt(mensaje.trim());delete estadoUsuario[telefono];
      if(mensaje.toLowerCase()==='cancelar'||isNaN(opcion)){await enviarMensaje(telefono,'❌ Cancelado. No se eliminó ningún gasto.');return;}
      const gastoABorrar=estado.gastos[opcion-1];
      if(!gastoABorrar){await enviarMensaje(telefono,'❌ Número inválido. Escribe /borrar para intentar de nuevo.');return;}
      try{await db.collection('gastos').doc(gastoABorrar.id).delete();await enviarMensaje(telefono,`🗑️ *Gasto eliminado*\n\n_${gastoABorrar.label}_ — S/ ${gastoABorrar.monto.toFixed(2)}\n\nEscribe /resumen para ver tu balance actualizado.`);}
      catch(e){await enviarMensaje(telefono,'❌ No pude eliminar el gasto. Intenta de nuevo.');}
      return;
    }

    if(tieneMedia&&mediaId){
      try{
        const{base64,mimeType}=await downloadMetaMedia(mediaId);
        if(mediaMime.startsWith('audio/')||tipo==='audio'||tipo==='voice'){
          const audio=await extractAudioData(base64,mimeType);
          if(audio.error==='no_monto'){await enviarMensaje(telefono,'🎙️ No pude identificar un monto.\nIntenta: "Almuerzo en La Lucha, veinte soles"');return;}
          const esIngreso=audio.tipo==='ingreso',cat=audio.categoria?.toLowerCase()||'otros',labelAudio=audio.negocio||audio.descripcion||(esIngreso?'Ingreso por voz':'Gasto por voz');
          const uid=await obtenerUidPorTelefono(telefono);
          await db.collection('gastos').add({telefono,uid:uid||null,monto:audio.monto,tipo:audio.tipo||'gasto',categoria:cat,label:labelAudio,descripcion:audio.descripcion,fuente:'audio_whatsapp',mensaje:'[audio]',fecha:admin.firestore.FieldValue.serverTimestamp()});
          await registrarEvento('gasto_registrado',{telefono,canal:'whatsapp',fuente:'audio',categoria:cat,monto:audio.monto});
          let resp=esIngreso?`💰 *Ingreso por voz*\n\n💵 S/ ${audio.monto.toFixed(2)}\n📝 ${labelAudio}\n\nEscribe /resumen para ver tu balance`:`✅ *Gasto por voz*\n\n🏪 ${labelAudio}\n💰 S/ ${audio.monto.toFixed(2)}\n📂 ${CATEGORIAS_DISPLAY[cat]||cat}\n\nEscribe /resumen para ver tu balance`;
          if(!esIngreso){const a=await verificarLimite(telefono,cat,audio.monto);if(a)resp+=mensajeAlerta(a,CATEGORIAS_DISPLAY[cat]||cat);const alerta=await verificarAlertaContextual(telefono,cat,audio.monto);if(alerta)resp+=`\n\n💡 Hoy ya llevas S/ ${alerta.totalHoy} en ${alerta.catDisplay}, por encima de tu promedio diario (S/ ${alerta.promedio})`;}
          await enviarMensaje(telefono,resp);
        }else{
          const voucher=await extractVoucherData(base64,mimeType);
          if(voucher.error==='no_voucher'){await enviarMensaje(telefono,'📸 No pude identificar un voucher.\nEnvía una foto clara de tu ticket.');return;}
          const cat=voucher.categoria?.toLowerCase()||'otros',labelVoucher=voucher.negocio||'Voucher';
          const uidV=await obtenerUidPorTelefono(telefono);
          await db.collection('gastos').add({telefono,uid:uidV||null,monto:voucher.monto,tipo:'gasto',categoria:cat,label:labelVoucher,descripcion:voucher.descripcion,fecha_voucher:voucher.fecha,fuente:'voucher_whatsapp',mensaje:'[imagen]',fecha:admin.firestore.FieldValue.serverTimestamp()});
          await registrarEvento('gasto_registrado',{telefono,canal:'whatsapp',fuente:'voucher',categoria:cat,monto:voucher.monto});
          let resp=`✅ *Voucher registrado*\n\n🏪 ${labelVoucher}\n💰 S/ ${voucher.monto.toFixed(2)}\n📂 ${CATEGORIAS_DISPLAY[cat]||cat}\n📝 ${voucher.descripcion}\n\nEscribe /resumen para ver tu balance`;
          const a=await verificarLimite(telefono,cat,voucher.monto);if(a)resp+=mensajeAlerta(a,CATEGORIAS_DISPLAY[cat]||cat);
          const alerta=await verificarAlertaContextual(telefono,cat,voucher.monto);if(alerta)resp+=`\n\n💡 Hoy ya llevas S/ ${alerta.totalHoy} en ${alerta.catDisplay}, por encima de tu promedio diario (S/ ${alerta.promedio})`;
          await enviarMensaje(telefono,resp);
        }
      }catch(err){console.error('Error media:',err);await enviarMensaje(telefono,'❌ No pude procesar el archivo. Intenta de nuevo.');}
      return;
    }

    if(estadoUsuario[telefono]?.esperando==='resumen'){
      const opcion=mensaje;delete estadoUsuario[telefono];
      const ahora=new Date();let desde,periodo;
      const offsetPeru=5*60*60*1000;
      if(opcion==='1'){desde=new Date(new Date(ahora.getFullYear(),ahora.getMonth(),ahora.getDate()).getTime()+offsetPeru);periodo='Hoy';}
      else if(opcion==='2'){desde=new Date(ahora.getTime()-(7*24*60*60*1000));desde=new Date(new Date(desde.getFullYear(),desde.getMonth(),desde.getDate()).getTime()+offsetPeru);periodo='Esta semana';}
      else if(opcion==='3'){desde=new Date(new Date(ahora.getFullYear(),ahora.getMonth(),1).getTime()+offsetPeru);periodo='Este mes';}
      else{await enviarMensaje(telefono,'❌ Opción no válida.\nEscribe /resumen para intentar de nuevo.');return;}
      const snapshot=await db.collection('gastos').where('telefono','==',telefono).where('fecha','>=',admin.firestore.Timestamp.fromDate(desde)).get();
      let totalGastos=0,totalIngresos=0,totalTarjeta=0;const cats={};
      snapshot.forEach(doc=>{const d=doc.data();if(d.tipo==='ingreso'){totalIngresos+=d.monto;}else{if(d.fuente_pago==='tarjeta'){totalTarjeta+=d.monto;}else{totalGastos+=d.monto;cats[d.categoria]=(cats[d.categoria]||0)+d.monto;}}});
      let resCats='';for(const[c,m]of Object.entries(cats))resCats+=`  • ${CATEGORIAS_DISPLAY[c]||c}: S/ ${m.toFixed(2)}\n`;
      const balance=totalIngresos-totalGastos;
      let msg=`📊 *Resumen - ${periodo}*\n━━━━━━━━━━━━━━\n💸 Gastos: S/ ${totalGastos.toFixed(2)}\n${resCats}💰 Ingresos: S/ ${totalIngresos.toFixed(2)}\n━━━━━━━━━━━━━━\n${balance>=0?'🟢':'🔴'} Balance: S/ ${balance.toFixed(2)}`;
      if(totalTarjeta>0)msg+=`\n\n💳 Tarjeta de crédito: S/ ${totalTarjeta.toFixed(2)}`;
      await enviarMensaje(telefono,msg);return;
    }

    if(mensaje.toLowerCase()==='/resumen'){estadoUsuario[telefono]={esperando:'resumen'};await enviarMensaje(telefono,`📊 *¿Qué resumen deseas?*\n\n1️⃣ Hoy\n2️⃣ Esta semana\n3️⃣ Este mes\n\nResponde con el número.`);return;}

    if(mensaje.toLowerCase()==='/borrar'||mensaje.toLowerCase()==='/delete'||mensaje.toLowerCase()==='/deletar'){
      try{
        const snapshot=await db.collection('gastos').where('telefono','==',telefono).orderBy('fecha','desc').limit(10).get();
        if(snapshot.empty){await enviarMensaje(telefono,'📭 No tienes gastos registrados para eliminar.');return;}
        const gastos=[];
        snapshot.forEach(doc=>{const d=doc.data();if(d.tipo==='ingreso')return;if(gastos.length>=5)return;gastos.push({id:doc.id,label:d.label||d.descripcion||'—',monto:d.monto||0,fecha:d.fecha?.toDate?d.fecha.toDate():new Date()});});
        if(gastos.length===0){await enviarMensaje(telefono,'📭 No tienes gastos registrados para eliminar.');return;}
        let lista=`🗑️ *¿Cuál gasto quieres eliminar?*\n\n`;
        gastos.forEach((g,i)=>{const fechaStr=g.fecha.toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit'});lista+=`${i+1}️⃣ ${g.label} — S/ ${g.monto.toFixed(2)} _(${fechaStr})_\n`;});
        lista+=`\nResponde con el número o escribe *cancelar*.`;
        estadoUsuario[telefono]={esperando:'confirmar_borrar',gastos};
        await enviarMensaje(telefono,lista);
      }catch(e){console.error('Error en /borrar:',e);await enviarMensaje(telefono,'❌ No pude cargar tus gastos. Intenta de nuevo.');}
      return;
    }

    if(mensaje.toLowerCase()==='/limites'){
      const premium=await esPremium(telefono);
      if(!premium){await registrarEvento('intento_premium',{telefono,canal:'whatsapp',origen:'comando_limites'});await enviarMensaje(telefono,`⭐ *Función Premium*\n\nActívala en: https://hormicash.com/dashboard.html`);return;}
      estadoUsuario[telefono]={esperando:'limite_categoria',limites:{},categoriaIndex:0};
      await enviarMensaje(telefono,`💰 *Configurar límites*\n\n¿Límite para *${CATEGORIAS_DISPLAY[CATEGORIAS[0]]}*?\n\nEscribe el monto o _"saltar"_.\n_(1 de ${CATEGORIAS.length})_`);
      return;
    }

    if(mensaje.toLowerCase()==='/consejo'){
      const premium=await esPremium(telefono);
      if(!premium){await registrarEvento('intento_premium',{telefono,canal:'whatsapp',origen:'comando_consejo'});await enviarMensaje(telefono,`⭐ *Función Premium*\n\nActívala en: https://hormicash.com/dashboard.html`);return;}
      await enviarMensaje(telefono,'💡 Analizando tus gastos...');
      const consejo=await generarConsejoIA(telefono);
      if(consejo)await enviarMensaje(telefono,`💡 *Consejo personalizado*\n\n${consejo}`);
      return;
    }

    if(mensaje.toLowerCase()==='/meta'){
      const premium=await esPremium(telefono);
      if(!premium){await registrarEvento('intento_premium',{telefono,canal:'whatsapp',origen:'comando_meta'});await enviarMensaje(telefono,`⭐ *Función Premium*\n\nActívala en: https://hormicash.com/dashboard.html`);return;}
      estadoUsuario[telefono]={esperando:'meta_ahorro'};
      await enviarMensaje(telefono,`🎯 *Meta de ahorro mensual*\n\n¿Cuánto quieres ahorrar este mes?\nEscribe el monto en soles:`);
      return;
    }

    const esTarjeta=detectarTarjeta(mensaje),mensajeLimpio=esTarjeta?limpiarTextoTC(mensaje):mensaje;
    const multiples=parsearMultiplesMovimientos(mensajeLimpio);
    if(multiples){
      let respuesta=`✅ *${multiples.length} gastos registrados*${esTarjeta?' 💳':''}\n\n`;
      for(const mov of multiples){
        if(mov.categoria==='otros' && mov.tipo==='gasto'){try{const model=genAI.getGenerativeModel({model:'gemini-2.5-flash-lite'});const result=await model.generateContent(`Clasifica este gasto en UNA categoría: comida, cafe, transporte, telecom, compras, entretenimiento, hogar, salud, educacion, otros.\nGasto: "${mov.label}"\nResponde SOLO la categoría.`);const cat=result.response.text().trim().toLowerCase().replace(/[^a-záéíóúñ]/g,'');const validas=['comida','cafe','transporte','telecom','compras','entretenimiento','hogar','salud','educacion','otros'];if(validas.includes(cat))mov.categoria=cat;}catch(e){console.log('Gemini fallback:',e.message);}}
        const uidM=await obtenerUidPorTelefono(telefono);
        const gastoData={telefono,uid:uidM||null,monto:mov.monto,tipo:mov.tipo,categoria:mov.categoria,label:mov.label,fuente:'texto_whatsapp',mensaje:mov.textoOriginal,fecha:admin.firestore.FieldValue.serverTimestamp()};
        if(esTarjeta)gastoData.fuente_pago='tarjeta';
        await db.collection('gastos').add(gastoData);
        await registrarEvento('gasto_registrado',{telefono,canal:'whatsapp',fuente:'texto',categoria:mov.categoria,monto:mov.monto});
        if(esTarjeta)await actualizarGastoTarjeta(telefono,mov.monto);
        respuesta+=`${mov.tipo==='ingreso'?'💰':'🐜'}${esTarjeta?' 💳':''} *${mov.label}* — S/ ${mov.monto.toFixed(2)} (${CATEGORIAS_DISPLAY[mov.categoria]||mov.categoria})\n`;
      }
      respuesta+=`\nEscribe /resumen para ver tu balance`;
      await enviarMensaje(telefono,respuesta);
      return;
    }

    const mov=parsearMovimiento(mensajeLimpio);
    if(!mov){
      const userDoc=await db.collection('usuarios_whatsapp').doc(telefono).get();
      await enviarMensaje(telefono,i18n.noEntendi[userDoc.data()?.idioma||'es']||i18n.noEntendi.es);
    }else{
      if(mov.categoria==='otros' && mov.tipo==='gasto'){
        try{
          const model=genAI.getGenerativeModel({model:'gemini-2.5-flash-lite'});
          const result=await model.generateContent(`Clasifica este gasto en UNA categoría: comida, cafe, transporte, telecom, compras, entretenimiento, hogar, salud, educacion, otros.\nGasto: "${mov.label}"\nResponde SOLO la categoría.`);
          const cat=result.response.text().trim().toLowerCase().replace(/[^a-záéíóúñ]/g,'');
          const validas=['comida','cafe','transporte','telecom','compras','entretenimiento','hogar','salud','educacion','otros'];
          if(validas.includes(cat)) mov.categoria=cat;
        }catch(e){ console.log('Gemini no disponible, usando keywords:', e.message); }
      }
      const uidT=await obtenerUidPorTelefono(telefono);
      const gastoData={telefono,uid:uidT||null,monto:mov.monto,tipo:mov.tipo,categoria:mov.categoria,label:mov.label,fuente:'texto_whatsapp',mensaje,fecha:admin.firestore.FieldValue.serverTimestamp()};
      await db.collection('gastos').add(gastoData);
      await registrarEvento('gasto_registrado',{telefono,canal:'whatsapp',fuente:esTarjeta?'tarjeta':'texto',categoria:mov.categoria,monto:mov.monto});
      let resp;
      if(esTarjeta){await actualizarGastoTarjeta(telefono,mov.monto);resp=`💳 *Gasto con tarjeta registrado*\n\n🏪 ${mov.label}\n💰 S/ ${mov.monto.toFixed(2)}\n📂 ${CATEGORIAS_DISPLAY[mov.categoria]||mov.categoria}\n\n_Registrado en tu tarjeta de crédito_\nEscribe /resumen para ver tu balance`;}
      else if(mov.tipo==='ingreso')resp=`💰 S/ ${mov.monto.toFixed(2)} ingreso registrado\n📝 ${mov.label}\nEscribe /resumen para ver tu balance`;
      else resp=`✅ S/ ${mov.monto.toFixed(2)} gasto registrado\n🐜 ${mov.label}\nEscribe /resumen para ver tu balance`;
      if(mov.tipo==='gasto'){const a=await verificarLimite(telefono,mov.categoria,mov.monto);if(a)resp+=mensajeAlerta(a,CATEGORIAS_DISPLAY[mov.categoria]||mov.categoria);const alerta=await verificarAlertaContextual(telefono,mov.categoria,mov.monto);if(alerta)resp+=`\n\n💡 Hoy ya llevas S/ ${alerta.totalHoy} en ${alerta.catDisplay}, por encima de tu promedio diario (S/ ${alerta.promedio})`;}
      await enviarMensaje(telefono,resp);
    }
  }catch(err){console.error('Error en webhook:',err);}
});

app.post('/api/analisis-mes', async (req, res) => {
  try {
    const{prompt}=req.body; if(!prompt)return res.status(400).json({error:'Falta el prompt'});
    const model=genAI.getGenerativeModel({model:'gemini-2.5-flash-lite'});
    const result=await model.generateContent(prompt);
    res.json({texto:result.response.text().trim()});
  }catch(e){console.error('Error análisis mes:',e);res.status(500).json({error:e.message});}
});

app.post('/recategorizar', async (req, res) => {
  const{clave}=req.body; if(clave!=='hormicash_admin_2024')return res.json({error:'No autorizado'});
  const CATS_VALIDAS=['comida','cafe','transporte','telecom','compras','entretenimiento','hogar','salud','educacion','otros'];
  async function categorizarGemini(label){try{const model=genAI.getGenerativeModel({model:'gemini-2.5-flash-lite'});const result=await model.generateContent(`Clasifica este gasto en UNA categoría exacta: comida, cafe, transporte, telecom, compras, entretenimiento, hogar, salud, educacion, otros.\nGasto: "${label}"\nResponde SOLO con la categoría, sin explicación.`);const cat=result.response.text().trim().toLowerCase().replace(/[^a-záéíóúñ]/g,'');return CATS_VALIDAS.includes(cat)?cat:'otros';}catch(e){return 'otros';}}
  try{
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

app.get('/api/metricas', async (req, res) => {
  if(req.query.clave!==process.env.ADMIN_SECRET)return res.status(401).json({error:'No autorizado'});
  try{
    const snap=await db.collection('metricas').orderBy('fecha','desc').limit(500).get();
    const eventos=[];snap.forEach(d=>eventos.push({id:d.id,...d.data()}));
    const resumen={total_eventos:eventos.length,nuevos_usuarios:eventos.filter(e=>e.tipo==='nuevo_usuario').length,intentos_premium:eventos.filter(e=>e.tipo==='intento_premium').length,gastos_registrados:eventos.filter(e=>e.tipo==='gasto_registrado').length,por_origen:{},por_categoria:{}};
    eventos.filter(e=>e.tipo==='intento_premium').forEach(e=>{resumen.por_origen[e.origen]=(resumen.por_origen[e.origen]||0)+1;});
    eventos.filter(e=>e.tipo==='gasto_registrado'&&e.categoria).forEach(e=>{resumen.por_categoria[e.categoria]=(resumen.por_categoria[e.categoria]||0)+1;});
    res.json({resumen,eventos});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/', (req, res) => res.send('🐜 Hormicash Bot corriendo'));

app.get('/test-email', async (req, res) => {
  const email = req.query.email; if(!email)return res.send('Falta ?email=');
  try { await enviarEmailRecordatorio(email,'Stefano',2,1165); res.send(`✅ Email enviado a ${email}`); }
  catch(e) { res.send(`❌ Error: ${e.message}`); }
});

app.get('/test-bienvenida', async (req, res) => {
  const email = req.query.email; if(!email)return res.send('Falta ?email=');
  try { await enviarEmailBienvenida(email,'Stefano'); res.send(`✅ Bienvenida enviada a ${email}`); }
  catch(e) { res.send(`❌ Error: ${e.message}`); }
});

app.get('/test-premium', async (req, res) => {
  const email = req.query.email; if(!email)return res.send('Falta ?email=');
  try { await enviarEmailBienvenidaPremium(email,'Stefano'); res.send(`✅ Premium enviado a ${email}`); }
  catch(e) { res.send(`❌ Error: ${e.message}`); }
});

app.get('/test-recordatorio-free', async (req, res) => {
  if(req.query.clave!==process.env.ADMIN_SECRET)return res.send('❌ No autorizado');
  try { await cronRecordatorioFree(); res.json({ok:true,mensaje:'Cron free ejecutado'}); }
  catch(e) { res.json({error:e.message}); }
});

app.get('/usuarios-emails', async (req, res) => {
  try{const snap=await db.collection('usuarios').get();const usuarios=[];snap.forEach(d=>{const data=d.data();if(data.email)usuarios.push({nombre:data.nombre?.split(' ')[0]||'Usuario',email:data.email,plan:data.plan||'free',telefono:data.telefono||''}); });res.json({total:usuarios.length,usuarios});}
  catch(e){res.json({error:e.message});}
});

app.get('/enviar-recordatorio-todos', async (req, res) => {
  if(req.query.clave!==process.env.ADMIN_SECRET)return res.send('❌ No autorizado');
  try{await cronRecordatorioDiario();res.json({ok:true,mensaje:'Cron ejecutado'});}
  catch(e){res.json({error:e.message});}
});

app.post('/api/notificar-premium', async (req, res) => {
  const{telefono,nombre}=req.body;
  try{
    await enviarMensaje(telefono,`🌟 *¡Ya eres Premium, ${nombre}!*\n\nTu pago fue confirmado. Entra al dashboard para disfrutar todas las funciones:\nhttps://hormicash.com/dashboard.html\n\n¡Gracias por confiar en Hormicash! 🐜`);
    const userInfo=await obtenerEmailUsuario(telefono);
    if(userInfo?.email) onActivoPremium(userInfo.email,userInfo.nombre).catch(console.error);
    res.json({ok:true});
  }catch(e){res.json({error:e.message});}
});

app.post('/api/claude', async (req, res) => {
  try{
    const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify(req.body)});
    res.json(await response.json());
  }catch(e){res.status(500).json({error:e.message});}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🐜 Hormicash Bot corriendo en puerto ${PORT}`));