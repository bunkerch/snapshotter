import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
    plugins: [react()],
    root: "app",
    base: "./",
    build: { outDir: "../dist", emptyOutDir: true },
    server: { port: 4173, strictPort: true },
})
