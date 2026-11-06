import { Menu } from '@base-ui-components/react/menu';
import { Check, ChevronDown, Layers } from 'lucide-react';

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
 * Built on the Base UI Menu, which handles focus, keyboard navigation, and
 * dismissal.
 */
export default function NamespacePicker({ namespaces, selected, onChange }: NamespacePickerProps) {
  const label =
    selected.length === 0
      ? 'All namespaces'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} namespaces`;

  const toggle = (namespace: string) =>
    onChange(selected.includes(namespace) ? selected.filter((n) => n !== namespace) : [...selected, namespace]);

  return (
    <div className="namespace-picker">
      <Menu.Root>
        <Menu.Trigger
          className="picker-toggle"
          aria-label={`Namespaces: ${label}`}
          title={selected.join(', ') || 'Filter by namespace'}
        >
          <Layers size={15} className="picker-icon" aria-hidden="true" />
          <span className="picker-label">{label}</span>
          <ChevronDown size={14} className="picker-caret" aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="popup-positioner" sideOffset={6} align="start">
            <Menu.Popup className="picker-menu popup" aria-label="Namespaces">
              <Menu.CheckboxItem
                className="picker-option"
                checked={selected.length === 0}
                onCheckedChange={(checked) => {
                  if (checked) onChange([]);
                }}
                closeOnClick={false}
              >
                <Menu.CheckboxItemIndicator className="picker-check" keepMounted>
                  <Check size={13} strokeWidth={3} aria-hidden="true" />
                </Menu.CheckboxItemIndicator>
                <span>All namespaces</span>
              </Menu.CheckboxItem>
              <Menu.Separator className="picker-divider" />
              {namespaces.map((namespace) => (
                <Menu.CheckboxItem
                  className="picker-option"
                  key={namespace}
                  checked={selected.includes(namespace)}
                  onCheckedChange={() => toggle(namespace)}
                  closeOnClick={false}
                >
                  <Menu.CheckboxItemIndicator className="picker-check" keepMounted>
                    <Check size={13} strokeWidth={3} aria-hidden="true" />
                  </Menu.CheckboxItemIndicator>
                  <span className="mono">{namespace}</span>
                </Menu.CheckboxItem>
              ))}
              {namespaces.length === 0 && <p className="muted small picker-empty">No namespaces yet.</p>}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
