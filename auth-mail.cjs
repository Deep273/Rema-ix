
const nodemailer = require('nodemailer');
let transport;
function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM);
}
async function sendVerification(email, code) {
  if (!mailConfigured()) throw Error('SMTP_NOT_CONFIGURED');
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
    });
  }
  await transport.sendMail({
    from: process.env.SMTP_FROM, to: email,
    subject: 'Код подтверждения LandScope',
    text: 'Ваш код подтверждения: ' + code + '\n\nВведите его на https://90.188.118.197/. Код действует 15 минут. Если вы не регистрировались, просто проигнорируйте письмо.'
  });
}
module.exports = { sendVerification, mailConfigured };
