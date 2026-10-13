import type { FC } from 'react';
import type { WorkflowExecution, WorkflowStepRecord } from '../types.js';

export interface WorkflowGraphProps {
  execution: WorkflowExecution;
  steps: WorkflowStepRecord[];
  onRetry?: () => void;
  onSendEvent?: (eventName: string) => void;
}

export const WorkflowGraph: FC<WorkflowGraphProps> = ({
  execution,
  steps = [],
  onRetry,
  onSendEvent,
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#10b981'; // Green
      case 'running':
        return '#00e5ff'; // Electric blue
      case 'sleeping':
        return '#818cf8'; // Indigo
      case 'waiting_event':
        return '#f59e0b'; // Amber
      case 'failed':
        return '#ef4444'; // Red
      default:
        return '#9490a5'; // Grey
    }
  };

  return (
    <div
      style={{
        backgroundColor: '#100e18',
        border: '1px solid #231f32',
        borderRadius: '8px',
        padding: '1.5rem',
        color: '#fff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Workflow Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #231f32',
          paddingBottom: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
              {execution.workflowName}
            </h2>
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${getStatusColor(execution.status)}`,
                color: getStatusColor(execution.status),
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              {execution.status}
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#9490a5', marginTop: '0.25rem' }}>
            ID: <code style={{ color: '#00e5ff' }}>{execution.id}</code> • Started:{' '}
            {new Date(execution.createdAt).toLocaleTimeString()}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {execution.status === 'failed' && onRetry && (
            <button
              onClick={onRetry}
              style={{
                backgroundColor: '#ffffff',
                color: '#08060d',
                border: 'none',
                padding: '0.4rem 0.8rem',
                borderRadius: '4px',
                fontWeight: 600,
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              Replay Workflow
            </button>
          )}
          {execution.status === 'waiting_event' && execution.waitingForEventName && onSendEvent && (
            <button
              onClick={() => onSendEvent(execution.waitingForEventName!)}
              style={{
                backgroundColor: '#f59e0b',
                color: '#08060d',
                border: 'none',
                padding: '0.4rem 0.8rem',
                borderRadius: '4px',
                fontWeight: 600,
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              Send "{execution.waitingForEventName}" Event
            </button>
          )}
        </div>
      </div>

      {/* Step Timeline Graph */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#9490a5', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Execution Steps ({steps.length})
        </h4>

        {steps.length === 0 ? (
          <div style={{ color: '#635f75', fontSize: '0.875rem', padding: '1rem 0' }}>
            No steps executed yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {steps.map((step, idx) => (
              <div
                key={step.id || idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  backgroundColor: '#151220',
                  border: '1px solid #231f32',
                  borderRadius: '6px',
                  borderLeft: `4px solid ${getStatusColor(step.status)}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      color: '#635f75',
                      width: '18px',
                    }}
                  >
                    #{idx + 1}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      {step.stepId}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#9490a5', fontFamily: 'monospace' }}>
                      type: {step.stepType} {step.attempts > 1 ? `• attempts: ${step.attempts}` : ''}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  {step.durationMs !== undefined && (
                    <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#9490a5' }}>
                      {step.durationMs}ms
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: getStatusColor(step.status),
                      textTransform: 'capitalize',
                    }}
                  >
                    {step.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Workflow Output / Error */}
      {execution.error && (
        <div
          style={{
            marginTop: '1.5rem',
            padding: '0.75rem 1rem',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '6px',
            color: '#ef4444',
            fontSize: '0.85rem',
          }}
        >
          <strong>Error:</strong> {execution.error}
        </div>
      )}

      {execution.output !== undefined && execution.output !== null && (
        <div
          style={{
            marginTop: '1.5rem',
            padding: '0.75rem 1rem',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: '6px',
            fontSize: '0.85rem',
          }}
        >
          <strong style={{ color: '#10b981' }}>Workflow Output:</strong>
          <pre
            style={{
              margin: '0.5rem 0 0',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              color: '#fff',
              overflowX: 'auto',
            }}
          >
            {JSON.stringify(execution.output, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
