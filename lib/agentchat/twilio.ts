export function twiml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

export function twimlTextResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}

export function enforceDialTimeLimit(twimlXml: string, seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return twimlXml;
  }

  return twimlXml.replace(/<Dial\b([^>]*)>/i, (full, attrs: string) => {
    if (/\btimeLimit\s*=\s*["'][^"']*["']/i.test(attrs)) {
      return full.replace(/\btimeLimit\s*=\s*["'][^"']*["']/i, `timeLimit="${Math.floor(seconds)}"`);
    }
    return `<Dial${attrs} timeLimit="${Math.floor(seconds)}">`;
  });
}

export function attachStreamStatusCallback(twimlXml: string, callbackUrl: string | null): string {
  if (!callbackUrl) {
    return twimlXml;
  }

  return twimlXml.replace(/<Stream\b([^>]*?)(\/?)>/i, (_full, rawAttrs: string, slash: string) => {
    let attrs = rawAttrs;

    if (/\bstatusCallback\s*=\s*["'][^"']*["']/i.test(attrs)) {
      attrs = attrs.replace(/\bstatusCallback\s*=\s*["'][^"']*["']/i, `statusCallback="${callbackUrl}"`);
    } else {
      attrs = `${attrs} statusCallback="${callbackUrl}"`;
    }

    if (/\bstatusCallbackMethod\s*=\s*["'][^"']*["']/i.test(attrs)) {
      attrs = attrs.replace(/\bstatusCallbackMethod\s*=\s*["'][^"']*["']/i, `statusCallbackMethod="POST"`);
    } else {
      attrs = `${attrs} statusCallbackMethod="POST"`;
    }

    const normalizedAttrs = attrs.trim();
    return `<Stream${normalizedAttrs ? ` ${normalizedAttrs}` : ""}${slash ? " /" : ""}>`;
  });
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
