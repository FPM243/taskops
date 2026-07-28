// src/lib/version.js
// Sistema de control de versiones NEXUS

import supabase from "../supabase";

// Versión de la app (inyectada por Vite en tiempo de build)
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';

/**
 * Detecta el tipo de dispositivo basado en user agent
 * @returns {'iOS' | 'Android' | 'Desktop' | 'Other'}
 */
export function detectDeviceType() {
  const ua = navigator.userAgent || '';

  if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) {
    return 'iOS';
  }

  if (/android/i.test(ua)) {
    return 'Android';
  }

  if (/Windows|Mac|Linux/.test(ua) && !/Mobile|Tablet/.test(ua)) {
    return 'Desktop';
  }

  return 'Other';
}

/**
 * Registra la versión actual del usuario en la tabla user_versions
 * Hace UPSERT silencioso para no bloquear la UI
 * @param {Object} user - Usuario autenticado {id, name, ...}
 */
export async function registerVersion(user) {
  if (!user || !user.id || !user.name) {
    console.warn('[registerVersion] Usuario inválido, saltando registro');
    return;
  }

  const deviceType = detectDeviceType();
  const userAgent = navigator.userAgent || '';

  try {
    const { error } = await supabase
      .from('user_versions')
      .upsert({
        user_id: user.id,
        user_name: user.name,
        version: APP_VERSION,
        device_type: deviceType,
        last_seen: new Date().toISOString(),
        user_agent: userAgent
      }, {
        onConflict: 'user_id,device_type'
      });

    if (error) {
      console.error('[registerVersion] Error al registrar versión:', error);
    } else {
      console.log(`[registerVersion] ✓ Versión registrada: ${APP_VERSION} (${deviceType})`);
    }
  } catch (err) {
    console.error('[registerVersion] Error inesperado:', err);
  }
}

/**
 * Verifica si hay una nueva versión disponible comparando con version.json
 * @returns {Promise<{hasUpdate: boolean, latestVersion: string|null}>}
 */
export async function checkForUpdate() {
  try {
    // Fetch con cache-busting
    const response = await fetch(`/version.json?_=${Date.now()}`);

    if (!response.ok) {
      console.warn('[checkForUpdate] No se pudo obtener version.json');
      return { hasUpdate: false, latestVersion: null };
    }

    const data = await response.json();
    const latestVersion = data.version;

    if (!latestVersion) {
      console.warn('[checkForUpdate] version.json sin campo "version"');
      return { hasUpdate: false, latestVersion: null };
    }

    const hasUpdate = latestVersion !== APP_VERSION;

    console.log(`[checkForUpdate] Local: ${APP_VERSION}, Remota: ${latestVersion}, ¿Update?: ${hasUpdate}`);

    return { hasUpdate, latestVersion };
  } catch (err) {
    console.error('[checkForUpdate] Error al verificar versión:', err);
    return { hasUpdate: false, latestVersion: null };
  }
}

/**
 * Muestra el banner de actualización (cerrable, con lógica de sessionStorage)
 * @param {string} latestVersion - Versión más reciente disponible
 */
export function showUpdateBanner(latestVersion) {
  // Verificar si el banner ya fue cerrado en esta sesión
  const dismissedKey = `dismissed_update_${latestVersion}`;
  const dismissedAt = sessionStorage.getItem(dismissedKey);

  if (dismissedAt) {
    const elapsed = Date.now() - parseInt(dismissedAt, 10);
    const FIVE_MINUTES = 5 * 60 * 1000;

    // Si pasaron menos de 5 minutos desde que se cerró, no mostrar
    if (elapsed < FIVE_MINUTES) {
      console.log('[showUpdateBanner] Banner cerrado hace menos de 5 min, saltando');
      return;
    }
  }

  // Si el banner ya existe, no duplicar
  if (document.getElementById('nexus-update-banner')) {
    return;
  }

  const banner = document.createElement('div');
  banner.id = 'nexus-update-banner';
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10000;
    background: linear-gradient(135deg, #2563EB 0%, #1E40AF 100%);
    color: #fff;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-family: inherit;
    font-size: 13px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.15);
    animation: slideDown 0.3s ease;
  `;

  const content = document.createElement('div');
  content.style.cssText = 'display: flex; align-items: center; gap: 12px; flex: 1;';
  content.innerHTML = `
    <span style="font-size: 18px;">🔄</span>
    <span><strong>Nueva versión disponible</strong> (${latestVersion}) — Actualiza para obtener las últimas mejoras</span>
  `;

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  const updateBtn = document.createElement('button');
  updateBtn.textContent = 'Actualizar ahora';
  updateBtn.style.cssText = `
    background: #fff;
    color: #1E40AF;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    transition: transform 0.2s;
  `;
  updateBtn.onmouseover = () => updateBtn.style.transform = 'scale(1.05)';
  updateBtn.onmouseout = () => updateBtn.style.transform = 'scale(1)';
  updateBtn.onclick = async () => {
    // Limpiar service workers y caches antes de recargar (iOS PWA fix)
    try {
      // Desregistrar todos los service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }

      // Limpiar todos los caches
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
        }
      }
    } catch (err) {
      console.error('[showUpdateBanner] Error al limpiar SW/caches:', err);
    }

    // Recargar forzando bypass de cache
    window.location.reload(true);
  };

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `
    background: transparent;
    color: #fff;
    border: none;
    padding: 4px 8px;
    font-size: 18px;
    cursor: pointer;
    opacity: 0.8;
    transition: opacity 0.2s;
  `;
  closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
  closeBtn.onmouseout = () => closeBtn.style.opacity = '0.8';
  closeBtn.onclick = () => {
    // Guardar timestamp de cierre en sessionStorage
    sessionStorage.setItem(dismissedKey, String(Date.now()));
    banner.remove();
  };

  actions.appendChild(updateBtn);
  actions.appendChild(closeBtn);

  banner.appendChild(content);
  banner.appendChild(actions);

  // Agregar animación CSS
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideDown {
      from {
        transform: translateY(-100%);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(banner);
}
