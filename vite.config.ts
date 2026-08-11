import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

export default defineConfig({
    plugins: [react(), viteSingleFile()],
    root: "app",
    base: "./",
    build: { outDir: "../dist", emptyOutDir: true },
    server: { port: 4173, strictPort: true },
})
