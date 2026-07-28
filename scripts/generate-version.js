// scripts/generate-version.js
// Genera public/version.json con la versión actual antes del build
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Obtener fecha en formato YYYYMMDD
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, '0');
const day = String(now.getDate()).padStart(2, '0');
const dateStr = `${year}${month}${day}`;

// Debug: Verificar variables de entorno de Vercel
console.log('[Version] VERCEL_GIT_COMMIT_SHA:', process.env.VERCEL_GIT_COMMIT_SHA);
console.log('[Version] VERCEL_GIT_COMMIT_REF:', process.env.VERCEL_GIT_COMMIT_REF);
console.log('[Version] VERCEL:', process.env.VERCEL);
console.log('[Version] Todas las envs con VERCEL:',
  Object.keys(process.env).filter(k => k.startsWith('VERCEL')));

// Obtener commit hash corto (7 caracteres)
// Prioridad: 1) Vercel env vars, 2) Git local, 3) fallback "dev"
let commitHash = 'dev';
let source = 'fallback';

// Nivel 1: Variable de entorno de Vercel (producción)
if (process.env.VERCEL_GIT_COMMIT_SHA) {
  commitHash = process.env.VERCEL_GIT_COMMIT_SHA.substring(0, 7);
  source = 'VERCEL_GIT_COMMIT_SHA';
  console.log(`✓ Commit hash desde ${source}: ${commitHash}`);
}
// Nivel 2: Git local (desarrollo)
else {
  try {
    commitHash = execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim();
    source = 'git local';
    console.log(`✓ Commit hash desde ${source}: ${commitHash}`);
  } catch (e) {
    // Nivel 3: Fallback
    console.warn(`⚠️  No se pudo obtener commit hash (ni Vercel ni git), usando "dev"`);
  }
}

// Versión en formato: 1.0.YYYYMMDD-HASH
const version = `1.0.${dateStr}-${commitHash}`;

// Generar version.json
const versionData = {
  version,
  buildTime: now.toISOString()
};

// Asegurar que existe el directorio public
try {
  mkdirSync('public', { recursive: true });
} catch (e) {
  // Ya existe
}

// Escribir version.json
const versionPath = 'public/version.json';
writeFileSync(versionPath, JSON.stringify(versionData, null, 2));

console.log(`✓ Versión generada: ${version}`);
console.log(`✓ Archivo creado: ${versionPath}`);

// Exportar la versión para que Vite la use
export default version;
