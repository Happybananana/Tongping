import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || '';

export const ready = /^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(url) && Boolean(key) && !/^YOUR_/i.test(key);
export const db = ready ? createClient(url.replace(/\/$/, ''), key, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
}) : null;
