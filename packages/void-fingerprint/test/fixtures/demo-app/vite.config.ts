import { defineConfig } from "vite";

const mode = process.env["MODE"] ?? "default";

export default defineConfig({
  plugins: [voidPlugin({ mode }), customPlugin()],
});
