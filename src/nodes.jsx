import { Handle, Position } from '@xyflow/react';

export const STATE_LABEL = {
  COMPLETE: 'Complete',
  FAIL: 'Failed',
  ABORT: 'Aborted',
  START: 'Started',
  RUNNING: 'Running',
  OTHER: 'Other',
};

export const stateKey = (s) => (s ? s.toLowerCase() : 'none');

const handleStyle = { opacity: 0, pointerEvents: 'none' };

export function DatasetNode({ data }) {
  return (
    <div className={`node dataset role-${data.role}${data.dim ? ' dim' : ''}`} title={`${data.namespace}\n${data.name}`}>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div className="node-name">{data.name}</div>
      <div className="node-ns">{data.namespace}</div>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}

export function JobNode({ data }) {
  return (
    <div className={`node job role-${data.role}${data.dim ? ' dim' : ''}`} title={`${data.namespace}\n${data.name}`}>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <span className={`dot state-${stateKey(data.state)}`} aria-label={STATE_LABEL[data.state] || 'No runs'} />
      <div className="node-text">
        <div className="node-name">{data.name}</div>
        <div className="node-ns">{data.namespace}</div>
      </div>
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}

export const nodeTypes = { dataset: DatasetNode, job: JobNode };
