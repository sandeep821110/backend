import crypto from 'crypto';


const generateOTP = () => {
  return crypto.randomInt(100000, 999999);
}
console.log(generateOTP());
export default generateOTP