/**
 * Split a pasted customer list into the row shape hashAudienceBatch already
 * accepts. One value per line, or a comma/tab row with an email and a phone.
 * Hashing stays in hash-client.ts — this file does not hash.
 */
export function rowsFromCustomerPaste(
  text: string,
): { email?: string; phone?: string }[] {
  const rows: { email?: string; phone?: string }[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.includes(",") || line.includes("\t")) {
      const cells = line.split(/[,\t]/).map((cell) => cell.trim()).filter(Boolean);
      const email = cells.find((cell) => cell.includes("@"));
      const phone = cells.find((cell) => cell !== email);
      if (email || phone) rows.push({ email, phone });
      continue;
    }
    if (line.includes("@")) rows.push({ email: line });
    else rows.push({ phone: line });
  }
  return rows;
}
