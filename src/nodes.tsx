import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { DatasetNode as DatasetData, JobNode as JobData } from '../shared/types.ts';

export const STATE_LABEL: Record<string, string> = {
  COMPLETE: 'Complete',
  FAIL: 'Failed',
  ABORT: 'Aborted',
  START: 'Started',
  RUNNING: 'Running',
  OTHER: 'Other',
};

export const stateKey = (s: string | null | undefined) => (s ? s.toLowerCase() : 'none');

export type Role = 'none' | 'selected' | 'up' | 'down';

type Highlight = {
  role?: Role;
  dim?: boolean;
};

export type DatasetFlowNode = Node<DatasetData & Highlight, 'dataset'>;
export type JobFlowNode = Node<JobData & Highlight, 'job'>;
export type LineageFlowNode = DatasetFlowNode | JobFlowNode;

const handleStyle = { opacity: 0, pointerEvents: 'none' } as const;

export function DatasetNode({ data }: NodeProps<DatasetFlowNode>) {
  return (
    <div className={`node dataset role-${data.role}${data.dim ? ' dim' : ''}`} title={`${data.namespace}\n${data.name}`}>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div className="node-name">{data.name}</div>
      <div className="node-ns">{data.namespace}</div>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}

export function JobNode({ data }: NodeProps<JobFlowNode>) {
  return (
    <div className={`node job role-${data.role}${data.dim ? ' dim' : ''}`} title={`${data.namespace}\n${data.name}`}>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <span
        className={`dot state-${stateKey(data.state)}`}
        aria-label={(data.state && STATE_LABEL[data.state]) || 'No runs'}
      />
      <div className="node-text">
        <div className="node-name">{data.name}</div>
        <div className="node-ns">{data.namespace}</div>
      </div>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}

export const nodeTypes = { dataset: DatasetNode, job: JobNode };
