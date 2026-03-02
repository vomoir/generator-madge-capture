import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Force Vite to pre-bundle these even if it's confused by the imports
    include: ["react-hot-toast", "prop-types"],
  },
  resolve: {
    alias: {
      <% for (let [alias, target] of Object.entries(aliasMap)) { 
         let normalizedTarget = target.replace(/\\/g, '/').replace(/^\//, '');
         if (normalizedTarget.startsWith('src/')) {
             normalizedTarget = normalizedTarget.replace(/^src\//, '');
         }
      %>
      '<%= alias %>': path.resolve(__dirname, './<%= normalizedTarget %>'),
      <% } %>
    },
  },
  server: {
    open: true, // Automatically open the browser
    port: 3000,
  },
});
