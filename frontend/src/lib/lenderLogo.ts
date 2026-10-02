import api from '../api/client';

/**
 * The lender's logo as a data URL, for printing. The image endpoint needs the
 * bearer token, so it can't be an <img src>, and html2canvas only paints an
 * image it can read without a network fetch — a data URL is both. Null when
 * there is no logo or it can't be read; the document then prints without one.
 */
export async function lenderLogoDataUrl(lenderId: string): Promise<string | null> {
  try {
    const { data } = await api.get<Blob>(`/lenders/${lenderId}/logo`, { responseType: 'blob' });
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(data);
    });
  } catch {
    return null;
  }
}
