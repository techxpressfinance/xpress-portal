import api from '../../api/client';
import { isImageAttachment } from '../../lib/arrears';
import type { ArrearsRecordDetail } from '../../types';

/** Attachment id → data URL, ready to drop straight into an `<img src>`. */
export type ArrearsPrintImages = Record<string, string>;

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Pull every screenshot on these records down as a data URL so the PDF can
 * carry the evidence itself, not just its filename.
 *
 * The files sit behind an authenticated endpoint, so html2canvas can't fetch
 * them from a URL in the markup — they have to be inlined before the capture.
 * A file that won't download is skipped rather than failing the export: the
 * print block still lists it by name.
 */
export async function loadArrearsPrintImages(
  records: ArrearsRecordDetail[],
): Promise<ArrearsPrintImages> {
  const targets = records.flatMap((record) => [
    ...record.attachments.map((a) => ({ recordId: record.id, id: a.id, filename: a.original_filename })),
    ...record.attempts.flatMap((attempt) =>
      attempt.attachments.map((a) => ({ recordId: record.id, id: a.id, filename: a.original_filename })),
    ),
  ]).filter((t) => isImageAttachment(t.filename));

  const images: ArrearsPrintImages = {};
  // A party-level export can cover dozens of snips; fetch a few at a time so a
  // big book doesn't open thirty parallel downloads at once.
  const queue = [...targets];
  const worker = async () => {
    for (let target = queue.shift(); target; target = queue.shift()) {
      try {
        const { data } = await api.get(
          `/arrears/${target.recordId}/attachments/${target.id}/download`,
          { responseType: 'blob' },
        );
        images[target.id] = await blobToDataUrl(data as Blob);
      } catch {
        // Missing file in storage, or a permission slip — the row still prints.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return images;
}
