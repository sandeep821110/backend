import mongoose from 'mongoose';
import CarsolSliderImage from '../src/models/carsolSliderImage.js';

describe('CarsolSliderImage model — max 5 images rule', () => {
  afterAll(async () => {
    await mongoose.disconnect();
    await mongoose.deleteModel(/.*/);
  });

  const build = (images) => new CarsolSliderImage({ name: 'Home Banner', images });

  test('accepts 1-5 images and stores the optional link', () => {
    const one = build(['https://example.com/1.jpg']);
    expect(one.validateSync()).toBeUndefined();

    const five = build([
      'https://example.com/1.jpg',
      'https://example.com/2.jpg',
      'https://example.com/3.jpg',
      'https://example.com/4.jpg',
      'https://example.com/5.jpg'
    ]);
    five.link = '/collections';
    expect(five.validateSync()).toBeUndefined();
    expect(five.link).toBe('/collections');
  });

  test('rejects more than 5 images', () => {
    const six = build([
      'https://example.com/1.jpg',
      'https://example.com/2.jpg',
      'https://example.com/3.jpg',
      'https://example.com/4.jpg',
      'https://example.com/5.jpg',
      'https://example.com/6.jpg'
    ]);
    const err = six.validateSync();
    expect(err).toBeDefined();
    expect(err.errors.images).toBeDefined();
    expect(err.errors.images.message).toMatch(/maximum of 5/i);
  });

  test('rejects an empty images array', () => {
    const err = build([]).validateSync();
    expect(err).toBeDefined();
    expect(err.errors.images).toBeDefined();
  });

  test('rejects blank image strings inside the array', () => {
    const err = build(['https://example.com/1.jpg', '   ']).validateSync();
    expect(err).toBeDefined();
  });
});
