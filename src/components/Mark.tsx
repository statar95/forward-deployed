/**
 * The mark: a circle of ink with a dot sitting low in it, something that landed on the ground.
 *
 * Drawn inline rather than loaded from /favicon.svg so it inherits the page's colour and never
 * flashes in late. The same geometry is in public/favicon.svg and the raster icons.
 */
export function Mark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <circle cx="50" cy="50" r="50" fill="currentColor" />
      <circle cx="50" cy="63" r="14" fill="var(--background)" />
    </svg>
  );
}
