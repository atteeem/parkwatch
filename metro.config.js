// T9.4 spike: bundle .tflite models (react-native-fast-tflite) as assets.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("tflite");

module.exports = config;
