const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  stream: require.resolve('readable-stream'),
  util: require.resolve('util/'),
  events: require.resolve('events/'),
};

module.exports = config;
