import { useEffect, useRef, useState } from 'react';

interface NamespacePickerProps {
  /** Every namespace in the graph. */
  namespaces: string[];
  /** Currently selected namespaces; an empty list means all of them. */
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Multi-select namespace filter. A single button opens a checklist so several
 * namespaces can be shown at once; an empty selection means "all namespaces".
 */
export default function NamespacePicker({ namespaces, selected, onChange }: NamespacePickerProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const label =
    selected.length === 0
      ? 'All namespaces'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} namespaces`;

  const toggle = (namespace: string) =>
    onChange(selected.includes(namespace) ? selected.filter((n) => n !== namespace) : [...selected, namespace]);

  return (
    <div className="field namespace-picker" ref={root}>
      <span id="namespace-label">Namespaces</span>
      <button
        type="button"
        className="picker-toggle"
        aria-expanded={open}
        aria-controls="namespace-menu"
        aria-labelledby="namespace-label"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="picker-label" title={selected.join(', ')}>
          {label}
        </span>
        <span className="picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="picker-menu" id="namespace-menu" role="group" aria-labelledby="namespace-label">
          <label className="picker-option">
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
            <span>All namespaces</span>
          </label>
          <div className="picker-divider" />
          {namespaces.map((namespace) => (
            <label className="picker-option" key={namespace}>
              <input type="checkbox" checked={selected.includes(namespace)} onChange={() => toggle(namespace)} />
              <span className="mono">{namespace}</span>
            </label>
          ))}
          {namespaces.length === 0 && <p className="muted small picker-empty">No namespaces yet.</p>}
        </div>
      )}
    </div>
  );
}
