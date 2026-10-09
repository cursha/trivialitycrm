// No `import "server-only"` — attemptDelivery() runs in the worker too
// (scheduled and sequence sends); see sanitize-html.ts for the same
// reasoning.
import { escapeHtml } from "@/lib/comms/sanitize-html";

/**
 * The branded frame every CRM email goes out in (Curt's call): the
 * Triviality Mayhem logo on a white card over Warm White, a thin Mayhem Red
 * line, the rep's own message, and a footer with the sender's name and the
 * business phone and website from Settings. The rep's message is written
 * and sanitized exactly as before — this only wraps the finished,
 * already-sanitized body, so its own styles never pass through the
 * sanitizer.
 *
 * Tables and inline styles only, because that's what email clients
 * (Outlook especially) reliably render; no web fonts, no CSS classes.
 */

// A 280px copy of the logo (shown at 140px, sharp on high-resolution
// screens): the full-size PNG is 7.6 MB, too heavy for every email.
const HEADER_LOGO_URL = "https://trivialitycrm.com/triviality-mayhem-logo-email.png";
// The logo the editor can insert into a message (see sanitize-html.ts).
const EDITOR_LOGO_URL = "https://trivialitycrm.com/triviality-mayhem-logo.png";

const COLORS = {
  warmWhite: "#F7F3ED",
  white: "#FFFFFF",
  red: "#DA0301",
  navy: "#002A6B",
  blue: "#00368B",
  text: "#050405",
  muted: "#6B6B6B",
  divider: "#A0A0A0",
} as const;

const FONT = "Arial, Helvetica, sans-serif";

export type BrandedFooter = {
  senderName: string;
  phone: string | null;
  website: string | null;
};

// A website from Settings, as a safe http(s) link and a short label
// ("triviality.ca"), or null when it isn't one.
function websiteLink(website: string | null): { href: string; label: string } | null {
  if (!website) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const label = `${url.hostname.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
    return { href: url.toString(), label };
  } catch {
    return null;
  }
}

export function wrapInBrandedLayout(bodyHtml: string, footer: BrandedFooter): string {
  // A message that already shows the logo doesn't get a second one.
  const header = bodyHtml.includes(EDITOR_LOGO_URL)
    ? ""
    : `<tr><td align="center" style="padding:24px 32px 8px 32px;"><img src="${HEADER_LOGO_URL}" width="140" height="140" alt="Triviality Mayhem" style="display:block;width:140px;height:140px;border:0;"></td></tr>`;

  const site = websiteLink(footer.website);
  const contactParts = [
    footer.phone ? `<a href="tel:${escapeHtml(footer.phone.replace(/[^\d+]/g, ""))}" style="color:${COLORS.blue};text-decoration:none;">${escapeHtml(footer.phone)}</a>` : null,
    site ? `<a href="${escapeHtml(site.href)}" style="color:${COLORS.blue};text-decoration:none;">${escapeHtml(site.label)}</a>` : null,
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:${COLORS.warmWhite};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.warmWhite};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:${COLORS.white};border-top:4px solid ${COLORS.red};">
${header}
<tr><td style="padding:16px 32px 24px 32px;font-family:${FONT};font-size:15px;line-height:1.6;color:${COLORS.text};">${bodyHtml}</td></tr>
<tr><td style="padding:0 32px;"><div style="border-top:1px solid ${COLORS.divider};font-size:0;line-height:0;">&nbsp;</div></td></tr>
<tr><td style="padding:16px 32px 24px 32px;font-family:${FONT};font-size:13px;line-height:1.5;color:${COLORS.muted};">
<div style="font-weight:bold;color:${COLORS.navy};">${escapeHtml(footer.senderName)}</div>
<div>Triviality Mayhem</div>
${contactParts.length > 0 ? `<div>${contactParts.join(" &middot; ")}</div>` : ""}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
