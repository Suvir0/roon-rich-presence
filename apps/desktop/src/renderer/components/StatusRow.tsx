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
    <div className="status">
      <span className={`dot ${dotClass}`} />
      <span>
        <small>{label}</small>
        <strong>{statusLabel}</strong>
      </span>
    </div>
  );
}
