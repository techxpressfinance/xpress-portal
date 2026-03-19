import { useCallback, useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import { useToast } from './Toast';
import type { OcrStatus } from '../types';
import { Button } from './ui';

interface DocumentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  filename: string;
  ocrStatus?: OcrStatus;
  showOcrTab?: boolean;
}

function getFileType(filename: string): 'pdf' | 'image' | 'unknown' {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext || '')) return 'image';
  return 'unknown';
}

function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toUpperCase() || 'FILE';
}

export default function DocumentPreviewModal({ isOpen, onClose, documentId, filename, ocrStatus, showOcrTab = true }: DocumentPreviewModalProps) {
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'preview' | 'ocr'>('preview');
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrFetched, setOcrFetched] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = `document-preview-${documentId}`;

  const fileType = getFileType(filename);
  const fileExt = getFileExtension(filename);
  const ocrAvailable = ocrStatus === 'completed' || ocrStatus === 'failed';

  const fetchDocument = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadProgress(0);
    setImageError(false);
    try {
      const { data } = await api.get(`/documents/${documentId}/download`, { 
        responseType: 'blob',
        onDownloadProgress: (progressEvent) => {
          if (progressEvent.total) {
            setLoadProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
          }
        }
      });
      const url = URL.createObjectURL(data);
      setBlobUrl(url);
    } catch {
      setError('Failed to load document');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  const fetchOcrText = useCallback(async () => {
    if (ocrFetched) return;
    setOcrLoading(true);
    setOcrError(null);
    try {
      const { data } = await api.get(`/documents/${documentId}/ocr-text`);
      setOcrText(data.ocr_text);
      if (data.ocr_error) setOcrError(data.ocr_error);
      setOcrFetched(true);
    } catch {
      setOcrError('Failed to load extracted text');
    } finally {
      setOcrLoading(false);
    }
  }, [documentId, ocrFetched]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (isOpen && documentId) {
      fetchDocument();
    }
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
      }
    };
  }, [isOpen, documentId]);

  useEffect(() => {
    if (activeTab === 'ocr' && ocrAvailable && !ocrFetched) {
      fetchOcrText();
    }
  }, [activeTab, ocrAvailable, ocrFetched, fetchOcrText]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setActiveTab('preview');
      setOcrText(null);
      setOcrError(null);
      setOcrFetched(false);
      setCopied(false);
      setZoom(100);
      setIsFullscreen(false);
    }
  }, [isOpen]);

  // Body scroll lock
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          onClose();
        }
      }
      if (e.key === '+' || e.key === '=') {
        setZoom(z => Math.min(z + 25, 300));
      }
      if (e.key === '-') {
        setZoom(z => Math.max(z - 25, 25));
      }
      if (e.key === '0') {
        setZoom(100);
      }
      if (e.key === 'f' || e.key === 'F') {
        setIsFullscreen(f => !f);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, isFullscreen]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(f => !f);
  }, []);

  // Zoom controls
  const zoomIn = useCallback(() => setZoom(z => Math.min(z + 25, 300)), []);
  const zoomOut = useCallback(() => setZoom(z => Math.max(z - 25, 25)), []);
  const resetZoom = useCallback(() => setZoom(100), []);

  const handleDownload = async () => {
    try {
      const { data } = await api.get(`/documents/${documentId}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast('Download failed — please try again', 'error');
    }
  };

  const handleCopyText = async () => {
    if (!ocrText) return;
    try {
      await navigator.clipboard.writeText(ocrText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Failed to copy text', 'error');
    }
  };

  if (!isOpen || !mounted) return null;

  const ocrLineCount = ocrText ? ocrText.split('\n').length : 0;
  const ocrCharCount = ocrText ? ocrText.length : 0;

  return createPortal(
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      />

      {/* Full-screen modal with fixed margin */}
      <div
        className={`z-10 flex flex-col overflow-hidden rounded-2xl bg-card shadow-[0_24px_80px_-12px_rgba(0,0,0,0.3),0_0_0_1px_var(--border)] ${
          isFullscreen 
            ? 'fixed inset-0 m-0 rounded-none h-full' 
            : 'absolute inset-3 sm:inset-4 lg:inset-6 h-[calc(100%-1.5rem)] sm:h-[calc(100%-2rem)] lg:h-[calc(100%-3rem)]'
        }`}
        style={{ animation: 'scaleIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        {/* Header -- pinned top */}
        <div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-3.5 sm:px-6">
          {/* File icon */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
            {fileType === 'pdf' ? (
              <svg className="h-5 w-5 text-destructive" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
            ) : fileType === 'image' ? (
              <svg className="h-5 w-5 text-chart-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
            ) : (
              <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
            )}
          </div>

          {/* File info */}
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="truncate text-[15px] font-semibold text-foreground">{filename}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground tracking-wide">
                {fileExt}
              </span>
              {showOcrTab && ocrStatus && (
                <span className={`inline-flex items-center gap-1 text-[12px] font-medium ${
                  ocrStatus === 'completed' ? 'text-success' :
                  ocrStatus === 'failed' ? 'text-destructive' :
                  ocrStatus === 'processing' ? 'text-chart-4' :
                  'text-muted-foreground'
                }`}>
                  {ocrStatus === 'completed' && (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                  )}
                  {ocrStatus === 'processing' && (
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-chart-4" />
                  )}
                  {ocrStatus === 'failed' && (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                  )}
                  {ocrStatus === 'completed' ? 'Text extracted' :
                   ocrStatus === 'processing' ? 'Extracting text...' :
                   ocrStatus === 'failed' ? 'Extraction failed' :
                   'OCR pending'}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={handleDownload}>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
              Download
            </Button>
            <button
              onClick={toggleFullscreen}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
              title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
            >
              {isFullscreen ? (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /></svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
              )}
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* Tab bar -- only shown when OCR tab is enabled */}
        {showOcrTab && (
          <div className="relative flex shrink-0 px-5 sm:px-6">
            <button
              onClick={() => setActiveTab('preview')}
              className={`relative px-4 py-2.5 text-[13px] font-medium transition-colors duration-200 ${
                activeTab === 'preview'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                Preview
              </div>
              {activeTab === 'preview' && (
                <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary" />
              )}
            </button>
            <button
              onClick={() => ocrAvailable && setActiveTab('ocr')}
              disabled={!ocrAvailable}
              className={`relative px-4 py-2.5 text-[13px] font-medium transition-colors duration-200 ${
                activeTab === 'ocr'
                  ? 'text-foreground'
                  : ocrAvailable
                    ? 'text-muted-foreground hover:text-foreground'
                    : 'text-muted-foreground/40 cursor-not-allowed'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                Extracted Text
                {ocrStatus === 'processing' && (
                  <span className="ml-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-chart-4" />
                )}
                {!ocrAvailable && ocrStatus !== 'processing' && (
                  <svg className="h-3 w-3 text-muted-foreground/40" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" /></svg>
                )}
              </div>
              {activeTab === 'ocr' && (
                <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary" />
              )}
            </button>
            {/* Tab bar border */}
            <div className="absolute bottom-0 left-0 right-0 h-px bg-border" />
          </div>
        )}

        {/* Content -- fills all remaining space */}
        <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-secondary/20 h-full">
          {/* Zoom toolbar for images */}
          {activeTab === 'preview' && fileType === 'image' && blobUrl && !loading && !error && (
            <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-lg bg-card/90 backdrop-blur-sm border border-border shadow-sm px-2 py-1.5">
              <button
                onClick={zoomOut}
                disabled={zoom <= 25}
                className="p-1 rounded hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Zoom out ( - )"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-6" /></svg>
              </button>
              <button
                onClick={resetZoom}
                className="px-2 py-0.5 text-[12px] font-medium hover:bg-secondary rounded transition-colors min-w-[48px]"
                title="Reset zoom (0)"
              >
                {zoom}%
              </button>
              <button
                onClick={zoomIn}
                disabled={zoom >= 300}
                className="p-1 rounded hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Zoom in ( + )"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" /></svg>
              </button>
            </div>
          )}
          {activeTab === 'preview' && (
            <>
              {loading && (
                <div className="flex h-full flex-col items-center justify-center p-6">
                  <div className="relative mb-4">
                    <div className="h-16 w-16 rounded-full border-4 border-secondary" />
                    <div className="absolute inset-0 h-16 w-16 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  </div>
                  <p className="text-[14px] font-medium text-foreground mb-2">Loading document...</p>
                  {loadProgress > 0 && (
                    <div className="w-48 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all duration-300 ease-out" 
                        style={{ width: `${loadProgress}%` }} 
                      />
                    </div>
                  )}
                  <p className="text-[12px] text-muted-foreground mt-2">{loadProgress}%</p>
                </div>
              )}
              {error && !loading && (
                <div className="flex h-full flex-col items-center justify-center p-6">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 mb-4">
                    <svg className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
                  </div>
                  <p className="text-[14px] font-medium text-foreground mb-1">Failed to load document</p>
                  <p className="text-[13px] text-muted-foreground mb-4">The document could not be retrieved. Please try again.</p>
                  <Button variant="secondary" size="sm" onClick={fetchDocument}>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" /></svg>
                    Try Again
                  </Button>
                </div>
              )}
              {blobUrl && !loading && !error && (
                <>
                  {fileType === 'pdf' && (
                    <div className="relative h-full w-full">
                      <iframe src={blobUrl} className="h-full w-full" title={filename} />
                    </div>
                  )}
                  {fileType === 'image' && (
                    <div className="flex h-full items-center justify-center p-4 overflow-auto">
                      {imageError ? (
                        <div className="flex flex-col items-center justify-center">
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 mb-4">
                            <svg className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
                          </div>
                          <p className="text-[14px] font-medium text-foreground mb-1">Failed to load image</p>
                          <p className="text-[13px] text-muted-foreground mb-4">The image file appears to be corrupted.</p>
                          <Button variant="secondary" size="sm" onClick={() => { setImageError(false); fetchDocument(); }}>
                            Try Again
                          </Button>
                        </div>
                      ) : (
                        <img 
                          src={blobUrl} 
                          alt={filename} 
                          className="rounded-lg object-contain transition-transform duration-200"
                          style={{ 
                            maxWidth: zoom > 100 ? 'none' : '100%',
                            maxHeight: zoom > 100 ? 'none' : '100%',
                            width: zoom > 100 ? `${zoom}%` : 'auto',
                            height: zoom > 100 ? 'auto' : 'auto',
                          }}
                          onError={() => setImageError(true)}
                        />
                      )}
                    </div>
                  )}
                  {fileType === 'unknown' && (
                    <div className="flex h-full flex-col items-center justify-center p-6">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary mb-4">
                        <svg className="h-6 w-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                      </div>
                      <p className="text-[14px] font-medium text-foreground mb-1">Preview not available</p>
                      <p className="text-[13px] text-muted-foreground mb-4">This file type can&apos;t be previewed. Download it to view.</p>
                      <Button variant="primary" size="sm" onClick={handleDownload}>
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                        Download File
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {activeTab === 'ocr' && (
            <div className="p-5 sm:p-6">
              {ocrLoading && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-4 w-24 rounded shimmer" />
                    <div className="h-4 w-16 rounded shimmer" />
                  </div>
                  <div className="rounded-xl bg-card p-5 space-y-2.5">
                    <div className="h-3.5 w-full rounded shimmer" />
                    <div className="h-3.5 w-11/12 rounded shimmer" />
                    <div className="h-3.5 w-4/5 rounded shimmer" />
                    <div className="h-3.5 w-full rounded shimmer" />
                    <div className="h-3.5 w-3/4 rounded shimmer" />
                    <div className="h-3.5 w-5/6 rounded shimmer" />
                    <div className="h-3.5 w-2/3 rounded shimmer" />
                  </div>
                </div>
              )}
              {ocrError && ocrStatus === 'failed' && !ocrLoading && (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 mb-4">
                    <svg className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
                  </div>
                  <p className="text-[14px] font-medium text-foreground mb-1">Text extraction failed</p>
                  <p className="text-[13px] text-muted-foreground max-w-sm text-center">{ocrError}</p>
                </div>
              )}
              {ocrText !== null && !ocrLoading && ocrStatus === 'completed' && (
                <div className="flex flex-col h-full">
                  {/* OCR toolbar */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-[12px] text-muted-foreground">
                        {ocrLineCount.toLocaleString()} {ocrLineCount === 1 ? 'line' : 'lines'}
                      </span>
                      <span className="text-[12px] text-muted-foreground/40">&middot;</span>
                      <span className="text-[12px] text-muted-foreground">
                        {ocrCharCount.toLocaleString()} {ocrCharCount === 1 ? 'character' : 'characters'}
                      </span>
                    </div>
                    <button
                      onClick={handleCopyText}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all duration-200 ${
                        copied
                          ? 'bg-success/10 text-success'
                          : 'text-muted-foreground hover:bg-card hover:text-foreground'
                      }`}
                    >
                      {copied ? (
                        <>
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                          Copied
                        </>
                      ) : (
                        <>
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
                          Copy text
                        </>
                      )}
                    </button>
                  </div>

                  {/* OCR text content */}
                  {ocrText ? (
                    <pre className="whitespace-pre-wrap break-words rounded-xl bg-card p-5 text-[13px] text-foreground/90 font-mono overflow-auto leading-relaxed selection:bg-primary/20 selection:text-foreground shadow-[0_0_0_1px_var(--border)]">
                      {ocrText}
                    </pre>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 rounded-xl bg-card shadow-[0_0_0_1px_var(--border)]">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary mb-3">
                        <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                      </div>
                      <p className="text-[13px] text-muted-foreground">No text was extracted from this document</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
