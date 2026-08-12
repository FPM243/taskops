import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = "nexus@fpm.com.mx";
const FROM_NAME = "NEXUS FPM"; // Acortado para evitar filtros de spam

interface EmailPayload {
  to: string[];
  subject: string;
  html: string;
  text: string; // NUEVO: versión texto plano obligatoria
}

// Rate limiting: max 5 emails por segundo
const emailQueue: Array<{ resolve: Function, reject: Function, payload: EmailPayload }> = [];
let processing = false;
const RATE_LIMIT_MS = 200; // 200ms entre emails = 5 emails/segundo

async function processQueue() {
  if (processing || emailQueue.length === 0) return;
  processing = true;

  while (emailQueue.length > 0) {
    const { resolve, reject, payload } = emailQueue.shift()!;
    try {
      const result = await sendEmailDirect(payload);
      resolve(result);
    } catch (err) {
      reject(err);
    }
    // Esperar entre emails para respetar rate limit
    if (emailQueue.length > 0) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  processing = false;
}

async function sendEmail(payload: EmailPayload): Promise<any> {
  return new Promise((resolve, reject) => {
    emailQueue.push({ resolve, reject, payload });
    processQueue();
  });
}

async function sendEmailDirect(payload: EmailPayload) {
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
      text: payload.text, // NUEVO: texto plano
      headers: {
        // NUEVO: Encabezado List-Unsubscribe (evita spam)
        "List-Unsubscribe": "<https://taskops-kappa.vercel.app/unsubscribe>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("[send-email] Error de Resend:", JSON.stringify(data));
    throw new Error(data.message || "Error al enviar email");
  }

  return data;
}

// Función auxiliar para convertir HTML a texto plano
function htmlToPlainText(html: string): string {
  console.log("[htmlToPlainText] Input:", typeof html, html?.substring(0, 100));

  if (!html || typeof html !== 'string') {
    console.log("[htmlToPlainText] Input inválido, retornando vacío");
    return '';
  }

  try {
    const result = html
      .replace(/<style[^>]*>.*?<\/style>/gi, '')
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
    console.log("[htmlToPlainText] Output exitoso, length:", result.length);
    return result;
  } catch (err: any) {
    console.error("[htmlToPlainText] ❌ Error:", err.message);
    console.error("[htmlToPlainText] Stack:", err.stack);
    return String(html);
  }
}

function emailTemplate(title: string, body: string, taskId?: string, taskTitle?: string, avisoId?: string) {
  try {
    console.log("[emailTemplate] Generando template - title:", title, "avisoId:", avisoId);

    const linkHref = taskId
      ? `https://taskops-kappa.vercel.app/?task=${taskId}`
      : avisoId
      ? `https://taskops-kappa.vercel.app/?aviso=${avisoId}`
      : null;
    const linkLabel = taskId ? `Ver tarea ${taskId} →` : "Ver aviso →";

    console.log("[emailTemplate] linkHref:", linkHref);

  const html = `
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
        ${linkHref ? `
        <a href="${linkHref}"
          style="display:inline-block;margin-top:20px;background:#4338CA;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
          ${linkLabel}
        </a>` : ""}
      </div>
      <div style="background:#F8FAFF;padding:14px 28px;border-top:1px solid #E2E8F0;">
        <p style="color:#94A3B8;font-size:11px;margin:0;">Este es un mensaje automático de NEXUS. No respondas a este correo.</p>
      </div>
    </div>
  </body>
  </html>`;

    // Generar versión texto plano
    console.log("[emailTemplate] Generando texto plano...");
    const text = `
NEXUS | Fine Pitch de México
────────────────────────────────

${title}

${htmlToPlainText(body)}

${linkHref ? `\n${linkLabel}\n${linkHref}\n` : ''}

────────────────────────────────
Este es un mensaje automático de NEXUS. No respondas a este correo.
    `.trim();

    console.log("[emailTemplate] Template generado exitosamente");
    return { html, text };
  } catch (err: any) {
    console.error("[emailTemplate] Error generando template:", err);
    throw err;
  }
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

    // LOG COMPLETO DEL PAYLOAD RECIBIDO
    console.log("[send-email] ========================================");
    console.log("[send-email] Payload completo recibido:", JSON.stringify({ type, to, data }, null, 2));
    console.log("[send-email] ========================================");
    console.log(`[Email] Received request - type: ${type}, recipients: ${to?.length || 0}`);

    if (!to || !to.length) {
      return new Response(JSON.stringify({ error: "No recipients" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Validación defensiva: asegurar que data existe
    if (!data || typeof data !== 'object') {
      console.error("[send-email] data es inválido:", data);
      return new Response(JSON.stringify({ error: "Invalid data payload" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    let subject = "";
    let htmlBody = "";
    let textBody = "";

    switch (type) {
      case "nueva_tarea":
        subject = `Nueva tarea asignada: ${data.taskTitle}`;
        const template1 = emailTemplate(
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
        htmlBody = template1.html;
        textBody = template1.text;
        break;

      case "tu_turno":
        subject = `Tu turno en el flujo: ${data.taskTitle}`;
        const template2 = emailTemplate(
          "Es tu turno en el flujo de trabajo",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p><strong>${data.prevUserName}</strong> completó su etapa en la siguiente tarea y ahora es tu turno:</p>
           <p style="background:#EEF2FF;border-left:3px solid #4338CA;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p>Ingresa a NEXUS para registrar tu avance.</p>`,
          data.taskId,
          data.taskTitle
        );
        htmlBody = template2.html;
        textBody = template2.text;
        break;

      case "tarea_completada":
        subject = `Tarea completada: ${data.taskTitle}`;
        const template3 = emailTemplate(
          "Una tarea fue marcada como completada",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p>La siguiente tarea ha sido completada:</p>
           <p style="background:#ECFDF5;border-left:3px solid #059669;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p style="color:#64748B;">Completada por: <strong>${data.completedBy}</strong></p>`,
          data.taskId,
          data.taskTitle
        );
        htmlBody = template3.html;
        textBody = template3.text;
        break;

      case "aviso": {
        try {
          console.log("[send-email] Procesando case 'aviso'...");
          console.log("[send-email] data.texto:", data.texto, "type:", typeof data.texto);
          console.log("[send-email] data.fromName:", data.fromName);
          console.log("[send-email] data.fromDept:", data.fromDept);
          console.log("[send-email] data.userName:", data.userName);
          console.log("[send-email] data.avisoId:", data.avisoId);

          const textoSafe = String(data.texto || "");
          console.log("[send-email] textoSafe:", textoSafe);

          const textoPreview = textoSafe.length > 50 ? textoSafe.slice(0, 50) + "..." : textoSafe;
          console.log("[send-email] textoPreview:", textoPreview);

          // Escapar HTML en data.texto para evitar XSS y errores de parsing
          const textoEscaped = textoSafe
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
          console.log("[send-email] textoEscaped:", textoEscaped);

          subject = `Aviso de ${data.fromName}: ${textoPreview}`;
          console.log("[send-email] subject generado:", subject);

          const template4 = emailTemplate(
            `Aviso de ${data.fromName} (${data.fromDept})`,
            `<p>Hola <strong>${data.userName}</strong>,</p>
             <p>Tienes un nuevo aviso:</p>
             <div style="background:#FFFBEB;border-left:3px solid #F59E0B;padding:14px 16px;border-radius:4px;color:#78350F;line-height:1.7;">${textoEscaped}</div>`,
            undefined,
            undefined,
            data.avisoId
          );
          console.log("[send-email] template generado exitosamente");

          htmlBody = template4.html;
          textBody = template4.text;
          console.log("[send-email] htmlBody y textBody asignados");
          break;
        } catch (avisoError: any) {
          console.error("[send-email] ❌ ERROR en case 'aviso':", avisoError);
          console.error("[send-email] Error stack:", avisoError.stack);
          console.error("[send-email] Error message:", avisoError.message);

          // Retornar 200 con detalles del error para debugging
          return new Response(JSON.stringify({
            error: "Error procesando aviso",
            details: avisoError.message,
            stack: avisoError.stack,
            data: data
          }), {
            status: 200, // Cambiado a 200 para que llegue al frontend
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }
      }

      case "tarea_vencida":
        subject = `Tarea vencida: ${data.taskTitle}`;
        const template5 = emailTemplate(
          "Tienes una tarea vencida",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p>La siguiente tarea venció hace <strong>${data.daysLate} día${data.daysLate !== 1 ? "s" : ""}</strong> y aún no ha sido completada:</p>
           <p style="background:#FEF2F2;border-left:3px solid #DC2626;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p style="color:#64748B;">Fecha límite: <strong>${data.deadline}</strong></p>`,
          data.taskId,
          data.taskTitle
        );
        htmlBody = template5.html;
        textBody = template5.text;
        break;

      case "avance_flujo":
        subject = `Avance en tu tarea: ${data.taskTitle}`;
        const template6 = emailTemplate(
          "Avance en el flujo de tu tarea",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p><strong>${data.whoName}</strong> (${data.whoDept}) cambió su etapa a <strong>"${data.newState}"</strong> en la siguiente tarea:</p>
           <p style="background:#EEF2FF;border-left:3px solid #4338CA;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>`,
          data.taskId
        );
        htmlBody = template6.html;
        textBody = template6.text;
        break;

      case "preparate":
        subject = `Tu turno se acerca: ${data.taskTitle}`;
        const template7 = emailTemplate(
          "Tu turno se acerca",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p><strong>${data.prevUserName}</strong> acaba de iniciar su etapa. Una vez que termine, será tu turno en:</p>
           <p style="background:#EEF2FF;border-left:3px solid #4338CA;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p>Prepárate para actuar cuando llegue tu turno.</p>`,
          data.taskId
        );
        htmlBody = template7.html;
        textBody = template7.text;
        break;

      case "tarea_bloqueada":
        subject = `Tarea bloqueada: ${data.taskTitle}`;
        const template8 = emailTemplate(
          "Una tarea fue marcada como bloqueada",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p>La siguiente tarea fue bloqueada por <strong>${data.blockedBy}</strong>:</p>
           <p style="background:#FEF2F2;border-left:3px solid #DC2626;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p><strong>Razón:</strong> ${data.reason}</p>
           <p>Se requiere atención para desbloquear el avance.</p>`,
          data.taskId
        );
        htmlBody = template8.html;
        textBody = template8.text;
        break;

      case "nuevo_comentario":
        subject = `Nuevo comentario en: ${data.taskTitle}`;
        const template9 = emailTemplate(
          "Nuevo comentario en una tarea",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p><strong>${data.commenterName}</strong> comentó en la siguiente tarea:</p>
           <p style="background:#EEF2FF;border-left:3px solid #4338CA;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p style="color:#64748B;">"${data.commentText}"</p>`,
          data.taskId,
          data.taskTitle
        );
        htmlBody = template9.html;
        textBody = template9.text;
        break;

      case "resumen_deadlines": {
        const proximas = data.proximas || [];
        const vencidas = data.vencidas || [];
        subject = `Resumen de deadlines: ${proximas.length} próxima(s), ${vencidas.length} vencida(s)`;

        const rowsHtml = (items: any[], dateKey: string) => items.map((t) => `
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;color:#1E1B4B;font-weight:600;">${t.taskTitle}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;color:#64748B;">${t.responsible}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;color:#64748B;">${dateKey === "deadline" ? t.deadline : `${t.daysLate} día${t.daysLate !== 1 ? "s" : ""}`}</td>
          </tr>`).join("");

        const sectionHtml = (title: string, color: string, bg: string, items: any[], dateLabel: string, dateKey: string) => items.length === 0 ? "" : `
          <div style="margin-bottom:20px;">
            <h3 style="color:${color};font-size:14px;margin:0 0 8px;">${title} (${items.length})</h3>
            <table style="width:100%;border-collapse:collapse;background:${bg};border-radius:6px;overflow:hidden;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:8px 10px;font-size:11px;color:#94A3B8;border-bottom:1px solid #E2E8F0;">TAREA</th>
                  <th style="text-align:left;padding:8px 10px;font-size:11px;color:#94A3B8;border-bottom:1px solid #E2E8F0;">RESPONSABLE</th>
                  <th style="text-align:left;padding:8px 10px;font-size:11px;color:#94A3B8;border-bottom:1px solid #E2E8F0;">${dateLabel}</th>
                </tr>
              </thead>
              <tbody>${rowsHtml(items, dateKey)}</tbody>
            </table>
          </div>`;

        const template10 = emailTemplate(
          "Resumen diario de deadlines",
          `<p>Hola,</p>
           <p>Este es el resumen de tareas con deadline próximo o vencido:</p>
           ${sectionHtml("Próximas a vencer", "#D97706", "#FFFBEB", proximas, "FECHA LÍMITE", "deadline")}
           ${sectionHtml("Vencidas", "#DC2626", "#FEF2F2", vencidas, "DÍAS VENCIDA", "daysLate")}`
        );
        htmlBody = template10.html;
        textBody = template10.text;
        break;
      }

      case "deadline_proximo":
        subject = `Tarea vence en ${data.hoursLeft}h: ${data.taskTitle}`;
        const template11 = emailTemplate(
          "Tarea próxima a vencer",
          `<p>Hola <strong>${data.userName}</strong>,</p>
           <p>La siguiente tarea vence en <strong>${data.hoursLeft} horas</strong>:</p>
           <p style="background:#FFFBEB;border-left:3px solid #F59E0B;padding:12px 16px;border-radius:4px;font-weight:600;color:#1E1B4B;">${data.taskTitle}</p>
           <p><strong>Fecha límite:</strong> ${data.deadline}</p>`,
          data.taskId
        );
        htmlBody = template11.html;
        textBody = template11.text;
        break;

      case "quick_task_created":
        subject = `Nueva tarea rápida: ${data.taskTitle}`;
        htmlBody = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family:'Segoe UI',Arial,sans-serif;background:#F0F4FF;margin:0;padding:24px;">
          <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
            <div style="background:#7C3AED;padding:20px 28px;display:flex;align-items:center;gap:12px;">
              <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:1px;">NEXUS</span>
              <span style="color:#DDD6FE;font-size:12px;">| Fine Pitch de México</span>
            </div>
            <div style="padding:28px;">
              <h2 style="color:#1E1B4B;font-size:18px;margin:0 0 12px;">Nueva tarea rápida asignada</h2>
              <div style="color:#64748B;font-size:14px;line-height:1.7;">
                <p>Hola <strong>${data.userName}</strong>,</p>
                <p>Se creó una nueva tarea rápida para <strong>${data.dept}</strong>:</p>
                <div style="background:#F5F3FF;border-left:4px solid #7C3AED;padding:14px 16px;border-radius:6px;margin:16px 0;">
                  <div style="font-weight:700;color:#1E1B4B;font-size:15px;margin-bottom:8px;">${data.taskTitle}</div>
                  <div style="color:#64748B;font-size:13px;line-height:1.6;">${data.taskDescription}</div>
                </div>
                <table style="width:100%;border-collapse:collapse;margin:12px 0;">
                  <tr><td style="padding:6px 0;color:#94A3B8;font-size:12px;width:120px;">DEPARTAMENTO</td><td style="padding:6px 0;font-weight:600;color:#1E1B4B;">${data.dept}</td></tr>
                  <tr><td style="padding:6px 0;color:#94A3B8;font-size:12px;">PRIORIDAD</td><td style="padding:6px 0;color:#64748B;">${data.priority}</td></tr>
                  <tr><td style="padding:6px 0;color:#94A3B8;font-size:12px;">FECHA LÍMITE</td><td style="padding:6px 0;color:#64748B;">${data.deadline}</td></tr>
                  <tr><td style="padding:6px 0;color:#94A3B8;font-size:12px;">CREADA POR</td><td style="padding:6px 0;color:#64748B;">${data.creatorName}</td></tr>
                </table>
              </div>
              <a href="https://taskops-kappa.vercel.app/?quickTask=${data.taskId}"
                style="display:inline-block;margin-top:20px;background:#7C3AED;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
                Ver tarea rápida →
              </a>
            </div>
            <div style="background:#F8FAFF;padding:14px 28px;border-top:1px solid #E2E8F0;">
              <p style="color:#94A3B8;font-size:11px;margin:0;">Este es un mensaje automático de NEXUS. No respondas a este correo.</p>
            </div>
          </div>
        </body>
        </html>`;
        textBody = `NEXUS | Fine Pitch de México\n\nNueva tarea rápida asignada\n\nHola ${data.userName},\n\nSe creó una nueva tarea rápida para ${data.dept}:\n\n${data.taskTitle}\n${data.taskDescription}\n\nDEPARTAMENTO: ${data.dept}\nPRIORIDAD: ${data.priority}\nFECHA LÍMITE: ${data.deadline}\nCREADA POR: ${data.creatorName}\n\nVer tarea rápida →\nhttps://taskops-kappa.vercel.app/?quickTask=${data.taskId}\n\n────────────────────────────────\nEste es un mensaje automático de NEXUS. No respondas a este correo.`;
        break;

      case "quick_task_comment":
        subject = `Comentario en tarea rápida: ${data.taskTitle}`;
        htmlBody = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family:'Segoe UI',Arial,sans-serif;background:#F0F4FF;margin:0;padding:24px;">
          <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
            <div style="background:#7C3AED;padding:20px 28px;display:flex;align-items:center;gap:12px;">
              <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:1px;">NEXUS</span>
              <span style="color:#DDD6FE;font-size:12px;">| Fine Pitch de México</span>
            </div>
            <div style="padding:28px;">
              <h2 style="color:#1E1B4B;font-size:18px;margin:0 0 12px;">Nuevo comentario en tarea rápida</h2>
              <div style="color:#64748B;font-size:14px;line-height:1.7;">
                <p>Hola <strong>${data.userName}</strong>,</p>
                <p><strong>${data.commenterName}</strong> comentó en la siguiente tarea rápida:</p>
                <div style="background:#F5F3FF;border-left:4px solid #7C3AED;padding:14px 16px;border-radius:6px;margin:16px 0;">
                  <div style="font-weight:700;color:#1E1B4B;font-size:15px;margin-bottom:8px;">${data.taskTitle}</div>
                  <div style="color:#94A3B8;font-size:12px;margin-bottom:8px;">${data.dept}</div>
                  <div style="background:#fff;border:1px solid #E9D5FF;border-radius:6px;padding:10px;color:#64748B;font-size:13px;line-height:1.6;">"${data.commentText}"</div>
                </div>
              </div>
              <a href="https://taskops-kappa.vercel.app/?quickTask=${data.taskId}"
                style="display:inline-block;margin-top:20px;background:#7C3AED;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
                Ver tarea rápida →
              </a>
            </div>
            <div style="background:#F8FAFF;padding:14px 28px;border-top:1px solid #E2E8F0;">
              <p style="color:#94A3B8;font-size:11px;margin:0;">Este es un mensaje automático de NEXUS. No respondas a este correo.</p>
            </div>
          </div>
        </body>
        </html>`;
        textBody = `NEXUS | Fine Pitch de México\n\nNuevo comentario en tarea rápida\n\nHola ${data.userName},\n\n${data.commenterName} comentó en la siguiente tarea rápida:\n\n${data.taskTitle}\n${data.dept}\n\n"${data.commentText}"\n\nVer tarea rápida →\nhttps://taskops-kappa.vercel.app/?quickTask=${data.taskId}\n\n────────────────────────────────\nEste es un mensaje automático de NEXUS. No respondas a este correo.`;
        break;

      default:
        return new Response(JSON.stringify({ error: "Unknown type" }), {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
    }

    const result = await sendEmail({ to, subject, html: htmlBody, text: textBody });
    console.log("[send-email] Enviado exitosamente:", type, "→", to.length, "destinatario(s)");

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (err: any) {
    console.error("[send-email] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }
});
