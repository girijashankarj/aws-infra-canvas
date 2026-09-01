import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

import { CATEGORY_COLORS, fallbackName, lookupCanonical } from '../../../model/registry';
import { ServiceIcon } from '../../../icons';

export interface GroupNodeData extends Record<string, unknown> {
  label: string;
  canonicalType: string;
  rawType: string;
  readOnly: boolean;
  findings?: number;
  worst?: 'high' | 'medium' | 'low' | null;
}

export type GroupFlowNode = Node<GroupNodeData, 'group'>;

/**
 * A container resource (VPC, subnet). Only the header is clickable, so dragging
 * inside the body still pans the canvas and children stay easy to grab.
 */
export function GroupNodeView({ data, selected }: NodeProps<GroupFlowNode>) {
  const def = lookupCanonical(data.canonicalType);
  const tint = def ? CATEGORY_COLORS[def.category] : 'var(--edge)';

  return (
    <div
      className={`rf-group${selected ? ' selected' : ''}`}
      style={{ '--tint': tint } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} />
      <div className="group-head">
        <ServiceIcon icon={def?.icon ?? 'generic'} size={16} />
        {data.label}
        <span className="sub">{def?.short ?? fallbackName(data.rawType)}</span>
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
