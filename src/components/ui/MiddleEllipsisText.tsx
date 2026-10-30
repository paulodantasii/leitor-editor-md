import { splitDisplayName } from '@/services/displayName';

interface MiddleEllipsisTextProps {
  text: string;
  className?: string;
  showTooltip?: boolean;
}

export function MiddleEllipsisText({
  text,
  className = '',
  showTooltip = true,
}: MiddleEllipsisTextProps) {
  const { head, tail } = splitDisplayName(text);
  return (
    <span
      className={`inline-flex min-w-0 max-w-full whitespace-pre ${className}`}
      title={showTooltip ? text : undefined}
    >
      <span className="min-w-0 truncate">{head}</span>
      {tail ? <span className="shrink-0">{tail}</span> : null}
    </span>
  );
}
