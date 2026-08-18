export function StatusRow({
  label,
  dotClass,
  statusLabel
}: {
  label: string;
  dotClass: string;
  statusLabel: string;
}) {
  return (
    <span className="status-item">
      <span className={`status-dot ${dotClass}`} aria-hidden="true" />
      {label} — {statusLabel}
    </span>
  );
}
