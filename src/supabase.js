import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mdqzyjmklawrvkghmabi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_xEmB2nc84riFnYxmtTsFfw_yOr3qcfg";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default supabase;
