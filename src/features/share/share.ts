interface ShareRequest {
  filePath: string;
}

interface ShareStatusResponse {
  enabled: boolean;
}

interface ShareResponse {
  shareUrl: string;
  expireTime: string;
  expireSeconds: number;
  fileName: string;
}

export async function getShareStatus(): Promise<boolean> {
  const res = await fetch("/api/share/status", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) return false;
  const data = (await res.json()) as ShareStatusResponse;
  return Boolean(data.enabled);
}

export async function createShareLink(
  filePath: string
): Promise<ShareResponse> {
  const payload: ShareRequest = {
    filePath,
  };

  const res = await fetch('/api/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-FlareDrive-Action': 'share',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function systemShare(shareData: ShareResponse): Promise<void> {
  const expireTime = new Date(shareData.expireTime).toLocaleString();
  const message =
    `Share link created!\n\n` +
    `File name: ${shareData.fileName}\n` +
    `Expires at: ${expireTime}\n\n` +
    `Link: ${shareData.shareUrl}`;

  try {
    await navigator.clipboard.writeText(shareData.shareUrl);
    
    const canUseWebShare =
      typeof navigator.share === 'function' &&
      ((navigator as any).canShare?.({ url: shareData.shareUrl }) ?? true);

    if (canUseWebShare) {
      try {
        await navigator.share({
          url: shareData.shareUrl,
        });
        return;
      } catch {
      }
    }
    
    alert(message + '\n\nLink copied to clipboard!');
  } catch {
    alert(message + '\n\nCopy the link manually if needed.');
  }
}
