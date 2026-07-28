import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

// Generar versión en tiempo de build
function getVersion() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;

  let commitHash = 'dev';
  try {
    commitHash = execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim();
  } catch (e) {
    console.warn('⚠️  No se pudo obtener git commit hash, usando "dev"');
  }

  return `1.0.${dateStr}-${commitHash}`;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(getVersion())
  }
})
