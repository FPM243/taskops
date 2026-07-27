import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://mdqzyjmklawrvkghmabi.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_xEmB2nc84riFnYxmtTsFfw_yOr3qcfg";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default supabase;
