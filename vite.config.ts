import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "build",
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "vendor";
          }
          if (
            id.includes("node_modules/@mui/") ||
            id.includes("node_modules/@emotion/")
          ) {
            return "mui";
          }
        },
      },
    },
  },
});
