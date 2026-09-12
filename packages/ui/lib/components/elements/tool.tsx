import { cn } from '../../utils';
import { Badge, Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  CopyIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react';
import type { ToolPartState } from '@extension/shared';
import type { ComponentProps, ReactNode } from 'react';

type ToolProps = ComponentProps<typeof Collapsible>;

const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible className={cn('not-prose mb-1 w-full rounded border border-border/30', className)} {...props} />
);

type ToolHeaderProps = {
  name: string;
  state: ToolPartState;
  /** Copy handler — when provided, a copy button is shown in the header. */
  onCopy?: () => void;
  className?: string;
};

const statusLabels: Record<ToolPartState, string> = {
  'input-streaming': 'Pending',
  'input-available': 'Running',
  'output-available': 'Completed',
  'output-error': 'Error',
};

const statusIcons: Record<ToolPartState, ReactNode> = {
  'input-streaming': <CircleIcon className="size-2.5" />,
  'input-available': <ClockIcon className="size-2.5 animate-pulse" />,
  'output-available': <CheckCircleIcon className="size-2.5 text-green-600" />,
  'output-error': <XCircleIcon className="size-2.5 text-red-600" />,
};

const getStatusBadge = (status: ToolPartState) => (
  <Badge className="flex items-center gap-0.5 rounded-full px-1.5 py-0 text-[10px] leading-4" variant="secondary">
    {statusIcons[status]}
    <span>{statusLabels[status]}</span>
  </Badge>
);

const ToolHeader = ({ className, name, state, onCopy, ...props }: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn('flex w-full min-w-0 items-center justify-between gap-1.5 px-2 py-1', className)}
    {...props}>
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <WrenchIcon className="text-muted-foreground/50 size-3 shrink-0" />
      <span className="text-muted-foreground truncate text-xs">{name}</span>
    </div>
    <div className="flex shrink-0 items-center gap-1.5">
      {getStatusBadge(state)}
      {onCopy && (
        <Button
          className="size-5"
          onClick={e => {
            e.stopPropagation();
            onCopy();
          }}
          size="icon"
          variant="ghost">
          <CopyIcon className="size-2.5" />
        </Button>
      )}
      <ChevronDownIcon className="text-muted-foreground/50 size-3 transition-transform group-data-[state=open]:rotate-180" />
    </div>
  </CollapsibleTrigger>
);

type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      'data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-hidden',
      className,
    )}
    {...props}
  />
);

type ToolInputProps = ComponentProps<'div'> & {
  input: Record<string, unknown>;
};

const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn('space-y-1.5 overflow-hidden border-t border-border/30 px-3 py-2', className)} {...props}>
    <h4 className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
      Parameters
    </h4>
    <pre className="bg-muted/50 overflow-x-auto rounded p-2 font-mono text-[10px]">
      {JSON.stringify(input, null, 2)}
    </pre>
  </div>
);

type ToolOutputProps = ComponentProps<'div'> & {
  output: ReactNode;
  errorText?: string;
};

const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  return (
    <div className={cn('space-y-1.5 border-t border-border/30 px-3 py-2', className)} {...props}>
      <h4 className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
        {errorText ? 'Error' : 'Result'}
      </h4>
      <div
        className={cn(
          'overflow-x-auto rounded text-[10px] [&_table]:w-full',
          errorText ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-foreground',
        )}>
        {errorText && <div>{errorText}</div>}
        {output && <div>{output}</div>}
      </div>
    </div>
  );
};

export { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput };
export type { ToolProps, ToolHeaderProps, ToolContentProps, ToolInputProps, ToolOutputProps };
