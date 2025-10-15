interface ShareRequest {
  filePath: string;
  expireSeconds?: number;
}

interface ShareResponse {
  shareUrl: string;
  expireTime: string;
  expireSeconds: number;
  fileName: string;
}

function getWebDAVAuth(): string | null {
  return sessionStorage.getItem('webdav_auth');
}

function setWebDAVAuth(username: string, password: string) {
  const auth = btoa(`${username}:${password}`);
  sessionStorage.setItem('webdav_auth', auth);
}

async function promptForAuth(): Promise<string | null> {
  const username = prompt('Please enter WebDAV username:');
  if (!username) return null;

  const password = prompt('Please enter WebDAV password:');
  if (!password) return null;

  const auth = btoa(`${username}:${password}`);
  setWebDAVAuth(username, password);
  return auth;
}

export async function createShareLink(
  filePath: string,
  expireSeconds?: number
): Promise<ShareResponse> {
  let auth = getWebDAVAuth();
  if (!auth) {
    auth = await promptForAuth();
    if (!auth) throw new Error('WebDAV authentication required');
  }

  const payload: ShareRequest = {
    filePath,
    expireSeconds: expireSeconds ?? 3600,
  };

  const doPost = async () => {
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json();
  };

  try {
    return await doPost();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Unauthorized') || msg.includes('401')) {
      sessionStorage.removeItem('webdav_auth');
      auth = await promptForAuth();
      if (!auth) throw new Error('WebDAV authentication required');
      return await doPost();
    }
    throw e;
  }
}

export async function generateShareData(
  filePath: string,
  expireSeconds?: number
): Promise<ShareResponse> {
  return await createShareLink(filePath, expireSeconds);
}

export async function systemShare(shareData: ShareResponse): Promise<void> {
  const expireTime = new Date(shareData.expireTime).toLocaleString();
  const message =
    `Share link created!\n\n` +
    `File name: ${shareData.fileName}\n` +
    `Expires at: ${expireTime}\n\n` +
    `Link: ${shareData.shareUrl}`;

  const canUseWebShare =
    typeof navigator.share === 'function' &&
    ((navigator as any).canShare?.({ url: shareData.shareUrl }) ?? true);

  if (canUseWebShare) {
    try {
      await navigator.share({
        title: `Shared file: ${shareData.fileName}`,
        text: `File will expire at ${expireTime}`,
        url: shareData.shareUrl,
      });
      return;
    } catch (err) {
    }
  }

  try {
    await navigator.clipboard.writeText(shareData.shareUrl);
    alert(message + '\n\nLink copied to clipboard!');
  } catch {
    alert(message + '\n\nCopy the link manually if needed.');
  }
}
