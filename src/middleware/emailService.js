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
  const subject = 'Your OTP for Verification';
  const text = `Your OTP is: ${otp}. It will expire in 10 minutes.`;
  const html = `<p>Your OTP is: <strong>${otp}</strong></p><p>It will expire in 10 minutes.</p>`;
  
  return sendEmail(to, subject, text, html);
};

export { sendEmail, sendOTPEmail };