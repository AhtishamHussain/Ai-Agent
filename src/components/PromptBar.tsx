export function PromptBar({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  return (
    <form
      className="prompt-bar"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled && value.trim()) onSubmit();
      }}
    >
      <label className="prompt-label" htmlFor="idea">
        What should the team build?
      </label>
      <div className="prompt-row">
        <textarea
          id="idea"
          className="prompt-input"
          rows={3}
          placeholder="e.g. A habit tracker with streaks, reminders, and a clean weekly review dashboard…"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (!disabled && value.trim()) onSubmit();
            }
          }}
        />
        <button type="submit" className="btn-run" disabled={disabled || !value.trim()}>
          {disabled ? "Working…" : "Run team"}
        </button>
      </div>
      <p className="prompt-hint">Ctrl/Cmd + Enter to run</p>
    </form>
  );
}
