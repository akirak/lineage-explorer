import { useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import type { DatasetNode as DatasetData, JobNode as JobData } from '../shared/types.ts';

export type Role = 'none' | 'selected' | 'up' | 'down';

type Highlight = {
  role?: Role;
  dim?: boolean;
};

export type TableData = DatasetData &
  Highlight & {
    /** Highlight role per field name; missing means 'none'. */
    fieldRoles: Record<string, Role>;
  };

export type DatasetFlowNode = Node<DatasetData & Highlight, 'dataset'>;
export type JobFlowNode = Node<JobData & Highlight, 'job'>;
export type TableFlowNode = Node<TableData, 'table'>;
export type LineageFlowNode = DatasetFlowNode | JobFlowNode;

const handleStyle = { opacity: 0, pointerEvents: 'none' } as const;

export const inHandle = (field: string) => `in:${field}`;
export const outHandle = (field: string) => `out:${field}`;

const nodeLabel = (title: string | null, name: string) => title ?? name;
const nodeTooltip = (
  title: string | null,
  name: string,
  namespace: string,
  description: string | null,
  archetype: string | null,
) =>
  [title && title !== name ? title : null, name, namespace, archetype, description].filter(Boolean).join('\n');
const archetypeClass = (archetype: string | null) => (archetype ? ' has-archetype' : '');

export function DatasetNode({ data }: NodeProps<DatasetFlowNode>) {
  return (
    <div
      className={`node dataset role-${data.role}${data.dim ? ' dim' : ''}${archetypeClass(data.archetype)}`}
      title={nodeTooltip(data.title, data.name, data.namespace, data.description, data.archetype)}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div className="node-name">{nodeLabel(data.title, data.name)}</div>
      <div className="node-ns">{data.namespace}</div>
      {data.archetype && <span className="archetype-badge">{data.archetype}</span>}
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}

export function JobNode({ data }: NodeProps<JobFlowNode>) {
  return (
    <div
      className={`node job role-${data.role}${data.dim ? ' dim' : ''}${archetypeClass(data.archetype)}`}
      title={nodeTooltip(data.title, data.name, data.namespace, data.description, data.archetype)}
    >
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <div className="node-text">
        <div className="node-name">{nodeLabel(data.title, data.name)}</div>
        <div className="node-ns">{data.namespace}</div>
      </div>
      {data.archetype && <span className="archetype-badge">{data.archetype}</span>}
      <Handle type="source" position={Position.Right} style={handleStyle} />
    </div>
  );
}

/** A dataset drawn as a table with one row (and one pair of handles) per column. */
export function TableNode({ id, data }: NodeProps<TableFlowNode>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const fieldsKey = data.fields.map((f) => f.name).join('\u0000');
  useEffect(() => updateNodeInternals(id), [id, fieldsKey, updateNodeInternals]);

  return (
    <div className={`table-node role-${data.role}${data.dim ? ' dim' : ''}`}>
      <div
        className={`table-head${archetypeClass(data.archetype)}`}
        title={nodeTooltip(data.title, data.name, data.namespace, data.description, data.archetype)}
      >
        <div className="node-name">{nodeLabel(data.title, data.name)}</div>
        <div className="node-ns">{data.namespace}</div>
        {data.archetype && <span className="archetype-badge">{data.archetype}</span>}
      </div>
      <ul className="table-fields">
        {data.fields.length === 0 && <li className="table-field empty">No column metadata</li>}
        {data.fields.map((f) => {
          const role = data.fieldRoles[f.name] ?? 'none';
          return (
            <li
              key={f.name}
              className={`table-field field-${role}`}
              data-field={f.name}
              title={f.description ? `${f.name}: ${f.description}` : f.name}
            >
              <Handle id={inHandle(f.name)} type="target" position={Position.Left} style={handleStyle} />
              <span className="field-name">{f.name}</span>
              {f.type && <span className="field-type">{f.type}</span>}
              <Handle id={outHandle(f.name)} type="source" position={Position.Right} style={handleStyle} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const nodeTypes = { dataset: DatasetNode, job: JobNode, table: TableNode };
