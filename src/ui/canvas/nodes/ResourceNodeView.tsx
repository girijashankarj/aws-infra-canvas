import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

import { CATEGORY_COLORS, fallbackName, lookupCanonical } from '../../../model/registry';
import { ServiceIcon } from '../../../icons';

export interface ResourceNodeData extends Record<string, unknown> {
  label: string;
  canonicalType: string;
  rawType: string;
  readOnly: boolean;
  /** Well-Architected findings on this resource, if the review is showing. */
  findings?: number;
  worst?: 'high' | 'medium' | 'low' | null;
}

export type ResourceFlowNode = Node<ResourceNodeData, 'resource'>;

export function ResourceNodeView({ data, selected }: NodeProps<ResourceFlowNode>) {
  const def = lookupCanonical(data.canonicalType);
  const tint = def ? CATEGORY_COLORS[def.category] : 'var(--edge)';
  const title = def?.name ?? fallbackName(data.rawType);

  return (
    <div
      className={`rf-node${selected ? ' selected' : ''}${data.readOnly ? ' readonly' : ''}`}
      style={{ '--tint': tint } as React.CSSProperties}
      title={data.rawType}
    >
      <Handle type="target" position={Position.Left} />
      <span className="glyph">
        <ServiceIcon icon={def?.icon ?? 'generic'} size={22} />
      </span>
      <div className="meta">
        <div className="id">{data.label}</div>
        <div className="type">{title}</div>
      </div>
      <Handle type="source" position={Position.Right} />
      {data.findings ? (
        <span
          className={`badge ${data.worst ?? 'low'}`}
          title={`${data.findings} Well-Architected finding${data.findings === 1 ? '' : 's'}`}
        >
          {data.findings}
        </span>
      ) : null}
    </div>
  );
}
