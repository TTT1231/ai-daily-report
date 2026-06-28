import { config } from "@remotion/eslint-config-flat";

export default [
  ...config,
  {
    files: ["scripts/**/*.mjs", "test/**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: {
      // scripts/ 与 test/ 是 Node CLI / 测试，不经 Remotion 渲染：随机性/确定性规则不适用。
      "@remotion/deterministic-randomness": "off",
    },
  },
];
