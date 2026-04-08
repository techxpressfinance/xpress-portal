import api from '../api/client';
import { useToast } from '../components/Toast';

export function useFileDownload() {
  const { toast } = useToast();

  const downloadFile = async (docId: string, filename: string) => {
    let url: string | null = null;
    let a: HTMLAnchorElement | null = null;
    try {
      const { data } = await api.get(`/documents/${docId}/download`, { responseType: 'blob' });
      url = URL.createObjectURL(data);
      a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
    } catch {
      toast('Failed to download document', 'error');
    } finally {
      if (a && a.parentNode) document.body.removeChild(a);
      if (url) URL.revokeObjectURL(url);
    }
  };

  return { downloadFile };
}
