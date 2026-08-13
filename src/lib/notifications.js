// src/lib/notifications.js
// Funciones de notificaciones push, email, WhatsApp, SMS y utilidades de descarga
// Extraídas de App.jsx en refactor ETAPA 3

import supabase from "../supabase";
import { VAPID_PUBLIC_KEY } from "./constants";

// ════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ════════════════════════════════════════
// PUSH NOTIFICATIONS
// ════════════════════════════════════════

export async function registerPush(user) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.log("[Push] Service Worker o PushManager no disponible");
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === "denied") {
      console.warn("[Push] Permiso denegado permanentemente para:", user.name);
      return;
    }
    if (permission !== "granted") {
      console.log("[Push] Permiso no concedido, estado:", permission);
      return;
    }

    // Registrar SW y esperar al registration activo antes de suscribir
    const swReg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    console.log("[Push] SW registrado:", swReg.scope);
    const readyReg = await navigator.serviceWorker.ready;
    console.log("[Push] SW activo:", readyReg.active?.scriptURL);

    // Verificar si ya existe una subscription
    let subscription = await readyReg.pushManager.getSubscription();
    let isNewSubscription = false;

    if (!subscription) {
      // No hay subscription, crear una nueva
      console.log("[Push] No hay subscription existente, creando nueva...");
      subscription = await readyReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      isNewSubscription = true;
    } else {
      console.log("[Push] Subscription existente encontrada");
    }

    const subJson = typeof subscription.toJSON === "function"
      ? subscription.toJSON()
      : JSON.parse(JSON.stringify(subscription));

    if (!subJson?.endpoint) {
      console.error("[Push] Subscription inválida — sin endpoint");
      return;
    }

    // Verificar si el token en la BD es diferente al actual
    const { data: existingToken } = await supabase
      .from("push_tokens")
      .select("subscription, needs_reregister")
      .eq("id", String(user.id))
      .single();

    let needsUpdate = isNewSubscription;

    if (existingToken) {
      const existingEndpoint = existingToken.subscription?.endpoint;
      const currentEndpoint = subJson.endpoint;

      if (existingEndpoint !== currentEndpoint) {
        console.log("[Push] Token cambió, actualizando...");
        console.log("[Push]   Anterior:", existingEndpoint?.substring(0, 50) + "...");
        console.log("[Push]   Nuevo:", currentEndpoint?.substring(0, 50) + "...");
        needsUpdate = true;
      } else if (existingToken.needs_reregister) {
        console.log("[Push] Token marcado para re-registro, actualizando...");
        needsUpdate = true;
      } else {
        console.log("[Push] Token actual válido, no requiere actualización");
        return;
      }
    } else {
      console.log("[Push] No hay token previo en BD, registrando nuevo...");
      needsUpdate = true;
    }

    if (needsUpdate) {
      const { error } = await supabase.from("push_tokens").upsert({
        id: String(user.id),
        user_name: user.name,
        dept: user.dept,
        subscription: subJson,
        needs_reregister: false, // Limpiar flag de re-registro
        updated_at: new Date().toISOString(),
      });

      if (error) {
        console.error("[Push] Error guardando subscription:", error.message);
      } else {
        console.log("[Push] ✓ Subscription registrada/actualizada para:", user.name);
      }
    }
  } catch (err) {
    console.error("[Push] Error al registrar push:", err.message, err);

    // Si el error es de subscription inválida, intentar limpiar y re-registrar
    if (err.name === "InvalidStateError" || err.message?.includes("subscription")) {
      try {
        console.log("[Push] Intentando limpiar subscription inválida...");
        const swReg = await navigator.serviceWorker.ready;
        const oldSub = await swReg.pushManager.getSubscription();
        if (oldSub) {
          await oldSub.unsubscribe();
          console.log("[Push] Subscription antigua eliminada, reintentando...");
          // Reintentar una vez
          setTimeout(() => registerPush(user), 1000);
        }
      } catch (cleanupErr) {
        console.error("[Push] Error limpiando subscription:", cleanupErr.message);
      }
    }
  }
}

export async function sendPushNotification(userIds, title, body, url="/") {
  if (!userIds || !userIds.length) return;
  try {
    const { error } = await supabase.functions.invoke("send-push", {
      body: { userIds: userIds.map(String), title, body, url },
    });
    if (error) console.error("[Push] send-push error:", error.message);
    else console.log(`[Push] Enviadas a ${userIds.length} usuario(s): ${title}`);
  } catch (err) {
    console.error("[Push] Error invocando send-push:", err.message);
  }
}

// ════════════════════════════════════════
// EMAIL NOTIFICATIONS
// ════════════════════════════════════════

export async function sendEmailNotification(type, to, data) {
  if (!to || !to.length) return;
  try {
    console.log(`[Email DEBUG] Invocando send-email:`, { type, to, dataKeys: Object.keys(data) });
    const { data: result, error } = await supabase.functions.invoke("send-email", {
      body: { type, to, data },
    });
    if (error) {
      console.error("[Email] Error de Supabase Functions:", error);
      return;
    }
    console.log(`[Email] Respuesta de Edge Function:`, result);
  } catch (err) {
    console.error("[Email] Exception:", err);
  }
}

// ════════════════════════════════════════
// WHATSAPP NOTIFICATIONS
// ════════════════════════════════════════

export async function sendWhatsAppNotification(type, toPhones, data) {
  if (!toPhones || !toPhones.length) return;
  try {
    console.log(`[WhatsApp DEBUG] Invocando send-whatsapp:`, { type, toPhones, dataKeys: Object.keys(data) });
    const { data: result, error } = await supabase.functions.invoke("send-whatsapp", {
      body: { type, to: toPhones, data },
    });
    if (error) {
      console.error("[WhatsApp] Error de Supabase Functions:", error);
      return;
    }
    console.log(`[WhatsApp] Respuesta de Edge Function:`, result);
  } catch (err) {
    console.error("[WhatsApp] Exception:", err);
  }
}

// ════════════════════════════════════════
// SMS NOTIFICATIONS
// ════════════════════════════════════════

export async function sendSMSNotification(type, toPhones, data) {
  if (!toPhones || !toPhones.length) return;
  try {
    console.log(`[SMS DEBUG] Invocando send-sms:`, { type, toPhones, dataKeys: Object.keys(data) });
    const { data: result, error } = await supabase.functions.invoke("send-sms", {
      body: { type, to: toPhones, data },
    });
    if (error) {
      console.error("[SMS] Error de Supabase Functions:", error);
      return;
    }
    console.log(`[SMS] Respuesta de Edge Function:`, result);
    if (result?.ok) {
      console.log(`[SMS] ✓ Enviado tipo '${type}' a ${toPhones.length} destinatario(s):`, result.results);
    } else {
      console.warn(`[SMS] ⚠ Respuesta no ok:`, result);
    }
  } catch (err) {
    console.error("[SMS] Exception:", err);
  }
}

// ════════════════════════════════════════
// FILE DOWNLOAD (iOS compatibility)
// ════════════════════════════════════════

export async function downloadAttachmentIOS(att) {
  try {
    const { data, error } = await supabase.storage.from("task-attachments").createSignedUrl(att.url, 60);
    if (error) {
      alert("No se pudo generar el enlace de descarga: " + error.message);
      return;
    }
    // Fetch del blob para compatibilidad con iOS Safari
    const response = await fetch(data.signedUrl);
    if (!response.ok) throw new Error("Error al descargar el archivo");
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = att.nombre || "archivo";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error("[Download] Error descargando adjunto:", err);
    alert("Error al descargar el archivo: " + err.message);
  }
}
