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

  // Nivel 1: Git local (funciona en local y debería funcionar en Vercel)
  try {
    commitHash = execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim();
  }
  // Nivel 2: Variable de entorno de Vercel (backup si git falla)
  catch (e) {
    if (process.env.VERCEL_GIT_COMMIT_SHA) {
      commitHash = process.env.VERCEL_GIT_COMMIT_SHA.substring(0, 7);
    }
    // Nivel 3: Fallback
    else {
      commitHash = 'dev';
    }
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
