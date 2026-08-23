import mongoose from 'mongoose';
import Product from '../src/models/productModel.js';

describe('Product model — bestSeller flag', () => {
  afterAll(async () => {
    await mongoose.disconnect();
    await mongoose.deleteModel(/.*/);
  });

  const validBase = () => ({
    productCode: 'TP-001',
    name: 'Test Product',
    price: 999,
    image: ['https://example.com/a.jpg'],
    category: 'Shirts',
    subCategory: 'Casual',
    description: 'A test product',
    brand: 'Acme'
  });

  test('bestSeller defaults to false when not provided', () => {
    const product = new Product(validBase());
    expect(product.bestSeller).toBe(false);
  });

  test('accepts bestSeller = true', () => {
    const product = new Product({ ...validBase(), bestSeller: true });
    expect(product.bestSeller).toBe(true);
    const err = product.validateSync();
    expect(err).toBeUndefined();
  });

  test('coerces string "true"/"false" from multipart form-data', () => {
    // admin sends bestSeller as 'true'/'false' strings via FormData
    const casted = new Product({ ...validBase(), bestSeller: 'true' });
    expect(casted.bestSeller).toBe(true);

    const castedFalse = new Product({ ...validBase(), bestSeller: 'false' });
    expect(castedFalse.bestSeller).toBe(false);
  });

  test('discount defaults to 0', () => {
    const product = new Product(validBase());
    expect(product.discount).toBe(0);
  });

  test('rejects a product missing required fields', () => {
    const product = new Product({ name: '' });
    const err = product.validateSync();
    expect(err).toBeDefined();
    expect(err.errors.name).toBeDefined();
  });
});
