// Normalize a US/Canada phone number to E.164 (+1XXXXXXXXXX), or return null.
export function toE164(input) {
  if (typeof input !== "string") return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
