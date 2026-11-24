import { Field } from '@base-ui-components/react/field';
import { Select } from '@base-ui-components/react/select';
import { Check, ChevronDown } from 'lucide-react';

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** `[value, label]` pairs; the first one should be the "all" entry. */
  options: [string, string][];
  className?: string;
  /** Visually hide the label while keeping the trigger's accessible name. */
  hideLabel?: boolean;
}

/** Shared labelled select used by the filters, query editor, and header. */
export default function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
  hideLabel = false,
}: FilterSelectProps) {
  return (
    <Field.Root className={className ? `field ${className}` : 'field'}>
      {!hideLabel && <Field.Label>{label}</Field.Label>}
      <Select.Root value={value} onValueChange={(next) => onChange(next ?? options[0][0])}>
        <Select.Trigger className="select-trigger" aria-label={label}>
          <Select.Value>
            {(value) =>
              options.find(([optionValue]) => optionValue === value)?.[1] ??
              options[0]?.[1] ??
              ''
            }
          </Select.Value>
          <Select.Icon className="select-icon">
            <ChevronDown size={14} aria-hidden="true" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="popup-positioner" sideOffset={6} alignItemWithTrigger={false}>
            <Select.Popup className="select-popup popup">
              <Select.List>
                {options.map(([optionValue, optionLabel]) => (
                  <Select.Item key={optionValue} value={optionValue} className="select-item">
                    <Select.ItemIndicator className="select-check">
                      <Check size={13} strokeWidth={3} aria-hidden="true" />
                    </Select.ItemIndicator>
                    <Select.ItemText>{optionLabel}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </Field.Root>
  );
}
