import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useState } from "react";

export type MenuOption = {
  value: string;
  label: string;
  count?: number;
  /** A heading row inside the menu (a region above its countries). Selectable when it has a value. */
  heading?: boolean;
};

/**
 * One filter as a word that opens a list. Ours rather than the browser's `<select>`: the native one draws
 * the operating system's picker, which ignored every rule of the page it sat on.
 *
 * Single choice closes on pick. Multiple choice stays open until you click away or press Escape.
 */
export function FilterMenu({
  label,
  options,
  selected,
  onChange,
  multi = false,
  width = 260,
}: {
  label: string;
  options: MenuOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const active = selected.filter(Boolean);
  const names = active.map((v) => options.find((o) => o.value === v)?.label ?? v);
  const summary =
    names.length === 0 ? label : names.length === 1 ? names[0] : `${label} ${names.length}`;

  const pick = (value: string) => {
    if (!multi) {
      onChange(active[0] === value ? [] : [value]);
      setOpen(false);
      return;
    }
    onChange(active.includes(value) ? active.filter((v) => v !== value) : [...active, value]);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        className={
          "inline-flex shrink-0 items-center gap-[6px] border-b pb-[2px] text-[14px] outline-none transition-colors focus-visible:border-foreground " +
          (active.length
            ? "border-foreground text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground")
        }
      >
        <span className="max-w-[180px] truncate">{summary}</span>
        <svg width="9" height="6" viewBox="0 0 9 6" aria-hidden="true" className="opacity-70">
          <path d="M1 1l3.5 3.5L8 1" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={8}
          collisionPadding={16}
          style={{ width }}
          className="z-50 max-h-[min(420px,var(--radix-popover-content-available-height))] overflow-y-auto border border-hairline bg-background py-2 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] outline-none"
        >
          <ul role="listbox" aria-label={label} aria-multiselectable={multi}>
            {options.map((o, i) =>
              o.heading && !o.value ? (
                <li
                  key={`h-${o.label}-${i}`}
                  className="px-4 pb-1 pt-3 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80"
                >
                  {o.label}
                </li>
              ) : (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active.includes(o.value)}
                    onClick={() => pick(o.value)}
                    className={
                      "flex w-full items-baseline justify-between gap-4 px-4 py-[7px] text-left text-[14px] outline-none transition-colors hover:bg-surface focus-visible:bg-surface " +
                      (o.heading ? "pt-3 " : "") +
                      (active.includes(o.value) ? "text-foreground" : "text-muted-foreground")
                    }
                  >
                    <span className="flex items-baseline gap-2">
                      <span
                        aria-hidden="true"
                        className={active.includes(o.value) ? "w-3 text-primary" : "w-3"}
                      >
                        {active.includes(o.value) ? "✓" : ""}
                      </span>
                      <span className={o.heading ? "text-foreground" : ""}>{o.label}</span>
                    </span>
                    {o.count != null ? (
                      <span className="text-[12px] text-muted-foreground/80">{o.count}</span>
                    ) : null}
                  </button>
                </li>
              ),
            )}
          </ul>
          {multi && active.length ? (
            <div className="mt-1 border-t border-hairline px-4 pt-2">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[13px] text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            </div>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
