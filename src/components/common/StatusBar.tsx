interface StatusBarProps {
  message: string;
  tone?: "neutral" | "error" | "success";
}

export function StatusBar({ message, tone = "neutral" }: StatusBarProps) {
  return (
    <footer className={`status-bar status-bar--${tone}`} aria-live="polite">
      <span className="status-bar__indicator" />
      {message}
    </footer>
  );
}
