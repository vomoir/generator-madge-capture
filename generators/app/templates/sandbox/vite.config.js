import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // If your monorepo uses aliases (e.g. '@utils'),
      // you can map them here to the folders you extracted.
      // '@utils': path.resolve(__dirname, './utils'),
    },
  },
  server: {
    open: true, // Automatically open the browser
    port: 3000,
  },
});
