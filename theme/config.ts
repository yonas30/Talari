// Phase 1-3 ship Light only: most screens still read the static Light `colors` and are not migrated to useTheme() yet,
// so a Dark switch would produce half-dark screens. Phase 4 flips this to true (and shows the Appearance setting).
export const APPEARANCE_ENABLED = false;
