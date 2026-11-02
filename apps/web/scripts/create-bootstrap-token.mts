/*
 * Prints a one-time Super Admin setup code (valid 60 minutes).
 * Run on a trusted machine with the service-role key:
 *
 *   npm run bootstrap:token              (reads apps/web/.env.local)
 *
 * Only the SHA-256 hash of the code is stored. Running it again replaces any
 * unused code. It refuses to run once setup is complete.
 */
import { createClient } from "@supabase/supabase-js";
import { generateSetupCode, hashSetupCode } from "../src/lib/bootstrap.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const ttl = Number(process.env.SETUP_CODE_TTL_MINUTES ?? 60);

if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (apps/web/.env.local).");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: done, error: statusError } = await admin.rpc("bootstrap_is_complete");
if (statusError) {
  console.error(`Could not check setup status: ${statusError.message}`);
  process.exit(1);
}
if (done) {
  console.error("Setup is already complete. Invite new people from Admin Panel → Team.");
  process.exit(1);
}

const code = generateSetupCode();
const { data: expiresAt, error } = await admin.rpc("bootstrap_create_token", {
  p_token_hash: hashSetupCode(code),
  p_ttl_minutes: ttl,
});
if (error) {
  console.error(`Could not create a setup code: ${error.message}`);
  process.exit(1);
}

console.log("\nOne-time setup code (shown only once):\n");
console.log(`    ${code}\n`);
console.log(`Open ${site}/setup and enter it. It expires at ${new Date(String(expiresAt)).toLocaleString()}.\n`);
