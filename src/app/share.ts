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
  const auth = sessionStorage.getItem('webdav_auth');
  return auth;
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

export async function createShareLink(filePath: string, expireSeconds?: number): Promise<ShareResponse> {
  let auth = getWebDAVAuth();
  
  if (!auth) {
    auth = await promptForAuth();
    if (!auth) {
      throw new Error('WebDAV authentication required');
    }
  }

  const payload: ShareRequest = {
    filePath,
    expireSeconds: expireSeconds ?? 3600
  };

  const response = await fetch('/api/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`
    },
    body: JSON.stringify(payload)
  });

  if (response.status === 401) {
    sessionStorage.removeItem('webdav_auth');
    auth = await promptForAuth();
    if (!auth) {
      throw new Error('WebDAV authentication required');
    }

    const retryResponse = await fetch('/api/share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`
      },
      body: JSON.stringify(payload)
    });

    if (!retryResponse.ok) {
      const errorText = await retryResponse.text();
      throw new Error(errorText);
    }

    return retryResponse.json();
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText);
  }

  return response.json();
}


export async function shareFile(filePath: string): Promise<void> {
  try {
    const shareData = await createShareLink(filePath);
    
    const expireTime = new Date(shareData.expireTime).toLocaleString();
    const message = `Share link created!\n\nFile name: ${shareData.fileName}\nExpires at: ${expireTime}\n\nLink: ${shareData.shareUrl}`;
    
    if (navigator.share) {
      await navigator.share({ 
        title: `Shared file: ${shareData.fileName}`,
        text: `File will expire at ${expireTime}`,
        url: shareData.shareUrl 
      });
    } else {
      await navigator.clipboard.writeText(shareData.shareUrl);
      alert(message + '\n\nLink copied to clipboard!');
    }
    
  } catch (error) {
    console.error('Failed to create share link:', error);
    alert(`Failed to create share link: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
