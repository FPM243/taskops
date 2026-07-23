-- RPC: merge_quick_task_data
-- Merges a JSON patch into the quick_task's data column server-side using the live
-- row value, preventing stale-state overwrites from concurrent clients.
-- Returns the resulting data so the caller can sync local state accurately.
CREATE OR REPLACE FUNCTION merge_quick_task_data(task_id TEXT, patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  merged JSONB;
BEGIN
  UPDATE quick_tasks
  SET data = data || patch
  WHERE id = task_id
  RETURNING data INTO merged;
  RETURN merged;
END;
$$;
