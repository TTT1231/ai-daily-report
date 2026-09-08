// See all configuration options: https://remotion.dev/docs/config
// Each option also is available as a CLI flag: https://remotion.dev/docs/cli

// Note: When using the Node.JS APIs, the config file doesn't apply. Instead, pass options directly to the APIs

import { Config } from "@remotion/cli/config";
import { enableTailwind } from '@remotion/tailwind-v4';

// Preserve small screenshot text before the final video encode.
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.setPublicDir("./data-scheme");
Config.overrideWebpackConfig(enableTailwind);
