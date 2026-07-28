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

// Obtener commit hash corto (7 caracteres)
let commitHash = 'dev';
try {
  commitHash = execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim();
} catch (e) {
  console.warn('⚠️  No se pudo obtener git commit hash, usando "dev"');
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
