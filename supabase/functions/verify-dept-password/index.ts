// ═══════════════════════════════════════════════════════════════════
// NEXUS - Edge Function: verify-dept-password
// Validación server-side de contraseñas de departamento
//
// Features:
// - Validación de contraseñas con bcrypt
// - Rate limiting de doble ventana (10/60s y 30/10min)
// - Timing constant de 200ms
// - Logging de todos los intentos
// ═══════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import bcrypt from "https://esm.sh/bcryptjs@2.4.3"

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MINIMUM_RESPONSE_TIME = 200 // ms - timing constant

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

serve(async (req) => {
  const startTime = Date.now()

  // Manejar preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    // Obtener IP del cliente (priorizar headers de proxies comunes)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
              || req.headers.get('cf-connecting-ip')
              || req.headers.get('x-real-ip')
              || 'unknown'

    // Parse body
    let dept: string, password: string
    try {
      const body = await req.json()
      dept = body.dept
      password = body.password
    } catch (err) {
      console.error('[Request] Error parseando JSON:', err)
      await delayToConstantTime(startTime, MINIMUM_RESPONSE_TIME)
      return jsonResponse({ valid: false }, 400)
    }

    // Validar inputs
    if (!dept || typeof dept !== 'string' || !password || typeof password !== 'string') {
      await delayToConstantTime(startTime, MINIMUM_RESPONSE_TIME)
      return jsonResponse({ valid: false }, 400)
    }

    // Cliente Supabase con service_role para acceder a tablas protegidas
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })

    // ═══════════════════════════════════════════════════════════════
    // RATE LIMITING - Doble ventana
    // ═══════════════════════════════════════════════════════════════

    const now = new Date()
    const sixtySecondsAgo = new Date(now.getTime() - 60 * 1000).toISOString()
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString()

    // Contar intentos en ventana de 60 segundos
    const { data: recent60s, error: err60s } = await supabase
      .from('auth_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('attempted_at', sixtySecondsAgo)

    // Contar intentos en ventana de 10 minutos
    const { data: recent10m, error: err10m } = await supabase
      .from('auth_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('attempted_at', tenMinutesAgo)

    if (err60s || err10m) {
      console.error('[Rate Limit] Error consultando intentos:', err60s || err10m)
      // Fail-open: continuar sin rate limiting si falla la consulta
    } else {
      const count60s = recent60s?.length ?? 0
      const count10m = recent10m?.length ?? 0

      // Límite 1: 10 intentos en 60 segundos
      if (count60s >= 10) {
        console.warn(`[Rate Limit] IP ${ip} excedió 10 intentos/60s (${count60s} intentos)`)
        await delayToConstantTime(startTime, MINIMUM_RESPONSE_TIME)
        return jsonResponse(
          {
            error: "Demasiados intentos. Espera 1 minuto.",
            retryAfter: 60
          },
          429,
          { 'Retry-After': '60' }
        )
      }

      // Límite 2: 30 intentos en 10 minutos
      if (count10m >= 30) {
        console.warn(`[Rate Limit] IP ${ip} excedió 30 intentos/10min (${count10m} intentos)`)
        await delayToConstantTime(startTime, MINIMUM_RESPONSE_TIME)
        return jsonResponse(
          {
            error: "Demasiados intentos. Espera 10 minutos.",
            retryAfter: 600
          },
          429,
          { 'Retry-After': '600' }
        )
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // VERIFICACIÓN DE CONTRASEÑA
    // ═══════════════════════════════════════════════════════════════

    const { data: deptData, error: deptError } = await supabase
      .from('department_passwords')
      .select('password_hash')
      .eq('dept', dept)
      .maybeSingle()

    let isValid = false

    if (!deptError && deptData?.password_hash) {
      // Comparar con bcrypt
      try {
        isValid = await bcrypt.compare(password, deptData.password_hash)
      } catch (bcryptErr) {
        console.error('[Bcrypt] Error comparando hash:', bcryptErr)
        isValid = false
      }
    } else if (deptError) {
      console.error('[DB] Error consultando department_passwords:', deptError.message)
    } else {
      // Departamento no existe en la tabla
      console.warn(`[Auth] Departamento no encontrado: ${dept}`)
    }

    // ═══════════════════════════════════════════════════════════════
    // LOGGING DE INTENTO
    // ═══════════════════════════════════════════════════════════════

    const { error: logError } = await supabase
      .from('auth_attempts')
      .insert({
        ip,
        dept,
        success: isValid
      })

    if (logError) {
      console.error('[Logging] Error guardando intento:', logError.message)
      // No fallar el request si falla el logging
    }

    // ═══════════════════════════════════════════════════════════════
    // TIMING CONSTANT - Siempre responder en ≥200ms
    // ═══════════════════════════════════════════════════════════════

    await delayToConstantTime(startTime, MINIMUM_RESPONSE_TIME)

    return jsonResponse({ valid: isValid }, 200)

  } catch (err) {
    console.error('[Edge Function] Error general:', err)
    await delayToConstantTime(startTime, MINIMUM_RESPONSE_TIME)
    return jsonResponse({ valid: false }, 500)
  }
})

// ───────────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────────

/**
 * Espera hasta completar el tiempo mínimo de respuesta
 */
async function delayToConstantTime(startTime: number, minTime: number): Promise<void> {
  const elapsed = Date.now() - startTime
  const remaining = minTime - elapsed
  if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, remaining))
  }
}

/**
 * Helper para respuestas JSON con CORS
 */
function jsonResponse(
  data: any,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: { ...corsHeaders, ...extraHeaders }
    }
  )
}
