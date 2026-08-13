-- Agregar columna needs_reregister para marcar usuarios que requieren re-registro
ALTER TABLE push_tokens
ADD COLUMN IF NOT EXISTS needs_reregister BOOLEAN DEFAULT FALSE;

-- Agregar índice para buscar rápidamente usuarios que necesitan re-registro
CREATE INDEX IF NOT EXISTS idx_push_tokens_needs_reregister
ON push_tokens(needs_reregister)
WHERE needs_reregister = TRUE;

-- Limpiar tokens duplicados: para cada usuario, mantener solo el más reciente
-- (basado en updated_at, o created_at si updated_at es NULL)
WITH ranked_tokens AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY id
      ORDER BY COALESCE(updated_at, created_at) DESC
    ) as rn
  FROM push_tokens
)
DELETE FROM push_tokens
WHERE id IN (
  SELECT id FROM ranked_tokens WHERE rn > 1
);

-- Limpiar tokens muy antiguos (más de 90 días sin actualizar)
-- Estos probablemente son de usuarios que no usan la app
DELETE FROM push_tokens
WHERE COALESCE(updated_at, created_at) < NOW() - INTERVAL '90 days';

-- Comentario para futuro: considerar agregar un trigger o cron job
-- para limpiar automáticamente tokens antiguos cada semana
COMMENT ON COLUMN push_tokens.needs_reregister IS
'Flag para marcar usuarios que necesitan re-registrar su token push debido a fallos (>50% de envíos fallidos)';
