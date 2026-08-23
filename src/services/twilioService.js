
import axios from 'axios';

/**
 * Send OTP message using Twilio or mock service
 * @param {string} phoneNumber - The recipient's phone number
 * @param {string|number} otp - The OTP to be sent
 * @returns {Promise<Object>} - Response from SMS API or mock response
 */
export const sendOTPMessage = async (phoneNumber, otp) => {
  try {
    // Format phone number
    const formattedPhoneNumber = formatPhoneNumber(phoneNumber);
    
    // Prepare the message
    const message = `Your verification code is: ${otp}. It will expire in 10 minutes.`;
    
    console.log(`[MOCK SMS] Sending OTP ${otp} to ${formattedPhoneNumber}`);
    
    // In development mode, just log the OTP and return mock success
    // This bypasses the Twilio trial account restrictions
    return {
      status: 'success',
      to: formattedPhoneNumber,
      body: message,
      mock: true,
      sid: 'MOCK_' + Math.random().toString(36).substring(2, 15)
    };
    
    /* 
    // UNCOMMENT THIS CODE WHEN READY FOR PRODUCTION
    // Replace with your actual SMS provider implementation
    
    const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioClient = require('twilio')(twilioAccountSid, twilioAuthToken);
    
    const response = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhoneNumber
    });
    
    console.log(`SMS sent successfully, SID: ${response.sid}`);
    return response;
    */
    
  } catch (error) {
    console.error('Error in sendOTPMessage:', error);
    
    // Return mock success even on error to allow development to continue
    return {
      status: 'success',
      to: formatPhoneNumber(phoneNumber),
      body: `Your verification code is: ${otp}. It will expire in 10 minutes.`,
      mock: true,
      error: true,
      errorMessage: error.message,
      sid: 'ERROR_MOCK_' + Math.random().toString(36).substring(2, 15)
    };
  }
};

/**
 * Format phone number to ensure it's in the correct format
 * @param {string} phoneNumber - The phone number to format
 * @returns {string} - Formatted phone number with +91 prefix for Indian numbers
 */
const formatPhoneNumber = (phoneNumber) => {
  // Remove any non-digit characters except the plus sign at the beginning
  let cleaned = phoneNumber.replace(/(?!^\+)\D/g, '');
  
  // If it's a 10-digit number without country code, add +91 (for India)
  if (cleaned.length === 10 && /^[6-9]\d{9}$/.test(cleaned)) {
    return '+91' + cleaned;
  }
  
  // If it starts with 91 without plus, add the plus
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return '+' + cleaned;
  }
  
  // If it already has +91, return as is
  if (cleaned.startsWith('+91') && cleaned.length === 13) {
    return cleaned;
  }
  
  // If none of the above, return the original with a plus if needed
  return cleaned.startsWith('+') ? cleaned : '+' + cleaned;
};
