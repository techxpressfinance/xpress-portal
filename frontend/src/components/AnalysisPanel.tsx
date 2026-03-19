import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useToast } from './Toast';
import { getErrorMessage } from '../lib/utils';
import { GlassCard, Badge, Button } from './ui';
import {
  ANALYSIS_STATUS_BADGE,
  FLAG_SEVERITY_STYLES,
  RECOMMENDATION_BADGE,
  RISK_LEVEL_BADGE,
} from '../lib/constants';
import type { AnalysisResult, AnalysisStatus, Document, LoanApplication } from '../types';

interface AnalysisPanelProps {
  application: LoanApplication;
  documents: Document[];
  onStatusChange?: () => void;
}

export default function AnalysisPanel({ application, documents, onStatusChange }: AnalysisPanelProps) {
  const { toast } = useToast();
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(application.analysis_status);
  const [analysisResult, setAnalysisResult] = useState<string | null>(application.analysis_result);
  const [analysisError, setAnalysisError] = useState<string | null>(application.analysis_error);
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(application.analyzed_at);
  const [triggering, setTriggering] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const allOcrComplete = documents.length > 0 && documents.every((d) => d.ocr_status === 'completed');
  const isProcessing = analysisStatus === 'pending' || analysisStatus === 'processing';
  const hasResult = analysisStatus === 'completed' && analysisResult;
  const hasFailed = analysisStatus === 'failed';

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollAnalysis = useCallback(() => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/applications/${application.id}/analysis`);
        setAnalysisStatus(data.analysis_status);
        setAnalysisResult(data.analysis_result);
        setAnalysisError(data.analysis_error);
        setAnalyzedAt(data.analyzed_at);

        if (data.analysis_status === 'completed' || data.analysis_status === 'failed') {
          stopPolling();
          onStatusChange?.();
        }
      } catch {
        stopPolling();
        toast('Failed to check analysis status', 'error');
      }
    }, 3000);
  }, [application.id, stopPolling, onStatusChange, toast]);

  // Start polling if already processing on mount
  useEffect(() => {
    if (isProcessing) {
      pollAnalysis();
    }
    return stopPolling;
  }, [isProcessing, pollAnalysis, stopPolling]);

  const handleAnalyze = async () => {
    setTriggering(true);
    try {
      await api.post(`/applications/${application.id}/analyze`);
      setAnalysisStatus('pending');
      setAnalysisError(null);
      pollAnalysis();
    } catch (err: any) {
      toast(getErrorMessage(err, 'Failed to start analysis'), 'error');
    } finally {
      setTriggering(false);
    }
  };

  let parsed: AnalysisResult | null = null;
  if (hasResult) {
    try {
      parsed = JSON.parse(analysisResult!) as AnalysisResult;
    } catch {
      // Will show raw fallback
    }
  }

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[15px] font-semibold text-foreground">AI Document Analysis</h2>
        {analysisStatus && (
          <Badge
            type="custom"
            value={ANALYSIS_STATUS_BADGE[analysisStatus].label}
            className={ANALYSIS_STATUS_BADGE[analysisStatus].className}
          />
        )}
      </div>

      {/* Trigger Button */}
      {!isProcessing && (
        <Button
          onClick={handleAnalyze}
          disabled={!allOcrComplete || triggering}
          className="w-full mb-4"
        >
          {triggering
            ? 'Starting...'
            : hasResult || hasFailed
              ? 'Re-Analyze with AI'
              : 'Analyze with AI'}
        </Button>
      )}

      {!allOcrComplete && !isProcessing && !hasResult && (
        <p className="text-[12px] text-muted-foreground mb-4">
          All documents must have completed OCR before analysis can begin.
        </p>
      )}

      {/* Processing State */}
      {isProcessing && (
        <div className="flex items-center gap-3 rounded-xl bg-chart-4/5 p-4 mb-4">
          <svg className="h-5 w-5 animate-spin text-chart-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <div>
            <p className="text-[14px] font-medium text-foreground">Analyzing documents...</p>
            <p className="text-[12px] text-muted-foreground">This may take 15-30 seconds</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {hasFailed && analysisError && (
        <div className="rounded-xl bg-destructive/5 border border-destructive/20 p-4 mb-4">
          <p className="text-[13px] font-medium text-destructive">Analysis Failed</p>
          <p className="text-[12px] text-muted-foreground mt-1">{analysisError}</p>
        </div>
      )}

      {/* Results */}
      {hasResult && parsed && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-xl bg-secondary p-4">
            <h3 className="text-[13px] font-medium text-muted-foreground mb-2">Summary</h3>
            <p className="text-[14px] text-foreground">{parsed.summary}</p>
          </div>

          {/* Recommendation */}
          <div className="rounded-xl bg-secondary p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-medium text-muted-foreground">Recommendation</h3>
              <Badge
                type="custom"
                value={RECOMMENDATION_BADGE[parsed.recommendation.decision]?.label || parsed.recommendation.decision}
                className={RECOMMENDATION_BADGE[parsed.recommendation.decision]?.className || ''}
              />
            </div>
            <p className="text-[14px] text-foreground mb-2">{parsed.recommendation.reasoning}</p>
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span>Confidence: <span className="font-medium capitalize">{parsed.recommendation.confidence}</span></span>
            </div>
            {parsed.recommendation.conditions.length > 0 && (
              <div className="mt-3">
                <p className="text-[12px] font-medium text-muted-foreground mb-1">Conditions:</p>
                <ul className="list-disc list-inside text-[13px] text-foreground space-y-0.5">
                  {parsed.recommendation.conditions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Risk Assessment */}
          <div className="rounded-xl bg-secondary p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-medium text-muted-foreground">Risk Assessment</h3>
              <Badge
                type="custom"
                value={RISK_LEVEL_BADGE[parsed.risk_assessment.risk_level]?.label || parsed.risk_assessment.risk_level}
                className={RISK_LEVEL_BADGE[parsed.risk_assessment.risk_level]?.className || ''}
              />
            </div>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-[12px] text-muted-foreground">Debt-to-Income</dt>
                <dd className="text-[14px] font-medium text-foreground">{parsed.risk_assessment.debt_to_income}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted-foreground">Affordability</dt>
                <dd className="text-[14px] font-medium text-foreground">{parsed.risk_assessment.affordability}</dd>
              </div>
            </dl>
          </div>

          {/* Financial Summary */}
          <div className="rounded-xl bg-secondary p-4">
            <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Financial Summary</h3>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-[12px] text-muted-foreground">Income</dt>
                <dd className="text-[14px] font-medium text-foreground">{parsed.financial_summary.income}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted-foreground">Employer</dt>
                <dd className="text-[14px] font-medium text-foreground">{parsed.financial_summary.employer}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted-foreground">Bank Balance</dt>
                <dd className="text-[14px] font-medium text-foreground">{parsed.financial_summary.bank_balance}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted-foreground">Monthly Obligations</dt>
                <dd className="text-[14px] font-medium text-foreground">{parsed.financial_summary.monthly_obligations}</dd>
              </div>
            </dl>
          </div>

          {/* Identity Verification */}
          <div className="rounded-xl bg-secondary p-4">
            <h3 className="text-[13px] font-medium text-muted-foreground mb-3">Identity Verification</h3>
            <div className="flex items-center gap-4 mb-2">
              <span className="text-[13px] text-foreground">
                Name: {parsed.identity_verification.name_consistent ? (
                  <span className="text-success font-medium">Consistent</span>
                ) : (
                  <span className="text-destructive font-medium">Inconsistent</span>
                )}
              </span>
              <span className="text-[13px] text-foreground">
                Address: {parsed.identity_verification.address_consistent ? (
                  <span className="text-success font-medium">Consistent</span>
                ) : (
                  <span className="text-destructive font-medium">Inconsistent</span>
                )}
              </span>
            </div>
            <p className="text-[13px] text-muted-foreground">{parsed.identity_verification.notes}</p>
          </div>

          {/* Red Flags */}
          {parsed.red_flags.length > 0 && (
            <div className="rounded-xl bg-secondary p-4">
              <h3 className="text-[13px] font-medium text-muted-foreground mb-3">
                Red Flags ({parsed.red_flags.length})
              </h3>
              <div className="space-y-2">
                {parsed.red_flags.map((flag, i) => {
                  const style = FLAG_SEVERITY_STYLES[flag.severity] || FLAG_SEVERITY_STYLES.info;
                  return (
                    <div key={i} className={`rounded-lg border p-3 ${style.bg} ${style.border}`}>
                      <div className="flex items-center justify-between mb-1">
                        <p className={`text-[13px] font-medium ${style.text}`}>{flag.flag}</p>
                        <span className={`text-[11px] font-medium uppercase ${style.text}`}>{flag.severity}</span>
                      </div>
                      <p className="text-[12px] text-muted-foreground">{flag.details}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Timestamp */}
          {analyzedAt && (
            <p className="text-[11px] text-muted-foreground text-right">
              Analyzed: {new Date(analyzedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Raw fallback */}
      {hasResult && !parsed && (
        <div className="rounded-xl bg-secondary p-4">
          <h3 className="text-[13px] font-medium text-muted-foreground mb-2">Raw Analysis Result</h3>
          <pre className="text-[12px] text-foreground whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
            {analysisResult}
          </pre>
        </div>
      )}
    </GlassCard>
  );
}
