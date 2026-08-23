// Create a rider account from the CLI:
//   node scripts/addRider.mjs "Ravi Kumar" ravi@fly.com secret123 [phone] [vehicle]
import mongoose from 'mongoose';
import { configDotenv } from 'dotenv';
import Rider from '../src/models/riderModel.js';

configDotenv();

const [name, email, password, phoneNumber = '', vehicleNumber = ''] = process.argv.slice(2);

if (!name || !email || !password) {
    console.error('Usage: node scripts/addRider.mjs "<name>" "<email>" "<password>" [phone] [vehicleNumber]');
    process.exit(1);
}

try {
    await mongoose.connect(process.env.MONGODB_URI);
    const existing = await Rider.findOne({ email: email.toLowerCase() });
    if (existing) {
        console.error(`Rider already exists: ${email}`);
        process.exit(1);
    }
    const rider = await Rider.create({ name, email, password, phoneNumber, vehicleNumber });
    console.log(`Rider created: ${rider.name} <${rider.email}> (id: ${rider._id})`);
    process.exit(0);
} catch (error) {
    console.error('Failed:', error.message);
    process.exit(1);
}
