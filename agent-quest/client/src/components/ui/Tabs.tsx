/**
 * Tabs — Portfolio-style pill tab navigation.
 *
 * Usage:
 *   <Tabs
 *     items={[{ label: 'All', value: 'all' }, { label: 'Active', value: 'active' }]}
 *     value="all"
 *     onChange={(v) => setFilter(v)}
 *   />
 */

export interface TabItem<T extends string = string> {
  label: string;
  value: T;
}

interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  className = '',
}: TabsProps<T>) {
  return (
    <div className={`flex gap-2 overflow-x-auto ${className}`}>
      {items.map((item) => (
        <button
          key={item.value}
          onClick={() => onChange(item.value)}
          className={`px-4 py-2 rounded-lg text-sm transition-all whitespace-nowrap ${
            value === item.value
              ? 'text-text-primary bg-bg-card border border-border-hover'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
