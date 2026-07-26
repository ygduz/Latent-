import type { Preset } from '../../engine/types';
import { activeEffects } from '../../engine/presets/routing';

interface PresetPickerProps {
  readonly presets: readonly Preset[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
}

export function PresetPicker({ presets, selectedId, onSelect }: PresetPickerProps) {
  return (
    <section className="presets" aria-label="Motion presets">
      <h2>Motion</h2>
      <div className="preset-list" role="radiogroup" aria-label="Motion presets">
        {presets.map((preset) => {
          const selected = preset.id === selectedId;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`preset${selected ? ' is-selected' : ''}`}
              onClick={() => onSelect(preset.id)}
            >
              <span className="preset-name">{preset.name}</span>
              <span className="preset-description">{preset.description}</span>
              <span className="preset-effects">{activeEffects(preset).join(' · ')}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
