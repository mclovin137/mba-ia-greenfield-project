import 'dotenv/config';
import { open, stat } from 'node:fs/promises';

interface Session {
  id: string;
  public_id: string;
  part_size: number;
  part_count: number;
}
interface Status {
  status: string;
  error_code: string | null;
}
async function main() {
  const path = process.argv[2];
  let token = process.env.VIDEO_TOKEN;
  let refreshToken = process.env.VIDEO_REFRESH_TOKEN;
  if (!path || !token)
    throw new Error(
      'Usage: VIDEO_TOKEN=... ts-node scripts/upload-video.ts /media/video.mp4',
    );
  const base = process.env.VIDEO_API_URL ?? 'http://nestjs-api:3000';
  const size = (await stat(path)).size;
  if (size < 1 || size > 10 * 1024 ** 3)
    throw new Error('Video must be 1 byte..10GiB');
  async function api<T>(
    route: string,
    method = 'GET',
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401 && refreshToken && route !== '/auth/refresh') {
      await response.arrayBuffer();
      const refreshed = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!refreshed.ok)
        throw new Error(`Session refresh failed: ${refreshed.status}`);
      const next = (await refreshed.json()) as {
        access_token: string;
        refresh_token: string;
      };
      token = next.access_token;
      refreshToken = next.refresh_token;
      return api<T>(route, method, body);
    }
    if (!response.ok)
      throw new Error(`API ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }
  const session = await api<Session>('/videos/uploads', 'POST', {
    title: 'Video upload verification',
    size,
    content_type: process.env.VIDEO_CONTENT_TYPE ?? 'video/mp4',
  });
  console.log({
    id: session.id,
    public_id: session.public_id,
    size,
    parts: session.part_count,
  });
  const file = await open(path, 'r');
  try {
    for (let part = 1; part <= session.part_count; part++) {
      const offset = (part - 1) * session.part_size;
      const buffer = Buffer.alloc(Math.min(session.part_size, size - offset));
      let read = 0;
      while (read < buffer.length) {
        const chunk = await file.read(
          buffer,
          read,
          buffer.length - read,
          offset + read,
        );
        if (!chunk.bytesRead)
          throw new Error('Input file changed during upload');
        read += chunk.bytesRead;
      }
      const { url } = await api<{ url: string }>(
        `/videos/${session.id}/upload-parts/${part}`,
        'POST',
      );
      const response = await fetch(url, {
        method: 'PUT',
        body: new Uint8Array(buffer),
      });
      if (!response.ok)
        throw new Error(`Storage PUT failed: ${response.status}`);
      await response.arrayBuffer();
      console.log(`Uploaded ${Math.min(size, offset + buffer.length)}/${size}`);
      // Global inherited limiter: 10 control-plane requests/minute. Pace long uploads.
      if (part < session.part_count)
        await new Promise((resolve) => setTimeout(resolve, 6500));
    }
  } finally {
    await file.close();
  }
  await api(`/videos/${session.id}/complete`, 'POST');
  const deadline = Date.now() + 3 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 6500));
    const status = await api<Status>(`/videos/${session.id}/status`);
    if (status.status === 'error')
      throw new Error(`Processing failed: ${status.error_code}`);
    if (status.status === 'ready') {
      console.log(`Ready: ${base}/videos/${session.public_id}`);
      return;
    }
  }
  throw new Error(`Processing timeout; inspect video ${session.id}`);
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
