// app/src/lib/draft/qr.ts
import QRCode from 'qrcode';
import { encodeDraft } from '$lib/draft/io';
import { normalizeRulesVersion, type RulesVersion } from '$lib/rules/version';
import type { Draft } from '$lib/validate/model';

/** Sponsor on a draft is a string id. Some callers pass the sponsor object. */
export type SponsorRef = string | { id?: string } | null | undefined;

export function resolveSponsorId(sponsor: SponsorRef): string {
  if (typeof sponsor === 'string') {
    const trimmed = sponsor.trim();
    return trimmed || 'no_sponsor';
  }
  if (sponsor && typeof sponsor.id === 'string' && sponsor.id.trim()) {
    return sponsor.id.trim();
  }
  return 'no_sponsor';
}

/** Compact draft encoded into share links and QR codes. Keeps the sponsor id. */
export function buildSharePayload(draft: {
  sponsor?: SponsorRef;
  teamName?: string;
  maxCans?: number;
  rulesVersion?: unknown;
  vehicles?: Draft['vehicles'];
} | null | undefined): Draft {
  const rulesVersion: RulesVersion = normalizeRulesVersion(draft?.rulesVersion);
  return {
    sponsor: resolveSponsorId(draft?.sponsor),
    teamName: draft?.teamName || 'Gaslands Team',
    ...(typeof draft?.maxCans === 'number' ? { maxCans: draft.maxCans } : {}),
    ...(rulesVersion === 3 ? { rulesVersion } : {}),
    vehicles: (draft?.vehicles || []).map(v => ({
      id: v.id,
      type: v.type,
      name: v.name || 'Vehicle',
      weapons: v.weapons || [],
      upgrades: v.upgrades || [],
      perks: v.perks || [],
      weaponFacings: v.weaponFacings || {},
      ...(v.driverArchetype ? { driverArchetype: v.driverArchetype } : {}),
      ...(v.driverName ? { driverName: v.driverName } : {}),
      ...(v.secondPerkClass ? { secondPerkClass: v.secondPerkClass } : {}),
      ...(v.turretWeaponId ? { turretWeaponId: v.turretWeaponId } : {}),
      ...(v.upgradeFacings && Object.keys(v.upgradeFacings).length
        ? { upgradeFacings: v.upgradeFacings }
        : {})
    }))
  };
}

export async function draftToDataURL(draft: Draft): Promise<string> {
  try {
    if (!draft) {
      console.error("[QR] Error: Draft is undefined or null");
      throw new Error("Draft is undefined or null");
    }

    const simplifiedDraft = buildSharePayload(draft);

    const encoded = encodeDraft(simplifiedDraft);
    if (!encoded) {
      console.error("[QR] Error: Failed to encode draft");
      throw new Error("Failed to encode draft");
    }

    // Ensure location is available (web context)
    if (typeof location === 'undefined' || !location.origin) {
      console.error("[QR] Error: Location not available");
      // Use a fallback URL base for server-side rendering contexts
      const baseUrl = "https://gaslandsgarage.com";
      const url = `${baseUrl}/?draft=${encoded}`;
      console.log("[QR] Using fallback base URL:", baseUrl);

      const qrDataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        scale: 6,
        errorCorrectionLevel: 'M'
      });

      return qrDataUrl;
    }

    const url = `${location.origin}${location.pathname}?draft=${encoded}`;
    console.log("[QR] Generating QR code for URL:", url.substring(0, 50) + "...");
    console.log("[QR] Full URL length:", url.length);

    // Check if URL is too long (QR codes have data limitations)
    if (url.length > 2000) {
      console.warn("[QR] URL is very long (> 2000 chars), which may affect QR code readability");
    }

    const qrDataUrl = await QRCode.toDataURL(url, {
      margin: 1,
      scale: 6,
      errorCorrectionLevel: 'M' // Medium error correction level
    });

    // Verify the data URL is valid
    if (!qrDataUrl || typeof qrDataUrl !== 'string' || !qrDataUrl.startsWith('data:image/')) {
      console.error("[QR] Generated QR code is not a valid data URL");
      throw new Error("Invalid QR code data URL");
    }

    console.log("[QR] Successfully generated QR code, data URL length:", qrDataUrl.length);
    return qrDataUrl;
  } catch (error) {
    console.error("[QR] Error generating QR code:", error);

    // Return a fallback image - a visible "QR Error" image instead of 1x1 transparent pixel
    // This creates an image with text "QR Error"
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAMAAAAOusbgAAAAe1BMVEUAAAAAAADd3d0AAAD///8KCgoWFhbZ2dmFhYX5+fnq6uru7u7i4uLW1tbNzc3Jycm6urqurq6lpaWZmZlmZmZdXV1VVVVMTEw+Pj42NjYuLi4mJiYeHh7Ly8uenp6NjY17e3txcXFeXl5AQEAzMzMhISGBgYFtbW1LS0tMX4CjAAAAAXRSTlMAQObYZgAAAtRJREFUaN7tmtFuo0AMRWcmjgkhGzqVV8qjEEL//wtrO5sCrWirVHl57oNl+TgexzZh53LkyJEjR478W3mz22Qrcrft9iLN3P4y7K5EjGVZ+p/LF7G8m/Pvr5cN8sXMw1Tsa2iijA5Z/lJQwT8k2QU4eSnOK3CyB+CUUlZ0Yw6yTxYtzkrn+Xhw6VJs/GBnPR/HPjg+2TzYB49Ey4gUfB/s+2CbM4JLh/kETtZpCe4McuhCYFqnafIupcSGxJSS9/hM2jHJSfr9WjGWnJTEK7Hnxa9Q7JbS7ZWCDVa2DQpb0N8QLN0+FvAWDLpHCMF+9uD3g8vG4J+LH0d3HEcEDxyDx2QE77keXFkXXJ6eBZe/D1NKFHwAcHN6FNx+DSw/A8yHAVtVXaItaStQFapcN8HRl2gm5yLlXBwYTU4+MxnqcHCWo3bG0QKAlaO2xlECWCxHJbEeHGQTGFg/BwbWAMA5ufyEDJPLz0hR56QFY2PcKnFZXnNQqVZXEm+qerTmCQxWvWLt0YJBVnI2cFB7qwUH65pqG4m1oVn1DK70BtKDh+aZXO0FXAIsa8FD8wwO2gsYwbPmkd03sIM1gEP7TI7WARj0HjwgGMBRe7AEvQPD+jtgVh8MDPXNQDUDqU8GVh/AVZHhGhhWfwDzAYH1HsyqI6s/gFn1FXDdBrM0OBpYNoG5DWZW3YNZ9RqY2mBWvQZm1asutALmJliaYFadVG+CpQ1m1dnAUR+C9QfgOzAMFFY9ENipQ/Bt98aqx3rlQfV5l3QXzKrn+n1bqc59kkQTTM3L1gNYPnrfluZFO+e7baqXgz03wNUCOBq4LNGTNsHVAngAmxtgXwGjFSz1e6tNMC2AsQXGJlgWwNCeJPOKON+9uZy/B04urcHT9YrE4j2CXY4cOXLkyP9TfgDWzY0+5OyK2QAAAABJRU5ErkJggg==';
  }
}

