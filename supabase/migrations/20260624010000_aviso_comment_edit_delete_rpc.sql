-- RPCs complementarios a append_aviso_comment (ver 20260624000000):
-- editar y borrar un comentario específico de un aviso, identificado
-- por su id, calculados sobre la fila viva para no perder comentarios
-- de otros usuarios por una sobreescritura concurrente.
--
-- Requieren que el comentario tenga un campo "id" (los comentarios
-- creados antes de este cambio no lo tienen y por lo tanto no se
-- pueden editar/borrar individualmente — solo siguen visibles).

CREATE OR REPLACE FUNCTION edit_aviso_comment(aviso_id TEXT, comment_id TEXT, new_text TEXT)
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
    (
      SELECT COALESCE(jsonb_agg(
        CASE WHEN elem->>'id' = comment_id
          THEN elem || jsonb_build_object('text', new_text, 'edited', true, 'editedAt', to_jsonb(now()))
          ELSE elem
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(data->'comments', '[]'::jsonb)) elem
    )
  )
  WHERE id = aviso_id
  RETURNING data INTO merged;
  RETURN merged;
END;
$$;

CREATE OR REPLACE FUNCTION delete_aviso_comment(aviso_id TEXT, comment_id TEXT)
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
    (
      SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(data->'comments', '[]'::jsonb)) elem
      WHERE elem->>'id' <> comment_id
    )
  )
  WHERE id = aviso_id
  RETURNING data INTO merged;
  RETURN merged;
END;
$$;
