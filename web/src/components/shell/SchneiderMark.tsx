/**
 * The Schneider Electric lockup from the reference renders, drawn rather than
 * imported: the brand assets are not ours to commit, and the mark is four
 * chevrons and a wordmark.
 */
export function SchneiderMark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <svg width="132" height="30" viewBox="0 0 132 30" role="img" aria-label="Schneider Electric">
        <g fill="var(--color-brand-400)">
          <path d="M2 4h22l-5 5H7z" />
          <path d="M0 11h24l-5 5H5z" />
          <path d="M3 18h21l-5 5H8z" />
        </g>
        <text
          x="32"
          y="13"
          fill="currentColor"
          fontSize="13"
          fontWeight="600"
          fontFamily="var(--font-sans)"
        >
          Schneider
        </text>
        <text
          x="32"
          y="26"
          fill="var(--color-brand-400)"
          fontSize="12"
          fontStyle="italic"
          fontFamily="var(--font-sans)"
        >
          Electric
        </text>
      </svg>
    </span>
  );
}
