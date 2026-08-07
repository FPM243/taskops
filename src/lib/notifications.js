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
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission === "denied") {
      console.warn("[Push] Permiso denegado permanentemente para:", user.name);
      return;
    }
    if (permission !== "granted") return;
    // Registrar SW y esperar al registration activo antes de suscribir
    const swReg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    console.log("[Push] SW registrado:", swReg.scope);
    const readyReg = await navigator.serviceWorker.ready;
    console.log("[Push] SW activo:", readyReg.active?.scriptURL);
    const subscription = await readyReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const subJson = typeof subscription.toJSON === "function"
      ? subscription.toJSON()
      : JSON.parse(JSON.stringify(subscription));
    if (!subJson?.endpoint) {
      console.error("[Push] Subscription inválida — sin endpoint");
      return;
    }
    const { error } = await supabase.from("push_tokens").upsert({
      id: String(user.id),
      user_name: user.name,
      dept: user.dept,
      subscription: subJson,
      updated_at: new Date().toISOString(),
    });
    if (error) console.error("[Push] Error guardando subscription:", error.message);
    else console.log("[Push] Subscription registrada para:", user.name);
  } catch (err) {
    console.error("[Push] Error al registrar push:", err.message);
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
    const { error } = await supabase.functions.invoke("send-email", {
      body: { type, to, data },
    });
    if (error) console.error("[Email] send-email error:", error.message);
    else console.log(`[Email] Enviado tipo '${type}' a ${to.length} destinatario(s)`);
  } catch (err) {
    console.error("[Email] Error invocando send-email:", err.message);
  }
}

// ════════════════════════════════════════
// WHATSAPP NOTIFICATIONS
// ════════════════════════════════════════

export async function sendWhatsAppNotification(type, toPhones, data) {
  if (!toPhones || !toPhones.length) return;
  try {
    const { error } = await supabase.functions.invoke("send-whatsapp", {
      body: { type, to: toPhones, data },
    });
    if (error) console.error("[WhatsApp] error:", error.message);
    else console.log(`[WhatsApp] Enviado tipo '${type}' a ${toPhones.length} destinatario(s)`);
  } catch (err) {
    console.error("[WhatsApp] Error:", err.message);
  }
}

// ════════════════════════════════════════
// SMS NOTIFICATIONS
// ════════════════════════════════════════

export async function sendSMSNotification(type, toPhones, data) {
  if (!toPhones || !toPhones.length) return;
  try {
    const { error } = await supabase.functions.invoke("send-sms", {
      body: { type, to: toPhones, data },
    });
    if (error) console.error("[SMS] error:", error.message);
    else console.log(`[SMS] Enviado tipo '${type}' a ${toPhones.length} destinatario(s)`);
  } catch (err) {
    console.error("[SMS] Error:", err.message);
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
