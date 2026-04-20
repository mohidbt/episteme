import { mkdir, writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const UPLOAD_DIR = join(process.cwd(), "uploads");

export async function saveFile(
  buffer: Buffer,
  originalName: string
): Promise<{ path: string; size: number }> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const ext = originalName.split(".").pop() ?? "pdf";
  const filename = `${randomUUID()}.${ext}`;
  const filepath = join(UPLOAD_DIR, filename);
  await writeFile(filepath, buffer);
  return { path: filepath, size: buffer.length };
}

export async function getFile(filepath: string): Promise<Buffer> {
  return readFile(filepath);
}

export async function deleteFile(filepath: string): Promise<void> {
  try {
    await unlink(filepath);
  } catch {
    // File already deleted — no-op
  }
}
