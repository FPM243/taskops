-- RPCs para avisos, equivalentes a merge_task_data pero adaptados al
-- patrón de lectura/comentarios concurrentes de avisos.
--
-- merge_aviso_data: merge superficial server-side (data || patch), para
-- ediciones de campos que no se tocan concurrentemente entre clientes
-- (texto, destinatario, attachments). Usado por updateAviso.
--
-- mark_aviso_read: append atómico e idempotente a leidoPor, calculado
-- sobre la fila viva. Evita que la marca de lectura de un usuario se
-- pierda cuando varios clientes leen el mismo aviso casi al mismo tiempo.
--
-- append_aviso_comment: append atómico de un comentario nuevo al array
-- comments, calculado sobre la fila viva. Evita que el comentario de un
-- usuario se pierda si otro cliente escribe (con una copia local
-- desactualizada) casi al mismo tiempo.

CREATE OR REPLACE FUNCTION merge_aviso_data(aviso_id TEXT, patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  merged JSONB;
BEGIN
  UPDATE avisos
  SET data = data || patch
  WHERE id = aviso_id
  RETURNING data INTO merged;
  RETURN merged;
END;
$$;

CREATE OR REPLACE FUNCTION mark_aviso_read(aviso_id TEXT, p_user_id INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  merged JSONB;
BEGIN
  UPDATE avisos
  SET data = jsonb_set(
    data,
    '{leidoPor}',
    CASE
      WHEN COALESCE(data->'leidoPor', '[]'::jsonb) @> to_jsonb(p_user_id)
        THEN COALESCE(data->'leidoPor', '[]'::jsonb)
      ELSE COALESCE(data->'leidoPor', '[]'::jsonb) || to_jsonb(p_user_id)
    END
  )
  WHERE id = aviso_id
  RETURNING data INTO merged;
  RETURN merged;
END;
$$;

CREATE OR REPLACE FUNCTION append_aviso_comment(aviso_id TEXT, new_comment JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  merged JSONB;
BEGIN
  UPDATE avisos
  SET data = jsonb_set(
    data,
    '{comments}',
    COALESCE(data->'comments', '[]'::jsonb) || jsonb_build_array(new_comment)
  )
  WHERE id = aviso_id
  RETURNING data INTO merged;
  RETURN merged;
END;
$$;
