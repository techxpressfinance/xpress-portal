import api from '../api/client';
import { useToast } from '../components/Toast';

export function useFileDownload() {
  const { toast } = useToast();

  const downloadFile = async (docId: string, filename: string) => {
    try {
      const { data } = await api.get(`/documents/${docId}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast('Failed to download document', 'error');
    }
  };

  return { downloadFile };
}
