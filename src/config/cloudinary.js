import { v2 as cloudinary } from 'cloudinary';
import { configDotenv } from 'dotenv';

configDotenv();

// Validate required environment variables
const requiredEnvVars = {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
};

// Check if all required variables are present
const missingVars = Object.entries(requiredEnvVars)
  .filter(([key, value]) => !value)
  .map(([key]) => key);

if (missingVars.length > 0) {
  console.error('❌ Missing Cloudinary environment variables:', missingVars);
  console.error('Please add these to your .env file:');
  missingVars.forEach(varName => {
    console.error(`CLOUDINARY_${varName.toUpperCase()}=your_${varName}_here`);
  });
  process.exit(1);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Test the configuration
const testCloudinaryConfig = async () => {
  try {
    await cloudinary.api.ping();
    console.log('✅ Cloudinary configuration successful');
  } catch (error) {
    console.error('❌ Cloudinary configuration failed:', error.message);
  }
};

// Test configuration on import (optional)
testCloudinaryConfig();

export default cloudinary;