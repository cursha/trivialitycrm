"use client";

/**
 * Hands a generated file to the browser as a download. The object URL is
 * not revoked straight after click(): mobile browsers (Chrome on Android,
 * Safari on iPhone) read the blob after this returns, so an immediate
 * revoke left a greyed-out, failed download (Curt hit it on Android with a
 * route export). A minute is ample, and frees it afterwards.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}
