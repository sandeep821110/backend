import nodemailer from 'nodemailer';
import { configDotenv } from 'dotenv';

configDotenv();

// Create a transporter using SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Function to send an email
const sendEmail = async (to, subject, text, html) => {
  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: to,
      subject: subject,
      text: text,
      html: html,
    });
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

// Function to send OTP email
const sendOTPEmail = async (to, otp) => {
  const subject = 'Your CHOOSEMOOD Verification Code';
  const text = `Your verification code is: ${otp}. It will expire in 10 minutes.`;
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>CHOOSEMOOD - Verification Code</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #E72744 0%, #c81e38 100%); padding:32px 40px; text-align:center;">
              <h1 style="margin:0; font-size:28px; font-weight:800; color:#ffffff; letter-spacing:3px; text-transform:uppercase;">CHOOSEMOOD</h1>
              <p style="margin:6px 0 0; font-size:12px; color:rgba(255,255,255,0.8); letter-spacing:1px; text-transform:uppercase;">spark in fashion</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px; text-align:center;">
              <div style="width:56px; height:56px; margin:0 auto 24px; background-color:#FFF1F3; border-radius:50%; display:flex; align-items:center; justify-content:center;">
                <span style="font-size:28px; line-height:56px;">🔐</span>
              </div>
              <h2 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0a0a0a;">Verify Your Email</h2>
              <p style="margin:0; font-size:15px; color:#525252; line-height:1.6;">Use the code below to complete your verification. This code is valid for <strong style="color:#E72744;">10 minutes</strong>.</p>
            </td>
          </tr>

          <!-- OTP Code -->
          <tr>
            <td style="padding:8px 40px 32px; text-align:center;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="background-color:#f9fafb; border:2px dashed #E72744; border-radius:14px; padding:20px 36px;">
                    <span style="font-size:36px; font-weight:800; color:#E72744; letter-spacing:10px; font-family:'Courier New',monospace;">${otp}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top:1px solid #e5e7eb;"></td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Security Notice -->
          <tr>
            <td style="padding:24px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF1F3; border-radius:10px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0; font-size:13px; color:#8c1628; line-height:1.5;">
                      <strong>⚠️ Security Note:</strong> Never share this code with anyone. CHOOSEMOOD will never ask for your verification code over phone or chat.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#fafafa; padding:24px 40px; text-align:center; border-top:1px solid #f0f0f0;">
              <p style="margin:0 0 8px; font-size:12px; color:#a3a3a3; line-height:1.5;">
                This email was sent to <strong style="color:#525252;">${to}</strong>
              </p>
              <p style="margin:0; font-size:12px; color:#a3a3a3; line-height:1.5;">
                © 2026 CHOOSEMOOD. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  
  return sendEmail(to, subject, text, html);
};

export { sendEmail, sendOTPEmail };