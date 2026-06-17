import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = "nexus@fpm.com.mx";
const FROM_NAME = "NEXUS | Fine Pitch de México";

interface EmailPayload {
  to: string[];
  subject: string;
  html: string;
}

async function sendEmail(payload: EmailPayload) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    }),
  });
  return res.json();
}

function emailTemplate(title: string, body: string, taskId?: string, taskTitle?: string) {
  return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family:'Segoe UI',Arial,sans-serif;background:#F0F4FF;margin:0;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
      <div style="background:#4338CA;padding:20px 28px;display:flex;align-items:center;gap:12px;">
        <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:1px;">NEXUS</span>
        <span style="color:#A5B4FC;font-size:12px;">| Fine Pitch de México</span>
      </div>
      <div style="padding:28px;">
        <h2 style="color:#1E1B4B;font-size:18px;margin:0 0 12px;">${title}</h2>
        <div style="color:#64748B;font-size:14px;line-height:1.7;">${body}</div>
        ${taskId ? `
        <a href="https://taskops-kappa.vercel.app"
          style="display:inline-block;margin-top:20px;background:#4338CA;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
          Ver tarea ${taskId} →
        </a>` : ""}
      </div>
      <div style="background:#F8FAFF;padding:14px 28px;border-top:1px solid #E2E8F0;">
        <p style="color:#94A3B8;font-size:11px;margin:0;">Este es un mensaje automático de NEXUS. No respondas a este correo.</p>
      </div>
    </div>
  </body>
  </html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { type, to, data } = await req.json();

    if (!to || !to.length) {
      return new Response(JSON.stringify({ error: "No recipients" }), { status: 400 });
    }

    let subject = "";
    let html = "";

    switch (type) {
      case "nueva_tarea":
        subject = `📋 Nueva tarea asignada: ${data.taskTitle}`;
        html = emailTemplate(
          "Se te asignó una nueva tarea",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p>Tienes una nueva tarea asignada en NEXUS:</p>
           <table style="width:100%;border-collapse:collapse;margin:12px 0;">
             <tr><td style="padding:6px 0;color:#94A3B8;font-size:12px;">TAREA</td><td style="padding:6px 0;font-weight:600;color:#1E1B4B;">${data.taskTitle}</td></tr>
             <tr><td style="padding:6px 0;color:#94A3B8;font-size:12px;">TIPO</td><td style="padding:6px 0;color:#64748B;">${data.taskType}</td></tr>
             <tr><td style="padding:6px 0;color:#94A3B8;font-size:12px;">PRIORIDAD</td><td style="padding:6px 0;color:#64748B;">${data.priority}</td></tr>
             <tr><td style="padding:6px 0;color:#94A3B8;font-size:12px;">FECHA LÍMITE</td><td style="padding:6px 0;color:#64748B;">${data.deadline}</td></tr>
             <tr><td style="padding:6px 0;color:#94A3B8;font-size:12px;">RESPONSABLE</td><td style="padding:6px 0;color:#64748B;">${data.responsible}</td></tr>
           </table>`,
          data.taskId,
          data.taskTitle
        );
        break;

      case "tu_turno":
        subject = `⚡ Tu turno en el flujo: ${data.taskTitle}`;
        html = emailTemplate(
          "Es tu turno en el flujo de trabajo",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p><strong>${data.prevUserName}</strong> completó su etapa en la siguiente tarea y ahora es tu turno:</p>
           <p style="background:#EEF2FF;border-left:3px solid #4338CA;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p>Ingresa a NEXUS para registrar tu avance.</p>`,
          data.taskId,
          data.taskTitle
        );
        break;

      case "tarea_completada":
        subject = `✅ Tarea completada: ${data.taskTitle}`;
        html = emailTemplate(
          "Una tarea fue marcada como completada",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p>La siguiente tarea ha sido completada:</p>
           <p style="background:#ECFDF5;border-left:3px solid #059669;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p style="color:#64748B;">Completada por: <strong>${data.completedBy}</strong></p>`,
          data.taskId,
          data.taskTitle
        );
        break;

      case "aviso":
        subject = `📢 Aviso de ${data.fromName}: ${data.texto.slice(0, 50)}${data.texto.length > 50 ? "..." : ""}`;
        html = emailTemplate(
          `Aviso de ${data.fromName} (${data.fromDept})`,
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p>Tienes un nuevo aviso:</p>
           <div style="background:#FFFBEB;border-left:3px solid #F59E0B;padding:14px 16px;border-radius:4px;color:#78350F;line-height:1.7;">${data.texto}</div>`
        );
        break;

      case "tarea_vencida":
        subject = `⚠️ Tarea vencida: ${data.taskTitle}`;
        html = emailTemplate(
          "Tienes una tarea vencida",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p>La siguiente tarea venció hace <strong>${data.daysLate} día${data.daysLate !== 1 ? "s" : ""}</strong> y aún no ha sido completada:</p>
           <p style="background:#FEF2F2;border-left:3px solid #DC2626;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p style="color:#64748B;">Fecha límite: <strong>${data.deadline}</strong></p>`,
          data.taskId,
          data.taskTitle
        );
        break;

      case "avance_flujo":
        subject = `📊 Avance en tu tarea: ${data.taskTitle}`;
        html = emailTemplate(
          "Avance en el flujo de tu tarea",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p><strong>${data.whoName}</strong> (${data.whoDept}) cambió su etapa a <strong>"${data.newState}"</strong> en la siguiente tarea:</p>
           <p style="background:#EEF2FF;border-left:3px solid #4338CA;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>`,
          data.taskId
        );
        break;

      case "preparate":
        subject = `⚡ Prepárate — tu turno se acerca: ${data.taskTitle}`;
        html = emailTemplate(
          "Tu turno se acerca",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p><strong>${data.prevUserName}</strong> acaba de iniciar su etapa. Una vez que termine, será tu turno en:</p>
           <p style="background:#EEF2FF;border-left:3px solid #4338CA;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p>Prepárate para actuar cuando llegue tu turno.</p>`,
          data.taskId
        );
        break;

      case "tarea_bloqueada":
        subject = `🔒 Tarea bloqueada: ${data.taskTitle}`;
        html = emailTemplate(
          "Una tarea fue marcada como bloqueada",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p>La siguiente tarea fue bloqueada por <strong>${data.blockedBy}</strong>:</p>
           <p style="background:#FEF2F2;border-left:3px solid #DC2626;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p><strong>Razón:</strong> ${data.reason}</p>
           <p>Se requiere atención para desbloquear el avance.</p>`,
          data.taskId
        );
        break;

      case "deadline_proximo":
        subject = `⏰ Tarea vence en ${data.hoursLeft}h: ${data.taskTitle}`;
        html = emailTemplate(
          "Tarea próxima a vencer",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p>La siguiente tarea vence en <strong>${data.hoursLeft} horas</strong>:</p>
           <p style="background:#FFFBEB;border-left:3px solid #F59E0B;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p><strong>Fecha límite:</strong> ${data.deadline}</p>`,
          data.taskId
        );
        break;

      default:
        return new Response(JSON.stringify({ error: "Unknown type" }), { status: 400 });
    }

    const result = await sendEmail({ to, subject, html });
    console.log("[send-email] Resultado:", JSON.stringify(result));

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (err) {
    console.error("[send-email] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
