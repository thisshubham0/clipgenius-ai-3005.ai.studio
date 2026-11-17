export async function downloadClipMp4(params: {
  clipId: number;
  resolution: string;
  clipTitle: string;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}): Promise<void> {
  const { clipId, resolution, clipTitle, authFetch } = params;
  const res = await authFetch(
    `/api/clips/${clipId}/download?resolution=${encodeURIComponent(resolution)}`
  );
  if (!res.ok) {
    let errMsg = `Download failed (HTTP ${res.status}).`;
    try {
      const data = await res.json();
      if (data?.error) errMsg = String(data.error);
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(errMsg);
  }

  const blob = await res.blob();
  const safeSlug = clipTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const filename = `${safeSlug || `clip-${clipId}`}-${resolution}.mp4`;

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}
