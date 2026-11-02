/* Setup-code format (no crypto, safe to use in browser bundles). */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export const SETUP_CODE_GROUPS = 6;
export const SETUP_CODE_GROUP_LEN = 5;

/** Accepts what people type: lower case, spaces, missing dashes. */
export function normalizeSetupCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, "");
  if (compact.length !== SETUP_CODE_GROUPS * SETUP_CODE_GROUP_LEN) return null;
  for (const ch of compact) if (!CODE_ALPHABET.includes(ch)) return null;
  return compact.match(new RegExp(`.{${SETUP_CODE_GROUP_LEN}}`, "g"))!.join("-");
}
