interface ShareRequest {
  filePath: string;
}

interface ShareResponse {
  shareUrl: string;
  expireTime: string;
  expireSeconds: number;
  fileName: string;
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
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}

export async function generateShareData(
  filePath: string
): Promise<ShareResponse> {
  return await createShareLink(filePath);
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
      } catch (err) {
      }
    }
    
    alert(message + '\n\nLink copied to clipboard!');
  } catch {
    alert(message + '\n\nCopy the link manually if needed.');
  }
}
