import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const WEBHOOK_VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_TOKEN");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function msgTemplate(title: string, body: string, taskId?: string) {
  return `🔔 *NEXUS | Fine Pitch de México*\n\n*${title}*\n\n${body}${taskId ? `\n\n📋 Tarea: ${taskId}` : ""}`;
}

async function sendWhatsApp(to: string, message: string) {
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/\D/g, ""),
      type: "text",
      text: { body: message },
    }),
  });
  const data = await res.json();
  if (!res.ok) console.error("[WhatsApp] Error:", JSON.stringify(data));
  else console.log("[WhatsApp] Sent to:", to);
  return data;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Webhook verification (GET) — required by Meta
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
      console.log("[WhatsApp] Webhook verified");
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" }
      });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // Send message (POST from App.jsx via Supabase invoke)
  if (req.method === "POST") {
    try {
      const { type, to, data } = await req.json();

      if (!to || !to.length) {
        return new Response(JSON.stringify({ error: "No recipients" }), { status: 400, headers: corsHeaders });
      }

      let message = "";

      const APP = "https://taskops-kappa.vercel.app";

      switch (type) {
        case "nueva_tarea":
          message = `🆕 *Nueva tarea asignada*\nHola ${data.userName}, te asignaron una tarea:\n\n📋 *${data.taskTitle}*\n🎯 Prioridad: ${data.priority}\n👤 Responsable: ${data.responsible}\n📅 Vence: ${data.deadline}\n\n🔗 Ver tarea: ${APP}/?task=${data.taskId}`;
          break;

        case "tu_turno":
          message = `⚡ *¡Es tu turno!*\nHola ${data.userName}, es tu momento en el flujo:\n\n📋 *${data.taskTitle}*\n👤 ${data.prevUserName} completó su etapa.\n\n▶️ Iniciar ahora: ${APP}/?task=${data.taskId}&action=start`;
          break;

        case "preparate":
          message = `🔔 *Prepárate — tu turno se acerca*\nHola ${data.userName}:\n\n📋 *${data.taskTitle}*\n👤 ${data.prevUserName} está en proceso. Tú eres el siguiente.\n\n👁️ Ver tarea: ${APP}/?task=${data.taskId}`;
          break;

        case "avance_flujo":
          message = `📊 *Avance en tu tarea*\nHola ${data.userName}:\n\n📋 *${data.taskTitle}*\n👤 ${data.whoName} (${data.whoDept}) cambió su etapa a: *${data.newState}*\n\n👁️ Ver detalle: ${APP}/?task=${data.taskId}`;
          break;

        case "tarea_completada":
          message = `✅ *Tarea completada*\nHola ${data.userName}:\n\n📋 *${data.taskTitle}*\n👤 Completada por: ${data.completedBy}\n\n👁️ Ver detalle: ${APP}/?task=${data.taskId}`;
          break;

        case "tarea_bloqueada":
          message = `🔒 *Tarea bloqueada*\nHola ${data.userName}:\n\n📋 *${data.taskTitle}*\n👤 Bloqueada por: ${data.blockedBy}\n❌ Razón: ${data.reason}\n\n⚡ Atender ahora: ${APP}/?task=${data.taskId}`;
          break;

        case "aviso":
          message = `💬 *Aviso de ${data.fromName}* (${data.fromDept}):\n\n${data.texto}`;
          break;

        case "nuevo_comentario":
          message = `💬 *Nuevo comentario*\nHola ${data.userName}:\n\n📋 *${data.taskTitle}*\n👤 ${data.commenterName}: "${data.commentText}"\n\n👁️ Ver tarea: ${APP}/?task=${data.taskId}`;
          break;

        case "deadline_proximo":
          message = `⚠️ *Tu tarea vence pronto*\nHola ${data.userName}:\n\n📋 *${data.taskTitle}*\n📅 Fecha límite: ${data.deadline} (${data.hoursLeft}h restantes)\n\n🔗 Ver tarea: ${APP}/?task=${data.taskId}`;
          break;

        case "tarea_vencida":
          message = msgTemplate(
            "⚠️ Tarea vencida",
            `Hola ${data.userName}, la siguiente tarea lleva *${data.daysLate} día(s)* vencida:\n\n📌 *${data.taskTitle}*\n📅 Fecha límite: ${data.deadline}`,
            data.taskId
          );
          break;

        default:
          return new Response(JSON.stringify({ error: "Unknown type" }), { status: 400, headers: corsHeaders });
      }

      // Send to all recipients
      const results = await Promise.all(
        to.map((phone: string) => sendWhatsApp(phone, message))
      );

      return new Response(JSON.stringify({ ok: true, results }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });

    } catch (err) {
      console.error("[WhatsApp] Error:", err.message);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: corsHeaders
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
});
