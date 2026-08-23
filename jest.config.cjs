module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  testMatch: ['**/tests/**/*.test.js'],
  moduleFileExtensions: ['js', 'json'],
  // color-name ships as ESM inside node_modules — let babel transform it
  transformIgnorePatterns: ['/node_modules/(?!color-name/)'],
  verbose: true
};
