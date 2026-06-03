import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  webpack(webpackConfig, { isServer }) {
    // @xenova/transformers runs in the browser / Web Worker.
    // Exclude Node.js-only packages so they don't get bundled client-side.
    if (!isServer) {
      webpackConfig.resolve.alias = {
        ...webpackConfig.resolve.alias,
        "onnxruntime-node$": false,
        "sharp$": false,
      };
    }
    return webpackConfig;
  },
};

export default config;
